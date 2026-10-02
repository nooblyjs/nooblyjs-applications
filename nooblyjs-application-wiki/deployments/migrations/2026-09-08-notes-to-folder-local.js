#!/usr/bin/env node
'use strict';

/**
 * PRODUCTION DATA MIGRATION — move per-user NOTES from the space-root activity
 * folder down into the folder each note is ABOUT.
 *
 * Notes were introduced under `useractivity`, which is space-scoped, so every
 * note in a content root shared one directory and one index:
 *
 *   <root>/.system/useractivity/<prefix>/notes/{<title>.txt,<title>.webm,notes.json}
 *
 * They are now content — a note about a document belongs with that document, so
 * it is versioned, cloned and reviewed with it. Space folders are symlinks to
 * separate git repositories, so a space-root namespace kept every repo's notes
 * OUTSIDE the repo: unversioned, and absent after a fresh clone. After this:
 *
 *   <root>/<folder>/.system/useractivity/<prefix>/notes/{...,notes.json}
 *
 * WHICH FOLDER. A note about a DOCUMENT goes to the document's own folder; a
 * note about a FOLDER goes inside that folder, the same way its `_folder.md`
 * context roll-up does; a note about the space ROOT stays where it is. This
 * mirrors `noteStore.folderFor`, and the two must agree — a note filed anywhere
 * else is simply not found, because nothing scans for it.
 *
 * NOTE THE CONSEQUENCE, WHICH IS INTENDED: notes move inside the content
 * repositories, so they are committed and pushed like every other `.system`
 * artifact, and everyone who clones the repository gets them.
 *
 * Self-contained — no app imports — so it can be copied to a production host.
 * Dry run by default; pass `--apply` to write. Idempotent: a note already in
 * its destination folder is left alone, so a partial run can be re-run.
 *
 *   node 2026-09-08-notes-to-folder-local.js --base-dir <content root>
 *   node 2026-09-08-notes-to-folder-local.js --base-dir <content root> --apply
 *
 * `--prune-orphans` additionally deletes attachment files in the SOURCE folder
 * that no index record points at. Those are the residue of a lost-update race
 * in the pre-lock store (two writers, one read-modify-write each, second wins)
 * and are unrecoverable — nothing records what note they belonged to. Off by
 * default: deleting data is never the default.
 *
 * @author NooblyJS Team
 * @since 2026-09-08
 */

const fs = require('node:fs');
const path = require('node:path');

const ACTIVITY_ROOT = path.join('.system', 'useractivity');
const NOTES_DIR = 'notes';
const INDEX_FILE = 'notes.json';

/** Mirrors noteStore: POSIX separators, no leading or trailing slash. */
function normalisePath(value) {
    return String(value == null ? '' : value)
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '');
}

/** Mirrors noteStore.folderFor — MUST stay in step with it. */
function folderFor(record) {
    const targetPath = normalisePath(record.path);
    if (String(record.type || '').toLowerCase() === 'folder') return targetPath;
    const cut = targetPath.lastIndexOf('/');
    return cut === -1 ? '' : targetPath.slice(0, cut);
}

/** Every file a record owns, body first. */
function filesOf(record) {
    const files = [record.file];
    if (record.audio && record.audio.file) files.push(record.audio.file);
    (record.images || []).forEach(image => {
        if (image && image.file) files.push(image.file);
    });
    return files.filter(Boolean);
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        console.warn(`  ! could not read ${file}: ${err.message}`);
        return fallback;
    }
}

/** A destination name not already taken on disk or by the index being built. */
function uniqueName(dir, taken, name) {
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    let candidate = name;
    let counter = 2;
    while (taken.has(candidate.toLowerCase()) || fs.existsSync(path.join(dir, candidate))) {
        candidate = `${stem}-${counter}${ext}`;
        counter += 1;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
}

function migrateUser(baseDir, prefix, opts) {
    const sourceDir = path.join(baseDir, ACTIVITY_ROOT, prefix, NOTES_DIR);
    const indexFile = path.join(sourceDir, INDEX_FILE);
    const index = readJson(indexFile, null);
    if (!Array.isArray(index)) return null;

    const stats = { user: prefix, notes: index.length, moved: 0, stayed: 0, skipped: 0, orphans: [] };

    // Group by destination folder, so each folder's index is written once.
    const byFolder = new Map();
    index.forEach(record => {
        const folder = folderFor(record);
        if (!byFolder.has(folder)) byFolder.set(folder, []);
        byFolder.get(folder).push(record);
    });

    const referenced = new Set([INDEX_FILE.toLowerCase()]);
    index.forEach(r => filesOf(r).forEach(f => referenced.add(String(f).toLowerCase())));

    for (const [folder, records] of byFolder) {
        // The root's notes are already where they belong.
        if (!folder) {
            stats.stayed += records.length;
            continue;
        }

        const destFolder = path.join(baseDir, folder);
        if (!fs.existsSync(destFolder)) {
            console.warn(`  ! ${folder} no longer exists — ${records.length} note(s) left in place`);
            stats.skipped += records.length;
            continue;
        }

        const destDir = path.join(destFolder, ACTIVITY_ROOT, prefix, NOTES_DIR);
        const destIndexFile = path.join(destDir, INDEX_FILE);
        const destIndex = readJson(destIndexFile, []) || [];
        const taken = new Set();
        (Array.isArray(destIndex) ? destIndex : []).forEach(r => {
            filesOf(r).forEach(f => taken.add(String(f).toLowerCase()));
        });

        console.log(`  ${folder}/  <- ${records.length} note(s)`);

        records.forEach(record => {
            // Re-point the record at whatever names it gets in the destination,
            // renaming only on a genuine collision.
            const renames = new Map();
            filesOf(record).forEach(file => {
                renames.set(file, uniqueName(destDir, taken, file));
            });

            if (opts.apply) {
                fs.mkdirSync(destDir, { recursive: true });
                renames.forEach((to, from) => {
                    const src = path.join(sourceDir, from);
                    if (!fs.existsSync(src)) {
                        console.warn(`    ! missing ${from} — index entry kept, file gone`);
                        return;
                    }
                    fs.renameSync(src, path.join(destDir, to));
                });
            }

            const moved = { ...record, file: renames.get(record.file) || record.file };
            if (moved.audio && moved.audio.file) {
                moved.audio = { ...moved.audio, file: renames.get(moved.audio.file) || moved.audio.file };
            }
            if (Array.isArray(moved.images)) {
                moved.images = moved.images.map(image => ({
                    ...image,
                    file: renames.get(image.file) || image.file
                }));
            }
            destIndex.push(moved);
            stats.moved += 1;
        });

        if (opts.apply) {
            fs.mkdirSync(destDir, { recursive: true });
            fs.writeFileSync(destIndexFile, JSON.stringify(destIndex, null, 2), 'utf8');
        }
    }

    // Whatever is left in the source folder that no record claimed.
    const remaining = fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir) : [];
    stats.orphans = remaining.filter(f => !referenced.has(f.toLowerCase()));

    // The root index keeps exactly what did NOT move: notes about the root
    // itself, and notes whose folder has since been deleted (left in place
    // rather than dropped — an unreachable note is still the user's).
    if (opts.apply) {
        const stayed = index.filter(record => {
            const folder = folderFor(record);
            return !folder || !fs.existsSync(path.join(baseDir, folder));
        });
        fs.writeFileSync(indexFile, JSON.stringify(stayed, null, 2), 'utf8');

        if (opts.pruneOrphans) {
            stats.orphans.forEach(file => {
                fs.unlinkSync(path.join(sourceDir, file));
                console.log(`    - pruned orphan ${file}`);
            });
        }
    }

    return stats;
}

function main() {
    const args = process.argv.slice(2);
    const opts = {
        apply: args.includes('--apply'),
        pruneOrphans: args.includes('--prune-orphans'),
        baseDir: null
    };
    const at = args.indexOf('--base-dir');
    if (at !== -1) opts.baseDir = args[at + 1];

    if (!opts.baseDir) {
        console.error('Usage: 2026-09-08-notes-to-folder-local.js --base-dir <content root> [--apply] [--prune-orphans]');
        process.exit(1);
    }

    const activityRoot = path.join(opts.baseDir, ACTIVITY_ROOT);
    if (!fs.existsSync(activityRoot)) {
        console.log(`No ${ACTIVITY_ROOT} under ${opts.baseDir} — nothing to migrate.`);
        return;
    }

    console.log(opts.apply ? 'APPLYING' : 'DRY RUN (pass --apply to write)');
    console.log(`Content root: ${opts.baseDir}\n`);

    let total = 0;
    fs.readdirSync(activityRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .forEach(entry => {
            const stats = migrateUser(opts.baseDir, entry.name, opts);
            if (!stats) return;
            total += stats.moved;
            console.log(`\n  user ${stats.user}: ${stats.notes} note(s) — ` +
                `${stats.moved} to move, ${stats.stayed} already at the root, ${stats.skipped} skipped`);
            if (stats.orphans.length) {
                console.log(`  orphaned attachment(s) nothing points at: ${stats.orphans.join(', ')}`);
                if (!opts.pruneOrphans) console.log('    (pass --prune-orphans to delete them)');
            }
        });

    console.log(`\n${opts.apply ? 'Moved' : 'Would move'} ${total} note(s).`);
}

if (require.main === module) main();

module.exports = { folderFor, filesOf };
