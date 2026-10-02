/**
 * API Client for NooblyJS Wiki Chrome Extension
 * Handles all communication with the wiki backend
 */

/**
 * Rebuild the `path` the folder-tree endpoint strips.
 *
 * `GET /spaces/:id/folder-tree` runs its answer through `leanTree()`
 * (filingRoutes.js), which drops `path`, `title`, `fileName` and `spaceName`
 * because all four are derivable and `path` alone is over 40% of the payload.
 * Every client is expected to put them back — the web app does it in
 * `navigationController.rehydrateTree()`.
 *
 * Skipping it does not throw. Nodes arrive with `path: undefined`, so documents
 * render with an empty `data-path` and clicking one does nothing at all, while
 * a folder asks for its subtree at "no path" and the server answers with the
 * space ROOT — the same folders nesting into themselves forever.
 *
 * `prefix` is the folder the response describes: '' at a space root, and the
 * REQUESTED folder for a subtree fetch, whose nodes are its children.
 *
 * @param {Array<Object>} nodes - nodes straight off the wire; mutated in place
 * @param {string} prefix - space-relative folder the response describes
 * @returns {Array<Object>} the same array, with path/title filled in
 */
function rehydratePaths(nodes, prefix = '') {
  if (!Array.isArray(nodes)) return [];

  for (const node of nodes) {
    node.path = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === 'folder') {
      rehydratePaths(node.children || (node.children = []), node.path);
    } else if (!node.title) {
      node.title = node.name;
    }
  }
  return nodes;
}

class WikiAPI {
  constructor(baseUrl) {
    // baseUrl comes from config.json (loaded by app.js before constructing this).
    // loadSession() will override with any URL the user has saved in chrome.storage.
    // Strip trailing slashes to avoid double slashes when concatenating endpoint paths
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.apiBase = `${this.baseUrl}/applications/wiki/api`;
    this.filingBase = `${this.baseUrl}/services/filing/api`;
    this.sessionId = null;
  }

  /**
   * Set the session ID for authenticated requests
   */
  setSession(sessionId) {
    this.sessionId = sessionId;
  }

  /**
   * Make an authenticated request
   * Uses bearer token if available, otherwise relies on cookies
   */
  async request(endpoint, options = {}) {
    const url = `${this.apiBase}${endpoint}`;

    // Check if we have a stored bearer token
    const stored = await chrome.storage.local.get(['bearerToken']);
    const headers = {
      'Content-Type': 'application/json',
      ...(stored.bearerToken ? { 'Authorization': `Bearer ${stored.bearerToken}` } : {}),
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'  // This will automatically send cookies
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * Exchange current browser session for a long-lived extension bearer token
   * Called after successful auto-login to get a token independent of browser cookies
   */
  async exchangeSessionForToken() {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/extension-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'  // Send browser session cookie
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Token exchange failed');
      }

      // Store the bearer token for future requests
      await chrome.storage.local.set({
        bearerToken: data.token,
        tokenUser: data.user,
        tokenExpiresAt: new Date(Date.now() + data.expiresIn * 1000).toISOString()
      });

      return data;
    } catch (error) {
      console.warn('Token exchange failed (extension will use cookies):', error.message);
      // Don't throw - Phase 1 auto-login still works with cookies
      return null;
    }
  }

  /**
   * Save session to chrome storage
   */
  async saveSession() {
    await chrome.storage.local.set({
      serverUrl: this.baseUrl,
      isAuthenticated: true,
      lastLogin: new Date().toISOString()
    });
  }

  /**
   * Load session from chrome storage
   */
  async loadSession() {
    const result = await chrome.storage.local.get(['serverUrl', 'isAuthenticated']);
    if (result.serverUrl) {
      // Strip trailing slashes to avoid double slashes
      this.baseUrl = result.serverUrl.replace(/\/+$/, '');
      this.apiBase = `${this.baseUrl}/applications/wiki/api`;
      this.filingBase = `${this.baseUrl}/services/filing/api`;
    }
    return !!result.isAuthenticated;
  }

  /**
   * Clear session
   */
  async clearSession() {
    await chrome.storage.local.remove([
      'isAuthenticated', 'serverUrl', 'currentSpace', 'currentPath', 'lastLogin',
      'bearerToken', 'tokenUser', 'tokenExpiresAt'  // Also clear bearer token on logout
    ]);
  }

  /**
   * Login with username and password
   */
  async login(email, password) {
    const url = `${this.baseUrl}/api/auth/login`;
    try {
      console.log('[API] POST', url);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password }),
        credentials: 'include'  // Browser will store the session cookie automatically
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Login failed');
      }

      // Save authentication state (cookies are handled by browser)
      await this.saveSession();

      return data;
    } catch (error) {
      console.error('Login failed:', url, error);
      // A "Failed to fetch" TypeError means the request never reached the server
      // (TLS/cert rejected, server not on HTTPS, host permission missing). Surface
      // the full URL so the cause is actionable instead of a bare message.
      if (error instanceof TypeError) {
        throw new Error(`Could not reach ${url} — ${error.message}. Verify the server is running on HTTPS and its certificate is trusted.`);
      }
      throw error;
    }
  }

  /**
   * Passwordless "trusted identity" login.
   *
   * Sends the email of the account signed into the Chrome browser profile to
   * POST /api/auth/identity, which looks up — or auto-provisions on first sight —
   * the matching wiki account and returns a 24h bearer token. No password is ever
   * entered: the verified browser identity IS the credential.
   *
   * The caller is responsible for vetting the email's domain BEFORE calling this
   * (see app.js isAllowedEmailDomain) — this method just performs the exchange.
   *
   * @param {string} email - Chrome profile email (the trusted identity)
   * @param {string} [externalId] - Chrome Gaia profile id, sent for server-side audit
   * @param {string} [source='chrome'] - Identity source label, for server-side audit
   * @returns {Promise<Object>} Backend response: { success, data: { token, user, expiresIn } }
   */
  async authenticateWithIdentity(email, externalId = null, source = 'chrome') {
    const response = await fetch(`${this.baseUrl}/api/auth/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, externalId, source }),
      credentials: 'include'
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || data.message || 'Identity authentication failed');
    }

    // Persist the bearer token so request()/getFolders()/etc. authenticate even
    // when the side panel has no browser cookie (chrome-extension:// origin).
    if (data.data && data.data.token) {
      await chrome.storage.local.set({
        bearerToken: data.data.token,
        tokenUser: data.data.user,
        tokenExpiresAt: new Date(Date.now() + (data.data.expiresIn || 86400) * 1000).toISOString()
      });
    }

    await this.saveSession();
    return data;
  }

  /**
   * Check authentication status
   */
  async checkAuth() {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/check`, {
        credentials: 'include'
      });
      return await response.json();
    } catch (error) {
      return { authenticated: false };
    }
  }

  /**
   * Get all spaces
   */
  async getSpaces() {
    return await this.request('/spaces');
  }

  /**
   * Get folders for a space. Prefers the filing-service-backed /folder-tree
   * endpoint because it applies per-folder ordering from .settings/file-order.json
   * (the same ordering the web wiki shows). Falls back to the legacy /folders
   * endpoint — which returns an alphabetically-sorted tree — when the filing
   * service is unavailable or the request fails.
   */
  async getFolders(spaceId, folderPath = '') {
    const stored = await chrome.storage.local.get(['bearerToken']);
    const headers = {
      'Content-Type': 'application/json',
      ...(stored.bearerToken ? { 'Authorization': `Bearer ${stored.bearerToken}` } : {})
    };

    // LAZY. One level at a time (the endpoint's default depth of 2, so a folder
    // and a peek at its children), re-requested with ?path= as the user drills.
    //
    // This used to ask for depth=4 in one go, which is what made opening a space
    // slow: the content roots are directories of symlinked git repositories, so
    // each extra level multiplies out into thousands of sequential directory
    // listings on the server. Nothing here needs the whole tree — the UI only
    // ever renders one level.
    const query = folderPath
      ? `?path=${encodeURIComponent(folderPath)}`
      : '';

    const resp = await fetch(`${this.apiBase}/spaces/${spaceId}/folder-tree${query}`, {
      method: 'GET',
      credentials: 'include',
      headers
    });

    if (!resp.ok) {
      throw new Error(`Could not list ${folderPath || 'the space root'} (HTTP ${resp.status})`);
    }

    const data = await resp.json();
    if (!data || !data.success || !Array.isArray(data.tree)) {
      throw new Error(`Could not list ${folderPath || 'the space root'}`);
    }

    // There is deliberately NO fallback to the legacy /spaces/:id/folders
    // endpoint. That one walks the whole tree with no depth bound — it is the
    // request this change exists to stop making, so falling back to it on error
    // would turn a visible failure into a silent multi-second hang.
    return rehydratePaths(data.tree, folderPath);
  }

  /**
   * Get document content via direct filing service API
   * Uses /services/filing/api/space-{id}/download/{path} for raw content
   * and determines viewer type client-side
   */
  async getDocumentContent(path, spaceName, enhanced = true, spaceId = null) {
    if (!spaceId) {
      // Fallback: use wiki middleware if no spaceId available
      const endpoint = `/documents/content?path=${encodeURIComponent(path)}&spaceName=${encodeURIComponent(spaceName)}${enhanced ? '&enhanced=true' : ''}`;
      return await this.request(endpoint);
    }

    // Use direct filing service
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.filingBase}/space-${spaceId}/download/${encodedPath}`;

    // Get stored bearer token to authenticate with filing API
    const stored = await chrome.storage.local.get(['bearerToken']);
    const headers = stored.bearerToken
      ? { 'Authorization': `Bearer ${stored.bearerToken}` }
      : {};

    try {
      const response = await fetch(url, { headers, credentials: 'include' });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const ext = path.split('.').pop().toLowerCase();
      const viewer = this.getViewerType(ext, contentType);

      // For binary types, return metadata only (the URL is used directly in src)
      if (['image', 'pdf', 'video', 'audio'].includes(viewer)) {
        return {
          content: null,
          metadata: {
            viewer,
            fileName: path.split('/').pop(),
            extension: ext,
            category: viewer,
            path,
            spaceName
          }
        };
      }

      // For text-based types, read the response body
      const isJson = contentType.includes('application/json');
      let content;

      if (isJson) {
        // Filing service returns JSON for text files: { data, encoding }
        const data = await response.json();
        content = data.data || data.content || '';
      } else {
        content = await response.text();
      }

      return {
        content,
        metadata: {
          viewer,
          fileName: path.split('/').pop(),
          extension: ext,
          category: viewer === 'markdown' ? 'markdown' : viewer === 'code' ? 'code' : 'text',
          path,
          spaceName
        }
      };
    } catch (error) {
      console.error('Filing API request failed:', error);
      throw error;
    }
  }

  /**
   * Get direct URL for binary content (images, PDFs, etc.)
   * Includes bearer token as query parameter since <img>/<iframe> can't set headers
   */
  async getDirectUrl(spaceId, filePath) {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const baseUrl = `${this.filingBase}/space-${spaceId}/download/${encodedPath}`;

    // Append bearer token as query param for img/iframe src
    const stored = await chrome.storage.local.get(['bearerToken']);
    if (stored.bearerToken) {
      return `${baseUrl}?token=${encodeURIComponent(stored.bearerToken)}`;
    }
    return baseUrl;
  }

  /**
   * Fetch binary content (image/PDF/video/audio) and return a Blob URL the
   * popup can use directly in <img>/<embed>/<video> src. Authenticates via
   * the Authorization header rather than ?token= query param — the latter
   * fails in the chrome-extension:// origin when the server enforces
   * X-Frame-Options or streams responses that the cross-origin <img>/<iframe>
   * loaders refuse to render. Blob URLs are same-origin to the popup so they
   * sidestep all those policies.
   */
  async fetchBinaryBlobUrl(spaceId, filePath) {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const url = `${this.filingBase}/space-${spaceId}/download/${encodedPath}`;
    const stored = await chrome.storage.local.get(['bearerToken']);
    const headers = stored.bearerToken
      ? { 'Authorization': `Bearer ${stored.bearerToken}` }
      : {};
    const response = await fetch(url, { headers, credentials: 'include' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  /**
   * Like fetchBinaryBlobUrl but keyed on space NAME, not numeric id — the doc
   * view only ever carries the space name (browse/search/recent don't pass the
   * id). Streams the raw bytes from the wiki /documents/content endpoint (no
   * enhanced flag = raw binary, not base64 JSON) and wraps them in a blob URL
   * the side panel can load in <img>/<iframe> without tripping the server's
   * cross-origin / X-Frame-Options policies.
   */
  async fetchBinaryBlobUrlByName(path, spaceName) {
    const endpoint = `/documents/content?path=${encodeURIComponent(path)}&spaceName=${encodeURIComponent(spaceName)}`;
    const stored = await chrome.storage.local.get(['bearerToken']);
    const headers = stored.bearerToken
      ? { 'Authorization': `Bearer ${stored.bearerToken}` }
      : {};
    const response = await fetch(`${this.apiBase}${endpoint}`, { headers, credentials: 'include' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  /**
   * Determine viewer type from file extension
   */
  getViewerType(ext, contentType = '') {
    const viewerMap = {
      // Markdown
      md: 'markdown',
      // Code
      js: 'code', ts: 'code', jsx: 'code', tsx: 'code',
      py: 'code', java: 'code', c: 'code', cpp: 'code',
      css: 'code', html: 'code', json: 'code', xml: 'code',
      yaml: 'code', yml: 'code', sh: 'code', bash: 'code',
      // Text
      txt: 'text', log: 'text', csv: 'text', ini: 'text', cfg: 'text',
      // Images
      png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
      svg: 'image', webp: 'image', bmp: 'image', ico: 'image',
      // PDF
      pdf: 'pdf',
      // Video
      mp4: 'video', webm: 'video', mkv: 'video', avi: 'video', mov: 'video',
      // Audio
      mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', aac: 'audio'
    };
    return viewerMap[ext] || 'default';
  }

  /**
   * Search documents
   */
  async search(query, spaceId = null) {
    let endpoint = `/search?q=${encodeURIComponent(query)}&includeContent=false`;
    if (spaceId) {
      endpoint += `&spaceId=${encodeURIComponent(spaceId)}`;
    }
    return await this.request(endpoint);
  }

  /**
   * Get user activity (recent files)
   */
  async getUserActivity() {
    return await this.request('/user/activity');
  }

  /**
   * Get user's pinned folders/documents
   */
  async getPins() {
    return await this.request('/pins');
  }

  /**
   * Toggle star on a document
   */
  async toggleStar(path, spaceName, title, action = 'star') {
    return await this.request('/user/star', {
      method: 'POST',
      body: JSON.stringify({ path, spaceName, title, action })
    });
  }

  /**
   * Record document visit
   */
  async recordVisit(path, spaceName, title) {
    return await this.request('/user/visit', {
      method: 'POST',
      body: JSON.stringify({ path, spaceName, title, action: 'viewed' })
    });
  }
}

// The extension loads this as an ES module (popup.html -> js/app.js).
export { WikiAPI };
