/**
 * Browse View Module
 *
 * Two levels:
 *   1. Spaces view (root, when state.browseSpace is null) — hero banner, a card
 *      per space to switch into, plus a "Quick Access" section that lists the
 *      user's pinned / starred / recently-viewed documents grouped by space.
 *   2. Folder view (when a space is selected) — drill through that space's
 *      folder tree from WikiAPI.getFolders (nodes: {type:'folder'|'document',
 *      name, path, children}). Documents open by their own real `path`.
 */

import { updateState, AppState } from '../state.js';

/* ===================== top-level dispatch ===================== */

export function render(state) {
  return state.browseSpace ? renderFolderView(state) : renderSpacesView(state);
}

export function setup(container, state) {
  if (state.browseSpace) {
    setupFolderView(container, state);
  } else {
    setupSpacesView(container, state);
  }
}

/* ======================== Spaces view ======================== */

function renderSpacesView(state) {
  const spaces = state.browseSpaces;
  const spacesLoaded = Array.isArray(spaces);

  let html = '';

  // Breadcrumb
  html += `
    <div style="padding: 12px 16px 0; background: var(--gray-bg); display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-faint);">
      <i class="bi bi-house-door"></i>
      <span style="color: #b3bfbb;">›</span>
      <span style="color: var(--text-body); font-weight: 600;">Spaces</span>
    </div>
  `;

  // Hero banner
  html += `
    <div style="margin: 14px 16px; padding: 20px; border-radius: 14px; background: linear-gradient(135deg, var(--teal-600), var(--teal-700)); color: #fff;">
      <div style="font-size: 10px; font-weight: 800; letter-spacing: .14em; opacity: .8;">WORKSPACES</div>
      <div style="font-family: var(--font-display); font-size: 24px; font-weight: 800; margin: 4px 0 6px;">Available Spaces</div>
      <div style="font-size: 12.5px; opacity: .85; line-height: 1.5;">Pick a workspace to browse its documents, capabilities, and architecture.</div>
    </div>
  `;

  // Space cards
  html += `<div style="padding: 0 16px;">`;
  if (!spacesLoaded) {
    html += `<div style="text-align: center; color: #9aa8a4; padding: 24px 0;"><p>Loading spaces…</p></div>`;
  } else if (spaces.length === 0) {
    html += `<div style="text-align: center; color: #9aa8a4; padding: 24px 0;"><p>No spaces available.</p></div>`;
  } else {
    spaces.forEach((space) => {
      html += `
        <div class="space-card" data-space-id="${escapeAttr(space.id)}" style="background: var(--white); border: 1px solid var(--border-mid); border-radius: 13px; padding: 14px; display: flex; align-items: center; gap: 13px; cursor: pointer; margin-bottom: 12px; transition: all 120ms;">
          <div style="flex-shrink: 0; width: 44px; height: 44px; border-radius: 10px; background: var(--teal-bg); color: var(--teal-300); display: flex; align-items: center; justify-content: center; font-size: 20px;">
            <i class="bi bi-people-fill"></i>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 15px; font-weight: 800; color: var(--text-strong); margin-bottom: 2px;">${escapeHtml(space.name)}</div>
            <div style="font-size: 12px; color: var(--text-muted-2); line-height: 1.4;">${escapeHtml(space.description || '')}</div>
          </div>
          <span style="flex-shrink: 0; color: #b3bfbb; font-size: 18px;">→</span>
        </div>
      `;
    });
  }
  html += `</div>`;

  // Quick Access — pinned / starred / recent grouped by space
  html += renderQuickAccess(state);

  return html;
}

/** Build the combined, de-duplicated, space-grouped Quick Access list. */
function buildQuickAccessGroups(state) {
  const byPath = new Map(); // path → entry (priority: pin > star > recent)

  const add = (doc, kind) => {
    if (!doc || !doc.path) return;
    const spaceName = doc.spaceName || doc.space || 'Unknown';
    if (!byPath.has(doc.path)) {
      byPath.set(doc.path, {
        path: doc.path,
        spaceName,
        title: doc.title || doc.path.split('/').pop(),
        kind, // 'pin' | 'star' | 'recent'
        type: doc.type, // 'folder' for pinned folders
      });
    }
  };

  (state.pins || []).forEach((p) => add(p, 'pin'));
  (state.starredDocs || []).forEach((d) => add(d, 'star'));
  (state.recentDocs || []).forEach((d) => add(d, 'recent'));

  const groups = {};
  Array.from(byPath.values())
    .slice(0, 18)
    .forEach((entry) => {
      (groups[entry.spaceName] = groups[entry.spaceName] || []).push(entry);
    });
  return groups;
}

function renderQuickAccess(state) {
  const groups = buildQuickAccessGroups(state);
  const spaceNames = Object.keys(groups);
  if (spaceNames.length === 0) return '';

  const badge = {
    pin: { icon: 'bi-pin-angle-fill', color: 'var(--teal-500)', title: 'Pinned' },
    star: { icon: 'bi-star-fill', color: '#e3b341', title: 'Starred' },
    recent: { icon: 'bi-clock-history', color: '#9aa8a4', title: 'Viewed' },
  };

  let html = `
    <div style="padding: 8px 16px 4px;">
      <div style="font-size: 11px; font-weight: 800; letter-spacing: .1em; color: #9aa8a4;">QUICK ACCESS</div>
    </div>
    <div style="padding: 0 16px 20px;">
  `;

  spaceNames.forEach((spaceName) => {
    html += `
      <div style="background: var(--white); border: 1px solid var(--border-mid); border-radius: 13px; padding: 10px 12px; margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 800; color: var(--text-strong); padding: 4px 2px 8px;">${escapeHtml(spaceName)}</div>
    `;
    groups[spaceName].forEach((entry) => {
      const b = badge[entry.kind] || badge.recent;
      const isFolder = entry.type === 'folder';
      html += `
        <div class="qa-item" data-path="${escapeAttr(entry.path)}" data-space="${escapeAttr(spaceName)}" data-title="${escapeAttr(entry.title)}" data-type="${escapeAttr(entry.type || 'document')}" style="display: flex; align-items: center; gap: 10px; padding: 8px 4px; cursor: pointer; border-radius: 8px;">
          <i class="bi ${isFolder ? 'bi-folder-fill' : 'bi-file-earmark-text'}" style="flex-shrink: 0; color: var(--teal-500); font-size: 16px;"></i>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13px; font-weight: 700; color: var(--text-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(entry.title)}</div>
            <div style="font-size: 10.5px; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(entry.path)}</div>
          </div>
          <i class="bi ${b.icon}" title="${b.title}" style="flex-shrink: 0; color: ${b.color}; font-size: 14px;"></i>
        </div>
      `;
    });
    html += `</div>`;
  });

  html += `</div>`;
  return html;
}

function setupSpacesView(container, state) {
  // Space card → enter that space's folder browser
  container.querySelectorAll('.space-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.spaceId;
      const space = (AppState.browseSpaces || []).find((s) => String(s.id) === String(id));
      if (!space) return;
      enterSpace(space, []);
    });
  });

  // Quick Access item → open doc (or drill into a pinned folder)
  container.querySelectorAll('.qa-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      const el = e.currentTarget;
      const path = el.dataset.path;
      const spaceName = el.dataset.space;
      const title = el.dataset.title;
      const type = el.dataset.type;
      if (!path) return;

      const space = (AppState.browseSpaces || []).find((s) => s.name === spaceName);

      if (type === 'folder' && space) {
        // Enter the space and drill straight to the folder. Each step needs its
        // CUMULATIVE path, not just its name — that path is what the level is
        // fetched by, and a step without one silently lists the space root.
        const steps = [];
        path.split('/').filter(Boolean).forEach((name) => {
          const parent = steps.length ? steps[steps.length - 1].path : '';
          steps.push({ name, path: parent ? `${parent}/${name}` : name });
        });
        enterSpace(space, steps);
        return;
      }

      if (space) updateState({ currentSpace: space });
      if (AppState.api) {
        AppState.api.recordVisit(path, spaceName, title).catch(() => {});
      }
      updateState({
        view: 'doc',
        backTo: 'browse',
        openDoc: { path, spaceName, title: title || path },
      });
    });
  });

  // Lazy-load the data the spaces view needs (once)
  ensureSpacesLoaded();
  ensurePinsLoaded();
}

function enterSpace(space, browsePath) {
  updateState({
    browseSpace: space,
    currentSpace: space,
    browsePath: browsePath || [],
    browseCache: {}, // force a fresh load for the new space
    browseTreeSpaceId: null,
    browseError: null,
  });
}

async function ensureSpacesLoaded() {
  if (!AppState.api || Array.isArray(AppState.browseSpaces)) return;
  try {
    const spaces = await AppState.api.getSpaces();
    updateState({ browseSpaces: Array.isArray(spaces) ? spaces : [] });
  } catch (error) {
    console.error('[Browse] Failed to load spaces:', error);
    updateState({ browseSpaces: [] });
  }
}

async function ensurePinsLoaded() {
  if (!AppState.api || Array.isArray(AppState.pins)) return;
  try {
    const result = await AppState.api.getPins();
    updateState({ pins: result && Array.isArray(result.pins) ? result.pins : [] });
  } catch (error) {
    console.warn('[Browse] Failed to load pins:', error);
    updateState({ pins: [] });
  }
}

/* ======================== Folder view ======================== */

/** The space-relative path of the folder currently being shown ('' = root). */
function currentFolderPath() {
  const stack = AppState.browsePath || [];
  return stack.length === 0 ? '' : (stack[stack.length - 1].path || '');
}

/**
 * The level being displayed, from the per-folder cache.
 *
 * Returns null — distinct from an empty array — when this folder has not been
 * fetched yet, so the view can say "loading" rather than "this folder is
 * empty". Those are very different messages and the old code could not tell
 * them apart.
 */
function computeCurrentLevel() {
  const cache = AppState.browseCache || {};
  const level = cache[currentFolderPath()];
  return Array.isArray(level) ? level : null;
}

function renderFolderView(state) {
  const breadcrumbPath = state.browsePath || [];
  const currentLevel = computeCurrentLevel();
  const treeLoaded = currentLevel !== null;
  const loadError = (state.browseError || null);
  const atRoot = breadcrumbPath.length === 0;
  const headingMain = atRoot
    ? state.browseSpace?.name || 'Space'
    : breadcrumbPath[breadcrumbPath.length - 1].name;
  const headingSub = atRoot ? 'Browse' : state.browseSpace?.name || 'Space';

  let html = '';

  // Header — back button always present (at root it returns to the spaces list)
  html += `
    <div style="padding: 12px 14px; background: var(--white); border-bottom: 1px solid #eceeee; display: flex; gap: 8px; align-items: center;">
      <button id="browse-back" title="${atRoot ? 'All spaces' : 'Back'}" style="background: #f1f5f4; border: none; color: var(--teal-500); width: 28px; height: 28px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px;">
        ←
      </button>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #9aa8a4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(headingSub)}
        </div>
        <div style="font-size: 14.5px; font-weight: 800; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(headingMain)}
        </div>
      </div>
    </div>
  `;

  html += `<div style="padding: 16px 14px; background: var(--gray-bg); min-height: 200px;">`;

  if (loadError) {
    html += `
      <div style="text-align: center; color: #9aa8a4; padding: 40px 0;">
        <p style="color: #b4544f; margin-bottom: 10px;">${escapeHtml(loadError)}</p>
        <button id="browse-retry" style="background: var(--teal-600); color: #fff; border: none; border-radius: 8px; padding: 7px 14px; cursor: pointer; font-size: 12.5px; font-weight: 600;">Try again</button>
      </div>`;
  } else if (!treeLoaded) {
    html += `<div style="text-align: center; color: #9aa8a4; padding: 40px 0;"><p>Loading…</p></div>`;
  } else if (currentLevel.length === 0) {
    html += `<div style="text-align: center; color: #9aa8a4; padding: 40px 0;"><p>This folder is empty.</p></div>`;
  } else {
    const folders = currentLevel.filter((item) => item.type === 'folder');
    const docs = currentLevel.filter((item) => item.type === 'document');

    if (folders.length > 0) {
      html += `<div style="margin-bottom: 16px;"><div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #9aa8a4; margin-bottom: 8px;">FOLDERS</div>`;
      folders.forEach((folder) => {
        html += `
          <div class="browse-folder" data-name="${escapeAttr(folder.name)}" data-path="${escapeAttr(folder.path)}" style="background: var(--white); border: 1px solid var(--border-light); border-radius: 11px; padding: 12px 13px; display: flex; align-items: center; gap: 10px; cursor: pointer; margin-bottom: 8px; transition: all 120ms;">
            <i class="bi bi-folder-fill" style="color: var(--teal-500); font-size: 18px;"></i>
            <div style="flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--text-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(folder.name)}</div>
            <span style="color: #b3bfbb; font-size: 16px;">›</span>
          </div>
        `;
      });
      html += `</div>`;
    }

    if (docs.length > 0) {
      html += `<div><div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #9aa8a4; margin-bottom: 8px;">DOCUMENTS</div>`;
      docs.forEach((doc) => {
        const label = doc.title || doc.name || doc.path;
        const ext = (doc.name || doc.path || '').split('.').pop().toLowerCase().slice(0, 2) || 'md';
        html += `
          <div class="browse-doc" data-path="${escapeAttr(doc.path)}" data-title="${escapeAttr(label)}" style="background: var(--white); border: 1px solid var(--border-light); border-radius: 11px; padding: 12px 13px; display: flex; align-items: center; gap: 10px; cursor: pointer; margin-bottom: 8px; transition: all 120ms;">
            <div style="flex-shrink: 0; width: 24px; height: 24px; border-radius: 6px; background: var(--teal-bg); color: var(--teal-300); display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold; text-transform: uppercase;">${escapeHtml(ext)}</div>
            <div style="flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--text-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(label)}</div>
          </div>
        `;
      });
      html += `</div>`;
    }
  }

  html += `</div>`;
  return html;
}

function setupFolderView(container, state) {
  // Back — pop a folder, or return to the spaces list when at the root
  const backBtn = container.querySelector('#browse-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      const path = [...(AppState.browsePath || [])];
      if (path.length === 0) {
        updateState({ browseSpace: null });
        return;
      }
      path.pop();
      updateState({ browsePath: path });
    });
  }

  const retryBtn = container.querySelector('#browse-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      updateState({ browseError: null });
    });
  }

  container.querySelectorAll('.browse-folder').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const { name, path } = e.currentTarget.dataset;
      // The path is what the next level is fetched by, so a folder without one
      // must not be drilled into — it would request the space root and show
      // this folder containing the whole space.
      if (!path) {
        console.warn('[Browse] Folder has no path, cannot drill in:', name);
        return;
      }
      updateState({
        browsePath: [...(AppState.browsePath || []), { name, path }],
        browseError: null,
      });
    });
  });

  container.querySelectorAll('.browse-doc').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const path = e.currentTarget.dataset.path;
      const title = e.currentTarget.dataset.title;
      if (!path) return;
      const spaceName = AppState.browseSpace?.name || '';
      if (AppState.api) {
        AppState.api.recordVisit(path, spaceName, title).catch(() => {});
      }
      updateState({
        view: 'doc',
        backTo: 'browse',
        openDoc: { path, spaceName, title: title || path },
      });
    });
  });

  ensureTreeLoaded();
}

/**
 * Fetch the folder currently being shown, if it is not already cached.
 *
 * One level per request. Two things keep that from being chatty: the cache is
 * kept for the whole time a space is open, so backing out is instant; and the
 * endpoint returns two levels, so drilling one step down is usually already in
 * hand and costs no request at all.
 */
async function ensureTreeLoaded() {
  const space = AppState.browseSpace;
  if (!AppState.api || !space) return;

  // Switching spaces invalidates every cached level.
  if (AppState.browseTreeSpaceId !== space.id) {
    updateState({ browseCache: {}, browseTreeSpaceId: space.id, browseError: null }, { silent: true });
  }

  const folderPath = currentFolderPath();
  const cache = AppState.browseCache || {};
  if (Array.isArray(cache[folderPath])) return;
  if (AppState.browseError) return;

  // Two callers can land here for the same folder (a render plus a click), so
  // mark it in flight rather than issuing the request twice.
  inFlight = inFlight || {};
  if (inFlight[folderPath]) return;
  inFlight[folderPath] = true;

  try {
    const level = await AppState.api.getFolders(space.id, folderPath);
    const next = { ...(AppState.browseCache || {}), [folderPath]: level };

    // The response carries one level below this one. Seeding those now means
    // the next click down usually renders with no request at all.
    for (const node of level) {
      if (node.type !== 'folder' || node.truncated) continue;
      if (!Array.isArray(node.children)) continue;
      if (!Array.isArray(next[node.path])) next[node.path] = node.children;
    }

    updateState({ browseCache: next, browseError: null });
  } catch (error) {
    console.error('[Browse] Error loading folder:', error);
    updateState({ browseError: error.message || 'Could not load this folder.' });
  } finally {
    delete inFlight[folderPath];
  }
}

/** Folders currently being fetched, so a re-render does not double-request. */
let inFlight = {};

/* ========================== helpers ========================== */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return (text == null ? '' : String(text)).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
