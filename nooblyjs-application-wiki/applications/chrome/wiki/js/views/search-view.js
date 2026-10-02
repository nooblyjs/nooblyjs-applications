/**
 * Search View Module
 * Full-text search across all spaces.
 *
 * IMPORTANT: typing must never rebuild the <input> (that destroys focus and
 * "eats" keystrokes). So the input is rendered once and live searches paint
 * ONLY into the #search-results container via direct DOM writes. Results are
 * persisted to state with { silent: true } so returning to the tab restores
 * them without a disruptive re-render.
 */

import { updateState, AppState } from '../state.js';

export function render(state) {
  return `
    <div style="padding: 16px 14px; background: var(--white); border-bottom: 1px solid #eceeee; position: sticky; top: 0; z-index: 10;">
      <div style="flex: 1; position: relative; display: flex; align-items: center; gap: 8px; background: var(--gray-input); border: 1px solid var(--border-input); border-radius: 8px; padding: 0 12px;">
        <i class="bi bi-search" style="color: var(--teal-500); font-size: 16px;"></i>
        <input
          type="text"
          id="search-input"
          placeholder="Search documents..."
          value="${escapeAttr(state.searchQuery || '')}"
          autocomplete="off"
          style="flex: 1; border: none; background: none; padding: 10px 0; font-size: 14px; font-family: var(--font-body); color: var(--text-body); outline: none;"
        />
        <button id="search-clear" style="background: none; border: none; cursor: pointer; color: #9aa8a4; padding: 4px; display: ${state.searchQuery ? 'flex' : 'none'}; align-items: center;">✕</button>
      </div>
    </div>
    <div id="search-results">${renderResults(state.searchResults || [], state.searchQuery || '')}</div>
  `;
}

/** Build the results-area HTML for the current query/results (no input here). */
function renderResults(results, query) {
  if (!query) {
    return `
      <div style="padding: 40px 16px; text-align: center; color: #9aa8a4;">
        <p style="font-size: 14px; margin-bottom: 8px;">Start typing to search</p>
        <p style="font-size: 12px;">Search across all documents in your spaces</p>
      </div>
    `;
  }

  if (results.length === 0) {
    return `
      <div style="padding: 40px 16px; text-align: center;">
        <div style="width: 62px; height: 62px; border-radius: 50%; border: 1px solid var(--border-input); background: var(--white); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; opacity: 0.5;">
          <i class="bi bi-search" style="font-size: 24px; color: #9aa8a4;"></i>
        </div>
        <h2 style="color: var(--text-strong); margin-bottom: 8px;">No matches</h2>
        <p style="color: #9aa8a4; font-size: 13px; margin: 0;">Nothing for "${escapeHtml(query)}". Try a different search.</p>
      </div>
    `;
  }

  let html = `
    <div style="padding: 12px 16px; background: var(--gray-bg); border-bottom: 1px solid var(--border-light); font-size: 13px; color: var(--text-body); font-weight: 600;">
      <strong>${results.length}</strong> result${results.length !== 1 ? 's' : ''}
    </div>
    <div style="padding: 9px 16px; background: var(--gray-bg); display: flex; flex-direction: column; gap: 9px;">
  `;

  results.forEach((result) => {
    const fileType = result.path?.split('.').pop()?.toLowerCase() || 'file';
    const chipColor = fileType === 'pdf' ? 'var(--red-bg)' : 'var(--teal-bg)';
    const chipTextColor = fileType === 'pdf' ? 'var(--red-text)' : 'var(--teal-300)';

    html += `
      <div class="search-result-card" data-path="${escapeAttr(result.path)}" data-space="${escapeAttr(result.spaceName)}" data-title="${escapeAttr(result.title || result.path)}" style="background: var(--white); border: 1px solid var(--border-mid); border-radius: 13px; padding: 13px; display: flex; gap: 11px; cursor: pointer; transition: all 120ms;">
        <div style="flex-shrink: 0; width: 34px; height: 34px; border-radius: 9px; background: ${chipColor}; color: ${chipTextColor}; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; text-transform: uppercase;">
          ${escapeHtml(fileType.substring(0, 2))}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13.5px; font-weight: 700; color: var(--text-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px;">
            ${escapeHtml(result.title || result.path)}
          </div>
          <div style="font-size: 11.5px; color: #9aa8a4; display: flex; align-items: center; gap: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            <span style="color: var(--orange);">▦</span>
            ${escapeHtml(result.spaceName || '')}
          </div>
        </div>
        <div style="flex-shrink: 0; background: var(--teal-bg); color: var(--teal-300); padding: 2px 6px; border-radius: 5px; font-size: 9px; font-weight: 600; white-space: nowrap;">
          ${escapeHtml(fileType)}
        </div>
      </div>
    `;
  });

  html += `</div>`;
  return html;
}

export function setup(container, state) {
  const searchInput = container.querySelector('#search-input');
  const clearBtn = container.querySelector('#search-clear');
  const resultsEl = container.querySelector('#search-results');

  // Wire any cards already painted from persisted state.
  attachResultHandlers(resultsEl);

  if (searchInput) {
    let searchTimeout;

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value;
      const trimmed = query.trim();

      // Toggle the clear (✕) button purely in the DOM — no re-render.
      if (clearBtn) clearBtn.style.display = query.length ? 'flex' : 'none';

      clearTimeout(searchTimeout);

      if (trimmed.length === 0) {
        resultsEl.innerHTML = renderResults([], '');
        updateState({ searchQuery: '', searchResults: [] }, { silent: true });
        return;
      }

      // Immediate, lightweight "searching" feedback in the results area only.
      resultsEl.innerHTML = `<div style="padding: 32px 16px; text-align: center; color: #9aa8a4;"><p>Searching…</p></div>`;

      searchTimeout = setTimeout(() => performSearch(trimmed, resultsEl), 300);
    });

    // Focus only on first paint of the tab (cursor lands at the end).
    const len = searchInput.value.length;
    searchInput.focus();
    try { searchInput.setSelectionRange(len, len); } catch (_) { /* noop */ }
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearBtn.style.display = 'none';
      resultsEl.innerHTML = renderResults([], '');
      updateState({ searchQuery: '', searchResults: [] }, { silent: true });
    });
  }
}

async function performSearch(query, resultsEl) {
  if (!AppState.api) return;

  try {
    // No spaceName → search every space the user can see.
    const results = (await AppState.api.search(query)) || [];
    console.log('[Search] Found', results.length, 'results');

    // Persist silently (so re-entering the tab restores results) and paint
    // ONLY the results area — the input keeps its value, focus and caret.
    updateState({ searchQuery: query, searchResults: results }, { silent: true });
    if (resultsEl) {
      resultsEl.innerHTML = renderResults(results, query);
      attachResultHandlers(resultsEl);
    }
  } catch (error) {
    console.error('[Search] Error:', error);
    updateState({ searchQuery: query, searchResults: [] }, { silent: true });
    if (resultsEl) resultsEl.innerHTML = renderResults([], query);
  }
}

function attachResultHandlers(resultsEl) {
  if (!resultsEl) return;
  resultsEl.querySelectorAll('.search-result-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const path = e.currentTarget.dataset.path;
      const spaceName = e.currentTarget.dataset.space;
      const title = e.currentTarget.dataset.title;
      if (!path) return;
      updateState({
        view: 'doc',
        backTo: 'search',
        openDoc: { path, spaceName, title: title || path },
      });
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return (text == null ? '' : String(text)).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
