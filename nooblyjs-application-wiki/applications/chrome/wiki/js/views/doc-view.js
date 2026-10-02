/**
 * Document View Module
 * Full document reading experience
 */

import { updateState, AppState } from '../state.js';

export function render(state) {
  const doc = state.openDoc || {};
  const backToLabel = state.backTo === 'ask' ? 'Ask' : state.backTo === 'search' ? 'Search' : state.backTo === 'browse' ? 'Browse' : state.backTo === 'recent' ? 'Recent' : 'Previous';
  const ext = (doc.path || '').split('.').pop().toLowerCase();
  const chipLabel = (doc.viewer && doc.viewer !== 'markdown' && ext) ? ext.slice(0, 4) : 'md';

  let html = '';

  // Header with back button and breadcrumb
  html += `
    <div style="padding: 12px 14px; background: var(--white); border-bottom: 1px solid #eceeee; display: flex; gap: 8px; align-items: center;">
      <button id="doc-back-btn" style="background: none; border: none; color: var(--teal-500); cursor: pointer; font-size: 20px; padding: 0; display: flex; align-items: center;" title="Go back">
        ←
      </button>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 12px; color: #86938f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(doc.spaceName || 'Document')} · ${escapeHtml(doc.title || doc.path || 'Untitled')}
        </div>
      </div>
      <button id="doc-menu-btn" style="background: none; border: none; color: #9aa8a4; cursor: pointer; font-size: 18px; padding: 4px;">⋯</button>
    </div>
  `;

  // Doc metadata block — md chip + title/meta on the left, Star button on the right
  html += `
    <div style="background: var(--white); border-bottom: 1px solid #eceeee; padding: 13px; display: flex; gap: 12px; align-items: center;">
      <div style="flex-shrink: 0; width: 38px; height: 38px; border-radius: 8px; background: var(--teal-bg); color: var(--teal-300); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; text-transform: uppercase;">
        ${escapeHtml(chipLabel)}
      </div>
      <div style="flex: 1; min-width: 0;">
        <h2 style="margin: 0 0 4px 0; font-size: 15px; font-weight: 800; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(doc.title || 'Untitled')}
        </h2>
        <div style="font-size: 11.5px; color: #86938f; margin: 0;">
          ${doc.size ? (doc.size / 1024).toFixed(1) + ' KB' : '—'} · updated ${doc.modifiedAt ? getRelativeTime(doc.modifiedAt) : 'recently'}
        </div>
      </div>
      <button id="doc-star-btn" style="flex-shrink: 0; min-width: 150px; padding: 10px 16px; border: 1px solid var(--border-mid); border-radius: 9px; background: var(--gray-input); color: var(--text-body); font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
        <i class="bi bi-star"></i>
        Star
      </button>
    </div>
  `;

  // Document content
  if (isBinaryViewer(doc.viewer)) {
    // PDF / image / video / audio — render the file itself, not markdown.
    html += renderBinaryViewer(doc);
  } else if (doc.content) {
    html += `
      <div class="md-doc" style="background: var(--white); padding: 18px 16px 24px;">
        ${renderMarkdown(doc.content)}
      </div>
    `;
  } else {
    // Loading state
    html += `
      <div style="padding: 40px 16px; text-align: center; color: #9aa8a4;">
        <p>Loading document...</p>
      </div>
    `;
  }

  return html;
}

const BINARY_VIEWERS = ['image', 'pdf', 'video', 'audio'];

function isBinaryViewer(viewer) {
  return BINARY_VIEWERS.includes(viewer);
}

/**
 * Render a binary file (PDF/image/video/audio) inline from the blob URL that
 * loadDocumentContent fetched. A blob URL is same-origin to the side panel, so
 * it loads without tripping the server's cross-origin / framing policies (a
 * direct cross-origin <iframe>/<img> to the server would be refused).
 */
function renderBinaryViewer(doc) {
  const fileName = doc.title || (doc.path ? doc.path.split('/').pop() : 'file');

  if (doc.binaryError) {
    return `
      <div style="padding: 40px 16px; text-align: center; color: #9aa8a4;">
        <p>Couldn't preview this ${escapeHtml(doc.viewer)} here.</p>
      </div>`;
  }

  if (!doc.blobUrl) {
    return `
      <div style="padding: 40px 16px; text-align: center; color: #9aa8a4;">
        <p>Loading ${escapeHtml(doc.viewer)}…</p>
      </div>`;
  }

  const src = doc.blobUrl;
  let body = '';
  if (doc.viewer === 'pdf') {
    body = `<iframe src="${src}" title="${escapeHtml(fileName)}" style="width: 100%; height: 78vh; min-height: 460px; border: 1px solid #eceeee; border-radius: 8px; background: #fff; display: block;"></iframe>`;
  } else if (doc.viewer === 'image') {
    body = `<img src="${src}" alt="${escapeHtml(fileName)}" style="max-width: 100%; height: auto; border: 1px solid #eceeee; border-radius: 8px; display: block; margin: 0 auto;" />`;
  } else if (doc.viewer === 'video') {
    body = `<video src="${src}" controls style="width: 100%; border-radius: 8px;"></video>`;
  } else if (doc.viewer === 'audio') {
    body = `<audio src="${src}" controls style="width: 100%;"></audio>`;
  }
  // Gutter so the media sits inset from the panel edges, matching .md-doc.
  return `<div style="padding: 16px 16px 24px; background: var(--white);">${body}</div>`;
}

export function setup(container, state) {
  const backBtn = container.querySelector('#doc-back-btn');
  const starBtn = container.querySelector('#doc-star-btn');
  const doc = state.openDoc || {};

  const handleBack = () => {
    // Free the blob URL and drop the open doc so reopening reloads cleanly.
    if (doc.blobUrl) {
      try { URL.revokeObjectURL(doc.blobUrl); } catch (_) { /* already revoked */ }
    }
    updateState({
      view: 'tab',
      activeTab: state.backTo || 'ask',
      openDoc: null,
    });
  };

  // Back button
  if (backBtn) {
    backBtn.addEventListener('click', handleBack);
  }

  // Star button
  if (starBtn && AppState.api) {
    starBtn.addEventListener('click', async () => {
      try {
        const isStarred = starBtn.classList.contains('starred');
        await AppState.api.toggleStar(doc.path, doc.spaceName, doc.title, isStarred ? 'unstar' : 'star');
        starBtn.classList.toggle('starred');
        if (isStarred) {
          starBtn.innerHTML = '<i class="bi bi-star"></i> Star';
        } else {
          starBtn.innerHTML = '<i class="bi bi-star-fill"></i> Starred';
        }
      } catch (error) {
        console.error('[Doc] Star error:', error);
      }
    });
  }

  // Load document content if not already loaded. Binary docs keep content null
  // (they render from blobUrl), so also treat a fetched blob / error as loaded —
  // otherwise every re-render would refetch the file in a loop.
  const alreadyLoaded = doc.content || doc.blobUrl || doc.binaryError;
  if (!alreadyLoaded && doc.path && doc.spaceName) {
    loadDocumentContent(doc.path, doc.spaceName);
  }
}

async function loadDocumentContent(path, spaceName) {
  if (!AppState.api) return;

  try {
    // enhanced=true is REQUIRED: it makes the backend return JSON
    // { content, metadata:{ size, modified, viewer, ... } }. Without it the
    // backend STREAMS raw text/binary and a .json() parse would throw.
    // spaceId is omitted on purpose — api.js falls back to the wiki
    // /documents/content endpoint, which only needs the space name (browse,
    // search and recent all carry spaceName but not the numeric space id).
    const result = await AppState.api.getDocumentContent(path, spaceName, true);
    const meta = result.metadata || {};
    const isBinary = ['image', 'pdf', 'video', 'audio'].includes(meta.viewer);

    console.log('[Doc] Loaded:', path, meta.viewer || '');

    if (isBinary) {
      // Fetch the raw bytes as a blob URL so the side panel can render the
      // PDF/image/video/audio inline. (A blob URL is same-origin to the panel
      // and sidesteps the cross-origin/framing restrictions that block a direct
      // <iframe>/<img> to the server.)
      let blobUrl = null;
      let binaryError = false;
      try {
        blobUrl = await AppState.api.fetchBinaryBlobUrlByName(path, spaceName);
      } catch (err) {
        console.error('[Doc] Binary preview fetch failed:', err);
        binaryError = true;
      }
      updateState({
        openDoc: {
          ...AppState.openDoc,
          content: null,
          viewer: meta.viewer,
          size: meta.size,
          modifiedAt: meta.modified,
          blobUrl,
          binaryError,
        },
      });
      return;
    }

    updateState({
      openDoc: {
        ...AppState.openDoc,
        content: result.content || '',
        size: meta.size,
        modifiedAt: meta.modified,
        viewer: meta.viewer,
      },
    });
  } catch (error) {
    console.error('[Doc] Load error:', error);
    updateState({
      openDoc: {
        ...AppState.openDoc,
        content: `> Could not load this document.\n>\n> ${error.message}`,
      },
    });
  }
}

/**
 * Render document markdown with the SHARED parser (js/markdown-parser.js),
 * loaded as a classic script in popup.html before this module. It's the same
 * parser the wiki and legacy popup use, so custom syntax renders correctly:
 * tables, inline [badge:variant text] chips, summary blocks, tabs, etc.
 * Output is wrapped by the caller in a .md-doc container (see markdown-styles.css).
 * Falls back to an escaped <pre> only if the parser failed to load.
 */
function renderMarkdown(content) {
  if (typeof window !== 'undefined' && typeof window.parseMarkdown === 'function') {
    try {
      return window.parseMarkdown(content);
    } catch (err) {
      console.error('[Doc] parseMarkdown failed, falling back to plain text:', err);
    }
  }
  return `<pre style="white-space: pre-wrap; word-break: break-word; margin: 0;">${escapeHtml(content)}</pre>`;
}

function getRelativeTime(timestamp) {
  if (!timestamp) return 'recently';

  const now = new Date();
  const time = new Date(timestamp);
  const diffMs = now - time;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return time.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
