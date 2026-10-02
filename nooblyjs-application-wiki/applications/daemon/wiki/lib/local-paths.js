const path = require('node:path');
const { normaliseFolderPath } = require('./config-store');

/**
 * Where a selected wiki folder lands on disk.
 *
 * Deliberately dependency-free (node builtins only) so this can be reasoned
 * about and tested without dragging in the HTTP client and the file watcher —
 * it is pure path arithmetic, and it is the rule that decides whether two
 * selections can collide.
 */

/** Characters that are illegal in Windows file/folder names. */
const ILLEGAL_FOLDER_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

/**
 * Turn one name into a filesystem-safe folder name. Replaces characters illegal
 * on Windows (and control chars) with "_", strips trailing dots/spaces, and
 * avoids reserved device names. The mapping does not need to be reversible —
 * a sync unit is bound to its folder, so the space is never parsed back out of
 * the name.
 */
function sanitizeFolderName(name) {
  let n = '';
  for (const ch of String(name)) {
    n += (ILLEGAL_FOLDER_CHARS.has(ch) || ch.charCodeAt(0) < 0x20) ? '_' : ch;
  }
  n = n.replace(/[. ]+$/g, '').trim();
  if (!n) n = 'folder';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n)) n = `_${n}`;
  return n;
}

/**
 * Local directory for a selected folder:
 *
 *   <watchFolder>/<Space Name>/<remote/folder/path>/
 *
 * The remote path is MIRRORED, not flattened. Each segment is sanitized
 * separately and they stay nested, which is what makes "Sales/Reports" and
 * "Finance/Reports" two different directories instead of one contested one —
 * and what makes the path on disk readable as the path in the wiki.
 *
 * Only the unit's own root is derived here. Paths BELOW it are joined verbatim
 * from the remote path, so a deep file keeps the name the wiki gave it.
 */
function localPathForFolder(watchFolder, spaceName, remotePath) {
  const segments = normaliseFolderPath(remotePath)
    .split('/')
    .filter(Boolean)
    .map(sanitizeFolderName);
  return path.join(watchFolder, sanitizeFolderName(spaceName), ...segments);
}

module.exports = { sanitizeFolderName, localPathForFolder, ILLEGAL_FOLDER_CHARS };
