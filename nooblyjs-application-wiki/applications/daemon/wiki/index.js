#!/usr/bin/env node

require('dotenv').config();
const fs = require('node:fs').promises;
const path = require('node:path');
const express = require('express');
const EventEmitter = require('node:events');

const { Monitor } = require('./lib/monitor');
const DaemonLog = require('./lib/daemon-log');
const { mountDashboard } = require('./lib/dashboard');
const {
  ConfigStore,
  DEFAULT_SERVER_URL,
  normaliseServerUrl,
  normaliseBaseFolder,
  isPathInside,
  isFilesystemRoot,
} = require('./lib/config-store');
const { SyncEngine } = require('./lib/sync-engine');
const appPaths = require('./lib/app-paths');
const { isUntrustedIssuerError, fetchPeerCertificate } = require('./lib/tls-trust');

// ============================================================================
// NooblyJS Wiki Sync Daemon
//
// Mirrors a set of wiki FOLDERS the operator chose into local directories, both
// ways. There are two distinct sources of configuration, and the split is
// deliberate:
//
//   * WHAT to sync, WHERE from and WHERE TO — the server URL, the API token,
//     the local folder to mirror into and the folder selection — lives in
//     `.daemon-config.json` and is edited entirely from the dashboard. A fresh
//     install has none of it, so the daemon starts, serves a SETUP SCREEN, and
//     does not sync until it has been filled in. There is nothing to sync
//     without a server to sync with, and guessing would mean writing files
//     against the wrong repository.
//
//   * HOW to run — poll interval, ignore patterns, dashboard port and binding —
//     stays in .env. Those are deployment settings, not choices a user makes in
//     a UI. (`WATCH_FOLDER` still seeds the local folder's default, but the
//     stored value wins once one has been saved.)
//
// The dashboard server is started FIRST and stays up through every failure, so
// the setup screen is reachable before any credential exists and an error is
// something you can read rather than something that killed the process.
// ============================================================================

const app = express();
app.use(express.json());

// Everything below is written at runtime, so it hangs off the WRITABLE data
// root, never off __dirname — which inside a packaged executable is a
// read-only snapshot. See lib/app-paths.js.
const DATA_ROOT = appPaths.dataRoot();
const bootstrap = appPaths.ensureDataRoot();
const APP_DIR = path.join(DATA_ROOT, '.application');
const options = {
  logDir: path.join(APP_DIR, 'logs'),
  dataDir: path.join(APP_DIR, 'data'),
  cacheDir: path.join(APP_DIR, 'caching'),
  'express-app': app,
  security: {
    apiKeyAuth: { requireApiKey: false, apiKeys: [] },
    servicesAuth: { requireLogin: false },
  },
};
const eventEmitter = new EventEmitter();
const serviceRegistry = require('digital-technologies-core');

serviceRegistry.initialize(app, eventEmitter, options);

// Auth service — acquired with options on first use so its routes mount onto
// `app` and its user store lives under .application/data/auth.
const authservice = serviceRegistry.authservice('file', {
  'express-app': app,
  dataDir: path.join(APP_DIR, 'data', 'auth'),
});

// Core file logger — structured logs under .application/logs. Guarded so the
// daemon still runs (console + dashboard only) if the provider is unavailable.
let coreLogger = null;
try {
  coreLogger = serviceRegistry.logger('file');
} catch (err) {
  console.warn(`[Init] Core file logger unavailable (${err.message}); using console only`);
}

// ----------------------------------------------------------------------------
// Operational configuration (.env only — see the header note).
// ----------------------------------------------------------------------------
const defaultIgnorePatterns = '.git,node_modules,.DS_Store,Thumbs.db,.idea,.vscode';
const ignorePatterns = (process.env.IGNORE_PATTERNS || defaultIgnorePatterns)
  .split(',')
  .map(p => p.trim())
  .filter(p => p);

const runtime = {
  watchFolder: appPaths.defaultWatchFolder(),
  stateDir: DATA_ROOT,
  syncInterval: parseInt(process.env.SYNC_INTERVAL || '5000', 10),
  ignorePatterns,
  tlsInsecure: process.env.WIKI_TLS_INSECURE === 'true',
  dashboardPort: parseInt(process.env.DASHBOARD_PORT || '11100', 10),
  // Localhost by default. The dashboard now carries the API token form and can
  // delete local folders, so exposing it on every interface is a decision that
  // has to be made explicitly rather than inherited from a default.
  dashboardHost: process.env.DASHBOARD_HOST || '127.0.0.1',
  dashboardRequireAuth: process.env.DASHBOARD_REQUIRE_AUTH === 'true',
  dashboardUser: process.env.DASHBOARD_USER || null,
  dashboardPassword: process.env.DASHBOARD_PASSWORD || null,
};

const monitor = new Monitor();
const log = new DaemonLog(coreLogger, monitor);

const configStore = new ConfigStore(path.join(DATA_ROOT, '.daemon-config.json'), {
  log,
  defaultBaseFolder: appPaths.defaultWatchFolder(),
  legacyBaseFolder: appPaths.legacyWatchFolder(),
});
const engine = new SyncEngine(runtime, { log, monitor });

/**
 * Publish the operational settings to the dashboard. Called again whenever one
 * of them changes at runtime — the local folder does — because setConfig
 * replaces the block wholesale rather than patching it.
 */
function publishConfig() {
  monitor.setConfig({
    watchFolder: path.resolve(runtime.watchFolder),
    syncInterval: runtime.syncInterval,
    ignorePatterns: runtime.ignorePatterns,
    tlsInsecure: runtime.tlsInsecure,
    dashboardPort: runtime.dashboardPort,
    dashboardHost: runtime.dashboardHost,
    dashboardRequireAuth: runtime.dashboardRequireAuth,
    defaultServerUrl: DEFAULT_SERVER_URL,
  });
  monitor.setConnection({
    watchFolder: path.resolve(runtime.watchFolder),
    syncInterval: runtime.syncInterval,
  });
}
publishConfig();
monitor.setDescribe(() => engine.describeFolders());

// ============================================================================
// Controller — everything the dashboard can ask the daemon to do.
//
// It is the ONE place that keeps the persisted config and the live engine in
// step. Every mutation follows the same order: validate against the server,
// then persist, then reshape the running engine — so a rejected change never
// reaches disk, and a change on disk is always one the engine has acted on.
// ============================================================================

/** Attach an HTTP status to an error so the route layer reports it faithfully. */
function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Check a proposed local root and make sure it can actually be written to.
 *
 * Every rejection here describes a way the mirror would go wrong LATER and
 * quietly: a drive root turns "stop syncing this folder" into a walk up the
 * whole disk (see `_pruneEmptyParents`); a path containing the daemon's own
 * data directory means the config file, the API token and the sync state get
 * uploaded to the wiki as documents; a path inside it means the next tidy-up
 * deletes them. Permission is proved by writing rather than by `fs.access`,
 * because on Windows the access bits routinely say yes where a write says no.
 *
 * @returns {string} the resolved, existing, writable directory
 */
async function ensureUsableBaseFolder(raw) {
  const target = normaliseBaseFolder(raw);
  if (!target) throw fail('A local folder is required');

  if (isFilesystemRoot(target)) {
    throw fail(`${target} is a drive root. Choose a folder inside it, for example ${path.join(target, 'NooblyJS Wiki')}.`);
  }
  if (isPathInside(DATA_ROOT, target) || isPathInside(target, DATA_ROOT)) {
    throw fail(`${target} overlaps the daemon's own data folder (${DATA_ROOT}). Choose a folder outside it.`);
  }

  try {
    await fs.mkdir(target, { recursive: true });
  } catch (err) {
    throw fail(`Cannot create ${target}: ${err.message}`);
  }

  const probe = path.join(target, `.daemon-write-test-${process.pid}`);
  try {
    await fs.writeFile(probe, 'ok');
  } catch (err) {
    throw fail(`${target} is not writable: ${err.message}`);
  } finally {
    try { await fs.unlink(probe); } catch { /* never created */ }
  }

  // Store the path as the filesystem itself spells it. This is not tidiness:
  // libuv's watcher CRASHES on a path containing an MS-DOS 8.3 short name
  // (`C:\Users\SRBOOY~1\…`), and a short name is exactly what arrives when
  // somebody pastes `%TEMP%` or a path out of an old dialog. Resolving it here
  // means the operator never has to know that, and the same folder typed two
  // ways is stored once. Best-effort — an unresolvable path keeps what was
  // validated above rather than failing over a cosmetic step.
  try {
    return await fs.realpath(target);
  } catch {
    return target;
  }
}

const controller = {
  getConfig() {
    return configStore.redacted();
  },

  getState() {
    const snap = monitor.snapshot({ events: 0 });
    return {
      status: snap.status,
      error: snap.error,
      connected: engine.connected,
      needsSetup: !configStore.isComplete(),
      syncedFolders: engine.units.size,
    };
  },

  /**
   * Set the local root every mirror is written beneath, and carry what is
   * already on disk over to it.
   *
   * Validating BEFORE persisting matters: a stored folder that turns out to be
   * unwritable is a daemon that reports itself configured and fails on every
   * file, which is exactly the state the setup screen exists to prevent.
   */
  async setBaseFolder(folder) {
    const target = await ensureUsableBaseFolder(folder);
    const current = path.resolve(runtime.watchFolder);

    if (target === current) {
      // Same folder, but possibly not yet PINNED — a config still riding the
      // derived default. Storing it is the point of pressing Save.
      await configStore.setBaseFolder(target);
      return { config: configStore.redacted(), state: controller.getState(), changed: false };
    }

    await configStore.setBaseFolder(target);
    // relocate() reassigns opts.watchFolder, which IS `runtime` — one object,
    // so the engine and this module never disagree about where the mirror is.
    const result = await engine.relocate(target);
    publishConfig();

    if (result.remirrored.length) {
      log.warn(`[Config] ${result.remirrored.length} folder(s) could not be moved and will be downloaded again at ${target}`);
    }
    if (engine.units.size) {
      monitor.setStatus('starting');
      startInBackground();
    }

    return {
      config: configStore.redacted(),
      state: controller.getState(),
      changed: true,
      moved: result.moved.length,
      remirrored: result.remirrored.length,
    };
  },

  /**
   * Verify a server URL + token pair, and only then save it.
   *
   * Verification is not a nicety: without it the first sign that a token was
   * mistyped is a 401 buried in the activity feed several seconds after the
   * form said "saved". `engine.connect` performs a real authenticated call, so
   * a bad URL, an untrusted certificate, an expired token and an account with
   * no space access each produce their own message at the form.
   */
  async setConnection(serverUrl, token, baseFolder) {
    if (!serverUrl) throw fail('A server URL is required');
    if (!token) throw fail('An API token is required');

    // The setup screen collects the local folder alongside the credentials, so
    // apply it FIRST — before anything can be mirrored — rather than letting a
    // first sync start against the old default and then move it.
    if (baseFolder !== undefined && baseFolder !== null && String(baseFolder).trim() !== '') {
      await controller.setBaseFolder(baseFolder);
    }

    const target = normaliseServerUrl(serverUrl);
    if (!target) throw fail('Server URL must be a valid http(s) URL');
    const previous = configStore.serverUrl;

    let spaces;
    try {
      spaces = await engine.connect(target, String(token).trim(), {
        trustedCerts: configStore.trustedPems(),
      });
    } catch (err) {
      monitor.setStatus('error', err.message);

      // A certificate the system does not trust is a decision to offer, not
      // just a failure to report. Node's own advice ("try --use-system-ca")
      // is wrong for a self-signed certificate, and the two real workarounds
      // live in an environment variable and a dotfile — neither reachable
      // from the screen showing the error. So describe what was actually
      // presented and let the operator pin it.
      if (isUntrustedIssuerError(err.cause || err)) {
        try {
          const certificate = await fetchPeerCertificate(target);
          const problem = fail(err.message, 502);
          problem.certificate = { ...certificate, serverUrl: target };
          throw problem;
        } catch (probeErr) {
          // Could not read it back — fall through to the plain error rather
          // than replacing a real diagnosis with a secondary failure.
          if (probeErr.certificate) throw probeErr;
          log.warn(`[Config] Could not read the server certificate: ${probeErr.message}`);
        }
      }
      throw fail(err.message, 502);
    }

    await configStore.setConnection(target, token);
    log.info(`[Config] Connection saved — ${spaces.length} space(s) available`);

    // Pointing at a DIFFERENT server invalidates the selection rather than
    // moving it: the saved entries name space ids from the old server, which
    // mean something else (or nothing) on this one, and silently re-mirroring
    // against them would either 404 on every call or, worse, push one server's
    // content into another. Local files are left alone — they are the
    // operator's, and they are the only remaining copy of anything not yet
    // uploaded.
    if (previous && previous !== target) {
      await engine.stop({ permanent: false });
      await engine.clearUnits();
      await engine.resetCursor();
      await configStore.setFolders([]);
      monitor.resetFolders();
      monitor.setStatus('idle');
      log.warn(`[Config] Server changed (${previous} → ${target}) — folder selection cleared; choose folders again. Existing local files were left in place.`);
      return { spaces, config: configStore.redacted(), state: controller.getState(), serverChanged: true };
    }

    // A saved selection from a previous run can start immediately.
    await controller._syncSelection(configStore.folders, { deleteLocal: false });

    return { spaces, config: configStore.redacted(), state: controller.getState() };
  },

  /**
   * Forget the token and stop syncing, WITHOUT touching local files or the
   * folder selection — this is "sign out", not "reset". Re-entering a token
   * picks the same folders back up.
   */
  async disconnect() {
    await engine.stop({ permanent: false });
    await engine.clearUnits();
    engine.disconnect();
    await configStore.clearToken();
    monitor.resetFolders();
    monitor.setStatus('needs-setup');
    log.info('[Config] Disconnected — token cleared, local files left in place');
  },

  /**
   * Pin a certificate the operator accepted, then retry the connection.
   *
   * The fingerprint is required and must match what the server is presenting
   * RIGHT NOW: the browser is echoing back a certificate the daemon described
   * moments ago, and re-reading it here means a server that changed in between
   * cannot be trusted on the strength of the old description.
   */
  async trustCertificate(serverUrl, token, fingerprint, baseFolder) {
    if (!fingerprint) throw fail('A certificate fingerprint is required');
    const target = normaliseServerUrl(serverUrl);
    if (!target) throw fail('Server URL must be a valid http(s) URL');

    let live;
    try {
      live = await fetchPeerCertificate(target);
    } catch (err) {
      throw fail(`Could not read the certificate from ${target}: ${err.message}`, 502);
    }
    if (live.fingerprint !== fingerprint) {
      throw fail(
        'The server is now presenting a different certificate than the one you were shown. '
        + 'Nothing has been trusted. Try connecting again to see the current certificate.', 409);
    }

    await configStore.trustCertificate({ ...live, serverUrl: target });
    log.warn(`[Config] Pinned certificate ${live.fingerprint} for ${target} (${live.subject})`);

    // Now retry the connection with the pin in place. The local folder rides
    // along because the setup form that offered the certificate is still on
    // screen, unsaved.
    return controller.setConnection(target, token, baseFolder);
  },

  /** Remove a pinned certificate. */
  async untrustCertificate(fingerprint) {
    const removed = await configStore.untrustCertificate(fingerprint);
    if (!removed) throw fail('No pinned certificate with that fingerprint', 404);
    log.info(`[Config] Removed pinned certificate ${fingerprint}`);
    return { config: configStore.redacted(), state: controller.getState() };
  },

  async listSpaces(opts) {
    if (!engine.connected) throw fail('Not connected', 409);
    return engine.listSpaces(opts);
  },

  async listFolders(spaceId, folderPath, depth) {
    if (!engine.connected) throw fail('Not connected', 409);
    return engine.listFolders(spaceId, folderPath, depth);
  },

  async searchFolders(query, opts) {
    if (!engine.connected) throw fail('Not connected', 409);
    return engine.searchFolders(query, opts);
  },

  /**
   * Replace the folder selection.
   *
   * The client sends the complete desired list, not a delta — a delta from a
   * stale page would silently resurrect a folder somebody else removed. The
   * store computes what actually changed, and only that is acted on: added
   * folders are mirrored, removed folders are torn down and their local
   * directories deleted (which is what removal MEANS here, and what the UI
   * confirms before calling).
   */
  async setFolders(folders) {
    if (!engine.connected) throw fail('Not connected — set the server URL and token first', 409);

    const spaces = await engine.listSpaces();
    const byId = new Map(spaces.map(s => [String(s.id), s]));

    const resolved = [];
    for (const entry of folders) {
      const spaceId = String(entry && entry.spaceId);
      const space = byId.get(spaceId);
      // Refuse a space the token cannot see rather than creating a unit that
      // will 404 on every call and look like a server fault.
      if (!space) throw fail(`Space ${spaceId} is not available to this account`);
      resolved.push({
        spaceId,
        spaceName: space.name,
        remotePath: entry.remotePath || '',
      });
    }

    const { folders: saved, added, removed } = await configStore.setFolders(resolved);
    log.info(`[Config] Selection saved: ${saved.length} folder(s) — ${added.length} added, ${removed.length} removed`);

    const result = await controller._syncSelection(saved, { deleteLocal: true });

    return {
      config: configStore.redacted(),
      state: controller.getState(),
      added: added.length,
      removed: removed.length,
      ...result,
    };
  },

  /**
   * Bring the engine in line with a saved selection.
   *
   * The initial mirror of a newly added folder can take minutes, so it is
   * started but NOT awaited — the HTTP response returns at once and progress
   * shows up in the live activity feed, which is exactly what that feed is for.
   * Awaiting it would leave the operator watching a spinner with no detail
   * while the information they want scrolls past behind the dialog.
   */
  async _syncSelection(folders, { deleteLocal }) {
    const { added, removed } = await engine.applySelection(folders, { deleteLocal });

    if (folders.length === 0) {
      monitor.setStatus('idle');
      engine.stopPolling();
      return { added: added.length, removed: removed.length };
    }

    monitor.setStatus('starting');
    startInBackground();
    return { added: added.length, removed: removed.length };
  },
};

/**
 * Mirror every not-yet-started unit and (re)start polling, in the background.
 * Serialised through a single promise so two rapid config saves can't run two
 * initial mirrors of the same folder at once.
 */
let startChain = Promise.resolve();
function startInBackground() {
  startChain = startChain
    .then(async () => {
      // startAll() skips units that are already running, so this is safe to
      // call again every time the selection grows.
      await engine.startAll();
      monitor.setStatus('running');
    })
    .catch((err) => {
      log.error('[Daemon] Failed to start syncing:', err.message);
      monitor.setStatus('error', err.message);
    });
  return startChain;
}

// ============================================================================
// Dashboard + boot
// ============================================================================

mountDashboard(app, { monitor, authservice, config: runtime, controller, log });

/**
 * Open the dashboard in the default browser.
 *
 * Set by the installed launcher, because clicking a Start Menu entry called
 * "NooblyJS Wiki Sync" should show you the thing, not leave you looking
 * at a console window wondering which port to type. Off by default so a
 * developer's `npm start` and any service-style run stay silent.
 *
 * Deliberately fired from the listen callback rather than the launcher script:
 * only here is the port known to be accepting connections, so the browser
 * cannot win the race and land on a connection-refused page.
 */
function openDashboard(url) {
  if (process.env.DAEMON_OPEN_DASHBOARD !== '1') return;
  try {
    const { spawn } = require('node:child_process');
    const child = process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (err) {
    // Never fatal — the URL is printed a few lines below either way.
    log.warn(`[Dashboard] Could not open a browser (${err.message})`);
  }
}

let server = null;
function startDashboardServer() {
  server = app.listen(runtime.dashboardPort, runtime.dashboardHost, () => {
    log.info(`[Dashboard] Live view on http://${runtime.dashboardHost}:${runtime.dashboardPort}`);
    openDashboard(`http://${runtime.dashboardHost}:${runtime.dashboardPort}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`[Dashboard] Port ${runtime.dashboardPort} is already in use — dashboard not started (set DASHBOARD_PORT to change). Sync continues.`);
    } else {
      log.error(`[Dashboard] HTTP server error: ${err.message}`);
    }
  });
}

/**
 * Ensure a dashboard admin account exists when DASHBOARD_REQUIRE_AUTH is on and
 * credentials were supplied. Best-effort: a failure (e.g. user already exists)
 * is logged and ignored.
 */
async function ensureDashboardUser() {
  if (!runtime.dashboardRequireAuth || !runtime.dashboardUser || !runtime.dashboardPassword) return;
  try {
    const existing = authservice.getUser && authservice.getUser(runtime.dashboardUser);
    if (existing) return;
    await authservice.createUser({
      email: runtime.dashboardUser,
      fullName: 'Daemon Dashboard',
      password: runtime.dashboardPassword,
      role: 'admin',
    });
    log.info(`[Dashboard] Created dashboard user ${runtime.dashboardUser}`);
  } catch (err) {
    log.warn(`[Dashboard] Could not ensure dashboard user (${err.message})`);
  }
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('[Daemon] Shutting down...');
  try {
    if (server) server.close();
  } catch { /* ignore */ }
  try {
    await engine.stop();
  } catch (err) {
    log.error('[Daemon] Error during shutdown:', err.message);
  }
  try {
    monitor.stop();
  } catch { /* ignore */ }
  log.info('[Daemon] Daemon stopped');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  console.log('='.repeat(60));
  console.log('NooblyJS Wiki Daemon - Starting...');
  console.log('='.repeat(60));

  // A packaged build writes to a per-user directory the operator has never
  // seen, so say where it is — otherwise "where is my config" and "where are
  // the logs" have no discoverable answer.
  if (appPaths.PACKAGED) {
    console.log(`  Data folder:   ${DATA_ROOT}`);
  }
  if (bootstrap.error) {
    log.error(`[Init] Cannot create the data folder ${DATA_ROOT}: ${bootstrap.error.message}`);
    log.error('[Init] Configuration and sync state cannot be saved until this is fixed.');
  }

  startDashboardServer();
  await ensureDashboardUser();
  await configStore.load();

  // The local root is a stored choice, so it has to be in place before a single
  // unit is built — `addUnit` derives each mirror's directory from it. Assigned
  // onto `runtime`, which is the same object the engine holds as `opts`.
  runtime.watchFolder = configStore.baseFolder;
  publishConfig();

  const dashboardUrl = `http://${runtime.dashboardHost}:${runtime.dashboardPort}`;

  // ---- No usable configuration: serve setup, sync nothing. ----
  if (!configStore.isComplete()) {
    monitor.setStatus('needs-setup');
    log.warn('[Init] Not configured yet — no sync will run until a server URL and API token are supplied');
    console.log('');
    console.log('  SETUP REQUIRED');
    console.log(`  Open ${dashboardUrl} to enter the server URL and your API token.`);
    console.log(`  Default server: ${DEFAULT_SERVER_URL}`);
    console.log(`  Local folder:   ${path.resolve(runtime.watchFolder)} (change it on the setup screen)`);
    console.log('');
    return;
  }

  // ---- Configured: connect and start. ----
  try {
    await engine.connect(configStore.serverUrl, configStore.token, {
      trustedCerts: configStore.trustedPems(),
    });
  } catch (err) {
    // A saved credential that no longer works (expired token, server moved) is
    // a setup problem, not a crash: say so and leave the dashboard up so it can
    // be corrected in place.
    monitor.setStatus('error', `Could not connect: ${err.message}`);
    log.error(`[Init] Could not connect to ${configStore.serverUrl}: ${err.message}`);
    log.warn(`[Init] Correct the server URL or token at ${dashboardUrl}`);
    return;
  }

  if (configStore.folders.length === 0) {
    monitor.setStatus('idle');
    log.warn('[Init] Connected, but no folders are selected yet — choose folders to sync at the dashboard');
    console.log('');
    console.log(`  Connected. Choose folders to sync at ${dashboardUrl}`);
    console.log('');
    return;
  }

  monitor.setStatus('starting');
  for (const folder of configStore.folders) {
    await engine.addUnit(folder);
  }
  await startInBackground();

  console.log('='.repeat(60));
  console.log('Daemon is running!');
  console.log('');
  console.log(`  Local folder:  ${path.resolve(runtime.watchFolder)}`);
  console.log(`  Server:        ${configStore.serverUrl}`);
  console.log(`  Dashboard:     ${dashboardUrl}`);
  console.log(`  Poll interval: ${runtime.syncInterval}ms`);
  console.log(`  Folders (${engine.units.size}):`);
  for (const unit of engine.units.values()) {
    console.log(`    - ${unit.folder.spaceName}/${unit.folder.remotePath || '(space root)'}`);
  }
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('='.repeat(60));
})().catch((err) => {
  log.error('[Daemon] Startup failed:', err.message);
  monitor.setStatus('error', err.message);
  log.warn('[Daemon] Dashboard remains available for diagnostics.');
});
