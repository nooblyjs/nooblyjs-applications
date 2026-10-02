const path = require('node:path');

const { assetRoot } = require('./app-paths');
const { loadAssets, serveAsset } = require('./assets');

const PUBLIC_DIR = path.join(assetRoot(), 'public');

/**
 * Mount the status dashboard onto an Express app.
 *
 * Routes:
 *   GET  /                        the dashboard page (and the setup screen)
 *   GET  /assets/*                static dashboard CSS/JS (always public, so the
 *                                 browser's Basic-auth prompt can style itself)
 *   GET  /api/status              a Monitor snapshot as JSON (polling fallback)
 *   GET  /api/stream              Server-Sent Events: snapshot | stats | activity
 *   GET  /healthz                 liveness probe
 *   GET  /api/config              current configuration (token MASKED)
 *   POST /api/config/connection   set + verify server URL and token
 *   POST /api/config/base-folder  set the local root, moving existing mirrors
 *   POST /api/config/disconnect   forget the token
 *   POST /api/config/trust-certificate    pin a server certificate
 *   POST /api/config/untrust-certificate  remove a pinned certificate
 *   GET  /api/browse/spaces       spaces the token can see
 *   GET  /api/browse/tree         one level of a space's folder tree
 *   GET  /api/browse/search       folders found by searching document content
 *   POST /api/config/folders      replace the synced-folder selection
 *
 * Auth is optional and off by default (this is a local operator tool, and it
 * binds to 127.0.0.1 unless DASHBOARD_HOST says otherwise). When
 * `config.dashboardRequireAuth` is true, requests must present either a
 * Bearer dtk_ token or HTTP Basic credentials that the core authservice
 * accepts.
 *
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {object} deps.monitor       the activity Monitor
 * @param {object} [deps.authservice] core authservice (for optional auth)
 * @param {object} deps.config        daemon config (dashboardRequireAuth, …)
 * @param {object} deps.controller    setup/config operations (see index.js)
 * @param {object} [deps.log]         logger (console-compatible)
 */
function mountDashboard(app, { monitor, authservice, config, controller, log = console }) {
  const requireAuth = !!(config && config.dashboardRequireAuth);
  const guard = makeGuard(requireAuth, authservice);

  if (requireAuth) {
    log.info('[Dashboard] Authentication required (Basic or Bearer dtk_ token)');
  }

  // Assets are read into memory once, rather than served with express.static.
  // A packaged build keeps them in a read-only virtual snapshot where static
  // serving is unreliable; see lib/assets.js for the full reasoning.
  const assets = loadAssets(PUBLIC_DIR, { log });
  log.info(`[Dashboard] Loaded ${assets.size} static asset(s)`);

  // Intentionally unguarded so a 401 challenge page can still style itself.
  app.get('/assets/*', (req, res) => {
    // req.params[0] is already URL-decoded and is matched against a fixed Map,
    // so there is no path to traverse out of.
    if (!serveAsset(assets, String(req.params[0] || ''), res)) res.status(404).end();
  });

  app.get('/healthz', (req, res) => {
    const snap = monitor.snapshot({ events: 0 });
    res.json({ ok: snap.status !== 'error', status: snap.status, uptimeSec: snap.uptimeSec });
  });

  app.get('/', guard, (req, res) => {
    if (!serveAsset(assets, 'index.html', res)) {
      res.status(500).send('Dashboard assets are missing from this build.');
    }
  });

  app.get('/api/status', guard, (req, res) => {
    res.json(monitor.snapshot({ events: 150 }));
  });

  app.get('/api/stream', guard, (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Initial full state (includes the recent feed to backfill).
    send('snapshot', monitor.snapshot({ events: 150 }));

    const onActivity = (e) => send('activity', e);
    const onStats = () => send('stats', monitor.snapshot({ events: 0 }));
    monitor.on('activity', onActivity);
    monitor.on('stats', onStats);

    // SSE comment heartbeat keeps intermediaries from closing an idle stream.
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
    if (keepAlive.unref) keepAlive.unref();

    req.on('close', () => {
      clearInterval(keepAlive);
      monitor.off('activity', onActivity);
      monitor.off('stats', onStats);
    });
  });

  mountConfigRoutes(app, { guard, controller, log });
}

/**
 * Setup + configuration API.
 *
 * Everything here is a thin, uniformly-wrapped shell over `controller`, which
 * owns the actual behaviour. Failures come back as
 * `{ success: false, error: <message the operator can act on> }` and a real
 * status code, because this API's only consumer is a form: an unexplained 500
 * shows up as a spinner that never stops.
 */
function mountConfigRoutes(app, { guard, controller, log }) {
  if (!controller) return;

  /** Wrap a handler so every rejection becomes a readable JSON error. */
  const route = (handler, { failStatus = 400 } = {}) => async (req, res) => {
    try {
      const body = await handler(req);
      res.json({ success: true, ...body });
    } catch (err) {
      log.warn(`[Config] ${req.method} ${req.path} failed: ${err.message}`);
      const body = { success: false, error: err.message };
      // A TLS failure carries the certificate that was presented, so the
      // setup screen can show it and offer to pin it.
      if (err.certificate) body.certificate = err.certificate;
      res.status(err.status || failStatus).json(body);
    }
  };

  // ---- configuration -------------------------------------------------------

  app.get('/api/config', guard, route(async () => ({
    config: controller.getConfig(),
    state: controller.getState(),
  })));

  app.post('/api/config/connection', guard, route(async (req) => {
    const { serverUrl, token, baseFolder } = req.body || {};
    return controller.setConnection(serverUrl, token, baseFolder);
  }));

  // Moving an existing mirror can take a while (it is a rename per selected
  // folder, and a re-download for any that could not be renamed), so this one
  // is deliberately awaited: the answer says what actually happened to the
  // files, which is the only reason the operator pressed the button.
  app.post('/api/config/base-folder', guard, route(async (req) => {
    const { baseFolder } = req.body || {};
    return controller.setBaseFolder(baseFolder);
  }));

  app.post('/api/config/disconnect', guard, route(async () => {
    await controller.disconnect();
    return { config: controller.getConfig(), state: controller.getState() };
  }));

  app.post('/api/config/trust-certificate', guard, route(async (req) => {
    const { serverUrl, token, fingerprint, baseFolder } = req.body || {};
    return controller.trustCertificate(serverUrl, token, fingerprint, baseFolder);
  }));

  app.post('/api/config/untrust-certificate', guard, route(async (req) => {
    const { fingerprint } = req.body || {};
    return controller.untrustCertificate(fingerprint);
  }));

  // ---- browsing, for the folder picker -------------------------------------

  app.get('/api/browse/spaces', guard, route(async (req) => ({
    spaces: await controller.listSpaces({ refresh: req.query.refresh === 'true' }),
  })));

  app.get('/api/browse/tree', guard, route(async (req) => {
    const { spaceId, path: folderPath, depth } = req.query || {};
    if (!spaceId) throw new Error('spaceId is required');
    return controller.listFolders(spaceId, folderPath || '', depth ? parseInt(depth, 10) : null);
  }));

  app.get('/api/browse/search', guard, route(async (req) => {
    const query = String((req.query || {}).q || '').trim();
    if (!query) return { folders: [] };
    return {
      folders: await controller.searchFolders(query, {
        spaceId: (req.query.spaceId || '').trim() || null,
      }),
    };
  }));

  // ---- the selection -------------------------------------------------------

  app.post('/api/config/folders', guard, route(async (req) => {
    const { folders } = req.body || {};
    if (!Array.isArray(folders)) throw new Error('folders must be an array');
    return controller.setFolders(folders);
  }));
}

/**
 * Build the auth guard. When auth is disabled this is a pass-through. When
 * enabled it accepts a Bearer dtk_ token (validated by the authservice) or
 * HTTP Basic credentials, and otherwise issues a Basic challenge.
 */
function makeGuard(requireAuth, authservice) {
  if (!requireAuth) return (req, res, next) => next();

  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    try {
      if (header.startsWith('Bearer ') && authservice && authservice.validateApiToken) {
        const result = await authservice.validateApiToken(header.slice(7).trim());
        if (result && result.email) return next();
      } else if (header.startsWith('Basic ') && authservice && authservice.authenticateUser) {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        const email = idx >= 0 ? decoded.slice(0, idx) : decoded;
        const password = idx >= 0 ? decoded.slice(idx + 1) : '';
        const result = await authservice.authenticateUser(email, password);
        if (result && (result.user || result.email || result.success)) return next();
      }
    } catch {
      // fall through to challenge
    }
    res.set('WWW-Authenticate', 'Basic realm="Wiki Sync Daemon"');
    res.status(401).send('Authentication required');
  };
}

module.exports = { mountDashboard };
