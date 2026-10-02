/**
 * Main App Controller
 * Handles initialization, auth flow, and tab navigation
 */

import { AppState, updateState, resetState, subscribe } from './state.js';
import { WikiAPI } from './api.js';
import * as AskView from './views/ask-view.js';
import * as SearchView from './views/search-view.js';
import * as BrowseView from './views/browse-view.js';
import * as RecentView from './views/recent-view.js';
import * as DocView from './views/doc-view.js';

// View modules
const views = {
  ask: AskView,
  search: SearchView,
  browse: BrowseView,
  recent: RecentView,
  doc: DocView,
};

// Loaded from config.json in setupAPI(); read by the allowed-domain gate.
let appConfig = null;

// Corporate email domains permitted to use the extension. Overridden by
// config.json `allowedEmailDomains`; this is the hard-coded safety default so
// the gate still works if config.json omits the key.
const DEFAULT_ALLOWED_DOMAINS = ['localhost'];

/**
 * The list of email domains allowed to sign in through the extension.
 * @returns {string[]}
 */
function getAllowedDomains() {
  const fromConfig = appConfig && Array.isArray(appConfig.allowedEmailDomains)
    ? appConfig.allowedEmailDomains
    : null;
  return (fromConfig && fromConfig.length) ? fromConfig : DEFAULT_ALLOWED_DOMAINS;
}

/**
 * Whether an email belongs to an allowed corporate domain. Matches the domain
 * exactly OR as a subdomain (e.g. "mail.example.com" matches
 * "example.com"). Case-insensitive.
 * @param {string} email
 * @returns {boolean}
 */
function isAllowedEmailDomain(email) {
  if (!email || typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return false;
  return getAllowedDomains().some((allowed) => {
    const base = String(allowed).toLowerCase().trim().replace(/^@/, '');
    return base && (domain === base || domain.endsWith('.' + base));
  });
}

/**
 * Read the email of the account signed into the Chrome browser profile.
 * Resolves to null (never rejects) when the identity API is unavailable, the
 * user isn't signed into Chrome, or permission is missing — callers then fall
 * back to the manual sign-in form.
 * @returns {Promise<{email?: string, id?: string}|null>}
 */
function getChromeIdentity() {
  return new Promise((resolve) => {
    try {
      if (!chrome.identity || !chrome.identity.getProfileUserInfo) {
        console.warn('[Auth] chrome.identity API unavailable');
        resolve(null);
        return;
      }
      chrome.identity.getProfileUserInfo((userInfo) => {
        if (chrome.runtime.lastError) {
          console.warn('[Auth] chrome.identity error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(userInfo || null);
      });
    } catch (error) {
      console.warn('[Auth] chrome.identity exception:', error.message);
      resolve(null);
    }
  });
}

// ===== INITIALIZATION =====

document.addEventListener('DOMContentLoaded', async () => {
  await initializeApp();
});

async function initializeApp() {
  console.log('[App] Initializing...');

  // Set up listener for state changes
  subscribe((state) => {
    renderApp(state);
  });

  // Hide the sign-in form while we attempt a silent auto-login so the password
  // form doesn't flash before the (usually successful) identity login resolves.
  document.getElementById('auth-panel')?.classList.add('hidden');

  // Load config and initialize API
  await setupAPI();

  // 1) Preferred: passwordless login using the signed-in Chrome browser account.
  const identityOutcome = await tryChromeIdentityLogin();
  if (identityOutcome.status === 'authenticated') {
    showMainPanel();
    await loadInitialData();
    return;
  }

  // 2) Fall back to an existing browser session (cookie).
  const isAuthenticated = await checkAuthentication();
  if (isAuthenticated) {
    showMainPanel();
    await loadInitialData();
    return;
  }

  // 3) No auto-login — show the manual sign-in form. If the Chrome browser
  // account was rejected for being outside the allowed domain, say so clearly.
  showAuthPanel();
  setupAuthForm();
  if (identityOutcome.status === 'domain-blocked') {
    showAuthError(
      document.getElementById('auth-error'),
      `Access is restricted to ${getAllowedDomains().join(' / ')} accounts. ` +
      `The signed-in browser account (${identityOutcome.email}) isn't permitted.`
    );
  }
}

/**
 * Attempt passwordless login using the email of the account signed into the
 * Chrome browser profile. The email is only sent to the backend when it belongs
 * to an allowed corporate domain — non-corporate accounts are never transmitted
 * and never auto-provisioned server-side.
 *
 * @returns {Promise<{status: 'authenticated'|'no-identity'|'domain-blocked'|'failed', email?: string}>}
 */
async function tryChromeIdentityLogin() {
  if (!AppState.api) return { status: 'failed' };

  const chromeUser = await getChromeIdentity();
  if (!chromeUser || !chromeUser.email) {
    console.log('[Auth] No Chrome identity email available — manual login required');
    return { status: 'no-identity' };
  }

  const email = chromeUser.email;

  // Domain gate (extension-side): block non-corporate browser accounts here,
  // before anything reaches the server.
  if (!isAllowedEmailDomain(email)) {
    console.warn(`[Auth] Chrome identity "${email}" is outside the allowed domain(s) — blocked`);
    return { status: 'domain-blocked', email };
  }

  try {
    const result = await AppState.api.authenticateWithIdentity(email, chromeUser.id, 'chrome');
    const user = (result.data && result.data.user) || null;
    updateState({ authenticated: true, currentUser: user });
    console.log('[Auth] Passwordless identity login successful for:', email);
    return { status: 'authenticated', email };
  } catch (error) {
    console.warn('[Auth] Identity login failed:', error.message);
    return { status: 'failed', email };
  }
}

async function setupAPI() {
  try {
    const response = await fetch(chrome.runtime.getURL('config.json'));
    const config = await response.json();
    appConfig = config; // retained for the allowed-domain gate

    const stored = await chrome.storage.local.get(['serverUrl']);
    let serverUrl = stored.serverUrl || config.defaultServerUrl;

    if (serverUrl && serverUrl.endsWith('/')) {
      serverUrl = serverUrl.slice(0, -1);
    }

    updateState({ api: new WikiAPI(serverUrl) });

    console.log('[App] API initialized:', serverUrl);
  } catch (error) {
    console.error('[App] Failed to setup API:', error);
    showAuthPanel();
  }
}

async function checkAuthentication() {
  try {
    if (!AppState.api) return false;

    // Use the checkAuth method which sends a GET request with cookies
    const response = await AppState.api.checkAuth();
    if (response.authenticated || response.user) {
      const user = response.user || response;
      // Enforce the corporate-domain rule even for a pre-existing browser
      // session — the extension must never show content to a non-allowed account.
      if (user && user.email && !isAllowedEmailDomain(user.email)) {
        console.warn(`[App] Existing session "${user.email}" is outside the allowed domain(s) — denied`);
        return false;
      }
      updateState({
        authenticated: true,
        currentUser: user,
      });
      // Exchange the browser cookie for a bearer token so subsequent requests
      // authenticate reliably from the chrome-extension:// origin (cross-site
      // cookies are unreliable). Non-fatal: falls back to cookies on failure.
      await AppState.api.exchangeSessionForToken();
      console.log('[App] Session login successful');
      return true;
    }
  } catch (error) {
    console.warn('[App] Auth check failed:', error.message);
  }
  return false;
}

// ===== AUTH FLOW =====

function showAuthPanel() {
  document.getElementById('auth-panel').classList.remove('hidden');
  document.getElementById('main-panel').classList.add('hidden');
}

function showMainPanel() {
  document.getElementById('auth-panel').classList.add('hidden');
  document.getElementById('main-panel').classList.remove('hidden');
}

function setupAuthForm() {
  const form = document.getElementById('login-form');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const errorDiv = document.getElementById('auth-error');
  const loadingDiv = document.getElementById('auth-loading');
  const serverDisplay = document.getElementById('server-display');

  // Display configured server URL
  (async () => {
    const response = await fetch(chrome.runtime.getURL('config.json'));
    const config = await response.json();
    const stored = await chrome.storage.local.get(['serverUrl']);
    const url = stored.serverUrl || config.defaultServerUrl;

    // Show just the hostname (e.g., "localhost:9101")
    try {
      const urlObj = new URL(url);
      serverDisplay.textContent = urlObj.host;
    } catch {
      serverDisplay.textContent = url;
    }
  })();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleLogin(
      usernameInput.value,
      passwordInput.value,
      errorDiv,
      loadingDiv
    );
  });
}

async function handleLogin(username, password, errorDiv, loadingDiv) {
  if (!username || !password) {
    showAuthError(errorDiv, 'Please fill in all fields');
    return;
  }

  // Same domain rule as the passwordless path: only allowed corporate accounts
  // may sign in through the extension.
  if (!isAllowedEmailDomain(username)) {
    showAuthError(
      errorDiv,
      `Access is restricted to ${getAllowedDomains().join(' / ')} accounts.`
    );
    return;
  }

  loadingDiv.classList.remove('hidden');
  errorDiv.classList.add('hidden');

  try {
    if (!AppState.api) {
      throw new Error('API not initialized');
    }

    // Use the login method from WikiAPI which authenticates with credentials
    const response = await AppState.api.login(username, password);

    if (response.success) {
      // Login successful - now check auth status
      const authCheck = await AppState.api.checkAuth();
      if (authCheck.user) {
        updateState({
          authenticated: true,
          currentUser: authCheck.user,
        });
        showMainPanel();
        await loadInitialData();
        console.log('[Auth] Login successful for:', username);
      } else {
        showAuthError(errorDiv, 'Login failed: could not verify session');
      }
    } else {
      showAuthError(errorDiv, response.message || 'Login failed: invalid credentials');
    }
  } catch (error) {
    console.error('[Auth] Login error:', error);
    showAuthError(errorDiv, `Login failed: ${error.message}`);
  } finally {
    loadingDiv.classList.add('hidden');
  }
}

function showAuthError(errorDiv, message) {
  errorDiv.textContent = message;
  errorDiv.classList.remove('hidden');
}

// ===== INITIAL DATA LOADING =====

async function loadInitialData() {
  console.log('[App] Loading initial data...');

  try {
    // Load spaces
    const spaces = await AppState.api.request('/spaces');
    if (spaces && spaces.length > 0) {
      updateState({ currentSpace: spaces[0] });
      console.log('[App] Loaded spaces, selected:', spaces[0].name);
    }

    // Load user activity (recent + starred)
    const activity = await AppState.api.request('/user/activity');
    if (activity) {
      updateState({
        recentDocs: activity.recent || [],
        starredDocs: activity.starred || [],
      });
      console.log('[App] Loaded activity:', activity.recent?.length || 0, 'recent');
    }

    // Show online indicator (optional — the side-panel layout omits it).
    // Must use optional chaining: an unguarded access here throws and aborts
    // before the tab listeners below are wired, leaving every tab dead.
    document.getElementById('online-pill')?.classList.remove('hidden');

    // Setup UI event listeners
    setupTabSwitching();
    setupOpenButton();
  } catch (error) {
    console.error('[App] Failed to load initial data:', error);
  }
}

// ===== RENDERING =====

function renderApp(state) {
  const contentEl = document.getElementById('content');
  const inputBar = document.getElementById('input-bar');

  if (!state.authenticated || !contentEl) {
    return; // Not ready yet
  }

  // Determine which view to render
  const viewType = state.view === 'doc' ? 'doc' : state.activeTab;
  const ViewModule = views[viewType];

  if (ViewModule) {
    // Use the view module's render and setup functions
    contentEl.innerHTML = ViewModule.render(state);
    ViewModule.setup(contentEl, state);
  }

  // Show input bar only for Ask tab (and when not in doc view)
  const showInputBar = state.activeTab === 'ask' && state.view === 'tab';
  inputBar.classList.toggle('hidden', !showInputBar);

  // Update tab bar active state
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const isActive = btn.dataset.tab === state.activeTab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
}

// Tab switching setup
function setupTabSwitching() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      updateState({ activeTab: tab, view: 'tab' });
    });
  });
}

// Open in full window button
function setupOpenButton() {
  const openBtn = document.getElementById('open-btn');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (AppState.api) {
        chrome.tabs.create({
          url: `${AppState.api.baseUrl}/applications/wiki/`,
        });
      }
    });
  }
}

