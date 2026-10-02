#!/usr/bin/env node
'use strict';

/**
 * PRODUCTION DATA MIGRATION — move per-document artifacts to a FOLDER-LOCAL
 * `.system/` beside the documents they describe.
 *
 * Supersedes 2026-07-13-consolidate-dotfolders-to-system.js for derived /
 * originals / context. That migration pulled those three UP into a space-root
 * namespace that mirrored the tree; this one puts them back DOWN next to their
 * source. The reason is deployment shape: space folders are symlinks to separate
 * git repositories, and a space-root namespace stranded every repo's artifacts
 * outside the repo — unversioned, and missing after a fresh clone. Folder-local
 * artifacts are committed and cloned with the content they describe.
 *
 *   <folder>/<Doc>.pdf
 *   <folder>/.system/derived/<Doc>.pdf.md      extracted text (search + context)
 *   <folder>/.system/originals/<Doc>.docx      untouched source of a converted page
 *   <folder>/.system/context/<Doc>.pdf.md      AI context  (+ _folder.md roll-up)
 *   <folder>/.system/file-order.json           child ordering
 *   <folder>/.system/file-types.json           child status colours
 *
 * The SPACE ROOT is itself a folder holding documents, so its `.system/` keeps
 * BOTH its own artifacts (for files sitting at the root) AND the space-SCOPED
 * `templates/` + `useractivity/`. Those two are never touched. Other space-scoped
 * folders (`dashboards`, `continuous-explorations`, `archive`) are also left
 * alone and reported, since they belong to the space rather than any document.
 *
 * ─── Legacy layouts handled ────────────────────────────────────────────────
 *   space-root, tree-mirroring (2026-07-13 .. 2026-07-21):
 *     <space>/.system/derived/<folder>/<Doc>.pdf.md
 *     <space>/.system/context/<folder>/<Doc>.md
 *     <space>/.system/originals/<folder>/<Doc>.docx
 *   space-root, pre-2026-07-13:
 *     <space>/.derived/<folder>/...           (and .context / .originals)
 *   per-folder, pre-2026-07-13:
 *     <folder>/.system/.derived/<Doc>.md      ← note: EXTENSION DROPPED
 *     <folder>/.derived/<Doc>.md              ← note: EXTENSION DROPPED
 *     <folder>/.context/<Doc>.md , <folder>/.originals/<Doc>.docx
 *   per-folder settings:
 *     <folder>/.settings/{file-order,file-types}.json
 *
 * NAME RECOVERY is the subtle part. The old per-folder derived sidecar dropped
 * the source's extension (`Report.pdf` -> `.derived/Report.md`); the new one
 * keeps it (`.system/derived/Report.pdf.md`) so `Report.pdf` and `Report.docx`
 * in one folder cannot collide. A blind move would therefore produce names the
 * application never looks up. Each artifact is matched back to a real source
 * document in its folder and renamed accordingly; anything with no surviving
 * source is an ORPHAN, reported and left alone (or removed with --prune-orphans).
 *
 * Context sidecars are always markdown: a markdown source keeps its own name,
 * a binary source keeps its FULL name plus `.md`. `_folder.md` is a folder's
 * roll-up and passes through untouched.
 *
 * SELF-CONTAINED (no dependency on the app's source) so it can be copied onto a
 * production host and run with just Node (>= 16.7).
 *
 * ─── Usage ─────────────────────────────────────────────────────────────────
 *     # 1. Deploy the new application code.
 *     # 2. STOP the backend (it recreates legacy paths while running).
 *     # 3. Preview (default — makes NO changes):
 *     node deployments/migrations/2026-07-21-artifacts-to-folder-local-system.js
 *     # 4. Apply:
 *     node deployments/migrations/2026-07-21-artifacts-to-folder-local-system.js --apply
 *
 *   Flags / env:
 *     --apply             actually move (default is a dry run)
 *     --force             apply even if the backend port is still listening
 *     --prune-orphans     delete artifacts whose source document is gone
 *     --port <n> | PORT   backend port to health-check        (default 9101)
 *     --app-base <dir> | APP_BASE_DIR   override the app base dir
 *     --base <dir>        base for resolving relative space paths (default: repo root)
 *     --space <name>      limit to one space (repeatable)
 *     --no-manifest       don't write the audit manifest
 *
 * Idempotent: artifacts already in the folder-local layout are left alone, so a
 * second run is a no-op. Never overwrites an existing target.
 *
 * @author NooblyJS Team
 * @since 2026-07-21
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
const flagVals = (f) => ARGV.reduce((acc, cur, i) => {
    if (cur === f && ARGV[i + 1] && !ARGV[i + 1].startsWith('--')) acc.push(ARGV[i + 1]);
    return acc;
}, []);

const APPLY = hasFlag('--apply');
const FORCE = hasFlag('--force');
const PRUNE_ORPHANS = hasFlag('--prune-orphans');
const WRITE_MANIFEST = !hasFlag('--no-manifest');
const PORT = Number(flagVal('--port', process.env.PORT || 9101));
const ONLY_SPACES = flagVals('--space');

// ─── Path anchoring (cwd-independent) ──────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_APP_BASE = path.resolve(REPO_ROOT, '..', '.application');
const APP_BASE = path.resolve(flagVal('--app-base', process.env.APP_BASE_DIR || DEFAULT_APP_BASE));
const RESOLVE_BASE = path.resolve(flagVal('--base', REPO_ROOT));

// ─── Layout constants (mirror shared/utils/filePolicy.js) ──────────────────
const SYSTEM_DIR = '.system';
const DERIVED = 'derived';
const ORIGINALS = 'originals';
const CONTEXT = 'context';
const FOLDER_CONTEXT_FILE = '_folder.md';

/** Space-SCOPED sub-folders of the space root's `.system/` — never folder-local. */
const SPACE_SCOPED = new Set([
    'templates', 'useractivity', 'dashboards', 'continuous-explorations', 'archive',
]);

/** Documents that yield a derived sidecar / can be a stored original. */
const BINARY_EXTS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];

/** Per-folder settings files that move into the folder's `.system/`. */
const SETTINGS_FILES = new Set(['file-order.json', 'file-types.json']);

/** Legacy per-folder artifact dirs, mapped to their new `.system/` sub-folder. */
const LEGACY_FOLDER_DIRS = [
    ['.derived', DERIVED],
    ['.originals', ORIGINALS],
    ['.context', CONTEXT],
    [path.join(SYSTEM_DIR, '.derived'), DERIVED],
    [path.join(SYSTEM_DIR, '.originals'), ORIGINALS],
    [path.join(SYSTEM_DIR, '.context'), CONTEXT],
];

/** Legacy SPACE-ROOT namespaces that mirrored the tree, by artifact kind. */
const LEGACY_ROOT_DIRS = [
    [path.join(SYSTEM_DIR, DERIVED), DERIVED],
    [path.join(SYSTEM_DIR, ORIGINALS), ORIGINALS],
    [path.join(SYSTEM_DIR, CONTEXT), CONTEXT],
    ['.derived', DERIVED],
    ['.originals', ORIGINALS],
    ['.context', CONTEXT],
];

// ─── Small helpers ─────────────────────────────────────────────────────────
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const toPosix = (p) => p.split(path.sep).join('/');
const stripMd = (n) => (n.toLowerCase().endsWith('.md') ? n.slice(0, -3) : n);
const isMd = (n) => n.toLowerCase().endsWith('.md');

function loadSpaces() {
    const file = path.join(APP_BASE, 'spaces', 'spaces.json');
    if (!fs.existsSync(file)) {
        throw new Error(
            `spaces.json not found at ${file}\n` +
            'Point --app-base at the .application dir (or set APP_BASE_DIR).'
        );
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : Object.values(parsed);
}

function spaceContentDir(space) {
    const p = space && (space.path
        || (space.configuration && space.configuration.filing && space.configuration.filing.baseDir));
    if (!p) return null;
    return path.isAbsolute(p) ? p : path.resolve(RESOLVE_BASE, p);
}

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
 * Every content folder in a space, as space-relative POSIX paths ('' = root).
 * Follows symlinks — space folders are typically symlinks to git repositories —
 * and guards against cycles by real path. Hidden folders are never descended.
 */
function listContentFolders(spaceDir) {
    const out = [''];
    const seen = new Set();
    (function walk(absDir, rel, depth) {
        if (depth > 40) return;
        let real;
        try { real = fs.realpathSync(absDir); } catch { return; }
        if (seen.has(real)) return;
        seen.add(real);

        let entries;
        try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const name = entry.name;
            if (name.startsWith('.') || name === 'node_modules') continue;
            const abs = path.join(absDir, name);
            if (!isDir(abs)) continue; // isDir follows symlinks
            const childRel = rel ? `${rel}/${name}` : name;
            out.push(childRel);
            walk(abs, childRel, depth + 1);
        }
    })(spaceDir, '', 0);
    return out;
}

/** Visible (non-hidden) file names directly inside a folder. */
function listFolderFiles(absFolder) {
    try {
        return fs.readdirSync(absFolder, { withFileTypes: true })
            .filter((e) => !e.name.startsWith('.') && isFile(path.join(absFolder, e.name)))
            .map((e) => e.name);
    } catch {
        return [];
    }
}

/** Every file beneath dir, as paths relative to dir (POSIX). */
function listFilesRecursive(dir) {
    const out = [];
    (function walk(current) {
        let entries;
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (isFile(full)) out.push(toPosix(path.relative(dir, full)));
        }
    })(dir);
    return out;
}

/** Remove `dir` and any now-empty ancestors, stopping below `stopAt`. */
function pruneEmptyDirs(dir, stopAt) {
    let current = dir;
    while (current.startsWith(stopAt) && current !== stopAt) {
        let remaining;
        try { remaining = fs.readdirSync(current); } catch { return; }
        if (remaining.length > 0) return;
        try { fs.rmdirSync(current); } catch { return; }
        current = path.dirname(current);
    }
}

// ─── The naming rules (must match shared/utils/filePolicy.js) ──────────────

/**
 * Target file name for a DERIVED sidecar, recovering the source's extension.
 *
 * The legacy per-folder layout dropped it (`Report.pdf` -> `.derived/Report.md`)
 * while the new layout keeps it (`.system/derived/Report.pdf.md`). Match the
 * artifact back to a real document in its folder; when the legacy stem is
 * already a full file name (the space-root layout kept extensions) that match
 * succeeds immediately and the name is unchanged.
 *
 * @returns {{name:string, source:string}|null} null when no source survives.
 */
function derivedTargetName(legacyName, folderFiles) {
    const stem = stripMd(legacyName);                       // `Report.pdf` or `Report`
    if (folderFiles.includes(stem)) return { name: `${stem}.md`, source: stem };

    const matches = folderFiles.filter((f) =>
        BINARY_EXTS.includes(path.extname(f).toLowerCase())
        && path.basename(f, path.extname(f)) === stem);
    if (matches.length === 1) return { name: `${matches[0]}.md`, source: matches[0] };
    return null; // no source, or ambiguous (Report.pdf AND Report.docx)
}

/**
 * Target file name for a CONTEXT sidecar. Context is always markdown: a markdown
 * source keeps its own name, any other source keeps its FULL name plus `.md`.
 * The folder roll-up passes through.
 * @returns {{name:string, source:string}|null}
 */
function contextTargetName(legacyName, folderFiles) {
    if (legacyName === FOLDER_CONTEXT_FILE) {
        return { name: FOLDER_CONTEXT_FILE, source: '(folder roll-up)' };
    }
    // Sidecar named exactly after a surviving source document.
    if (folderFiles.includes(legacyName)) {
        return { name: isMd(legacyName) ? legacyName : `${legacyName}.md`, source: legacyName };
    }
    // Already new-style for a binary: `Report.pdf.md` -> source `Report.pdf`.
    const stem = stripMd(legacyName);
    if (stem !== legacyName && folderFiles.includes(stem)) {
        return { name: legacyName, source: stem };
    }
    // Legacy derived-doc sidecar with the extension dropped.
    const matches = folderFiles.filter((f) =>
        BINARY_EXTS.includes(path.extname(f).toLowerCase())
        && path.basename(f, path.extname(f)) === stem);
    if (matches.length === 1) return { name: `${matches[0]}.md`, source: matches[0] };
    return null;
}

/**
 * Target file name for a STORED ORIGINAL. The file IS the source, just relocated,
 * so the name never changes; its owner is the visible `<stem>.md` page.
 * @returns {{name:string, source:string}|null}
 */
function originalsTargetName(legacyName, folderFiles) {
    const page = `${path.basename(legacyName, path.extname(legacyName))}.md`;
    if (folderFiles.includes(page)) return { name: legacyName, source: page };
    return null;
}

const TARGET_NAME_FOR = {
    [DERIVED]: derivedTargetName,
    [CONTEXT]: contextTargetName,
    [ORIGINALS]: originalsTargetName,
};

// ─── Move engine ───────────────────────────────────────────────────────────
const stats = { moved: 0, renamed: 0, orphans: 0, pruned: 0, conflicts: 0, alreadyOk: 0 };
const manifest = [];

/** Relocate one artifact file, honouring dry-run. */
async function moveArtifact(fromAbs, toAbs, pruneRoot, label, note) {
    if (path.resolve(fromAbs) === path.resolve(toAbs)) { stats.alreadyOk++; return; }
    if (fs.existsSync(toAbs)) {
        stats.conflicts++;
        console.log(`    ! EXISTS  ${label}  — target already present, left in place`);
        return;
    }
    console.log(`    ${APPLY ? '✓' : '•'} ${label}${note ? `  ${note}` : ''}`);
    if (APPLY) {
        await fsp.mkdir(path.dirname(toAbs), { recursive: true });
        try {
            await fsp.rename(fromAbs, toAbs);
        } catch (err) {
            if (err.code !== 'EXDEV') throw err;
            await fsp.cp(fromAbs, toAbs, { recursive: true, force: false, errorOnExist: false });
            await fsp.rm(fromAbs, { force: true });
        }
        pruneEmptyDirs(path.dirname(fromAbs), pruneRoot);
        manifest.push({ from: toPosix(fromAbs), to: toPosix(toAbs) });
    }
    stats.moved++;
}

/** Report (or delete) an artifact whose source document no longer exists. */
async function handleOrphan(absPath, pruneRoot, label) {
    stats.orphans++;
    if (!PRUNE_ORPHANS) {
        console.log(`    ? ORPHAN  ${label}  — source gone (use --prune-orphans to delete)`);
        return;
    }
    console.log(`    ${APPLY ? '✓' : '•'} PRUNE   ${label}  — source gone`);
    if (APPLY) {
        await fsp.rm(absPath, { force: true });
        pruneEmptyDirs(path.dirname(absPath), pruneRoot);
        stats.pruned++;
        manifest.push({ pruned: toPosix(absPath) });
    }
}

/**
 * Phase 1 — de-mirror a legacy SPACE-ROOT namespace back into each owning folder.
 * `<space>/<legacyDir>/<folder>/<name>` -> `<space>/<folder>/.system/<kind>/<name>`
 */
async function demirrorRootNamespace(spaceDir, legacyDir, kind) {
    const root = path.join(spaceDir, legacyDir);
    if (!isDir(root)) return;

    const entries = listFilesRecursive(root);
    if (entries.length === 0) return;
    console.log(`  ${legacyDir}/  (space-root, tree-mirroring — ${entries.length} file(s))`);

    for (const rel of entries) {
        // Already folder-local underneath the root namespace? Leave it be.
        if (rel.split('/').includes(SYSTEM_DIR)) { stats.alreadyOk++; continue; }

        const slash = rel.lastIndexOf('/');
        const folderRel = slash === -1 ? '' : rel.slice(0, slash);
        const legacyName = slash === -1 ? rel : rel.slice(slash + 1);
        const absFrom = path.join(root, rel);
        const ownerAbs = path.join(spaceDir, folderRel);

        if (folderRel && !isDir(ownerAbs)) {
            await handleOrphan(absFrom, root, `${legacyDir}/${rel}  (folder gone)`);
            continue;
        }

        const resolved = TARGET_NAME_FOR[kind](legacyName, listFolderFiles(ownerAbs));
        if (!resolved) {
            await handleOrphan(absFrom, root, `${legacyDir}/${rel}`);
            continue;
        }

        const absTo = path.join(ownerAbs, SYSTEM_DIR, kind, resolved.name);
        const note = resolved.name !== legacyName ? `→ renamed for "${resolved.source}"` : '';
        if (resolved.name !== legacyName) stats.renamed++;
        await moveArtifact(absFrom, absTo,
            root, `${legacyDir}/${rel}  ->  ${folderRel ? `${folderRel}/` : ''}${SYSTEM_DIR}/${kind}/${resolved.name}`, note);
    }

    if (APPLY) pruneEmptyDirs(root, spaceDir);
}

/**
 * Phase 2 — normalise ONE folder's own legacy artifact dirs and settings into
 * that folder's `.system/`.
 */
async function migrateFolder(spaceDir, folderRel) {
    const absFolder = path.join(spaceDir, folderRel);
    const folderFiles = listFolderFiles(absFolder);
    const isRoot = folderRel === '';
    let headerShown = false;
    const header = () => {
        if (!headerShown) { console.log(`  ${folderRel || '(space root)'}`); headerShown = true; }
    };

    for (const [legacyDir, kind] of LEGACY_FOLDER_DIRS) {
        const from = path.join(absFolder, legacyDir);
        if (!isDir(from)) continue;

        // At the space root, `.system/derived` etc. IS the correct destination —
        // only the DOTTED legacy variants (`.system/.derived`) need moving there.
        for (const name of listFilesRecursive(from)) {
            if (name.includes('/')) {
                // Nested: this is a tree-mirroring root namespace, handled in phase 1.
                continue;
            }
            const resolved = TARGET_NAME_FOR[kind](name, folderFiles);
            const absFrom = path.join(from, name);
            if (!resolved) {
                header();
                await handleOrphan(absFrom, from, `${legacyDir}/${name}`);
                continue;
            }
            const absTo = path.join(absFolder, SYSTEM_DIR, kind, resolved.name);
            header();
            const note = resolved.name !== name ? `→ renamed for "${resolved.source}"` : '';
            if (resolved.name !== name) stats.renamed++;
            await moveArtifact(absFrom, absTo, from,
                `${legacyDir}/${name}  ->  ${SYSTEM_DIR}/${kind}/${resolved.name}`, note);
        }
        if (APPLY) pruneEmptyDirs(from, absFolder);
    }

    // `.settings/{file-order,file-types}.json` -> `<folder>/.system/`
    const settingsDir = path.join(absFolder, '.settings');
    if (isDir(settingsDir)) {
        for (const name of listFilesRecursive(settingsDir)) {
            if (name.includes('/')) continue;
            if (!SETTINGS_FILES.has(name)) {
                header();
                console.log(`    - keeping .settings/${name} (not a known settings file)`);
                continue;
            }
            header();
            await moveArtifact(path.join(settingsDir, name), path.join(absFolder, SYSTEM_DIR, name),
                settingsDir, `.settings/${name}  ->  ${SYSTEM_DIR}/${name}`);
        }
        if (APPLY) pruneEmptyDirs(settingsDir, absFolder);
    }

    if (isRoot) reportSpaceScoped(absFolder);
}

/** Report what remains space-scoped at the root, so nothing is silently moved. */
function reportSpaceScoped(spaceDir) {
    const sys = path.join(spaceDir, SYSTEM_DIR);
    if (!isDir(sys)) return;
    const kept = [];
    for (const entry of fs.readdirSync(sys, { withFileTypes: true })) {
        if (entry.isDirectory() && SPACE_SCOPED.has(entry.name)) kept.push(entry.name);
    }
    if (kept.length) {
        console.log(`  (space root) space-scoped, left untouched: ${kept.map((k) => `${SYSTEM_DIR}/${k}`).join(', ')}`);
    }
}

async function migrateSpace(label, spaceDir) {
    console.log(`\n${'─'.repeat(62)}\n${label}\n  ${spaceDir}`);
    if (!isDir(spaceDir)) { console.warn('  ! directory not found — skipped'); return; }

    // Phase 1 first: de-mirroring drops artifacts into each folder's `.system/`,
    // which phase 2 then treats as already-correct.
    for (const [legacyDir, kind] of LEGACY_ROOT_DIRS) {
        await demirrorRootNamespace(spaceDir, legacyDir, kind);
    }

    const folders = listContentFolders(spaceDir);
    console.log(`  scanning ${folders.length} content folder(s)…`);
    for (const folderRel of folders) {
        await migrateFolder(spaceDir, folderRel);
    }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
    console.log('══════════════════════════════════════════════════════════════');
    console.log(' Move derived / originals / context to folder-local .system/');
    console.log(`   Mode:      ${APPLY ? 'APPLY (moving files)' : 'DRY RUN (no changes)'}`);
    console.log(`   Orphans:   ${PRUNE_ORPHANS ? 'DELETE (--prune-orphans)' : 'report only'}`);
    console.log(`   App base:  ${APP_BASE}`);
    console.log(`   Path base: ${RESOLVE_BASE}`);
    console.log('══════════════════════════════════════════════════════════════');

    if (APPLY && !FORCE) {
        if (await isPortInUse(PORT)) {
            console.error(
                `\n✖ Backend appears to be RUNNING on port ${PORT}.\n` +
                '  Stop the service first so it cannot recreate legacy paths,\n' +
                '  then re-run. (Override with --force if you are certain it is safe.)'
            );
            process.exitCode = 2;
            return;
        }
    }

    const spaces = loadSpaces()
        .filter((s) => ONLY_SPACES.length === 0 || ONLY_SPACES.includes(s && s.name));
    if (spaces.length === 0) {
        console.error('No spaces matched. Check spaces.json or --space.');
        process.exitCode = 1;
        return;
    }

    for (const space of spaces) {
        const dir = spaceContentDir(space);
        if (!dir) { console.warn(`  ! space "${space && space.name}" has no resolvable path — skipped`); continue; }
        await migrateSpace(`space "${space.name}"`, path.resolve(dir));
    }

    console.log(`\n${'─'.repeat(62)}`);
    console.log(`  moved       ${stats.moved}   (of which renamed to recover an extension: ${stats.renamed})`);
    console.log(`  already ok  ${stats.alreadyOk}`);
    console.log(`  orphans     ${stats.orphans}${PRUNE_ORPHANS ? `  (pruned ${stats.pruned})` : '  (left in place)'}`);
    console.log(`  conflicts   ${stats.conflicts}   (target existed — nothing overwritten)`);

    if (!APPLY) {
        console.log('\nDRY RUN — no changes written. Re-run with --apply (stop the backend first).');
        return;
    }

    if (WRITE_MANIFEST && manifest.length) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const manifestPath = path.join(APP_BASE, `artifact-folder-local-migration-${stamp}.json`);
        try {
            fs.writeFileSync(manifestPath,
                JSON.stringify({ appliedAt: new Date().toISOString(), stats, moves: manifest }, null, 2), 'utf8');
            console.log(`\nAudit manifest written: ${manifestPath}`);
        } catch (err) {
            console.warn(`Could not write manifest (${err.message}) — migration still succeeded.`);
        }
    }
    console.log('Start the backend on the NEW code, which reads/writes <folder>/.system/.');
}

main().catch((err) => {
    console.error('\nMigration FAILED:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
});
