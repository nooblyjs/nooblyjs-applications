/**
 * Recent View Module
 * View recently accessed documents
 */

import { updateState, AppState } from '../state.js';

export function render(state) {
  const recentDocs = state.recentDocs || [];

  let html = `
    <div style="padding: 18px 16px;">
      <h3 style="font-family: var(--font-display); font-weight: 800; font-size: 17px; color: var(--text-strong); margin: 0 0 4px 0;">Recently viewed</h3>
      <p style="font-size: 12px; color: #86938f; margin: 0; margin-bottom: 16px;">Picks up where you left off</p>
    </div>
  `;

  if (recentDocs.length === 0) {
    html += `
      <div style="padding: 40px 16px; text-align: center; color: #9aa8a4;">
        <p style="font-size: 14px;">No recently viewed documents</p>
        <p style="font-size: 12px;">Documents you view will appear here</p>
      </div>
    `;
  } else {
    html += `<div style="padding: 0 16px 16px; display: flex; flex-direction: column; gap: 9px; background: var(--gray-bg);">`;

    recentDocs.slice(0, 20).forEach((doc) => {
      const relativeTime = getRelativeTime(doc.visitedAt);

      html += `
        <div class="recent-doc-card" data-path="${escapeAttr(doc.path)}" data-space="${escapeAttr(doc.spaceName)}" data-title="${escapeAttr(doc.title)}" style="background: var(--white); border: 1px solid var(--border-mid); border-radius: 13px; padding: 12px 13px; display: flex; gap: 11px; cursor: pointer; transition: all 120ms;">
          <div style="flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px; background: var(--teal-bg); color: var(--teal-300); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">
            md
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13.5px; font-weight: 700; color: var(--text-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">
              ${escapeHtml(doc.title)}
            </div>
            <div style="font-size: 11.5px; color: #86938f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(doc.spaceName)}
            </div>
          </div>
          <div style="flex-shrink: 0; font-size: 11px; color: #a3afab; white-space: nowrap;">
            ${relativeTime}
          </div>
        </div>
      `;
    });

    html += `</div>`;
  }

  return html;
}

export function setup(container, state) {
  // Recent doc card clicks
  container.querySelectorAll('.recent-doc-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const path = e.currentTarget.dataset.path;
      const spaceName = e.currentTarget.dataset.space;
      const title = e.currentTarget.dataset.title;

      if (path && spaceName) {
        // Track this visit
        if (AppState.api) {
          AppState.api.recordVisit(path, spaceName, title).catch((err) => {
            console.warn('[Recent] Could not record visit:', err);
          });
        }

        updateState({
          view: 'doc',
          backTo: 'recent',
          openDoc: { path, spaceName, title: title || path },
        });
      }
    });
  });
}

function getRelativeTime(timestamp) {
  if (!timestamp) return '';

  const now = new Date();
  const time = new Date(timestamp);
  const diffMs = now - time;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return time.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
