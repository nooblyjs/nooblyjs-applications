/**
 * Rebuilding the `path` the folder-tree endpoint strips.
 *
 * Deliberately free of any `vscode` import so it stays a pure function of the
 * wire format, testable on its own.
 */

export interface TreeNode {
  name: string;
  type: 'file' | 'folder' | 'document';
  path?: string;
  extension?: string;
  size?: number;
  modified?: string;
  children?: TreeNode[];
  truncated?: boolean;
}

function extensionOfName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Rebuild each node's `path` from its position in the tree.
 *
 * `GET /spaces/:id/folder-tree` runs its response through `leanTree()`
 * (filingRoutes.js), which drops `path`, `title`, `fileName` and `spaceName`
 * because they are all derivable and `path` alone is over 40% of the payload.
 * Every client is expected to put them back — the web app does it in
 * `navigationController.rehydrateTree()`.
 *
 * Skipping this does not fail loudly. Nodes come back with `path: undefined`,
 * each folder then requests the subtree at "no path", the server treats that as
 * the space root, and the tree renders the same folders inside themselves to
 * any depth the user cares to expand.
 *
 * `prefix` is the folder the response describes: `''` for a space root, and the
 * REQUESTED FOLDER for a subtree fetch — a subtree's nodes are children of that
 * folder, so without the prefix their paths are wrong by exactly the segment
 * that makes them reachable.
 *
 * @param nodes - nodes straight off the wire; mutated in place
 * @param prefix - space-relative folder the response describes
 * @return the same array, with `path` (and file `extension`) filled in
 */
export function rehydratePaths(nodes: TreeNode[], prefix = ''): TreeNode[] {
  if (!Array.isArray(nodes)) return [];

  for (const node of nodes) {
    node.path = prefix ? `${prefix}/${node.name}` : node.name;

    if (node.type === 'folder') {
      rehydratePaths(node.children || (node.children = []), node.path);
    } else if (!node.extension) {
      node.extension = extensionOfName(node.name);
    }
  }

  return nodes;
}
