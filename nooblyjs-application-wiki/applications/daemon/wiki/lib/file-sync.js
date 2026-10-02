const fs = require('node:fs').promises;
const path = require('node:path');
const { nullMonitor } = require('./monitor');

/**
 * Canonical space-relative path: POSIX separators, no leading/trailing slash.
 * Every remote path crossing this module's boundary goes through here so that
 * prefix comparisons in toLocalRelative() compare like with like — the same
 * discipline StateManager applies to its two key spaces.
 */
function normaliseRemote(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

class FileSync {
  /**
   * One sync unit: a local directory mirroring one REMOTE FOLDER of one space.
   *
   * @param {string} watchFolder - local directory this unit owns
   * @param {object} [opts]
   * @param {string} [opts.remoteRoot] - space-relative folder this unit mirrors;
   *   '' means the whole space root (the original behaviour). Local paths are
   *   relative to `watchFolder`, remote paths are relative to the SPACE root, so
   *   every crossing between the two goes through toRemotePath/toLocalRelative.
   */
  constructor(apiClient, stateManager, watchFolder, spaceId, instanceName, ignorePatterns = [], { log = console, monitor = nullMonitor, remoteRoot = '', unitId = null } = {}) {
    this.apiClient = apiClient;
    this.stateManager = stateManager;
    this.watchFolder = watchFolder;
    this.spaceId = spaceId;
    this.instanceName = instanceName; // filing instance for this space, e.g. "space-12"
    this.remoteRoot = normaliseRemote(remoteRoot);
    // Identity of this unit in the Monitor. The dashboard's rows are now one
    // per selected FOLDER, not one per space — a space can contribute several.
    this.unitId = unitId || `${spaceId}::${this.remoteRoot}`;
    this.ignorePatterns = ignorePatterns;
    this.log = log;
    this.monitor = monitor;
    this.folderWatcher = null;
    // Set while the unit is being torn down. See suspend().
    this.suspended = false;
  }

  /**
   * Stop this unit from making any REMOTE change, permanently.
   *
   * This is the safety interlock for removing a folder from the configuration.
   * Removing it deletes the local directory, and deleting a directory chokidar
   * is watching fires an `unlink` for every file in it — which the watcher
   * would faithfully forward to the server as "the user deleted these", wiping
   * the folder out of the wiki for everyone. Closing the watcher first is
   * necessary but NOT sufficient: its handlers are async and unawaited, so
   * events already dispatched are still in flight.
   *
   * So the guard is on the sync side, is set before anything else happens, and
   * is never cleared — a suspended unit is discarded, never reused.
   */
  suspend() {
    this.suspended = true;
  }

  /**
   * Check if a path should be ignored based on configured patterns
   * Matches if any segment of the path equals an ignore pattern
   */
  shouldIgnore(relativePath) {
    if (!this.ignorePatterns || this.ignorePatterns.length === 0) return false;
    const segments = relativePath.split(/[/\\]/);
    return this.ignorePatterns.some(pattern => segments.includes(pattern));
  }

  /**
   * Local-relative path -> full space-relative remote path.
   * The filing API always addresses documents from the space root, so a unit
   * anchored at a subfolder has to put the prefix back on every write.
   */
  toRemotePath(localRelative) {
    const rel = normaliseRemote(localRelative);
    if (!this.remoteRoot) return rel;
    return rel ? `${this.remoteRoot}/${rel}` : this.remoteRoot;
  }

  /**
   * Full space-relative remote path -> path relative to this unit's local
   * folder, or null when the path lies OUTSIDE the folder this unit mirrors.
   *
   * The null case is load-bearing: the change feed carries every event in the
   * space, so this is what stops one selected folder from writing files that
   * belong to a sibling it was never asked to mirror. Matching is on whole path
   * segments — "Sales" must not claim "SalesOps".
   */
  toLocalRelative(remotePath) {
    const rel = normaliseRemote(remotePath);
    if (!this.remoteRoot) return rel;
    if (rel === this.remoteRoot) return '';
    if (rel.startsWith(`${this.remoteRoot}/`)) return rel.slice(this.remoteRoot.length + 1);
    return null;
  }

  /** Does this unit own the given space-relative path? */
  owns(remotePath) {
    return this.toLocalRelative(remotePath) !== null;
  }

  /**
   * Set the folder watcher reference
   */
  setFolderWatcher(folderWatcher) {
    this.folderWatcher = folderWatcher;
  }

  /**
   * Upload a local file to the space via filing API
   */
  async uploadFile(filePath) {
    if (this.suspended) return;
    try {
      const localRelative = path.relative(this.watchFolder, filePath).replace(/\\/g, '/');
      const remotePath = this.toRemotePath(localRelative);

      if (this.shouldIgnore(localRelative)) {
        this.log.info(`[Upload] Ignored by pattern: ${localRelative}`);
        return;
      }

      this.log.info(`[Upload] Processing file: ${filePath}`);

      // Check if file has actually changed
      const hasChanged = await this.stateManager.hasFileChanged(filePath);
      const isTracked = this.stateManager.isFileTracked(filePath);

      if (isTracked && !hasChanged) {
        this.log.info(`[Upload] File unchanged, skipping: ${remotePath}`);
        return;
      }

      // Read file content
      const fileData = await fs.readFile(filePath);

      this.log.info(`[Upload] ${isTracked ? 'Updating' : 'Creating'}: ${remotePath}`);
      await this.apiClient.upload(this.instanceName, remotePath, fileData);

      // Track the file
      await this.stateManager.trackFile(filePath, remotePath);
      this.monitor.count('uploads', this.unitId, fileData.length);
      this.log.info(`[Upload] Done: ${remotePath}`);

    } catch (error) {
      this.log.error(`[Upload] Error uploading ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * Download a file from the space and save to local folder
   */
  async downloadFile(remoteFile) {
    try {
      const remotePath = normaliseRemote(remoteFile.path || remoteFile.name);
      const localRelative = this.toLocalRelative(remotePath);
      if (localRelative === null) {
        this.log.warn(`[Download] Outside this folder, skipping: ${remotePath}`);
        return;
      }
      this.log.info(`[Download] Processing: ${remotePath}`);

      const localFilePath = path.join(this.watchFolder, localRelative);
      const absoluteFilePath = path.resolve(localFilePath);

      // Get file content from filing API
      const content = await this.apiClient.download(this.instanceName, remotePath);

      // Ensure parent directory exists
      const dirPath = path.dirname(localFilePath);
      await fs.mkdir(dirPath, { recursive: true });

      // Tell the watcher to ignore the next change for this file
      if (this.folderWatcher) {
        this.folderWatcher.ignoreFile(localFilePath);
      }

      // Write content to file
      if (Buffer.isBuffer(content)) {
        await fs.writeFile(localFilePath, content);
      } else {
        await fs.writeFile(localFilePath, content, 'utf8');
      }

      // Verify the file was written
      const stats = await fs.stat(localFilePath);
      this.log.info(`[Download] Written: ${absoluteFilePath} (${stats.size} bytes)`);

      // Track the file
      const hash = await this.stateManager.calculateFileHash(localFilePath);
      await this.stateManager.trackFile(localFilePath, remotePath, hash);
      this.monitor.count('downloads', this.unitId, stats.size);

    } catch (error) {
      this.log.error(`[Download] Error downloading ${remoteFile.path || remoteFile.name}:`, error.message);
      throw error;
    }
  }

  /**
   * Delete a local file when it's removed from the space
   */
  async deleteLocalFile(remotePath) {
    try {
      const filePath = this.stateManager.getFilePath(remotePath);

      if (!filePath) {
        this.log.info(`[Delete] No local file tracked for: ${remotePath}`);
        return;
      }

      this.log.info(`[Delete] Removing local file: ${filePath}`);
      await fs.unlink(filePath);
      await this.stateManager.untrackDocument(remotePath);
      this.monitor.count('deletes', this.unitId);
      this.log.info(`[Delete] Deleted: ${filePath}`);

    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log.info(`[Delete] File already gone, cleaning up tracking`);
        await this.stateManager.untrackDocument(remotePath);
      } else {
        this.log.error(`[Delete] Error:`, error.message);
      }
    }
  }

  /**
   * Remove a file from the space when its local copy is deleted.
   * Called by the folder watcher's unlink handler; owns the instance routing
   * and state cleanup so the watcher stays space-agnostic.
   */
  async deleteRemoteFile(filePath) {
    // A suspended unit is being torn down; the local files are about to be
    // removed on purpose and must NOT be removed from the wiki as well.
    if (this.suspended) {
      this.log.info('[Delete] Unit suspended, not propagating local delete');
      return;
    }

    const localRelative = path.relative(this.watchFolder, filePath).replace(/\\/g, '/');
    const remotePath = this.toRemotePath(localRelative);

    if (this.shouldIgnore(localRelative)) {
      return;
    }

    // Only push a delete to the space if we were actually tracking this file
    if (!this.stateManager.isFileTracked(filePath)) {
      this.log.info(`[Delete] Untracked local file removed, nothing to do: ${localRelative}`);
      return;
    }

    await this.apiClient.remove(this.instanceName, remotePath);
    await this.stateManager.untrackFile(filePath);
    this.monitor.count('deletes', this.unitId);
    this.log.info(`[Delete] Removed ${remotePath} from space`);
  }

  /**
   * Apply a single change-feed event to the local mirror.
   * The daemon polls /applications/wiki/api/changes and feeds each event
   * here, replacing the old "browse the whole tree every tick" approach.
   *
   * @param {Object} event - Event payload from the wiki event bus
   *   event.event.operation: 'create' | 'update' | 'delete' | 'rename' | 'move'
   *   event.event.itemType:  'file' | 'folder'
   *   event.item.path / oldPath / newPath
   */
  async applyChange(event) {
    if (this.suspended) return;
    if (!event || !event.event || !event.item) {
      this.log.warn('[Change] malformed event, skipping');
      return;
    }
    const { operation, itemType } = event.event;
    const item = event.item;
    const remotePath = normaliseRemote(item.newPath || item.path);
    const oldPath = item.oldPath ? normaliseRemote(item.oldPath) : null;

    if (remotePath && this.shouldIgnore(remotePath)) {
      this.log.info(`[Change] Ignored by pattern: ${remotePath}`);
      return;
    }

    // The change feed carries the whole space. This unit only mirrors one
    // folder of it, so anything outside is somebody else's business — or
    // nobody's, if that folder was never selected.
    //
    // A MOVE is the exception that makes this two questions rather than one:
    // an item moved OUT of this folder has a destination we do not own, but a
    // local copy we do. Judging only the destination would leave that copy
    // behind forever — present locally, gone from the wiki, and never
    // reconciled, because no future event mentions this folder again.
    const localRelative = this.toLocalRelative(remotePath);
    const oldLocalRelative = oldPath ? this.toLocalRelative(oldPath) : null;
    if (localRelative === null && oldLocalRelative === null) return;

    if (localRelative === null) {
      try {
        if (itemType === 'folder') {
          await fs.rm(path.join(this.watchFolder, oldLocalRelative), { recursive: true, force: true });
          this.log.info(`[Change] moved out of this folder, removed locally: ${oldPath}`);
        } else {
          await this.deleteLocalFile(oldPath);
        }
      } catch (err) {
        this.log.warn(`[Change] could not remove moved-out ${oldPath}: ${err.message}`);
      }
      return;
    }

    try {
      if (itemType === 'folder') {
        if (operation === 'create') {
          const localDir = path.join(this.watchFolder, localRelative);
          await fs.mkdir(localDir, { recursive: true });
          this.log.info(`[Change] mkdir: ${remotePath}`);
        } else if (operation === 'delete') {
          // Never delete the unit's own root out from under itself: the folder
          // is still selected, so it must stay on disk (empty) rather than
          // vanish and take the watcher's mount point with it.
          if (!localRelative) {
            this.log.warn(`[Change] the synced folder itself was deleted remotely (${remotePath}); leaving the local folder in place`);
            return;
          }
          const localDir = path.join(this.watchFolder, localRelative);
          try {
            await fs.rm(localDir, { recursive: true, force: true });
            this.log.info(`[Change] rmdir: ${remotePath}`);
          } catch (err) {
            this.log.warn(`[Change] rmdir failed (${remotePath}): ${err.message}`);
          }
        } else if ((operation === 'rename' || operation === 'move') && oldPath) {
          const oldLocal = oldLocalRelative;
          const newDir = path.join(this.watchFolder, localRelative);
          await fs.mkdir(path.dirname(newDir), { recursive: true });
          if (oldLocal === null) {
            // Moved IN from outside the mirrored folder — there is nothing local
            // to rename, so let the next full sync pull the contents down.
            this.log.info(`[Change] folder ${operation} into this folder: ${oldPath} -> ${remotePath}`);
            await fs.mkdir(newDir, { recursive: true });
            return;
          }
          const oldDir = path.join(this.watchFolder, oldLocal);
          try {
            await fs.rename(oldDir, newDir);
            this.log.info(`[Change] folder ${operation}: ${oldPath} -> ${remotePath}`);
          } catch (err) {
            this.log.warn(`[Change] folder ${operation} failed (${oldPath} -> ${remotePath}): ${err.message}`);
          }
        }
        return;
      }

      // Files
      if (operation === 'create' || operation === 'update') {
        await this.downloadFile({ path: remotePath, name: item.name });
      } else if (operation === 'delete') {
        await this.deleteLocalFile(remotePath);
      } else if ((operation === 'rename' || operation === 'move') && oldPath) {
        // Simple strategy: drop the old local copy, fetch the new path.
        // Avoids edge cases around filesystem-level rename across folders
        // that may not yet exist locally.
        try {
          await this.deleteLocalFile(oldPath);
        } catch (err) {
          this.log.warn(`[Change] delete-old (${oldPath}) failed: ${err.message}`);
        }
        await this.downloadFile({ path: remotePath, name: item.name });
      }
    } catch (err) {
      this.log.error(`[Change] failed to apply ${operation} ${itemType} ${remotePath}:`, err.message);
    }
  }

  /**
   * Sync all files from the space to the local folder
   */
  async syncFromSpace() {
    if (this.suspended) return;
    try {
      this.log.info(`[Sync] Syncing "${this.remoteRoot || '/'}" to local folder...`);

      // Browse this unit's subtree recursively via the filing API, starting at
      // the folder it mirrors rather than the space root — the whole point of a
      // folder selection is not to walk the parts nobody asked for.
      // Skip ignored folders/files at the API level for efficiency
      const remoteFiles = await this.apiClient.browseAll(this.instanceName, this.remoteRoot, (p) => this.shouldIgnore(p));

      // Track which remote paths exist, normalized to the same key space the
      // state manager uses so the deletion check below compares like with like
      const remotePathSet = new Set(
        remoteFiles.map(f => this.stateManager.normalizeRemotePath(f.path))
      );

      this.log.info(`[Sync] Remote files: ${remoteFiles.map(f => f.path).join(', ') || '(empty)'}`);

      // Download new or missing files. An individual file failure must NOT
      // abort the whole pull — on first start we want the ENTIRE repo mirrored
      // before tailing change events, so we catch per-file errors, skip the bad
      // file, and keep going. Failed files stay untracked and are retried on the
      // next full sync.
      let failed = 0;
      for (const remoteFile of remoteFiles) {
        const remotePath = remoteFile.path;

        if (this.shouldIgnore(remotePath)) {
          continue;
        }

        const localRelative = this.toLocalRelative(remotePath);
        if (localRelative === null) continue;

        const localFilePath = path.join(this.watchFolder, localRelative);
        const isTracked = this.stateManager.isDocumentTracked(remotePath);

        // Check if the file actually exists locally
        let fileExists = false;
        try {
          await fs.access(localFilePath);
          fileExists = true;
        } catch {
          fileExists = false;
        }

        if (!isTracked || !fileExists) {
          this.log.info(`[Sync] ${!isTracked ? 'New' : 'Missing'}, downloading: ${remotePath}`);
          try {
            await this.downloadFile(remoteFile);
          } catch (err) {
            failed++;
            this.log.warn(`[Sync] Skipped (download failed, will retry on next full sync): ${remotePath} — ${err.message}`);
          }
        }
      }
      if (failed > 0) {
        this.log.warn(`[Sync] ${failed} file(s) failed to download and were skipped; continued syncing the rest of the space.`);
      }

      // Remove local files for remote files that no longer exist
      // Skip ignored paths to avoid deleting local files that were never meant to sync
      const trackedDocs = this.stateManager.getAllTrackedDocuments();
      for (const docPath of trackedDocs) {
        if (this.shouldIgnore(docPath)) {
          // Stale state entry for an ignored path — untrack but leave local file alone
          await this.stateManager.untrackDocument(docPath);
          continue;
        }
        if (!remotePathSet.has(docPath)) {
          this.log.info(`[Sync] Removed from space, deleting local: ${docPath}`);
          await this.deleteLocalFile(docPath);
        }
      }

      this.log.info(`[Sync] Folder sync completed: ${this.remoteRoot || '/'}`);

      // List local contents for verification
      await this.listWatchFolderContents();

      // Upload any local files that aren't tracked
      await this.uploadUntrackedFiles();

    } catch (error) {
      this.log.error('[Sync] Error syncing from space:', error.message);
    }
  }

  /**
   * Upload any local files that aren't tracked in the space
   */
  async uploadUntrackedFiles() {
    try {
      this.log.info('[Sync] Checking for untracked local files...');

      const localFiles = await this.getAllFiles(this.watchFolder);
      let uploadCount = 0;

      for (const filePath of localFiles) {
        const localRelative = path.relative(this.watchFolder, filePath).replace(/\\/g, '/');

        if (this.shouldIgnore(localRelative)) continue;

        // Tracking is keyed by the FULL space-relative path, so ask about the
        // remote name, not the local one — they differ for every unit anchored
        // below a space root.
        const isTracked = this.stateManager.isDocumentTracked(this.toRemotePath(localRelative));

        if (!isTracked) {
          this.log.info(`[Sync] Untracked local file: ${localRelative}`);
          try {
            await this.uploadFile(filePath);
            uploadCount++;
          } catch (error) {
            this.log.error(`[Sync] Failed to upload ${localRelative}:`, error.message);
          }
        }
      }

      if (uploadCount > 0) {
        this.log.info(`[Sync] Uploaded ${uploadCount} untracked file(s)`);
      } else {
        this.log.info('[Sync] No untracked files');
      }

    } catch (error) {
      this.log.error('[Sync] Error uploading untracked files:', error.message);
    }
  }

  /**
   * List all files in the watch folder
   */
  async listWatchFolderContents() {
    try {
      const absolutePath = path.resolve(this.watchFolder);
      this.log.info(`\n[Sync] === Watch Folder: ${absolutePath} ===`);

      const files = await this.getAllFiles(this.watchFolder);

      if (files.length === 0) {
        this.log.info(`[Sync] (empty)`);
      } else {
        for (const file of files) {
          const stats = await fs.stat(file);
          const relativePath = path.relative(this.watchFolder, file);
          this.log.info(`[Sync]   ${relativePath} (${stats.size} bytes)`);
        }
      }
      this.log.info(`[Sync] ===========================\n`);
    } catch (error) {
      this.log.error(`[Sync] Error listing watch folder:`, error.message);
    }
  }

  /**
   * Recursively get all files in a directory
   */
  async getAllFiles(dir) {
    const files = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...await this.getAllFiles(fullPath));
        } else {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    return files;
  }

  /**
   * Ensure watch folder exists
   */
  async ensureWatchFolder() {
    try {
      const absolutePath = path.resolve(this.watchFolder);
      this.log.info(`[Init] Watch folder: ${absolutePath}`);
      await fs.access(this.watchFolder);
      this.log.info(`[Init] Watch folder exists`);
    } catch {
      const absolutePath = path.resolve(this.watchFolder);
      this.log.info(`[Init] Creating watch folder: ${absolutePath}`);
      await fs.mkdir(this.watchFolder, { recursive: true });
    }
  }
}

module.exports = FileSync;
