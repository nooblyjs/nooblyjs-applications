#!/usr/bin/env node
'use strict';

/**
 * PRODUCTION DATA MIGRATION — consolidate space-root dot-folders under `.system/`.
 *
 * Moves the six legacy space-root hidden folders into a single per-space
 * `.system/` namespace, for every space content dir AND the app base dir:
 *
 *     .derived                 -> .system/derived
 *     .useractivity            -> .system/useractivity
 *     .dashboards              -> .system/dashboards
 *     .continuous-explorations -> .system/continuous-explorations
 *     .templates               -> .system/templates
 *     .archive                 -> .system/archive
 *
 * Per-FOLDER items are intentionally left in place (they are folder-local by
 * design): `.settings`, `.aicontext`, `.context`, `.originals`, `.home.md`, and
 * each Continuous-Exploration project's `.continuous-exploration.json`/`.chat.json`.
 *
 * This script is SELF-CONTAINED (no dependency on the app's source) so it can be
 * copied onto a production host and run with just Node (>= 16.7).
 *
 * ─── Assumed layout (same as dev) ──────────────────────────────────────────
 *     <parent>/
 *       .application/                     ← app base dir  (spaces/spaces.json)
 *       knowledge-content/<space>/        ← space content dirs
 *       <repo>/deployments/migrations/    ← this script
 *   Space `path`s in spaces.json are relative (e.g. `../knowledge-content/x`)
 *   and are resolved against the repo root (where the server runs).
 *
 * ─── Usage ─────────────────────────────────────────────────────────────────
 *     # 1. Stop the backend service first (so it can't recreate legacy folders).
 *     # 2. Preview (default — makes NO changes):
 *     node deployments/migrations/2026-07-13-consolidate-dotfolders-to-system.js
 *     # 3. Apply for real:
 *     node deployments/migrations/2026-07-13-consolidate-dotfolders-to-system.js --apply
 *
 *   Flags / env:
 *     --apply                 actually move (default is a dry run)
 *     --force                 apply even if the backend port is still listening
 *     --port <n> | PORT       backend port to health-check   (default 9101)
 *     --app-base <dir> | APP_BASE_DIR   override the app base dir
 *     --base <dir>            base for resolving relative space paths
 *                             (default: repo root, i.e. the server's cwd)
 *     --no-manifest           don't write the audit manifest
 *
 * Idempotent: re-running after a successful apply is a no-op. If a target
 * already exists (partial prior run), children are merged in WITHOUT
 * overwriting existing files, and a warning is printed.
 *
 * @author NooblyJS Team
 * @since 2026-07-13
 */

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const path = require('node:path');
const net = require('node:net');

// ─── Args ──────────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const hasFlag = (f) => ARGV.includes(f);
const flagVal = (f, dflt) => {
    const i = ARGV.indexOf(f);
    return i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith('--') ? ARGV[i + 1] : dflt;
};

const APPLY = hasFlag('--apply');
const FORCE = hasFlag('--force');
const WRITE_MANIFEST = !hasFlag('--no-manifest');
const PORT = Number(flagVal('--port', process.env.PORT || 9101));

// ─── Path anchoring (cwd-independent) ──────────────────────────────────────
// This file lives at <repo>/deployments/migrations/, so:
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_APP_BASE = path.resolve(REPO_ROOT, '..', '.application');
const APP_BASE = path.resolve(flagVal('--app-base', process.env.APP_BASE_DIR || DEFAULT_APP_BASE));
// Relative space paths (../knowledge-content/x) resolve against the server cwd,
// which is the repo root. Overridable for non-standard prod layouts.
const RESOLVE_BASE = path.resolve(flagVal('--base', REPO_ROOT));

const SYSTEM_DIR = '.system';
const MOVES = [
    ['.derived', 'derived'],
    ['.useractivity', 'useractivity'],
    ['.dashboards', 'dashboards'],
    ['.continuous-explorations', 'continuous-explorations'],
    ['.templates', 'templates'],
    ['.archive', 'archive'],
];

// ─── Helpers ───────────────────────────────────────────────────────────────
function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function loadSpaces() {
    const file = path.join(APP_BASE, 'spaces', 'spaces.json');
    if (!fs.existsSync(file)) {
        throw new Error(
            `spaces.json not found at ${file}\n` +
            `Point --app-base at the .application dir (or set APP_BASE_DIR).`
        );
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : Object.values(parsed);
}

function spaceContentDir(space) {
    const p = space && (space.path || (space.configuration && space.configuration.filing && space.configuration.filing.baseDir));
    if (!p) return null;
    return path.isAbsolute(p) ? p : path.resolve(RESOLVE_BASE, p);
}

// Resolve without leaking on failure. Returns true if something is listening.
function isPortInUse(port) {
    return new Promise((resolve) => {
        const sock = new net.Socket();
        const done = (inUse) => { sock.destroy(); resolve(inUse); };
        sock.setTimeout(800);
        sock.once('connect', () => done(true));
        sock.once('timeout', () => done(false));
        sock.once('error', () => done(false));
        sock.connect(port, '127.0.0.1');
    });
}

/**
 * Move `src` to `dest`. Handles the normal case (rename), a pre-existing target
 * (merge children without overwriting), and cross-device moves (copy + remove).
 * Returns 'moved' | 'merged'.
 */
async function movePath(src, dest) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });

    if (!fs.existsSync(dest)) {
        try {
            await fsp.rename(src, dest);
            return 'moved';
        } catch (err) {
            if (err.code !== 'EXDEV') throw err;
            await fsp.cp(src, dest, { recursive: true, force: false, errorOnExist: false });
            await fsp.rm(src, { recursive: true, force: true });
            return 'moved';
        }
    }

    // Target already exists — merge source children in (never overwrite an
    // existing file), then drop the now-empty source.
    await fsp.cp(src, dest, { recursive: true, force: false, errorOnExist: false });
    await fsp.rm(src, { recursive: true, force: true });
    return 'merged';
}

async function migrateDir(label, dir, manifest) {
    if (!isDir(dir)) return 0;
    let count = 0;
    let headerPrinted = false;
    const printHeader = () => {
        if (!headerPrinted) { console.log(`\n${label}  (${dir})`); headerPrinted = true; }
    };

    for (const [legacy, target] of MOVES) {
        const src = path.join(dir, legacy);
        if (!isDir(src)) continue;
        const dest = path.join(dir, SYSTEM_DIR, target);
        const willMerge = fs.existsSync(dest);

        if (!APPLY) {
            printHeader();
            console.log(`  • would move ${legacy} -> ${SYSTEM_DIR}/${target}${willMerge ? '  (merge — target exists)' : ''}`);
            count++;
            continue;
        }

        const mode = await movePath(src, dest);
        printHeader();
        console.log(`  ✓ ${legacy} -> ${SYSTEM_DIR}/${target}${mode === 'merged' ? '  (merged)' : ''}`);
        if (mode === 'merged') console.warn(`    ! ${SYSTEM_DIR}/${target} already existed — merged without overwriting`);
        manifest.push({ dir, from: legacy, to: `${SYSTEM_DIR}/${target}`, mode });
        count++;
    }
    return count;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
    console.log('══════════════════════════════════════════════════════════════');
    console.log(` Consolidate space-root dot-folders under ${SYSTEM_DIR}/`);
    console.log(`   Mode:      ${APPLY ? 'APPLY (moving files)' : 'DRY RUN (no changes)'}`);
    console.log(`   App base:  ${APP_BASE}`);
    console.log(`   Path base: ${RESOLVE_BASE}`);
    console.log('══════════════════════════════════════════════════════════════');

    // Safety: never migrate underneath a live backend — it would keep writing to
    // (and recreating) the legacy folders. Block --apply unless --force.
    if (APPLY && !FORCE) {
        const live = await isPortInUse(PORT);
        if (live) {
            console.error(
                `\n✖ Backend appears to be RUNNING on port ${PORT}.\n` +
                `  Stop the service first so it can't recreate legacy folders,\n` +
                `  then re-run. (Override with --force if you are certain it is safe.)`
            );
            process.exitCode = 2;
            return;
        }
    }

    const spaces = loadSpaces();

    // Deduped target dirs: app base dir (global .useractivity) + each space.
    const targets = new Map(); // absPath -> label
    targets.set(path.resolve(APP_BASE), 'app base dir');
    for (const space of spaces) {
        const dir = spaceContentDir(space);
        if (dir) targets.set(path.resolve(dir), `space "${space.name}"`);
        else console.warn(`  ! space "${space && space.name}" has no resolvable path — skipped`);
    }

    const manifest = [];
    let total = 0;
    for (const [dir, label] of targets) {
        total += await migrateDir(label, dir, manifest);
    }

    console.log('\n──────────────────────────────────────────────────────────────');
    if (!APPLY) {
        console.log(`DRY RUN complete: ${total} folder move(s) pending across ${targets.size} location(s).`);
        console.log('Re-run with --apply to execute (stop the backend first).');
        return;
    }

    console.log(`APPLIED: ${total} folder move(s) across ${targets.size} location(s).`);

    if (WRITE_MANIFEST && manifest.length) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const manifestPath = path.join(APP_BASE, `dotfolder-migration-${stamp}.json`);
        try {
            fs.writeFileSync(manifestPath, JSON.stringify({ appliedAt: new Date().toISOString(), moves: manifest }, null, 2), 'utf8');
            console.log(`Audit manifest written: ${manifestPath}`);
        } catch (err) {
            console.warn(`Could not write manifest (${err.message}) — migration still succeeded.`);
        }
    }
    console.log('Remember to start the backend on the NEW code so it reads/writes .system/.');
}

main().catch(err => {
    console.error('\nMigration FAILED:', err.message);
    process.exitCode = 1;
});
