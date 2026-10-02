const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * Where the daemon reads code from and where it is allowed to WRITE.
 *
 * These are the same directory when running from source and MUST NOT be when
 * running as a packaged executable, which is the whole reason this module
 * exists.
 *
 * A pkg/SEA build mounts the application inside a virtual, READ-ONLY snapshot
 * (`C:\snapshot\…`). `__dirname` resolves into it, so every path the daemon
 * derived from `__dirname` — the config file, the change cursor, the per-folder
 * state files and the entire `.application` tree the core service registry logs
 * into — pointed somewhere that cannot be written. The failure is not loud
 * either: the registry initialises, the dashboard serves, and the first attempt
 * to save a token fails with EROFS/ENOENT long after the operator has decided
 * the thing is working.
 *
 * So:
 *   - `assetRoot()` is where the shipped files live (inside the snapshot when
 *     packaged) — read-only, and only ever read.
 *   - `dataRoot()` is a per-user writable directory when packaged, and the
 *     daemon's own folder when running from source (preserving the existing
 *     developer layout exactly).
 *
 * `DAEMON_DATA_DIR` overrides the data location in both modes, which is what
 * makes a packaged build testable without installing it.
 */

/** The daemon's source directory (one level up from lib/). */
const SOURCE_ROOT = path.join(__dirname, '..');

/**
 * Is this an INSTALLED copy rather than a working tree?
 *
 * Three ways of shipping have to answer yes, and only one of them is
 * self-announcing:
 *   - `pkg` sets `process.pkg`;
 *   - Node's own SEA sets `process.versions.sea`;
 *   - the runtime-bundled build this project actually ships — plain node.exe
 *     running plain index.js — sets NOTHING, and is byte-for-byte
 *     indistinguishable from a developer checkout by any process-level signal.
 *
 * So the build drops an `.installed` marker beside index.js. A working tree
 * never has one, an installed copy always does, and the check is a file test
 * rather than an environment variable so it still holds when someone launches
 * index.js directly instead of going through the shortcut.
 *
 * Getting this wrong is quiet and bad in one direction: an installed copy that
 * reads as a working tree writes its config, state and logs into its own
 * program folder, which an upgrade then replaces.
 */
const INSTALL_MARKER = path.join(SOURCE_ROOT, '.installed');
const PACKAGED = !!process.pkg
  || !!(process.versions && process.versions.sea)
  || fs.existsSync(INSTALL_MARKER);

/**
 * Read-only application files (public/ assets and so on). Inside the snapshot
 * when packaged, which is correct — they are only ever read.
 */
function assetRoot() {
  return SOURCE_ROOT;
}

/**
 * The directory beside the installed executable. Not writable on a
 * machine-wide install under Program Files, so it is used for locating
 * optional files shipped next to the exe, never for state.
 */
function installRoot() {
  return PACKAGED ? path.dirname(process.execPath) : SOURCE_ROOT;
}

/**
 * Writable root for everything the daemon persists: `.daemon-config.json`,
 * `.daemon-cursor.json`, the per-folder state files and `.application/`.
 *
 * Packaged builds go to LOCALAPPDATA rather than beside the executable, because
 * an installed application lives in Program Files where a standard user cannot
 * write — and because the config holds a personal API token and a personal
 * folder selection, which belong to the user, not the machine.
 */
function dataRoot() {
  if (process.env.DAEMON_DATA_DIR) {
    return path.resolve(process.env.DAEMON_DATA_DIR);
  }
  if (!PACKAGED) {
    // Running from source — keep the historical layout so a developer's
    // existing config, state files and logs are found exactly where they were.
    return SOURCE_ROOT;
  }
  const base = process.env.LOCALAPPDATA
    || process.env.APPDATA
    || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'NooblyJS Wiki Sync');
}

/**
 * The user's Documents folder — the default home for the local mirror.
 *
 * "Documents" is NOT reliably `<home>/Documents` on Windows: OneDrive's Known
 * Folder Move redirects it into the OneDrive tree, and when it does the profile
 * copy usually no longer exists. Guessing wrong is quiet and annoying rather
 * than fatal — files land somewhere the user's own Documents shortcut does not
 * show — so the registry, which is what Explorer itself reads, is consulted
 * first and the guesses are only a fallback.
 *
 * Every step degrades: a locked-down machine where `reg` cannot run, a profile
 * with no Documents folder at all, a non-Windows host — each falls through to
 * the next candidate and finally to the home directory, which always exists.
 */
function documentsFolder() {
  const home = os.homedir();
  const candidates = [];

  if (process.platform === 'win32') {
    const fromRegistry = windowsKnownDocumentsPath();
    if (fromRegistry) candidates.push(fromRegistry);
    // OneDrive KFM, in case the registry read was unavailable.
    for (const key of ['OneDriveCommercial', 'OneDriveConsumer', 'OneDrive']) {
      if (process.env[key]) candidates.push(path.join(process.env[key], 'Documents'));
    }
  }
  candidates.push(path.join(home, 'Documents'));

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch { /* not this one */ }
  }
  // Nothing on disk to confirm: prefer the conventional location anyway (it is
  // created on first use) rather than dropping a mirror in the profile root.
  return candidates[0] || home;
}

/**
 * Read the `Personal` (Documents) known folder out of the user's shell folder
 * registry key and expand any `%VAR%` it contains. Returns null on any failure
 * — this is an optimisation over guessing, never a requirement.
 */
function windowsKnownDocumentsPath() {
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'],
      { encoding: 'utf8', windowsHide: true, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const match = out.match(/Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
    if (!match) return null;
    const expanded = match[1].trim().replace(/%([^%]+)%/g, (whole, name) => process.env[name] || whole);
    return expanded.includes('%') ? null : expanded;   // an unresolved variable is not a path
  } catch {
    return null;
  }
}

/**
 * Default local mirror root for a FRESH install: a named folder inside the
 * user's Documents, which is somewhere they can find it without being told
 * where to look.
 *
 * `WATCH_FOLDER` still wins when it is set, so a scripted deployment can place
 * the mirror without touching the UI. It is a SEED for the default only — once
 * the operator has saved a location it is stored in `.daemon-config.json` and
 * the environment is not consulted again (the same rule `WIKI_URL` follows).
 */
function defaultWatchFolder() {
  if (process.env.WATCH_FOLDER) return process.env.WATCH_FOLDER;
  return path.join(documentsFolder(), 'NooblyJS Wiki');
}

/**
 * What a build BEFORE the folder became configurable would have used.
 *
 * This exists solely so an UPGRADE does not move anybody's files: a config
 * written by an older build has no `baseFolder`, and defaulting it to the new
 * Documents location would silently abandon an existing mirror and re-download
 * the lot somewhere else. An existing config therefore keeps the old default;
 * only a first run gets the new one. See ConfigStore.baseFolder.
 */
function legacyWatchFolder() {
  if (process.env.WATCH_FOLDER) return process.env.WATCH_FOLDER;
  if (!PACKAGED) return './watch';
  return path.join(os.homedir(), 'NooblyJS Wiki');
}

/** Create the writable root up front so every later write finds it there. */
function ensureDataRoot() {
  const dir = dataRoot();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    // Reported by the caller with the context of what it was about to write;
    // throwing here would kill the process before the dashboard can explain.
    return { dir, error: err };
  }
  return { dir, error: null };
}

module.exports = {
  PACKAGED,
  assetRoot,
  installRoot,
  dataRoot,
  documentsFolder,
  defaultWatchFolder,
  legacyWatchFolder,
  ensureDataRoot,
};
