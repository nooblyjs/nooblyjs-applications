const fs = require('node:fs').promises;
const crypto = require('crypto');
const path = require('node:path');

/**
 * StateManager — persists the daemon's two-way index between local files and
 * remote space documents to a JSON file so sync survives restarts.
 *
 * There are two intentional key spaces, each normalized canonically so the
 * same file/document always produces the same key no matter how the path was
 * derived (chokidar emit vs path.join, separator direction, drive-letter
 * casing, "./" prefixes):
 *
 *   state.files     — keyed by local path  (normalizeLocalPath)
 *                     value: { remotePath, hash, lastSync }
 *   state.documents — keyed by remote path (normalizeRemotePath; relative POSIX)
 *                     value: { localPath, hash, lastSync }
 *
 * The two maps mirror each other so a filesystem event (which knows the local
 * path) and a change-feed event (which knows the remote path) can each resolve
 * the other side in O(1).
 */
class StateManager {
  constructor(stateFilePath = '.daemon-state.json', { log = console } = {}) {
    this.stateFilePath = stateFilePath;
    this.log = log;
    this.state = {
      files: {},      // { localKey:  { remotePath, hash, lastSync } }
      documents: {},  // { remoteKey: { localPath,  hash, lastSync } }
    };
  }

  /**
   * Canonical key for a local filesystem path. Absolute + forward slashes so a
   * path emitted by chokidar matches the same file produced by
   * path.join(watchFolder, remotePath). Windows filesystems are
   * case-insensitive, so the key is also lowercased there to absorb
   * drive-letter casing; other platforms are left case-sensitive.
   */
  normalizeLocalPath(filePath) {
    let key = path.resolve(filePath).replace(/\\/g, '/');
    if (process.platform === 'win32') key = key.toLowerCase();
    return key;
  }

  /**
   * Canonical key for a remote document path: relative, POSIX separators, no
   * duplicate slashes and no leading "./" or "/". Remote paths are
   * case-sensitive, so casing is preserved.
   */
  normalizeRemotePath(remotePath) {
    return String(remotePath)
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\//, '');
  }

  /**
   * Load state from disk
   */
  async load() {
    try {
      const data = await fs.readFile(this.stateFilePath, 'utf8');
      this.state = JSON.parse(data);
      this.log.info('[State] Loaded state from disk');
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log.info('[State] No existing state file, starting fresh');
        await this.save();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save state to disk
   */
  async save() {
    try {
      await fs.writeFile(
        this.stateFilePath,
        JSON.stringify(this.state, null, 2),
        'utf8'
      );
    } catch (error) {
      this.log.error('[State] Failed to save state:', error.message);
    }
  }

  /**
   * Calculate hash of file content
   */
  async calculateFileHash(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (error) {
      throw new Error(`Failed to calculate hash for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Track a local file and the remote document it maps to.
   * @param {string} filePath - local filesystem path (any representation)
   * @param {string} remotePath - relative POSIX path of the document in the space
   * @param {string} [hash] - precomputed content hash; read from disk if omitted
   */
  async trackFile(filePath, remotePath, hash = null) {
    if (!hash) {
      hash = await this.calculateFileHash(filePath);
    }

    const localKey = this.normalizeLocalPath(filePath);
    const remoteKey = this.normalizeRemotePath(remotePath);
    const lastSync = new Date().toISOString();

    this.state.files[localKey] = { remotePath: remoteKey, hash, lastSync };
    this.state.documents[remoteKey] = { localPath: localKey, hash, lastSync };

    await this.save();
  }

  /**
   * Check if a file has changed
   */
  async hasFileChanged(filePath) {
    const currentHash = await this.calculateFileHash(filePath);
    const trackedFile = this.state.files[this.normalizeLocalPath(filePath)];

    if (!trackedFile) {
      return true; // New file
    }

    return currentHash !== trackedFile.hash;
  }

  /**
   * Get the remote document path mapped to a local file
   */
  getRemotePath(filePath) {
    return this.state.files[this.normalizeLocalPath(filePath)]?.remotePath;
  }

  /**
   * Get the local path mapped to a remote document
   */
  getFilePath(remotePath) {
    return this.state.documents[this.normalizeRemotePath(remotePath)]?.localPath;
  }

  /**
   * Check if a remote document is tracked
   */
  isDocumentTracked(remotePath) {
    return !!this.state.documents[this.normalizeRemotePath(remotePath)];
  }

  /**
   * Check if a local file is tracked
   */
  isFileTracked(filePath) {
    return !!this.state.files[this.normalizeLocalPath(filePath)];
  }

  /**
   * Remove tracking for a local file (and its paired remote document)
   */
  async untrackFile(filePath) {
    const localKey = this.normalizeLocalPath(filePath);
    const remoteKey = this.state.files[localKey]?.remotePath;

    delete this.state.files[localKey];
    if (remoteKey) {
      delete this.state.documents[remoteKey];
    }

    await this.save();
  }

  /**
   * Remove tracking for a remote document (and its paired local file)
   */
  async untrackDocument(remotePath) {
    const remoteKey = this.normalizeRemotePath(remotePath);
    const localKey = this.state.documents[remoteKey]?.localPath;

    delete this.state.documents[remoteKey];
    if (localKey) {
      delete this.state.files[localKey];
    }

    await this.save();
  }

  /**
   * Get all tracked local file keys
   */
  getAllTrackedFiles() {
    return Object.keys(this.state.files);
  }

  /**
   * Get all tracked remote document keys
   */
  getAllTrackedDocuments() {
    return Object.keys(this.state.documents);
  }

  /**
   * Rewrite every tracked local path from one directory to another, after the
   * mirror itself has been MOVED on disk (the operator changed the base folder).
   *
   * This has to happen or the move is worse than useless: local paths are the
   * key space here, so a state file still pointing at the old directory
   * describes files that are no longer there — every document would look
   * untracked, the whole folder would be mirrored again, and the moved copy
   * would sit beside it unowned.
   *
   * Only entries INSIDE `fromDir` are rewritten. Anything else is left exactly
   * as it was rather than being dropped: it is not ours to reason about, and
   * silently discarding tracking is what turns a file into a duplicate upload.
   *
   * @returns {number} how many tracked files were rebased
   */
  async rebase(fromDir, toDir) {
    const fromKey = this.normalizeLocalPath(fromDir);
    const toKey = this.normalizeLocalPath(toDir);
    if (fromKey === toKey) return 0;

    // The separator matters: "…/Reports" must not swallow "…/Reports Archive".
    const moved = (key) => key === fromKey || key.startsWith(`${fromKey}/`);
    const rekey = (key) => (key === fromKey ? toKey : toKey + key.slice(fromKey.length));

    const files = {};
    let rebased = 0;
    for (const [key, value] of Object.entries(this.state.files)) {
      if (moved(key)) { files[rekey(key)] = value; rebased++; } else { files[key] = value; }
    }

    const documents = {};
    for (const [key, value] of Object.entries(this.state.documents)) {
      documents[key] = (value && value.localPath && moved(this.normalizeLocalPath(value.localPath)))
        ? { ...value, localPath: rekey(this.normalizeLocalPath(value.localPath)) }
        : value;
    }

    this.state = { ...this.state, files, documents };
    await this.save();
    return rebased;
  }

  /**
   * Clear all state
   */
  async clear() {
    this.state = {
      files: {},
      documents: {},
    };
    await this.save();
  }
}

module.exports = StateManager;
