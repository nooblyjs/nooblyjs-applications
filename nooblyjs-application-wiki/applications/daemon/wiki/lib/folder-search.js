const { normaliseFolderPath } = require('./config-store');

/**
 * Turning document search hits into selectable FOLDERS.
 *
 * Pure and dependency-free (no HTTP, no I/O) so the rule that matters here can
 * be reasoned about on its own: which SPACE a found folder gets bound to.
 *
 * The platform indexes documents, not folders — there is no folder search to
 * call — so a folder becomes findable through the documents inside it, and each
 * hit's parent directory is offered as something to sync.
 */

/**
 * Collapse per-space search results into one ranked list of folders.
 *
 * @param {Array<{target: {id: string, name: string}, hits: Array}>} batches
 *   One entry per space that was SEARCHED, carrying that space's hits. The
 *   shape is per-space rather than one flat hit list on purpose — see below.
 * @return {Array<{id, spaceId, spaceName, remotePath, matches, samples}>}
 *
 * THE SPACE COMES FROM THE REQUEST, NEVER FROM THE HIT. Each hit arrives
 * stamped with a `spaceId`/`spaceName`, and it is tempting to trust them. They
 * are not trustworthy: several spaces are different curated lenses over ONE
 * content directory, and the index can only record whichever of them indexed
 * that directory last. The backend is explicit that an unscoped search has no
 * better answer than that stamp, and falls back to the first public space when
 * even the stamp does not resolve.
 *
 * A wrong space here is not a cosmetic mislabel. The selection binds a sync
 * unit to a space, the unit addresses the filing API through `space-<id>`, and
 * a space whose `allowedPaths` does not cover the folder answers 404 for every
 * file in it — a mirror that silently stays empty. So the caller searches each
 * space SCOPED (a scoped search answers with the space that was asked for) and
 * this function keys every folder by that target.
 */
function collapseHitsToFolders(batches) {
  const byFolder = new Map();

  for (const batch of batches || []) {
    if (!batch || !batch.target) continue;
    const spaceId = String(batch.target.id);
    const spaceName = batch.target.name;

    for (const hit of batch.hits || []) {
      if (!hit) continue;
      const hitPath = normaliseFolderPath(hit.path || '');
      const slash = hitPath.lastIndexOf('/');
      // A root-level document belongs to the space root, which is a legitimate
      // (and common) selection — '' is a real folder here, not a missing value.
      const remotePath = slash === -1 ? '' : hitPath.slice(0, slash);
      const key = `${spaceId}::${remotePath}`;
      const label = hit.title || hit.name || hitPath;

      const existing = byFolder.get(key);
      if (existing) {
        existing.matches += 1;
        if (existing.samples.length < 3) existing.samples.push(label);
      } else {
        byFolder.set(key, {
          id: key,
          spaceId,
          spaceName,
          remotePath,
          matches: 1,
          samples: [label],
        });
      }
    }
  }

  return [...byFolder.values()].sort((a, b) => {
    if (b.matches !== a.matches) return b.matches - a.matches;
    // Stable, readable order for equal scores: space then path.
    return String(a.spaceName || '').localeCompare(String(b.spaceName || ''))
      || a.remotePath.localeCompare(b.remotePath);
  });
}

module.exports = { collapseHitsToFolders };
