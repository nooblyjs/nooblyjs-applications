import * as vscode from 'vscode';
import { WikiApiClient, FileSystemItem, extensionOf, viewerFor } from '../api/WikiApiClient';
import { describeError } from '../api/errors';

const ICON_BY_EXTENSION: { [key: string]: string } = {
  md: 'markdown', markdown: 'markdown',
  js: 'symbol-method', ts: 'symbol-method', jsx: 'symbol-method', tsx: 'symbol-method',
  json: 'json', html: 'code', css: 'symbol-color',
  py: 'symbol-class', java: 'symbol-class', cs: 'symbol-class',
  c: 'symbol-file', cpp: 'symbol-file', h: 'symbol-file',
  go: 'symbol-module', rs: 'symbol-module', rb: 'ruby', php: 'symbol-variable',
  sh: 'terminal', bash: 'terminal', ps1: 'terminal',
  txt: 'file-text', log: 'output', csv: 'graph',
  pdf: 'file-pdf',
  png: 'file-media', jpg: 'file-media', jpeg: 'file-media',
  gif: 'file-media', svg: 'file-media', webp: 'file-media',
  xml: 'file-code', yml: 'file-code', yaml: 'file-code',
  docx: 'file-word', doc: 'file-word',
  xlsx: 'file-excel', xls: 'file-excel',
  pptx: 'file-pdf', ppt: 'file-pdf'
};

export class FileTreeItem extends vscode.TreeItem {
  constructor(public readonly itemData: FileSystemItem) {
    const isFolder = itemData.type === 'folder';

    // `truncated` means NOT LISTED YET, never "empty" — a truncated folder must
    // stay expandable or its whole subtree silently disappears. A folder that
    // WAS walked and came back with nothing really is empty, so it collapses to
    // a leaf rather than offering a chevron that reveals nothing.
    const expandable = isFolder
      && (itemData.truncated === true || (itemData.children?.length ?? 0) > 0);

    super(
      itemData.name,
      expandable
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    if (isFolder) {
      this.contextValue = 'wikiFolder';
      this.iconPath = new vscode.ThemeIcon('folder');
      this.tooltip = itemData.path;
    } else {
      this.contextValue = 'wikiFile';
      const extension = itemData.extension || extensionOf(itemData.name);
      this.iconPath = new vscode.ThemeIcon(ICON_BY_EXTENSION[extension.toLowerCase()] || 'file');
      this.description = formatSize(itemData.size);
      this.tooltip = new vscode.MarkdownString(
        `\`${itemData.path}\`\n\n${describeFile(itemData)}`
      );
      this.command = {
        command: 'nooblyjs-knowledge-repository.openFile',
        title: 'Open Document',
        arguments: [itemData]
      };
    }
  }
}

function formatSize(size?: number): string {
  if (!size || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function describeFile(item: FileSystemItem): string {
  const parts: string[] = [];
  const viewer = viewerFor(item.extension || extensionOf(item.name));
  if (viewer !== 'unknown') parts.push(viewer);
  if (item.modified) {
    const when = new Date(item.modified);
    if (!Number.isNaN(when.getTime())) parts.push(`updated ${when.toLocaleDateString()}`);
  }
  return parts.join(' · ');
}

/**
 * The space's folder tree, loaded one level at a time.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It never asks for the whole tree. The content roots are directories of
 *    symlinked git repositories; an exhaustive walk is thousands of sequential
 *    directory listings. Children are fetched when a folder is expanded, which
 *    is exactly how a TreeDataProvider works anyway.
 *
 *  - It never opens a document. Rendering the tree is not a user action, and
 *    `getChildren` runs on every expand, collapse and refresh — opening a home
 *    file from here stole the editor each time the tree was touched.
 */
export class FileTreeProvider implements vscode.TreeDataProvider<FileTreeItem> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<FileTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Children by space-relative folder path; '' is the space root. */
  private cache = new Map<string, FileSystemItem[]>();
  private inFlight = new Map<string, Promise<FileSystemItem[]>>();
  private loadedSpaceId: number | undefined;

  constructor(private api: WikiApiClient) {}

  /** Redraw from what is already cached. */
  redraw(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Drop everything and re-fetch from the server. */
  reload(): void {
    this.cache.clear();
    this.inFlight.clear();
    this.loadedSpaceId = this.api.getCurrentSpace()?.id;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FileTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FileTreeItem): Promise<FileTreeItem[]> {
    if (!this.api.isAuthenticated()) return [];

    const space = this.api.getCurrentSpace();
    if (!space) return [];

    // Switching spaces invalidates every cached path.
    if (this.loadedSpaceId !== space.id) {
      this.cache.clear();
      this.inFlight.clear();
      this.loadedSpaceId = space.id;
    }

    // Root level.
    if (!element) {
      return this.list(space.id, '', space.name);
    }

    const node = element.itemData;

    // A path is what makes a folder reachable. If one is missing the request
    // would fall back to the space root and render the whole tree inside this
    // folder — so fail visibly instead.
    if (!node.path) {
      vscode.window.showErrorMessage(
        `"${node.name}" has no path, so its contents cannot be listed. Run NooblyJS Wiki: Show Log.`
      );
      return [];
    }

    // Already walked: the depth-2 root response carries this folder's children
    // with it, so expanding costs nothing. Only a TRUNCATED folder — one the
    // server stopped walking at — needs a request.
    if (!node.truncated && Array.isArray(node.children)) {
      return node.children.map((item) => new FileTreeItem(item));
    }

    return this.list(space.id, node.path, node.path);
  }

  private async list(
    spaceId: number, folderPath: string, label: string
  ): Promise<FileTreeItem[]> {
    try {
      const children = await this.loadFolder(spaceId, folderPath);
      return children.map((item) => new FileTreeItem(item));
    } catch (error) {
      vscode.window.showErrorMessage(`Could not list ${label}: ${describeError(error)}`);
      return [];
    }
  }

  /**
   * Children of one folder, cached, with concurrent requests for the same
   * folder sharing a single fetch — VS Code can ask more than once while a
   * request is still in flight.
   */
  private async loadFolder(spaceId: number, folderPath: string): Promise<FileSystemItem[]> {
    const cached = this.cache.get(folderPath);
    if (cached) return cached;

    const pending = this.inFlight.get(folderPath);
    if (pending) return pending;

    const request = this.api.getFolderTree(spaceId, folderPath)
      .then((items) => {
        this.cache.set(folderPath, items);
        this.inFlight.delete(folderPath);
        return items;
      })
      .catch((error) => {
        this.inFlight.delete(folderPath);
        throw error;
      });

    this.inFlight.set(folderPath, request);
    return request;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
