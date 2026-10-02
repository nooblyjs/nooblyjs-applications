const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * ConfigStore — the daemon's own persisted configuration.
 *
 * Everything the daemon needs in order to RUN lives here rather than in .env:
 * the server URL, the API token, and the list of folders the operator chose to
 * mirror. It is written by the setup screen and the config panel on the
 * dashboard, so a first run needs no file editing at all.
 *
 * Relationship to .env (deliberate, and one-way):
 *   - This file is the source of truth for serverUrl / token / baseFolder /
 *     folders.
 *   - .env still owns OPERATIONAL knobs (SYNC_INTERVAL, IGNORE_PATTERNS,
 *     DASHBOARD_PORT, WIKI_TLS_INSECURE) — those are deployment settings, not
 *     things a user picks in a UI.
 *   - On a FIRST run only, WIKI_URL, WIKI_API_TOKEN and WATCH_FOLDER from .env
 *     are used to PRE-FILL the setup screen (`seedFromEnv`), so an install that
 *     already worked from .env isn't stranded behind a blank form. They are
 *     never read again once this file exists — otherwise a stale .env would
 *     silently override what the operator just saved in the UI, and there would
 *     be two answers to "what server are we talking to".
 *
 * The token is stored in plaintext, exactly as .env stored it. The file is
 * written 0600 (a no-op on Windows) and is git-ignored. This is a local
 * operator tool holding a credential the operator already has; encrypting it
 * with a key sitting next to it would be theatre.
 */

/** Shipped default — a NooblyJS Wiki running on this machine. Point it at your own server in the setup screen. */
const DEFAULT_SERVER_URL = 'https://localhost:9101/';

const CONFIG_VERSION = 1;

/**
 * Normalise a server URL for storage: trimmed, no trailing slash, scheme
 * required. Returns null when it isn't a usable http(s) URL, so callers can
 * reject it with a message rather than storing something that will only fail
 * later, deep inside axios.
 */
function normaliseServerUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return value.replace(/\/+$/, '');
}

/**
 * Canonical form for a LOCAL base folder typed by a human: quotes stripped,
 * `~` and `%VAR%` expanded, resolved to an absolute native path. Returns null
 * for anything empty, so a blank field is rejected at the form rather than
 * silently resolving to the working directory — which for a daemon launched
 * from a shortcut is wherever the shell happened to be.
 *
 * Expansion is done here, once, rather than left to the shell: this value is
 * typed into a web form, so no shell ever sees it, and an operator who pastes
 * `%USERPROFILE%\Documents` out of Explorer's address bar means the folder it
 * names — not a directory whose literal name contains a percent sign.
 */
function normaliseBaseFolder(raw) {
  let value = String(raw == null ? '' : raw).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  if (!value) return null;

  value = value.replace(/%([^%]+)%/g, (whole, name) => process.env[name] || whole);
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(os.homedir(), value.slice(1));
  }
  if (!value.trim()) return null;

  try {
    return path.resolve(value);
  } catch {
    return null;
  }
}

/**
 * Is `child` the same as, or beneath, `parent`? Compared by path arithmetic
 * rather than string prefix, because "C:\watch2" starts with "C:\watch" and is
 * a completely different directory. Case-insensitively on Windows, where the
 * same folder can be spelled several ways.
 */
function isPathInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return true;
}

/** True for a filesystem root (`C:\`, `/`) — nothing may be mirrored there. */
function isFilesystemRoot(dir) {
  const resolved = path.resolve(dir);
  return path.dirname(resolved) === resolved;
}

/**
 * Canonical space-relative folder path: POSIX separators, no leading or
 * trailing slash, no './'. The empty string means "the whole space root",
 * which is how the old mirror-everything behaviour is still expressible.
 */
function normaliseFolderPath(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/**
 * A selection's stable identity: the space it lives in plus its path. Used as
 * the key for state files and for diffing one saved selection against the next,
 * so re-saving an unchanged folder never re-mirrors it.
 */
function folderId(spaceId, remotePath) {
  return `${spaceId}::${normaliseFolderPath(remotePath)}`;
}

/**
 * Short, filesystem-safe derivation of a folder id, used to name that folder's
 * state file. A hash rather than the path itself because the path contains
 * slashes, spaces and characters Windows rejects, and because a deep path would
 * otherwise blow the filename length limit.
 */
function folderKey(id) {
  return crypto.createHash('sha1').update(id).digest('hex').slice(0, 12);
}

/** Show enough of a token to recognise it, never enough to use it. */
function maskToken(token) {
  const value = String(token || '');
  if (!value) return null;
  if (value.length <= 12) return `${value.slice(0, 3)}…`;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

class ConfigStore {
  /**
   * @param {string} filePath
   * @param {object} [opts]
   * @param {object} [opts.log]
   * @param {string} [opts.defaultBaseFolder] where a FRESH install mirrors to
   * @param {string} [opts.legacyBaseFolder]  where a build predating the
   *   configurable folder mirrored to; used for an existing config that has no
   *   `baseFolder` of its own, so an upgrade never moves anybody's files.
   */
  constructor(filePath, { log = console, defaultBaseFolder = null, legacyBaseFolder = null } = {}) {
    this.filePath = filePath;
    this.log = log;
    this.data = { version: CONFIG_VERSION, serverUrl: null, token: null, baseFolder: null, folders: [], trustedCertificates: [] };
    this.loaded = false;
    this.seededFromEnv = false;
    this.existedOnLoad = false;
    this.defaultBaseFolder = defaultBaseFolder ? path.resolve(defaultBaseFolder) : null;
    this.legacyBaseFolder = legacyBaseFolder ? path.resolve(legacyBaseFolder) : this.defaultBaseFolder;
  }

  /**
   * Read the config from disk. A missing file is the normal first-run case and
   * yields an empty config seeded from .env. A CORRUPT file is not treated as
   * missing: overwriting it would silently discard a folder selection the
   * operator may have spent real time building, so it is moved aside to
   * `<file>.corrupt-<timestamp>` and reported.
   */
  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = this._coerce(parsed);
      this.loaded = true;
      this.existedOnLoad = true;
      this.log.info(`[Config] Loaded ${this.data.folders.length} folder selection(s) from ${path.basename(this.filePath)}`);
      return this.data;
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.loaded = true;
        this._seedFromEnv();
        return this.data;
      }
      // Unreadable or unparseable — preserve it and start clean.
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        await fs.rename(this.filePath, backup);
        this.log.error(`[Config] ${path.basename(this.filePath)} is unreadable (${err.message}); moved to ${path.basename(backup)} and starting fresh`);
      } catch {
        this.log.error(`[Config] ${path.basename(this.filePath)} is unreadable (${err.message}) and could not be moved aside`);
      }
      this.data = { version: CONFIG_VERSION, serverUrl: null, token: null, baseFolder: null, folders: [], trustedCertificates: [] };
      this.loaded = true;
      // A config that was there but unreadable still means an INSTALLED daemon
      // with a mirror already on disk, so it keeps the pre-upgrade default
      // folder rather than being treated as a first run.
      this.existedOnLoad = true;
      this._seedFromEnv();
      return this.data;
    }
  }

  /**
   * Accept whatever was on disk and return a shape the rest of the daemon can
   * rely on. Every field is defaulted, because a hand-edited or half-written
   * file must not turn into a TypeError three modules away.
   */
  _coerce(parsed) {
    const source = (parsed && typeof parsed === 'object') ? parsed : {};
    const folders = Array.isArray(source.folders) ? source.folders : [];
    const seen = new Set();
    const clean = [];

    for (const entry of folders) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.spaceId === undefined || entry.spaceId === null) continue;
      const spaceId = String(entry.spaceId);
      const remotePath = normaliseFolderPath(entry.remotePath);
      const id = folderId(spaceId, remotePath);
      if (seen.has(id)) continue; // same folder listed twice — keep the first
      seen.add(id);
      clean.push({
        id,
        spaceId,
        spaceName: String(entry.spaceName || `Space ${spaceId}`),
        remotePath,
        addedAt: entry.addedAt || new Date().toISOString(),
      });
    }

    const certs = Array.isArray(source.trustedCertificates) ? source.trustedCertificates : [];
    const cleanCerts = [];
    const seenPrints = new Set();
    for (const c of certs) {
      if (!c || typeof c !== 'object' || !c.pem || !c.fingerprint) continue;
      if (seenPrints.has(c.fingerprint)) continue;
      seenPrints.add(c.fingerprint);
      cleanCerts.push({
        fingerprint: String(c.fingerprint),
        subject: String(c.subject || ""),
        issuer: String(c.issuer || ""),
        serverUrl: c.serverUrl ? String(c.serverUrl) : null,
        validTo: c.validTo ? String(c.validTo) : null,
        pem: String(c.pem),
        addedAt: c.addedAt || new Date().toISOString(),
      });
    }

    return {
      version: CONFIG_VERSION,
      serverUrl: normaliseServerUrl(source.serverUrl),
      token: source.token ? String(source.token) : null,
      baseFolder: normaliseBaseFolder(source.baseFolder),
      folders: clean,
      trustedCertificates: cleanCerts,
    };
  }

  /**
   * First run only: pre-fill from the environment so an install that already
   * worked from .env opens the setup screen with its answers filled in rather
   * than blank. Never applied once a config file exists.
   */
  _seedFromEnv() {
    const envUrl = normaliseServerUrl(process.env.WIKI_URL || process.env.SERVER_URL);
    const envToken = process.env.WIKI_API_TOKEN || process.env.WIKI_TOKEN || null;
    if (envUrl) this.data.serverUrl = envUrl;
    if (envToken) this.data.token = String(envToken);
    // WATCH_FOLDER is not read here: it reaches the setup form through
    // appPaths.defaultWatchFolder(), which is the same route the Documents
    // default takes, so there is one place that decides the pre-filled folder.
    if (envUrl || envToken) {
      this.seededFromEnv = true;
      this.log.info('[Config] No config file yet — pre-filling setup from .env (WIKI_URL / WIKI_API_TOKEN)');
    }
  }

  /**
   * Persist. Written to a temp file and renamed so a crash mid-write can never
   * leave a half-written config — the one file whose loss means the operator
   * has to redo the whole folder selection by hand.
   */
  async save() {
    const tmp = `${this.filePath}.tmp`;
    const body = JSON.stringify(this.data, null, 2);
    await fs.writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, this.filePath);
    // rename preserves the temp file's mode, but be explicit for the case where
    // the destination already existed with looser permissions.
    try {
      await fs.chmod(this.filePath, 0o600);
    } catch { /* not supported on this platform/filesystem */ }
  }

  /** Everything needed to connect AND something to sync. */
  isComplete() {
    return !!(this.data.serverUrl && this.data.token);
  }

  get serverUrl() { return this.data.serverUrl; }
  get token() { return this.data.token; }
  get folders() { return this.data.folders.slice(); }

  /**
   * The local root every mirror is written beneath — a stored choice when the
   * operator has made one, and otherwise a default that depends on whether this
   * is a first run.
   *
   * The fallback is NOT persisted on read. An unsaved default stays derived, so
   * it keeps tracking the environment (a `WATCH_FOLDER` added to .env, a
   * Documents folder that has since been redirected) right up until the operator
   * saves a location of their own — at which point it is pinned and nothing in
   * the environment can move it again.
   */
  get baseFolder() {
    return this.data.baseFolder || this.defaultFolderForThisInstall();
  }

  /** Is the folder above a stored choice rather than a derived default? */
  get baseFolderChosen() { return !!this.data.baseFolder; }

  /**
   * The folder to fall back on: the pre-upgrade location for a config that
   * already existed (moving somebody's mirror on upgrade is never right), the
   * new default for a first run.
   */
  defaultFolderForThisInstall() {
    return (this.existedOnLoad ? this.legacyBaseFolder : this.defaultBaseFolder) || this.defaultBaseFolder;
  }

  /**
   * Store the local root. Only the value is written here — MOVING an existing
   * mirror to it is the engine's job (`SyncEngine.relocate`), because the config
   * store owns no files and must not be the thing that decides to touch them.
   */
  async setBaseFolder(folder) {
    const resolved = normaliseBaseFolder(folder);
    if (!resolved) throw new Error('A local folder is required');
    this.data.baseFolder = resolved;
    await this.save();
    return resolved;
  }

  async setConnection(serverUrl, token) {
    const url = normaliseServerUrl(serverUrl);
    if (!url) throw new Error('Server URL must be a valid http(s) URL');
    if (!token || !String(token).trim()) throw new Error('An API token is required');
    this.data.serverUrl = url;
    this.data.token = String(token).trim();
    await this.save();
  }

  /**
   * Replace the folder selection wholesale and report what changed, so the
   * caller can act incrementally: start syncing only what was added, and tear
   * down only what was removed. Returns normalised entries, never the raw
   * client input.
   */
  async setFolders(folders) {
    const before = new Map(this.data.folders.map(f => [f.id, f]));
    const next = [];
    const seen = new Set();

    for (const entry of Array.isArray(folders) ? folders : []) {
      if (!entry || entry.spaceId === undefined || entry.spaceId === null) continue;
      const spaceId = String(entry.spaceId);
      const remotePath = normaliseFolderPath(entry.remotePath);
      const id = folderId(spaceId, remotePath);
      if (seen.has(id)) continue;
      seen.add(id);
      next.push(before.get(id) || {
        id,
        spaceId,
        spaceName: String(entry.spaceName || `Space ${spaceId}`),
        remotePath,
        addedAt: new Date().toISOString(),
      });
    }

    const added = next.filter(f => !before.has(f.id));
    const removed = this.data.folders.filter(f => !seen.has(f.id));

    this.data.folders = next;
    await this.save();
    return { folders: next, added, removed };
  }

  get trustedCertificates() { return this.data.trustedCertificates.slice(); }

  /** PEM bodies only, which is what an https.Agent wants. */
  trustedPems() { return this.data.trustedCertificates.map(c => c.pem); }

  /**
   * Pin a certificate the operator chose to trust. Keyed by fingerprint so
   * re-accepting the same certificate is a no-op rather than a growing list,
   * and so a REPLACED server certificate (a regenerated dev cert) arrives as a
   * new entry the operator has to accept again — which is the point of pinning.
   */
  async trustCertificate(cert) {
    if (!cert || !cert.pem || !cert.fingerprint) throw new Error('A certificate with a fingerprint is required');
    const existing = this.data.trustedCertificates.find(c => c.fingerprint === cert.fingerprint);
    if (existing) return existing;
    const entry = {
      fingerprint: cert.fingerprint,
      subject: cert.subject || '',
      issuer: cert.issuer || '',
      serverUrl: cert.serverUrl || this.data.serverUrl || null,
      validTo: cert.validTo || null,
      pem: cert.pem,
      addedAt: new Date().toISOString(),
    };
    this.data.trustedCertificates.push(entry);
    await this.save();
    return entry;
  }

  /** Remove a pinned certificate by fingerprint. */
  async untrustCertificate(fingerprint) {
    const before = this.data.trustedCertificates.length;
    this.data.trustedCertificates = this.data.trustedCertificates.filter(c => c.fingerprint !== fingerprint);
    if (this.data.trustedCertificates.length !== before) await this.save();
    return before - this.data.trustedCertificates.length;
  }

  /** Forget the credential (the dashboard's "sign out"); keeps the selection. */
  async clearToken() {
    this.data.token = null;
    await this.save();
  }

  /**
   * The view handed to the browser. The token is MASKED, never sent: the
   * dashboard has no reason to display a working credential, and the config
   * endpoint is the one route most likely to end up in a screenshot.
   */
  redacted() {
    return {
      serverUrl: this.data.serverUrl,
      defaultServerUrl: DEFAULT_SERVER_URL,
      hasToken: !!this.data.token,
      tokenHint: maskToken(this.data.token),
      seededFromEnv: this.seededFromEnv,
      baseFolder: this.baseFolder,
      baseFolderChosen: this.baseFolderChosen,
      defaultBaseFolder: this.defaultFolderForThisInstall(),
      folders: this.data.folders.map(f => ({ ...f })),
      trustedCertificates: this.data.trustedCertificates.map(({ pem, ...rest }) => rest),
    };
  }
}

module.exports = {
  ConfigStore,
  DEFAULT_SERVER_URL,
  normaliseServerUrl,
  normaliseBaseFolder,
  normaliseFolderPath,
  isPathInside,
  isFilesystemRoot,
  folderId,
  folderKey,
  maskToken,
};
