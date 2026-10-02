#!/usr/bin/env node
/**
 * Vendors shared assets out of the repo into the extension's media/ tree.
 *
 * A VS Code extension is packaged as a self-contained folder, so it cannot
 * reference anything outside itself — every asset a webview loads has to
 * physically live here. These files are therefore GENERATED, not authored:
 * edit the source in the repo, then `npm run sync` to refresh them. They are
 * committed so that a fresh clone compiles and runs without a sync first.
 *
 * This mirrors applications/chrome/wiki/build.js, deliberately: that extension
 * hit exactly this problem first, and the wiki's custom markdown blocks are the
 * reason both exist. Two copies of the parser that drift are worse than one
 * copy that is regenerated, so nothing here is hand-edited.
 *
 * Usage:
 *   npm run sync          refresh every vendored asset
 *   node scripts/sync-assets.js --check    fail if anything is out of date (CI)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXT_DIR = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(EXT_DIR, 'media', 'vendor');
// applications/vscode/wiki -> repo root
const REPO_ROOT = path.resolve(EXT_DIR, '../../..');

const CHECK_ONLY = process.argv.includes('--check');

/**
 * Shared assets copied out of the repo.
 *
 * `section` extracts one labelled block out of a larger stylesheet; without it
 * the whole file is copied. `binary` skips the generated-file banner, which
 * would corrupt anything that is not text.
 */
const ASSETS = [
  {
    from: 'public/js/markdown/markdown-parser.js',
    to: 'markdown-parser.js',
    why: 'the wiki renders custom blocks (landing-hero, pane, linked-documents, …) with this parser'
  },
  {
    // MUST be marked 4.x — see MARKED_MAJOR below. Sourced from node_modules
    // rather than from the Chrome extension, which vendors v15 and therefore
    // renders every image and link wrongly.
    fromNodeModules: 'marked/marked.min.js',
    to: 'marked.min.js',
    binary: true,
    why: 'markdown-parser.js extends marked and needs it as a browser global, loaded first'
  },
  {
    from: 'public/css/kr-base.css',
    to: 'kr-landing.css',
    section: 'Landing blocks',
    // Every landing rule is scoped under .kr-landing precisely because these
    // bands render inside .md-doc, whose element rules would otherwise win.
    mustContain: '.kr-landing {',
    why: 'styles the landing-hero / news / tiles / stories / cta blocks the parser emits'
  },
  {
    from: 'applications/chrome/wiki/css/markdown-styles.css',
    to: 'markdown-styles.css',
    why: 'base .md-doc typography the parser output expects; already written for an extension context'
  },
  {
    from: 'public/css/kr-base.css',
    to: 'kr-markdown.css',
    section: 'Markdown rendering',
    // Styles the chrome the parser wraps around custom output — most visibly
    // `.kr-image`, the figure a base64 data-URI image is rendered inside.
    // Without it an embedded image has no canvas to sit in and the figure
    // collapses, which reads as "the image did not load".
    mustContain: '.kr-image {',
    why: 'themes every custom block and markdown element the parser emits'
  },
  {
    from: 'applications/chrome/wiki/css/bootstrap-icons.min.css',
    to: 'bootstrap-icons.min.css',
    binary: true,
    why: 'the parser emits <i class="bi bi-…"> for links, image figures and zoom controls'
  },
  {
    // The stylesheet above references these by a RELATIVE url("fonts/…"), so
    // they have to sit in a `fonts/` directory beside it.
    from: 'applications/chrome/wiki/css/fonts/bootstrap-icons.woff2',
    to: 'fonts/bootstrap-icons.woff2',
    binary: true,
    why: 'icon font referenced by bootstrap-icons.min.css'
  },
  {
    from: 'applications/chrome/wiki/css/fonts/bootstrap-icons.woff',
    to: 'fonts/bootstrap-icons.woff',
    binary: true,
    why: 'icon font fallback for older engines'
  },
  {
    from: 'applications/web/wiki/public/js/vendor/pdfjs/pdf.min.mjs',
    to: 'pdfjs/pdf.min.mjs',
    binary: true,
    why: 'VS Code webviews run in Electron, which has no PDF plugin — <embed> renders nothing'
  },
  {
    from: 'applications/web/wiki/public/js/vendor/pdfjs/pdf.worker.min.mjs',
    to: 'pdfjs/pdf.worker.min.mjs',
    binary: true,
    why: 'PDF.js worker; workerSrc is pointed at it as a webview URI'
  }
];

/**
 * Cut one top-level section out of a stylesheet, by the label in its banner
 * comment. Sections run from their banner to the next one (or EOF).
 *
 * @param {string} css - The full stylesheet.
 * @param {string} label - Text identifying the section's banner comment.
 * @returns {string} The section, banner included.
 * @throws {Error} When the label matches no banner — a silent miss would ship
 *   an empty stylesheet and the blocks would render unstyled all over again.
 */
function extractSection(css, label) {
  const lines = css.split('\n');
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
  return lines.slice(start, end).join('\n');
}

/**
 * The ONLY major version of marked that markdown-parser.js works with.
 *
 * marked changed its renderer contract at v5: `renderer.image(href, title, text)`
 * became `renderer.image(token)`. The parser overrides `image` and `link` with
 * the v4 positional signature, so a newer marked hands it a token object where
 * it expects a string — every image renders as `src="[object Object]"`, and
 * every link with it. Nothing throws; the page simply comes out wrong.
 *
 * The web app pins 4.3.0 (see the CDN tag in the wiki's index.html), so anything
 * vendoring marked for this parser has to match. Checked rather than trusted,
 * because `npm install marked` resolves to v15 today and the breakage is silent.
 */
const MARKED_MAJOR = 4;

/**
 * Refuse to ship a marked whose renderer contract the parser cannot use.
 *
 * @param {string} nodeModulesRelPath - e.g. `marked/marked.min.js`
 * @return {void}
 * @throws {Error} when the installed major version is wrong or unreadable
 */
function assertMarkedVersion(nodeModulesRelPath) {
  if (!nodeModulesRelPath.startsWith('marked/')) return;

  const pkgPath = path.join(EXT_DIR, 'node_modules', 'marked', 'package.json');
  let version;
  try {
    version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  } catch (error) {
    throw new Error(`could not read marked's version (${error.message}) — run npm install`);
  }

  const major = Number(String(version).split('.')[0]);
  if (major !== MARKED_MAJOR) {
    throw new Error(
      `marked ${version} is installed, but markdown-parser.js requires ${MARKED_MAJOR}.x.\n` +
      `       v5+ passes renderer methods a token object instead of positional arguments,\n` +
      `       so every image and link would render as "[object Object]".\n` +
      `       Fix: npm install marked@4.3.0`
    );
  }
}

let failed = false;
let stale = 0;

for (const asset of ASSETS) {
  if (asset.fromNodeModules) {
    try {
      assertMarkedVersion(asset.fromNodeModules);
    } catch (error) {
      console.error(`ERROR: ${error.message}`);
      failed = true;
      continue;
    }
  }

  const label = asset.from || `node_modules/${asset.fromNodeModules}`;
  const src = asset.fromNodeModules
    ? path.join(EXT_DIR, 'node_modules', asset.fromNodeModules)
    : path.join(REPO_ROOT, asset.from);
  const dst = path.join(VENDOR_DIR, asset.to);

  if (!fs.existsSync(src)) {
    console.error(`ERROR: shared asset missing: ${label}`);
    console.error(`       needed because ${asset.why}`);
    failed = true;
    continue;
  }

  let next;
  if (asset.binary) {
    next = fs.readFileSync(src);
  } else {
    let text = fs.readFileSync(src, 'utf8');
    if (asset.section) {
      try {
        text = extractSection(text, asset.section);
      } catch (error) {
        console.error(`ERROR: ${error.message} (${label})`);
        failed = true;
        continue;
      }
    }
    if (asset.mustContain && !text.includes(asset.mustContain)) {
      console.error(`ERROR: extracted "${asset.section}" from ${label} but it lacks ${asset.mustContain}`);
      failed = true;
      continue;
    }
    next = `/* GENERATED by scripts/sync-assets.js from ${label} — do not edit here; edit the source. */\n${text}`;
  }

  const previous = fs.existsSync(dst)
    ? fs.readFileSync(dst, asset.binary ? null : 'utf8')
    : null;

  const same = previous !== null && Buffer.from(next).equals(Buffer.from(previous));

  if (CHECK_ONLY) {
    if (!same) {
      console.error(`STALE    ${asset.to}  ← ${label}`);
      stale += 1;
    }
    continue;
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, next);
  console.log(`  ${same ? 'unchanged' : 'UPDATED  '} ${asset.to}  ← ${label}`);
}

if (failed) {
  console.error('\nAsset sync failed. The extension will not render wiki documents correctly.');
  process.exit(1);
}

if (CHECK_ONLY && stale > 0) {
  console.error(`\n${stale} vendored asset(s) out of date — run: npm run sync`);
  process.exit(1);
}

if (!CHECK_ONLY) {
  console.log('\nAssets synced.');
}
