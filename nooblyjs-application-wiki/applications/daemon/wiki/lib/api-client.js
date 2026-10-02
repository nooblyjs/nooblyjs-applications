const axios = require('axios');
const FormData = require('form-data');
const https = require('node:https');
const { trustStoreWith } = require('./tls-trust');

/**
 * Turn an axios failure into a sentence that names the actual cause.
 *
 * `error.message` alone is not good enough, and the gap is worst exactly when
 * a diagnosis matters most. Node fails a connection attempt by trying every
 * address a host resolves to and collecting the results in an **AggregateError**,
 * whose own `message` is the literal string "Error" — so a server that was
 * simply not running reported:
 *
 *     Failed to list spaces (no response): Error
 *
 * which is indistinguishable from any other failure and sent the reader looking
 * for a TLS problem that was not there. The sub-errors carry the real story
 * (`ECONNREFUSED ::1:9101`), so they are unwrapped here.
 *
 * Three shapes, in the order they are worth reporting:
 *   - the server answered with an error body  -> its message
 *   - the request never got a response        -> the code and every address tried
 *   - anything else                           -> whatever message exists
 */
function describeRequestError(error) {
  const status = error.response?.status;
  if (status) {
    const body = error.response?.data;
    const detail = (body && (body.error || body.message)) || error.message;
    return { status, detail };
  }

  // No response: a DNS, connection, timeout or TLS failure.
  const parts = [];
  if (error.code) parts.push(error.code);

  const nested = Array.isArray(error.errors) ? error.errors
    : (error.cause && Array.isArray(error.cause.errors)) ? error.cause.errors
    : null;

  if (nested && nested.length) {
    // Deduplicated because IPv6 and IPv4 usually fail identically, and one
    // line per address is what shows "it tried both and nothing was there".
    const seen = [];
    for (const e of nested) {
      const line = e && e.message ? e.message : String(e);
      if (!seen.includes(line)) seen.push(line);
    }
    parts.push(seen.join('; '));
  } else if (error.cause && error.cause.message) {
    parts.push(error.cause.message);
  } else if (error.message && error.message !== 'Error') {
    parts.push(error.message);
  }

  return { status: null, detail: parts.join(' - ') || 'request failed with no further detail' };
}

/**
 * Filing API Client
 * Uses /services/filing/api with bearer token authentication.
 *
 * The client is space-agnostic: filing operations take an explicit
 * `instanceName` (e.g. "space-12") so a single authenticated client can serve
 * every space the daemon mirrors.
 */
class FilingApiClient {
  constructor(baseURL, { log = console, insecureTLS = false, trustedCerts = [] } = {}) {
    this.baseURL = baseURL;
    this.token = null;
    this.log = log;

    const axiosConfig = {
      baseURL,
      headers: { 'Content-Type': 'application/json' },
    };

    // Dev escape hatch: accept ANY certificate. Scoped to THIS client (unlike
    // NODE_TLS_REJECT_UNAUTHORIZED=0, which disables verification
    // process-wide). Opt-in via WIKI_TLS_INSECURE=true.
    if (insecureTLS) {
      axiosConfig.httpsAgent = new https.Agent({ rejectUnauthorized: false });
      this.log.warn('[API] TLS certificate verification DISABLED (WIKI_TLS_INSECURE=true) — use only against trusted dev servers');
    } else {
      // Certificates the operator explicitly pinned from the setup screen.
      // Verification stays ON — these are added to the trust store, so the
      // chain, hostname and expiry are all still checked. That is what makes
      // this different from the branch above.
      const ca = trustStoreWith(trustedCerts);
      if (ca) {
        axiosConfig.httpsAgent = new https.Agent({ ca });
        this.log.info(`[API] Trusting ${trustedCerts.length} pinned certificate(s) in addition to the system trust store`);
      }
    }

    // Main client for filing API
    this.client = axios.create(axiosConfig);
  }

  /**
   * Authenticate with a pre-issued bearer token instead of email/password.
   * Useful for headless/automated runs (WIKI_TOKEN).
   */
  useToken(token) {
    this.token = token;
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    this.log.info('[API] Using pre-supplied bearer token');
  }

  /**
   * Authenticate via /api/auth/login and store bearer token
   */
  async login(email, password) {
    try {
      this.log.info(`[API] Logging in as ${email}...`);
      const response = await this.client.post('/api/auth/login', { email, password });

      if (!response.data.success) {
        throw new Error(response.data.message || 'Login failed');
      }

      // Extract token from session data
      this.token = response.data.data?.session?.token;
      if (!this.token) {
        throw new Error('No session token returned from login');
      }

      // Set bearer token for all subsequent requests
      this.client.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;

      this.log.info(`[API] Login successful, bearer token acquired`);
      return response.data;
    } catch (error) {
      const { status, detail } = describeRequestError(error);
      throw new Error(`Login failed (${status || 'no response'}): ${detail}`, { cause: error });
    }
  }

  /**
   * Build the filing API path for a space instance
   * Always includes trailing slash so Express /* wildcard matches
   */
  _filingPath(instanceName, action, key) {
    const base = `/services/filing/api/${instanceName}/${action}`;
    if (!key) return `${base}/`;
    // Encode each path segment (matching the wiki frontend client) so names
    // containing %, +, #, spaces, etc. produce a valid URL. The server decodes
    // req.params[0] back to the literal path; slashes stay as separators.
    // (A literal "%" — e.g. "10% Discount" — is otherwise an invalid escape and
    // the server rejects it with HTTP 400.)
    const encodedKey = String(key).split('/').map(encodeURIComponent).join('/');
    return `${base}/${encodedKey}`;
  }

  /**
   * Browse files at a path within a space instance
   * Returns { path, items: [{ name, path, type }] }
   */
  async browse(instanceName, browsePath = '') {
    try {
      const url = this._filingPath(instanceName, 'browse', browsePath);
      this.log.info(`[API] GET ${url}`);

      const response = await this.client.get(url);
      const items = response.data.items || [];

      this.log.info(`[API] Browse found ${items.length} items at "${browsePath || '/'}"`);
      return items;
    } catch (error) {
      this.log.error(`[API] Browse failed:`, error.response?.status, error.response?.data?.error || error.message);
      throw new Error(`Failed to browse "${browsePath}": ${error.message}`);
    }
  }

  /**
   * Recursively browse to get all files in a space instance
   * Returns flat array of { name, path, type } for all files
   * @param {string} instanceName - Filing instance, e.g. "space-12"
   * @param {string} browsePath - Path to browse from
   * @param {Function} shouldSkip - Optional callback (path) => boolean to skip folders/files
   */
  async browseAll(instanceName, browsePath = '', shouldSkip = null) {
    const allFiles = [];
    const items = await this.browse(instanceName, browsePath);

    for (const item of items) {
      if (shouldSkip && shouldSkip(item.path)) continue;

      if (item.type === 'folder') {
        // A single failing subfolder must not abort the whole enumeration —
        // skip it and continue so the rest of the repo is still discovered.
        try {
          const children = await this.browseAll(instanceName, item.path, shouldSkip);
          allFiles.push(...children);
        } catch (err) {
          this.log.warn(`[API] Skipping folder (browse failed): ${item.path} — ${err.message}`);
        }
      } else {
        allFiles.push(item);
      }
    }

    return allFiles;
  }

  /**
   * Download file content by path from a space instance
   */
  async download(instanceName, filePath) {
    try {
      const url = this._filingPath(instanceName, 'download', filePath);
      this.log.info(`[API] GET ${url}`);

      const response = await this.client.get(url, {
        responseType: 'arraybuffer',
      });

      const contentType = response.headers['content-type'] || '';

      // The filing route answers a non-Buffer payload by wrapping it as
      // { data, encoding } JSON, so unwrap that before anything else — the raw
      // envelope is not the file.
      if (contentType.includes('json')) {
        const text = response.data.toString('utf8');
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.data !== undefined) return parsed.data;
        } catch {
          // Declared JSON but isn't (e.g. a .json document served by extension) —
          // it is still text, so hand back the text.
        }
        return text;
      }

      if (contentType.includes('text') || contentType.includes('markdown')) {
        return response.data.toString('utf8');
      }

      // BINARY: return the Buffer untouched.
      //
      // This used to end in `.toString('utf8')`, which silently corrupted every
      // PDF, image and office document the daemon mirrored: the filing route
      // sends raw bytes with the file's real MIME type (application/pdf, …),
      // none of the text checks above match, and decoding those bytes as UTF-8
      // replaces each invalid sequence with U+FFFD. FileSync's
      // `Buffer.isBuffer(content)` test could therefore never be true, so the
      // mangled string was written back out as UTF-8 text.
      return response.data;
    } catch (error) {
      this.log.error(`[API] Download failed:`, error.response?.status, error.message);
      throw new Error(`Failed to download "${filePath}": ${error.message}`);
    }
  }

  /**
   * Upload file content by path to a space instance
   */
  async upload(instanceName, filePath, fileData) {
    try {
      const url = this._filingPath(instanceName, 'upload', filePath);
      this.log.info(`[API] POST ${url}`);

      const form = new FormData();
      const fileName = filePath.split('/').pop();
      const buffer = Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData, 'utf8');
      form.append('file', buffer, fileName);

      const response = await this.client.post(url, form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${this.token}`,
        },
      });

      this.log.info(`[API] Upload successful: ${filePath}`);
      return response.data;
    } catch (error) {
      this.log.error(`[API] Upload failed:`, error.response?.status, error.response?.data?.error || error.message);
      throw new Error(`Failed to upload "${filePath}": ${error.message}`);
    }
  }

  /**
   * Remove a file by path from a space instance
   */
  async remove(instanceName, filePath) {
    try {
      const url = this._filingPath(instanceName, 'remove', filePath);
      this.log.info(`[API] DELETE ${url}`);

      const response = await this.client.delete(url);

      this.log.info(`[API] Removed: ${filePath}`);
      return response.data;
    } catch (error) {
      this.log.error(`[API] Remove failed:`, error.response?.status, error.message);
      throw new Error(`Failed to remove "${filePath}": ${error.message}`);
    }
  }

  /**
   * List available filing instances (for diagnostics)
   */
  async getInstances() {
    try {
      const response = await this.client.get('/services/filing/api/instances');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get instances: ${error.message}`);
    }
  }

  /**
   * Poll the wiki backend's change feed.
   * Returns events newer than `since` (ISO timestamp), filtered to the
   * configured space. Caller should persist the returned `cursor` and pass
   * it as `since` on the next poll. If `truncated` is true, the cursor is
   * older than the server's in-memory ring — fall back to a full sync.
   *
   * @param {Object} opts
   * @param {string} [opts.since] - ISO timestamp; null/undefined returns full ring
   * @param {(string|number)} [opts.spaceId] - filter to one space
   * @param {number} [opts.limit] - max events to return
   * @return {Promise<{events: Array, cursor: string|null, truncated: boolean, serverTime: string}>}
   */
  async getChanges({ since, spaceId, limit = 500 } = {}) {
    try {
      const params = {};
      if (since) params.since = since;
      if (spaceId !== undefined && spaceId !== null) params.spaceId = spaceId;
      if (limit) params.limit = limit;

      const response = await this.client.get('/applications/wiki/api/changes', { params });
      if (!response.data || response.data.success === false) {
        throw new Error(response.data?.error || 'changes endpoint returned failure');
      }
      return {
        events: response.data.events || [],
        cursor: response.data.cursor || null,
        truncated: !!response.data.truncated,
        serverTime: response.data.serverTime || null
      };
    } catch (error) {
      const { status, detail } = describeRequestError(error);
      throw new Error(`Failed to get changes (${status || 'no response'}): ${detail}`, { cause: error });
    }
  }

  /**
   * Get all spaces available to the authenticated user.
   * Returns an array of space objects (each includes at least { id, name }).
   *
   * Uses the wiki-native endpoint, which filters to the user's accessible
   * spaces and returns a bare array. (The datasources /api/spaces route is
   * gated behind a datasources-admin role the daemon account may not have,
   * which redirects to an auth page and surfaces as a 404.)
   */
  async getSpaces() {
    try {
      const response = await this.client.get('/applications/wiki/api/spaces');
      // Endpoint returns a bare array; tolerate a { data } wrapper just in case.
      return Array.isArray(response.data) ? response.data : (response.data?.data || []);
    } catch (error) {
      const { status, detail } = describeRequestError(error);
      // Keep the original: the TLS layer needs its `code` to decide whether
      // this is an untrusted certificate worth offering to pin.
      throw new Error(`Failed to list spaces (${status || 'no response'}): ${detail}`, { cause: error });
    }
  }

  /**
   * Verify that the configured server URL and token actually work, and report
   * who the token belongs to. Used by the setup screen before it will save a
   * connection, so a typo is caught at the form rather than surfacing as a
   * mysterious 401 in the activity feed ten seconds later.
   *
   * `getSpaces()` is the probe because it is the first call the daemon makes
   * anyway: it proves the URL resolves, TLS is acceptable, the token is valid,
   * AND that the account can actually see something worth syncing.
   */
  async verify() {
    const spaces = await this.getSpaces();
    return { spaces, spaceCount: spaces.length };
  }

  /**
   * One level (or `depth` levels) of a space's folder tree.
   *
   * THE TREE IS LAZY AND THE RESPONSE IS LEAN — two things the caller must know:
   *
   *  - A folder flagged `truncated: true` was NOT walked. It means "not listed
   *    yet", never "empty"; fetch it by re-requesting this route with its path.
   *    Treating the flag as empty silently hides whole subtrees from the picker.
   *  - Nodes carry `{ type, name, children }` and NO `path` — the server strips
   *    it because it is implied by the nesting and is over 40% of the payload.
   *    The picker rebuilds paths as it descends.
   *
   * @param {string|number} spaceId
   * @param {string} [folderPath] - space-relative folder; '' is the space root
   * @param {number} [depth] - levels to list; the server default is 2
   */
  async getFolderTree(spaceId, folderPath = '', depth = null) {
    try {
      const params = {};
      if (folderPath) params.path = folderPath;
      if (depth) params.depth = depth;

      const response = await this.client.get(
        `/applications/wiki/api/spaces/${encodeURIComponent(spaceId)}/folder-tree`,
        { params }
      );
      const data = response.data || {};
      return {
        tree: Array.isArray(data.tree) ? data.tree : [],
        path: data.path || folderPath || '',
        depth: data.depth,
      };
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.error || error.message;
      throw new Error(`Failed to list folders in space ${spaceId} at "${folderPath || '/'}" (${status || 'no response'}): ${msg}`);
    }
  }

  /**
   * Full-text document search, optionally scoped to one space.
   *
   * The folder picker uses this to make folders findable BY CONTENT, because
   * the platform has no server-side folder search: only documents are indexed.
   * The picker takes each hit's parent directory as a candidate folder — which
   * is why the space-relative `path` on each result is the field that matters
   * here, not the title.
   *
   * @param {string} query
   * @param {object} [opts]
   * @param {string|number} [opts.spaceId] - restrict to one space
   * @param {number} [opts.limit]
   */
  async searchDocuments(query, { spaceId = null, limit = 60 } = {}) {
    try {
      const params = { q: query, limit };
      if (spaceId !== null && spaceId !== undefined && spaceId !== '') params.spaceId = spaceId;

      const response = await this.client.get('/applications/wiki/api/search', { params });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.error || error.message;
      throw new Error(`Search failed (${status || 'no response'}): ${msg}`);
    }
  }

  /**
   * Get space by name
   * Returns the space object which includes the ID
   */
  async getSpaceByName(spaceName) {
    try {
      this.log.info(`[API] Getting space by name: "${spaceName}"`);

      const spaces = await this.getSpaces();

      if (spaces.length === 0) {
        throw new Error('No spaces available on server. Check backend is fully initialized.');
      }

      const space = spaces.find(s => s.name === spaceName);
      if (!space) {
        const available = spaces.map(s => `"${s.name}"`).join(', ');
        throw new Error(`Space "${spaceName}" not found. Available spaces: ${available}`);
      }

      this.log.info(`[API] Found space: "${spaceName}" (ID: ${space.id})`);
      return space;
    } catch (error) {
      throw new Error(`Failed to get space "${spaceName}": ${error.message}`);
    }
  }
}

module.exports = FilingApiClient;
