const fs = require('node:fs');
const path = require('node:path');

/**
 * The dashboard's static files, loaded into memory once at startup.
 *
 * WHY NOT `express.static`: a packaged build (pkg / Node SEA) mounts these
 * files inside a virtual read-only snapshot. pkg patches `fs.readFile` and
 * friends so a direct read works, but `express.static` and `res.sendFile` go
 * well beyond that — `fs.stat` for size and mtime, ETag generation, byte-range
 * handling and a `createReadStream` — and those are exactly the corners where
 * the snapshot layer is incomplete. The failure mode is a dashboard that serves
 * a blank page or a truncated stylesheet from the packaged build while working
 * perfectly from source, which is a miserable thing to debug.
 *
 * Reading them up front sidesteps the whole class of problem: after startup
 * these are plain Buffers in memory and the snapshot is never touched again.
 * The cost is bounded and known — about 2 MB, most of it the shared
 * `kr-base.css` and the PNG favicons — which is nothing against a process that
 * already holds a change-event ring and a file-watcher tree.
 *
 * It also gets the caching right for free, which the previous `maxAge: 0`
 * static mount did not: the payload is fixed at startup, so a strong ETag is
 * simply the content hash, and a conditional request costs one comparison.
 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Recursively read a directory into a Map of url-path -> { body, type, etag }.
 * Paths are keyed with forward slashes and no leading slash, so a lookup is a
 * direct Map hit rather than any kind of path arithmetic — which also means a
 * request can never traverse out of the asset set.
 */
function loadAssets(rootDir, { log = console } = {}) {
  const files = new Map();
  const crypto = require('node:crypto');

  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      log.warn(`[Assets] Cannot read ${dir}: ${err.message}`);
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, key);
        continue;
      }
      try {
        const body = fs.readFileSync(full);
        files.set(key, {
          body,
          type: MIME[path.extname(entry.name).toLowerCase()] || 'application/octet-stream',
          etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
        });
      } catch (err) {
        log.warn(`[Assets] Cannot read ${full}: ${err.message}`);
      }
    }
  };

  walk(rootDir, '');
  return files;
}

/**
 * An Express handler serving one asset set. `indexKey` is what an empty path
 * resolves to, so the same store backs both `/assets/*` and the dashboard page.
 */
function serveAsset(files, key, res) {
  const asset = files.get(key);
  if (!asset) return false;

  res.set('Content-Type', asset.type);
  res.set('ETag', asset.etag);
  // The bytes cannot change without the process restarting, so revalidation is
  // cheap and always correct. `no-cache` means "revalidate", not "don't store".
  res.set('Cache-Control', 'no-cache');
  res.send(asset.body);
  return true;
}

module.exports = { loadAssets, serveAsset, MIME };
