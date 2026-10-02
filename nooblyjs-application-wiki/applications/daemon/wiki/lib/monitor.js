const EventEmitter = require('node:events');

/**
 * Monitor — the daemon's live activity model.
 *
 * It is the single source of truth behind the status dashboard (port 11100):
 * the daemon and its sync components feed it counters and log lines, and the
 * web layer reads `snapshot()` / subscribes to its events to render a live view.
 *
 * It deliberately holds only in-memory state (a process view, not persistence):
 *   - `status`/`error`     lifecycle (needs-setup | starting | running | error)
 *   - `connection`         server URL, auth state, last poll, change cursor
 *   - `totals`             process-wide counters (uploads, downloads, …)
 *   - `folders`            per-selected-folder counters, merged with describe()
 *   - `events`            a bounded ring buffer of recent activity log lines
 *
 * A row is one SELECTED FOLDER, not one space: the operator picks folders, and
 * a single space commonly contributes several of them.
 *
 * Events emitted:
 *   'activity' (event)  — a new log line was recorded
 *   'stats'             — aggregate state changed (counters/connection/spaces)
 */
class Monitor extends EventEmitter {
  constructor({ maxEvents = 300 } = {}) {
    super();
    this.setMaxListeners(0); // one listener pair per connected SSE client
    this.maxEvents = maxEvents;

    this.startedAt = new Date().toISOString();
    this.status = 'starting';
    this.error = null;

    this.seq = 0;
    this.events = [];

    this.totals = {
      uploads: 0,
      downloads: 0,
      deletes: 0,
      changesApplied: 0,
      polls: 0,
      errors: 0,
      bytesUp: 0,
      bytesDown: 0,
    };

    // unitId(String) -> counters; merged with the live describe() in snapshot()
    this.folders = new Map();

    this.connection = {
      serverUrl: null,
      authenticated: false,
      authMethod: null,
      watchFolder: null,
      syncInterval: null,
      lastPollAt: null,
      lastPollOk: null,
      cursor: null,
    };

    this.config = {};
    this._describe = null;

    // Heartbeat so SSE clients get a periodic refresh even when idle, and so
    // proxies don't drop a quiet connection. unref() keeps it from holding the
    // process open on its own.
    this._heartbeat = setInterval(() => this.emit('stats'), 2000);
    if (this._heartbeat.unref) this._heartbeat.unref();
  }

  stop() {
    clearInterval(this._heartbeat);
    this.removeAllListeners();
  }

  setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.emit('stats');
  }

  setConfig(config) {
    this.config = config || {};
    this.emit('stats');
  }

  /** Inject a function returning live per-space info (name/folder/trackedFiles). */
  setDescribe(fn) {
    this._describe = typeof fn === 'function' ? fn : null;
  }

  setConnection(patch) {
    Object.assign(this.connection, patch);
    this.emit('stats');
  }

  /** Register (or update) a folder so it shows up before any sync happens. */
  registerFolder(unitId, info = {}) {
    const key = String(unitId);
    const current = this.folders.get(key) || {
      id: key, uploads: 0, downloads: 0, deletes: 0, lastActivity: null,
    };
    this.folders.set(key, { ...current, ...info, id: key });
    this.emit('stats');
  }

  /** Drop a folder's counters when the operator removes it from the config. */
  unregisterFolder(unitId) {
    this.folders.delete(String(unitId));
    this.emit('stats');
  }

  /** Forget every folder — used when the whole selection is being rebuilt. */
  resetFolders() {
    this.folders.clear();
    this.emit('stats');
  }

  /**
   * Bump a counter. `metric` is one of uploads | downloads | deletes |
   * changesApplied | polls. Errors are counted from error-level log lines in
   * push(), so they are not driven through here.
   */
  count(metric, unitId = null, bytes = 0) {
    if (Object.prototype.hasOwnProperty.call(this.totals, metric)) {
      this.totals[metric] += 1;
    }
    if (metric === 'uploads') this.totals.bytesUp += bytes || 0;
    if (metric === 'downloads') this.totals.bytesDown += bytes || 0;

    if (unitId != null) {
      const unit = this.folders.get(String(unitId));
      if (unit) {
        if (unit[metric] !== undefined) unit[metric] += 1;
        unit.lastActivity = new Date().toISOString();
      }
    }
    this.emit('stats');
  }

  recordPoll(ok, cursor) {
    this.connection.lastPollAt = new Date().toISOString();
    this.connection.lastPollOk = ok;
    if (cursor !== undefined) this.connection.cursor = cursor;
    this.totals.polls += 1;
    this.emit('stats');
  }

  /** Record one activity log line (also feeds the global error counter). */
  push(evt) {
    const entry = {
      id: ++this.seq,
      ts: new Date().toISOString(),
      level: evt.level || 'info',
      scope: evt.scope || 'Daemon',
      message: evt.message || '',
    };
    if (entry.level === 'error') this.totals.errors += 1;

    this.events.push(entry);
    if (this.events.length > this.maxEvents) this.events.shift();

    this.emit('activity', entry);
    return entry;
  }

  /** A point-in-time view for the dashboard. `events` caps the feed slice. */
  snapshot({ events = 120 } = {}) {
    const live = this._describe ? safeDescribe(this._describe) : [];
    const counters = new Map(this.folders);

    // Merge live structural info (folder, trackedFiles) with accumulated
    // counters, keyed by unit id. Live order wins.
    const seen = new Set();
    const folders = live.map((d) => {
      const key = String(d.id);
      seen.add(key);
      const c = counters.get(key) || {};
      return {
        uploads: 0, downloads: 0, deletes: 0, lastActivity: null,
        ...c,
        ...d,
        id: key,
      };
    });
    // Include any counter-only units the describe() didn't return (defensive).
    for (const [key, c] of counters) {
      if (!seen.has(key)) folders.push({ ...c });
    }

    return {
      startedAt: this.startedAt,
      now: new Date().toISOString(),
      uptimeSec: Math.max(0, Math.floor((Date.now() - Date.parse(this.startedAt)) / 1000)),
      status: this.status,
      error: this.error,
      totals: this.totals,
      connection: this.connection,
      config: this.config,
      folders,
      events: events > 0 ? this.events.slice(-events) : [],
    };
  }
}

function safeDescribe(fn) {
  try {
    const out = fn();
    return Array.isArray(out) ? out : [];
  } catch {
    return [];
  }
}

/** No-op monitor so components run standalone without a real one. */
const nullMonitor = {
  setStatus() {}, setConfig() {}, setDescribe() {}, setConnection() {},
  registerFolder() {}, unregisterFolder() {}, resetFolders() {},
  count() {}, recordPoll() {}, push() {}, stop() {},
  snapshot() { return {}; }, on() {}, off() {}, emit() {},
};

module.exports = { Monitor, nullMonitor };
