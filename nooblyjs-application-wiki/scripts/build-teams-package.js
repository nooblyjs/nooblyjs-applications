/**
 * @fileoverview Builds the Teams app package (.zip) for sideloading into Teams.
 *
 * Steps:
 *   1. Builds the Teams tab frontend (`npm run build` in applications/teams/wiki).
 *   2. Resolves the manifest placeholders (${{TEAMS_APP_ID}} etc.) from the
 *      Teams env files, generating and persisting a stable TEAMS_APP_ID on
 *      first run.
 *   3. Zips the resolved manifest + icons into
 *      applications/teams/wiki/appPackage/build/appPackage.dev.zip
 *
 * Run via:  npm run build:teams   (from the repo root)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const archiver = require('archiver');

const ROOT = path.join(__dirname, '..');
const TEAMS_APP_DIR = path.join(ROOT, 'applications', 'teams', 'wiki');
const APP_PACKAGE_DIR = path.join(TEAMS_APP_DIR, 'appPackage');
const BUILD_DIR = path.join(APP_PACKAGE_DIR, 'build');
const ENV_DEV = path.join(TEAMS_APP_DIR, 'env', '.env.dev');
const ENV_LOCAL = path.join(TEAMS_APP_DIR, 'env', '.env.local');
const MANIFEST = path.join(APP_PACKAGE_DIR, 'manifest.json');
const ZIP_PATH = path.join(BUILD_DIR, 'appPackage.dev.zip');

// Fallbacks used when a value is absent from the Teams env files.
const DEFAULTS = {
  APP_NAME_SUFFIX: 'dev',
  TAB_ENDPOINT: 'https://knowledgerepository.local/applications/teams/',
  TAB_DOMAIN: 'knowledgerepository.local'
};

/** Parse a simple KEY=VALUE env file into an object (ignores comments/blanks). */
function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Ensure a stable TEAMS_APP_ID exists, persisting a generated one to .env.dev. */
function resolveAppId(envDev, envLocal) {
  const existing = envLocal.TEAMS_APP_ID || envDev.TEAMS_APP_ID;
  if (existing) return existing;

  const appId = crypto.randomUUID();
  if (fs.existsSync(ENV_DEV)) {
    const raw = fs.readFileSync(ENV_DEV, 'utf8');
    const updated = /^TEAMS_APP_ID=.*$/m.test(raw)
      ? raw.replace(/^TEAMS_APP_ID=.*$/m, `TEAMS_APP_ID=${appId}`)
      : `${raw.replace(/\s*$/, '')}\nTEAMS_APP_ID=${appId}\n`;
    fs.writeFileSync(ENV_DEV, updated);
  }
  console.log(`Generated TEAMS_APP_ID=${appId} (persisted to env/.env.dev)`);
  return appId;
}

async function zipPackage(manifestJson) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(ZIP_PATH);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(manifestJson, { name: 'manifest.json' });
    archive.file(path.join(APP_PACKAGE_DIR, 'color.png'), { name: 'color.png' });
    archive.file(path.join(APP_PACKAGE_DIR, 'outline.png'), { name: 'outline.png' });
    archive.finalize();
  });
}

async function main() {
  // 1. Build the Teams tab frontend.
  console.log('Building Teams frontend...');
  execSync('npm run build', { cwd: TEAMS_APP_DIR, stdio: 'inherit' });

  // 2. Resolve manifest placeholders.
  const envDev = parseEnvFile(ENV_DEV);
  const envLocal = parseEnvFile(ENV_LOCAL);
  const values = {
    TEAMS_APP_ID: resolveAppId(envDev, envLocal),
    APP_NAME_SUFFIX: envLocal.APP_NAME_SUFFIX || envDev.APP_NAME_SUFFIX || DEFAULTS.APP_NAME_SUFFIX,
    TAB_ENDPOINT: envLocal.TAB_ENDPOINT || envDev.TAB_ENDPOINT || DEFAULTS.TAB_ENDPOINT,
    TAB_DOMAIN: envLocal.TAB_DOMAIN || envDev.TAB_DOMAIN || DEFAULTS.TAB_DOMAIN
  };

  let manifest = fs.readFileSync(MANIFEST, 'utf8');
  manifest = manifest.replace(/\$\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );

  const unresolved = manifest.match(/\$\{\{\w+\}\}/g);
  if (unresolved) {
    console.warn(`WARNING: unresolved manifest placeholders: ${[...new Set(unresolved)].join(', ')}`);
  }

  // 3. Zip manifest + icons.
  await zipPackage(manifest);

  console.log('');
  console.log('Teams app package built:');
  console.log(`  ${ZIP_PATH}`);
  console.log(`  contentUrl host: ${values.TAB_ENDPOINT}`);
  console.log('Sideload via Teams > Apps > Manage your apps > Upload a custom app.');
}

main().catch((err) => {
  console.error('Failed to build Teams package:', err.message || err);
  process.exit(1);
});
