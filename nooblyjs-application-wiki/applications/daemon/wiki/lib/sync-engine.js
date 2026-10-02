const fs = require('node:fs').promises;
const path = require('node:path');

const FilingApiClient = require('./api-client');
const StateManager = require('./state-manager');
const FileSync = require('./file-sync');
const FolderWatcher = require('./folder-watcher');
const { nullMonitor } = require('./monitor');
const { folderKey, normaliseFolderPath } = require('./config-store');
const { sanitizeFolderName, localPathForFolder } = require('./local-paths');
const { collapseHitsToFolders } = require('./folder-search');

/**
 * SyncEngine — the daemon's runtime.
 *
 * It owns a set of SYNC UNITS, one per folder the operator selected, and the
 * single change-feed poll that feeds all of them. Unlike the original daemon
 * (which discovered every space at boot and then never changed shape), this is
 * built to be RECONFIGURED WHILE RUNNING: `applySelection` diffs the new folder
 * list against the live one and only starts what was added and tears down what
 * was removed, so adding one folder never re-mirrors the others.
 */
class SyncEngine {
  /**
   * @param {object} opts
   * @param {string} opts.watchFolder     local root for all mirrors
   * @param {string} opts.stateDir        where per-unit state files live
   * @param {number} opts.syncInterval    change-feed poll interval (ms)
   * @param {string[]} opts.ignorePatterns
   * @param {boolean} opts.tlsInsecure
   */
  constructor(opts, { log = console, monitor = nullMonitor } = {}) {
    this.opts = opts;
    this.log = log;
    this.monitor = monitor;

    this.apiClient = null;
    this.serverUrl = null;
    this.spaces = [];

    /** unitId -> { folder, watchFolder, stateManager, fileSync, folderWatcher } */
    this.units = new Map();

    this.changeCursor = null;
    this.cursorFile = path.join(opts.stateDir, '.daemon-cursor.json');
    this._cursorDirty = false;
    this._cursorSaveTimer = null;

    this.pollTimer = null;
    this.polling = false;   // in-flight guard, see _tick()
    this.stopped = false;
  }

  get connected() {
    return !!this.apiClient;
  }

  // ==========================================================================
  // Connection
  // ==========================================================================

  /**
   * Authenticate against a server with a token and confirm it works. Throws
   * with a usable message when it doesn't — this is called straight from the
   * setup form, so the message is what the operator reads.
   */
  async connect(serverUrl, token, { trustedCerts = [] } = {}) {
    const client = new FilingApiClient(serverUrl, {
      log: this.log,
      insecureTLS: this.opts.tlsInsecure,
      trustedCerts,
    });
    client.useToken(token);

    const { spaces } = await client.verify();

    this.apiClient = client;
    this.serverUrl = serverUrl;
    this.spaces = spaces;

    // Hand the new client to units that already exist. The common reason to
    // come through here twice is a token that expired: the folders and their
    // mirrors are all still valid, and leaving them holding the old client
    // would mean every one of them kept failing with 401 against a daemon that
    // reports itself connected.
    for (const unit of this.units.values()) {
      unit.fileSync.apiClient = client;
    }

    this.monitor.setConnection({
      serverUrl,
      authenticated: true,
      authMethod: 'token',
      watchFolder: path.resolve(this.opts.watchFolder),
      syncInterval: this.opts.syncInterval,
    });
    this.log.info(`[Init] Connected to ${serverUrl} — ${spaces.length} space(s) visible`);
    return spaces;
  }

  /** Drop the connection (used when the operator changes server or signs out). */
  disconnect() {
    this.apiClient = null;
    this.serverUrl = null;
    this.spaces = [];
    this.monitor.setConnection({ authenticated: false, authMethod: null });
  }

  _requireClient() {
    if (!this.apiClient) throw new Error('Not connected — set the server URL and token first');
    return this.apiClient;
  }

  async listSpaces({ refresh = false } = {}) {
    const client = this._requireClient();
    if (refresh || !this.spaces.length) this.spaces = await client.getSpaces();
    return this.spaces;
  }

  /** One level of a space's folder tree, for the picker. */
  async listFolders(spaceId, folderPath = '', depth = null) {
    return this._requireClient().getFolderTree(spaceId, folderPath, depth);
  }

  /**
   * Find FOLDERS by searching document CONTENT.
   *
   * The platform indexes documents, not folders — there is no folder search to
   * call — so a folder becomes findable through the documents inside it: hits
   * are collapsed onto their parent directories, and each distinct parent is
   * offered as a selectable folder, carrying the number of hits it accounted
   * for so the strongest match sorts first.
   *
   * THE SPACE IS PART OF THE ANSWER, WHICH IS WHY THIS FANS OUT RATHER THAN
   * RUNNING ONE UNSCOPED SEARCH. Several spaces are different curated lenses
   * over ONE content directory, and the index can only stamp a document with
   * whichever of them indexed that directory last. An unscoped search therefore
   * returns a space that is a guess — the backend says so in as many words
   * ("only an unscoped search has no better answer than the stamp"), and falls
   * back to the first public space when even the stamp does not resolve. Binding
   * a sync unit to a guessed space is not a cosmetic error: the daemon would
   * mirror the folder through a lens whose allowedPaths may not expose it, and
   * every file would 404.
   *
   * Asking each space SEPARATELY makes the search scoped, and a scoped search
   * answers with the space that was requested. The cost is one request per
   * visible space, they are cached server-side for 5 minutes, and they run a few
   * at a time so a wide account does not open a dozen sockets at once.
   */
  async searchFolders(query, { spaceId = null, limit = 60 } = {}) {
    const client = this._requireClient();

    const targets = (spaceId !== null && spaceId !== undefined && spaceId !== '')
      ? [{ id: String(spaceId), name: this.spaceNameFor(spaceId) }]
      : (await this.listSpaces()).map(s => ({ id: String(s.id), name: s.name }));

    const batches = [];
    const CONCURRENCY = 4;

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const slice = targets.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(slice.map(async (target) => {
        try {
          return { target, hits: await client.searchDocuments(query, { spaceId: target.id, limit }) };
        } catch (err) {
          // One space failing must not lose the results from the others.
          this.log.warn(`[Search] "${target.name}" failed: ${err.message}`);
          return { target, hits: [] };
        }
      }));
      batches.push(...settled);
    }

    return collapseHitsToFolders(batches);
  }

  /** Display name for a space id, falling back to something recognisable. */
  spaceNameFor(id) {
    const match = this.spaces.find(s => String(s.id) === String(id));
    return match ? match.name : `Space ${id}`;
  }

  // ==========================================================================
  // Selection
  // ==========================================================================

  /**
   * Bring the live units in line with `folders` (the saved selection).
   *
   * Returns what it actually did, so the caller can report it. Removal is NOT
   * inferred from absence alone — the caller passes `deleteLocal` to say
   * whether the local directory goes with it, because that is a destructive
   * choice that belongs to the operator, not to a diff.
   */
  async applySelection(folders, { deleteLocal = true } = {}) {
    const wanted = new Map(folders.map(f => [f.id, f]));
    const added = [];
    const removed = [];

    // Tear down units no longer selected, FIRST — so a folder being replaced by
    // one at the same path never has two watchers on one directory.
    for (const id of [...this.units.keys()]) {
      if (!wanted.has(id)) {
        await this.removeUnit(id, { deleteLocal });
        removed.push(id);
      }
    }

    for (const folder of folders) {
      if (this.units.has(folder.id)) continue;
      await this.addUnit(folder);
      added.push(folder.id);
    }

    return { added, removed };
  }

  /**
   * Build a unit for one selected folder and register it. Does NOT start
   * syncing — `startUnit` does that, so a caller can create everything and then
   * kick off the (slow) initial mirrors with the dashboard already showing the
   * rows.
   */
  async addUnit(folder) {
    const client = this._requireClient();
    const watchFolder = localPathForFolder(this.opts.watchFolder, folder.spaceName, folder.remotePath);
    const instanceName = `space-${folder.spaceId}`;
    const stateFile = path.join(this.opts.stateDir, `.daemon-state-${folderKey(folder.id)}.json`);

    const stateManager = new StateManager(stateFile, { log: this.log });
    await stateManager.load();

    const fileSync = new FileSync(
      client,
      stateManager,
      watchFolder,
      folder.spaceId,
      instanceName,
      this.opts.ignorePatterns,
      { log: this.log, monitor: this.monitor, remoteRoot: folder.remotePath, unitId: folder.id }
    );
    await fileSync.ensureWatchFolder();

    const folderWatcher = new FolderWatcher(
      watchFolder,
      fileSync,
      folder.spaceId,
      this.opts.ignorePatterns,
      { log: this.log }
    );
    fileSync.setFolderWatcher(folderWatcher);

    const unit = { folder, instanceName, watchFolder, stateManager, fileSync, folderWatcher, started: false };
    this.units.set(folder.id, unit);

    this.monitor.registerFolder(folder.id, {
      spaceId: folder.spaceId,
      spaceName: folder.spaceName,
      remotePath: folder.remotePath,
      watchFolder,
    });

    this.log.info(`[Init] Prepared "${folder.spaceName}/${folder.remotePath || '(root)'}" -> ${watchFolder}`);
    return unit;
  }

  /**
   * Start one unit: mirror it, then watch it.
   *
   * `bulkSync` is skipped only when the unit already has tracked files AND a
   * change cursor survived the last run — i.e. when tailing the feed can be
   * trusted to carry everything that happened since. Otherwise the folder is
   * mirrored in full, which is also what happens the first time it is selected.
   */
  async startUnit(unit, { bulkSync = true } = {}) {
    if (unit.started) return;
    if (bulkSync) {
      this.log.info(`[Daemon] Initial mirror: "${unit.folder.spaceName}/${unit.folder.remotePath || '(root)'}"`);
      await unit.fileSync.syncFromSpace();
    }
    await unit.folderWatcher.start();
    unit.started = true;
  }

  /**
   * Remove a unit, and optionally the local directory it mirrored.
   *
   * ORDER IS THE WHOLE POINT HERE. Deleting a watched directory makes chokidar
   * emit `unlink` for every file in it, and the watcher's job is to forward
   * those to the server as deletions — which would erase the folder from the
   * wiki for everyone, from what the operator experienced as "stop syncing
   * this". So: suspend the sync (a latch the delete path checks, and which no
   * in-flight event can race past), then close the watcher, and only then touch
   * the disk.
   */
  async removeUnit(id, { deleteLocal = true } = {}) {
    const unit = this.units.get(id);
    if (!unit) return false;

    unit.fileSync.suspend();
    try {
      await unit.folderWatcher.stop();
    } catch (err) {
      this.log.warn(`[Config] Error stopping watcher for ${id}: ${err.message}`);
    }

    this.units.delete(id);
    this.monitor.unregisterFolder(id);

    if (deleteLocal) {
      try {
        await fs.rm(unit.watchFolder, { recursive: true, force: true });
        this.log.info(`[Config] Deleted local folder: ${unit.watchFolder}`);
        await this._pruneEmptyParents(unit.watchFolder);
      } catch (err) {
        this.log.error(`[Config] Could not delete ${unit.watchFolder}: ${err.message}`);
      }
    }

    // The state file describes a mirror that no longer exists. Leaving it would
    // make re-adding the folder later look "already synced" while the disk is
    // empty, so every file would be treated as a remote deletion.
    try {
      await fs.unlink(unit.stateManager.stateFilePath);
    } catch { /* never existed, or already gone */ }

    this.log.info(`[Config] Stopped syncing "${unit.folder.spaceName}/${unit.folder.remotePath || '(root)'}"`);
    return true;
  }

  /**
   * Walk up from a deleted mirror removing directories that are now empty, so
   * a nested selection doesn't leave a trail of hollow scaffolding behind
   * (`Engineering/Commercial Services/` after `.../Technology` is dropped).
   * Stops at the watch folder itself and at the first non-empty directory —
   * anything with content is somebody's, and not ours to remove.
   */
  async _pruneEmptyParents(startDir, watchRoot = this.opts.watchFolder) {
    const root = path.resolve(watchRoot);
    // Containment by path arithmetic, not by string prefix: "C:\watch2" starts
    // with "C:\watch" and is a completely different directory.
    const inside = (dir) => {
      const rel = path.relative(root, dir);
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    };
    let dir = path.dirname(path.resolve(startDir));
    while (inside(dir)) {
      let entries;
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }
      if (entries.length > 0) return;
      try {
        await fs.rmdir(dir);
      } catch {
        return;
      }
      dir = path.dirname(dir);
    }
  }

  /** The local root every mirror currently sits beneath, resolved. */
  get watchFolder() {
    return path.resolve(this.opts.watchFolder);
  }

  /**
   * Move every mirror to a new local root.
   *
   * The naive version of this — point the engine somewhere new and let it
   * mirror again — is wrong in a way the operator only discovers later: the old
   * copy is left behind unowned (looking exactly like a folder they chose to
   * keep), everything is re-downloaded, and any local edit not yet uploaded now
   * exists only in the abandoned tree. So the files are CARRIED OVER instead:
   *
   *   1. watchers off first, uploads suspended (an fs.rename of a watched
   *      directory otherwise rains `unlink` events into the delete path, which
   *      forwards deletions to the server — the same trap removeUnit documents);
   *   2. rename each unit's directory to the new root;
   *   3. rebase its state file, because tracking is keyed by ABSOLUTE local
   *      path and a move invalidates every key (see StateManager.rebase);
   *   4. rebuild the units against the new root.
   *
   * A rename that cannot happen (a different drive — EXDEV — or a file held
   * open) is not fatal and is not silent: that unit keeps its files where they
   * are, loses its state file, and is mirrored again at the new location, which
   * is the outcome the naive version gives for everything. The caller gets both
   * lists so it can say which folders were carried and which were left behind.
   *
   * Restarting is NOT done here — `startAll` is the caller's to schedule, so a
   * relocation triggered from an HTTP request can answer immediately and let
   * the (potentially long) re-mirror run in the background.
   */
  async relocate(newBase) {
    const from = path.resolve(this.opts.watchFolder);
    const to = path.resolve(newBase);
    if (from === to) return { changed: false, moved: [], remirrored: [] };

    const folders = [...this.units.values()].map(u => u.folder);

    this.stopPolling();
    await this.clearUnits();          // stops watchers; leaves every file alone

    const moved = [];
    const remirrored = [];

    for (const folder of folders) {
      const oldDir = localPathForFolder(from, folder.spaceName, folder.remotePath);
      const newDir = localPathForFolder(to, folder.spaceName, folder.remotePath);
      const stateFile = path.join(this.opts.stateDir, `.daemon-state-${folderKey(folder.id)}.json`);
      const label = `${folder.spaceName}/${folder.remotePath || '(root)'}`;

      let carried = false;
      if (await this._exists(oldDir)) {
        try {
          await fs.mkdir(path.dirname(newDir), { recursive: true });
          await fs.rename(oldDir, newDir);
          carried = true;
        } catch (err) {
          this.log.warn(`[Config] Could not move "${label}" to ${newDir}: ${err.message} — it will be downloaded again and the old copy left at ${oldDir}`);
        }
      }

      if (carried) {
        try {
          const state = new StateManager(stateFile, { log: this.log });
          await state.load();
          const rebased = await state.rebase(oldDir, newDir);
          this.log.info(`[Config] Moved "${label}" to ${newDir} (${rebased} tracked file(s) re-keyed)`);
        } catch (err) {
          // Files are already at the new location; a state file that could not
          // follow them just means this folder is reconciled from scratch.
          this.log.warn(`[Config] Moved "${label}" but could not update its sync state (${err.message}); it will be reconciled on the next mirror`);
        }
        moved.push(folder.id);
        await this._pruneEmptyParents(oldDir, from);
      } else {
        // No copy to carry (or the move failed): the state file describes a
        // mirror that is not at the new root, and leaving it would make every
        // document look already-synced against an empty directory — i.e. a
        // remote deletion.
        try {
          await fs.unlink(stateFile);
        } catch { /* never existed */ }
        remirrored.push(folder.id);
      }
    }

    this.opts.watchFolder = to;
    this.monitor.setConnection({ watchFolder: to });

    for (const folder of folders) {
      await this.addUnit(folder);
    }

    this.log.info(`[Config] Local folder changed: ${from} → ${to}`);
    return { changed: true, from, to, moved, remirrored };
  }

  async _exists(dir) {
    try {
      await fs.access(dir);
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Mirror every unit and begin tailing the change feed.
   *
   * The cursor is loaded from disk first. A surviving cursor is what closes the
   * daemon's oldest gap: a bulk sync only reconciles which files EXIST (browse
   * returns no size or timestamp to compare), so a document edited in the wiki
   * while the daemon was stopped was never pulled again — the old code then
   * anchored the cursor at "now", making the miss permanent. Resuming from the
   * saved cursor replays exactly that window; if the server has rolled past it,
   * `truncated` comes back and every unit is re-mirrored instead.
   */
  async startAll() {
    // Only from disk, and only once: on a later call (a folder was just added)
    // the in-memory cursor is ahead of the file, which is flushed at most every
    // 30s, and reloading would rewind the feed and replay events already applied.
    if (this.changeCursor === null) await this._loadCursor();
    const resumable = !!this.changeCursor;

    for (const unit of this.units.values()) {
      const alreadyMirrored = unit.stateManager.getAllTrackedDocuments().length > 0;
      await this.startUnit(unit, { bulkSync: !(resumable && alreadyMirrored) });
    }

    if (!this.changeCursor) {
      this.changeCursor = await this._fetchInitialCursor();
      this.log.info(`[Daemon] Initial change cursor: ${this.changeCursor}`);
    } else {
      this.log.info(`[Daemon] Resuming change feed from saved cursor: ${this.changeCursor}`);
    }

    this.startPolling();
  }

  startPolling() {
    if (this.pollTimer || this.stopped) return;
    this.log.info(`[Daemon] Starting change-feed polling (interval: ${this.opts.syncInterval}ms)`);
    this._scheduleTick();
  }

  /**
   * Self-rearming timer rather than setInterval.
   *
   * A tick can take far longer than the interval — the `truncated` branch
   * re-mirrors every folder, which is minutes — and setInterval would keep
   * firing throughout, stacking concurrent full re-syncs on top of the one
   * still running. Rearming only after a tick finishes makes overlap
   * structurally impossible instead of relying on a flag.
   */
  _scheduleTick() {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this._tick();
    }, this.opts.syncInterval);
    if (this.pollTimer.unref) this.pollTimer.unref();
  }

  async _tick() {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      await this._pollChanges();
      this.monitor.recordPoll(true, this.changeCursor);
    } catch (err) {
      this.log.error('[Daemon] poll error:', err.message);
      this.monitor.recordPoll(false, this.changeCursor);
    } finally {
      this.polling = false;
      this._scheduleTick();
    }
  }

  stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * One poll: fetch events after the cursor and offer each to every unit in the
   * owning space. A unit ignores anything outside the folder it mirrors
   * (FileSync.owns), which is what lets several selections share one space and
   * one poll without stepping on each other.
   */
  async _pollChanges() {
    if (!this.apiClient || this.units.size === 0) return;

    const result = await this.apiClient.getChanges({
      since: this.changeCursor,
      limit: 500,
    });

    if (result.truncated) {
      this.log.warn('[Daemon] change cursor too old (server ring rolled past it); re-mirroring every folder');
      for (const unit of this.units.values()) {
        await unit.fileSync.syncFromSpace();
      }
      this._setCursor(result.cursor || new Date().toISOString());
      return;
    }

    if (result.events.length === 0) {
      if (result.cursor) this._setCursor(result.cursor);
      return;
    }

    this.log.info(`[Daemon] applying ${result.events.length} change event(s) since ${this.changeCursor}`);
    for (const event of result.events) {
      const spaceId = event && event.space ? String(event.space.id) : null;
      if (!spaceId) continue;
      const remotePath = event.item && (event.item.newPath || event.item.path);
      const oldPath = event.item && event.item.oldPath;

      for (const unit of this.units.values()) {
        if (String(unit.folder.spaceId) !== spaceId) continue;
        // A move OUT of this folder has a destination the unit does not own but
        // an origin it does, and the local copy still has to go. Filtering on
        // the destination alone would strand it.
        if (remotePath
          && !unit.fileSync.owns(remotePath)
          && !(oldPath && unit.fileSync.owns(oldPath))) continue;
        await unit.fileSync.applyChange(event);
        this.monitor.count('changesApplied', unit.folder.id);
      }
    }

    if (result.cursor) this._setCursor(result.cursor);
  }

  async _fetchInitialCursor() {
    try {
      const result = await this.apiClient.getChanges({ limit: 1 });
      return result.cursor || result.serverTime || new Date().toISOString();
    } catch (err) {
      this.log.warn(`[Daemon] could not get initial cursor (${err.message}), using local time`);
      return new Date().toISOString();
    }
  }

  // ---- cursor persistence --------------------------------------------------

  async _loadCursor() {
    try {
      const raw = await fs.readFile(this.cursorFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.cursor === 'string') this.changeCursor = parsed.cursor;
    } catch { /* absent or unreadable — start without one */ }
  }

  /**
   * Record a new cursor, persisting at most every 30s rather than on every
   * poll: the cursor moves every few seconds and its value only matters across
   * a restart, so writing it 12 times a minute buys nothing. The remaining
   * window is covered by the flush in stop().
   */
  _setCursor(cursor) {
    if (cursor === this.changeCursor) return;
    this.changeCursor = cursor;
    this._cursorDirty = true;
    if (!this._cursorSaveTimer) {
      this._cursorSaveTimer = setTimeout(() => {
        this._cursorSaveTimer = null;
        this._saveCursor().catch(() => {});
      }, 30000);
      if (this._cursorSaveTimer.unref) this._cursorSaveTimer.unref();
    }
  }

  async _saveCursor() {
    if (!this._cursorDirty || !this.changeCursor) return;
    this._cursorDirty = false;
    try {
      await fs.writeFile(
        this.cursorFile,
        JSON.stringify({ cursor: this.changeCursor, savedAt: new Date().toISOString() }, null, 2),
        'utf8'
      );
    } catch (err) {
      this.log.warn(`[Daemon] could not persist change cursor: ${err.message}`);
    }
  }

  /** Forget the cursor — the selection changed shape enough to warrant a mirror. */
  async resetCursor() {
    this.changeCursor = null;
    this._cursorDirty = false;
    try {
      await fs.unlink(this.cursorFile);
    } catch { /* nothing to remove */ }
  }

  // ---- shutdown ------------------------------------------------------------

  /**
   * Stop polling and close every watcher.
   *
   * `permanent` distinguishes the two callers, and getting it wrong is a silent
   * failure either way. Process shutdown wants the `stopped` latch set so a
   * timer that fires during teardown can't restart the loop. A DISCONNECT does
   * not: the operator is expected to enter a new token and carry on, and a
   * latched engine would accept the token, register the folders, and then never
   * poll — running, by every indicator, and syncing nothing.
   */
  async stop({ permanent = true } = {}) {
    this.stopped = permanent;
    this.stopPolling();
    if (this._cursorSaveTimer) {
      clearTimeout(this._cursorSaveTimer);
      this._cursorSaveTimer = null;
    }
    await this._saveCursor();

    for (const unit of this.units.values()) {
      try {
        await unit.folderWatcher.stop();
      } catch (err) {
        this.log.error(`[Daemon] Error stopping watcher for ${unit.folder.id}:`, err.message);
      }
    }
  }

  /**
   * Drop every unit without touching the local files they mirror. Used when the
   * operator signs out: the folders stay on disk and stay selected, so entering
   * a token again resumes exactly where it left off.
   */
  async clearUnits() {
    for (const unit of this.units.values()) {
      unit.fileSync.suspend();
      try {
        await unit.folderWatcher.stop();
      } catch { /* already stopped */ }
    }
    this.units.clear();
  }

  /** One row per synced folder, for the dashboard. */
  describeFolders() {
    const out = [];
    for (const [id, unit] of this.units) {
      let trackedFiles = null;
      try {
        trackedFiles = unit.stateManager.getAllTrackedDocuments().length;
      } catch {
        trackedFiles = null;
      }
      out.push({
        id,
        spaceId: unit.folder.spaceId,
        spaceName: unit.folder.spaceName,
        remotePath: unit.folder.remotePath,
        watchFolder: unit.watchFolder,
        started: unit.started,
        trackedFiles,
      });
    }
    return out;
  }
}

module.exports = { SyncEngine, sanitizeFolderName, localPathForFolder };
