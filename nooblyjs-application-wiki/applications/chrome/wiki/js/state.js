/**
 * State Management
 * Centralized app state with observer pattern
 */

export const AppState = {
  // Auth & context
  authenticated: false,
  currentSpace: null,
  currentUser: null,

  // Navigation
  activeTab: 'browse', // 'ask' | 'search' | 'browse' | 'recent'
  view: 'tab',      // 'tab' | 'doc'
  backTo: 'browse',    // which tab to return to when closing a doc

  // Ask tab
  messages: [],     // { role: 'user'|'assistant', text, citations?: [] }
  isTyping: false,

  // Search tab
  searchQuery: '',
  searchResults: [],
  searchResultLayout: 'list', // 'list' | 'grid'

  // Browse tab
  browseSpace: null,      // selected space (null = show the spaces list)
  browseSpaces: null,     // all spaces for the picker (null = not loaded yet)
  pins: null,             // user's pinned items for Quick Access (null = not loaded)
  browsePath: [],         // stack of { name, path } folder steps as you drill down
  // Folder listings keyed by space-relative path ('' = the space root).
  // The tree is fetched ONE LEVEL AT A TIME: the content roots are directories
  // of symlinked git repositories, so asking for the whole thing up front cost
  // thousands of sequential directory listings on the server and made opening a
  // space take seconds.
  browseCache: {},
  browseTreeSpaceId: null,// which space id browseCache belongs to
  browseError: null,      // message shown in place of a folder that failed to load

  // Recent tab
  recentDocs: [],
  starredDocs: [],

  // Document view
  openDoc: null,    // { path, title, content, size, modifiedAt, spaceName }

  // API
  api: null,        // WikiAPI instance
};

// Observer pattern — listeners notified on state changes
const listeners = new Set();

/**
 * Subscribe to state changes
 * @param {Function} fn - Called with (state) when state updates
 * @returns {Function} Unsubscribe function
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Update state (merges with existing state)
 * @param {Object} updates - Partial state object
 * @param {Object} [options]
 * @param {boolean} [options.silent] - When true, persist the change but do NOT
 *   notify listeners (no re-render). Used by the search view so live results
 *   can be stored without rebuilding — and destroying — the search input.
 */
export function updateState(updates, options = {}) {
  // Merge updates into AppState
  Object.assign(AppState, updates);

  if (options.silent) return;

  // Notify all listeners
  listeners.forEach(fn => {
    try {
      fn(AppState);
    } catch (error) {
      console.error('[State] Listener error:', error);
    }
  });
}

/**
 * Reset state to initial condition
 */
export function resetState() {
  Object.assign(AppState, {
    authenticated: false,
    currentSpace: null,
    currentUser: null,
    activeTab: 'browse',
    view: 'tab',
    backTo: 'browse',
    messages: [],
    isTyping: false,
    searchQuery: '',
    searchResults: [],
    searchResultLayout: 'list',
    browseSpace: null,
    browseSpaces: null,
    pins: null,
    browsePath: [],
    browseCache: {},
    browseTreeSpaceId: null,
    browseError: null,
    recentDocs: [],
    starredDocs: [],
    openDoc: null,
  });

  listeners.forEach(fn => {
    try {
      fn(AppState);
    } catch (error) {
      console.error('[State] Listener error:', error);
    }
  });
}
