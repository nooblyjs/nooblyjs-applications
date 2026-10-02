#!/usr/bin/env node
/**
 * Build script for the NooblyJS Wiki Chrome Extension.
 *
 * Reads the production target URL from package.json (build.targetUrl) or --url flag,
 * copies the extension source into dist/ and rewrites the development URL
 * (https://localhost:9101) to the production URL in:
 *   - manifest.json     (host_permissions)
 *   - config.json       (defaultServerUrl, supportedHosts)
 *
 * Usage:
 *   npm run build                                  # Use default production URL
 *   npm run build -- --url https://staging.example # Override URL
 *   node build.js --url https://other.example      # Direct invocation
 *
 * Output:
 *   dist/                  - Loadable unpacked extension folder
 *   dist-zip/<name>.zip    - Optional zip archive for distribution
 */

'use strict';

const fs = require('fs');
const path = require('path');

const EXT_DIR = __dirname;
const DIST_DIR = path.join(EXT_DIR, 'dist');
const PKG_PATH = path.join(EXT_DIR, 'package.json');
const DEV_URL = 'https://localhost:9101';

// Repo root — the extension vendors a few shared assets from the web wiki.
const REPO_ROOT = path.resolve(EXT_DIR, '../../..');

/**
 * Shared assets copied out of the web wiki into the extension tree.
 *
 * The extension is loaded as a plain folder (unpacked source in dev, dist/ in
 * production), so it cannot reference anything outside itself — every asset has
 * to physically live here. These files are therefore GENERATED, not authored:
 * edit the source, then `npm run build` (or `npm run sync`) to refresh them.
 * They are committed so that loading the unpacked source folder works without a
 * build first.
 *
 * `section` extracts one labelled block out of a larger stylesheet; without it
 * the whole file is copied.
 */
const SHARED_ASSETS = [
  {
    from: 'public/js/markdown/markdown-parser.js',
    to: 'js/markdown-parser.js',
    why: 'the wiki renders custom blocks (landing-hero, pane, mermaid, …) with this parser'
  },
  {
    from: 'public/css/kr-base.css',
    to: 'css/kr-landing.css',
    section: 'Landing blocks',
    // Every landing rule is scoped under .kr-landing precisely because these
    // bands render inside .md-doc, whose element rules would otherwise win.
    mustContain: '.kr-landing {',
    why: 'styles the landing-hero / news / tiles / stories / cta blocks the parser emits'
  },
  {
    from: 'public/css/kr-base.css',
    to: 'css/kr-markdown.css',
    section: 'Markdown rendering',
    // Most visibly `.kr-image`, the figure an embedded base64 image renders
    // inside. Without it the figure has no canvas and collapses, which reads
    // as "the image did not load".
    mustContain: '.kr-image {',
    why: 'themes every markdown element and custom block the parser emits'
  }
];

// ── 1. Resolve target URL ────────────────────────────────────────────────────

/**
 * Cut one top-level section out of a stylesheet, by the label in its banner
 * comment. Sections run from their `/* ===…` banner to the next one (or EOF).
 *
 * @param {string} css - The full stylesheet.
 * @param {string} label - Text identifying the section's banner comment.
 * @returns {string} The section, banner included.
 * @throws {Error} When the label matches no banner — a silent miss would ship
 *   an empty stylesheet and the blocks would render unstyled all over again.
 */
function extractSection(css, label) {
  const lines = css.split('\n');
  // A banner opens with `/* ===`; its label follows within the next few lines.
  const isBanner = (i) => /^\/\*\s*=+/.test(lines[i]);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isBanner(i)) continue;
    if (lines.slice(i, i + 4).join('\n').includes(label)) { start = i; break; }
  }
  if (start === -1) {
    throw new Error(`No section banner containing "${label}" — has the stylesheet been reorganised?`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isBanner(i)) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trimEnd() + '\n';
}

/**
 * Refresh every vendored asset from its source in the repo.
 * Runs before the dist copy so dist/ and the source tree agree.
 * @returns {void}
 */
/**
 * The ONLY major version of marked that markdown-parser.js works with.
 *
 * marked changed its renderer contract at v5: `renderer.image(href, title, text)`
 * became `renderer.image(token)`. The parser overrides `image` and `link` with
 * the v4 signature, so a newer marked hands it a token object where it expects
 * a string — every image renders as `src="[object Object]"`, and every link
 * href with it. Nothing throws; the pages just come out wrong.
 *
 * The web wiki loads 4.3.0 from a CDN. `js/marked.min.js` here is a committed
 * copy, so this check is what stops it silently drifting again — it shipped as
 * v15 for a while, which is exactly how the breakage went unnoticed.
 *
 * @returns {void}
 */
function assertVendoredMarked() {
  const markedPath = path.join(EXT_DIR, 'js', 'marked.min.js');
  let head;
  try {
    head = fs.readFileSync(markedPath, 'utf8').slice(0, 400);
  } catch (error) {
    console.error(`ERROR: js/marked.min.js is missing (${error.message}).`);
    process.exit(1);
  }

  const match = /marked[^*\n]*?v(\d+)\.(\d+)\.(\d+)/i.exec(head);
  if (!match) {
    console.error('ERROR: could not read a version banner from js/marked.min.js.');
    console.error('  markdown-parser.js requires marked 4.x — refusing to build blind.');
    process.exit(1);
  }

  if (Number(match[1]) !== 4) {
    console.error(`ERROR: js/marked.min.js is v${match[1]}.${match[2]}.${match[3]}, but markdown-parser.js requires 4.x.`);
    console.error('  v5+ passes renderer methods a token object instead of positional arguments,');
    console.error('  so every image and link would render as "[object Object]".');
    process.exit(1);
  }

  console.log(`  marked v${match[1]}.${match[2]}.${match[3]} — compatible with markdown-parser.js`);
}

function syncSharedAssets() {
  assertVendoredMarked();

  for (const asset of SHARED_ASSETS) {
    const src = path.join(REPO_ROOT, asset.from);
    const dst = path.join(EXT_DIR, asset.to);

    if (!fs.existsSync(src)) {
      console.error(`ERROR: shared asset missing: ${asset.from}`);
      console.error(`  The extension needs it because ${asset.why}.`);
      process.exit(1);
    }

    let content = fs.readFileSync(src, 'utf8');
    if (asset.section) {
      try {
        content = extractSection(content, asset.section);
      } catch (error) {
        console.error(`ERROR: could not extract "${asset.section}" from ${asset.from}`);
        console.error(`  ${error.message}`);
        console.error(`  The extension needs it because ${asset.why}.`);
        process.exit(1);
      }
    }
    if (asset.mustContain && !content.includes(asset.mustContain)) {
      console.error(`ERROR: ${asset.to} came out without "${asset.mustContain}" — refusing to write it.`);
      process.exit(1);
    }

    const banner = asset.to.endsWith('.css') || asset.to.endsWith('.js')
      ? `/* GENERATED by build.js from ${asset.from} — do not edit here; edit the source. */\n`
      : '';
    const next = banner + content;

    const previous = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, next);
    console.log(`  ${previous === next ? 'unchanged' : 'UPDATED  '} ${asset.to}  ← ${asset.from}`);
  }
}

const args = process.argv.slice(2);
let urlOverride = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) {
    urlOverride = args[i + 1];
  }
}

// `--sync-only` refreshes the vendored assets in the SOURCE tree and stops —
// what you want while developing against the unpacked source folder, where no
// dist/ is involved.
if (args.includes('--sync-only')) {
  console.log('Syncing shared assets');
  syncSharedAssets();
  console.log('\n✓ Shared assets up to date. Reload the extension to pick them up.');
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const targetUrl = (urlOverride || pkg.build?.targetUrl || '').replace(/\/+$/, '');

if (!targetUrl) {
  console.error('ERROR: No target URL configured.');
  console.error('  Set "build.targetUrl" in package.json, or pass --url <url>.');
  process.exit(1);
}

console.log(`Building extension`);
console.log(`  Source URL: ${DEV_URL}`);
console.log(`  Target URL: ${targetUrl}`);

// ── 1b. Refresh vendored assets from the web wiki ────────────────────────────

console.log('Syncing shared assets');
syncSharedAssets();

// ── 2. Clean & recreate dist/ ────────────────────────────────────────────────

if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// ── 3. Copy source tree to dist/ ─────────────────────────────────────────────

const EXCLUDE = new Set([
  'dist',
  'dist-zip',
  'temp',
  'node_modules',
  'build.js',
  'package.json',
  'package-lock.json',
  'README.md',
  '.DS_Store',
  '.gitignore'
]);

function copyRecursive(src, dst) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      copyRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

copyRecursive(EXT_DIR, DIST_DIR);
console.log(`Copied source files to dist/`);

// ── 4. Rewrite manifest.json ─────────────────────────────────────────────────

const manifestPath = path.join(DIST_DIR, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

manifest.host_permissions = [`${targetUrl}/*`];

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Rewrote manifest.json host_permissions: ${manifest.host_permissions.join(', ')}`);

// ── 5. Rewrite config.json ───────────────────────────────────────────────────

const configPath = path.join(DIST_DIR, 'config.json');
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

cfg.defaultServerUrl = targetUrl;

// Replace any localhost entries in supportedHosts with the target host
const targetHost = targetUrl.replace(/^https?:\/\//, '');
cfg.supportedHosts = [targetHost];

fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`Rewrote config.json defaultServerUrl: ${cfg.defaultServerUrl}`);

// ── 6. Done ──────────────────────────────────────────────────────────────────

console.log('\n✓ Build complete!');
console.log(`\n  dist/ folder is ready to load as an unpacked extension:`);
console.log(`    1. Open chrome://extensions`);
console.log(`    2. Enable "Developer mode"`);
console.log(`    3. Click "Load unpacked"`);
console.log(`    4. Select: ${DIST_DIR}`);
