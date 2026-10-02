import * as vscode from 'vscode';
import { WikiApiClient, SearchResult, extensionOf } from '../api/WikiApiClient';
import { describeError } from '../api/errors';

/** What every "open a document" command accepts, from any view. */
export interface OpenTarget {
  name: string;
  path: string;
  type: 'file' | 'document';
  extension?: string;
  /**
   * The space the item came from. Carrying it matters: several spaces are
   * curated views of one content root, so opening a hit against whichever
   * space happens to be selected silently shows the same path through the
   * wrong lens — or fails outright across roots.
   */
  spaceId?: number;
  spaceName?: string;
}

/** Turn the server's match-centred snippet into something a tooltip can show. */
function plainSnippet(result: SearchResult): string {
  const raw = result.snippet || result.excerpt || '';
  return raw
    .replace(/<\/?mark>/gi, '**')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class SearchResultItem extends vscode.TreeItem {
  constructor(public readonly result: SearchResult) {
    super(result.title || result.path, vscode.TreeItemCollapsibleState.None);

    const folder = result.path.includes('/')
      ? result.path.slice(0, result.path.lastIndexOf('/'))
      : '';

    this.description = folder || result.spaceName || '';
    this.iconPath = new vscode.ThemeIcon('file');
    this.contextValue = 'wikiSearchResult';

    const snippet = plainSnippet(result);
    this.tooltip = new vscode.MarkdownString(
      [
        `**${result.spaceName || 'Wiki'}**`,
        '',
        `\`${result.path}\``,
        snippet ? `\n${snippet}` : ''
      ].join('\n')
    );

    const target: OpenTarget = {
      name: result.title || result.path.split('/').pop() || result.path,
      path: result.path,
      type: 'file',
      extension: extensionOf(result.path),
      spaceId: result.spaceId ?? undefined,
      spaceName: result.spaceName
    };

    this.command = {
      command: 'nooblyjs-knowledge-repository.openFile',
      title: 'Open Document',
      arguments: [target]
    };
  }
}

/** Shown in place of results, so the view is never a blank panel. */
class MessageItem extends vscode.TreeItem {
  constructor(label: string, icon: string, command?: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = command;
  }
}

type SearchNode = SearchResultItem | MessageItem;

export class SearchProvider implements vscode.TreeDataProvider<SearchNode> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<SearchNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private results: SearchResult[] = [];
  private query = '';
  private searching = false;
  /** Scope the next search to the current space, or search everything. */
  private scopeToSpace = true;

  constructor(private api: WikiApiClient) {}

  getScopeToSpace(): boolean {
    return this.scopeToSpace;
  }

  async setScopeToSpace(value: boolean): Promise<void> {
    this.scopeToSpace = value;
    await vscode.commands.executeCommand(
      'setContext', 'nooblyjs-knowledge-repository.searchAllSpaces', !value
    );
    if (this.query) await this.search(this.query);
    else this._onDidChangeTreeData.fire();
  }

  async search(query?: string): Promise<void> {
    if (!this.api.isAuthenticated()) {
      vscode.window.showWarningMessage('Set a NooblyJS Wiki API token to search.');
      return;
    }

    if (query === undefined) {
      query = await vscode.window.showInputBox({
        prompt: this.scopeToSpace
          ? `Search ${this.api.getCurrentSpace()?.name || 'the current space'}`
          : 'Search every space you can see',
        placeHolder: 'Search documents — "quote a phrase" for an exact match',
        value: this.query
      });
      if (query === undefined) return; // cancelled
    }

    this.query = query.trim();

    if (!this.query) {
      this.results = [];
      this._onDidChangeTreeData.fire();
      return;
    }

    this.searching = true;
    this._onDidChangeTreeData.fire();

    try {
      const space = this.api.getCurrentSpace();
      const spaceId = this.scopeToSpace ? space?.id : undefined;
      this.results = await this.api.search(this.query, spaceId);
    } catch (error) {
      this.results = [];
      vscode.window.showErrorMessage(`Search failed: ${describeError(error)}`);
    } finally {
      this.searching = false;
      this._onDidChangeTreeData.fire();
    }
  }

  clear(): void {
    this.results = [];
    this.query = '';
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SearchNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SearchNode): Promise<SearchNode[]> {
    if (element) return [];
    if (!this.api.isAuthenticated()) return [];

    if (this.searching) {
      return [new MessageItem(`Searching for "${this.query}"…`, 'loading~spin')];
    }

    if (!this.query) {
      return [new MessageItem('Search the wiki…', 'search', {
        command: 'nooblyjs-knowledge-repository.search',
        title: 'Search'
      })];
    }

    if (this.results.length === 0) {
      const scope = this.scopeToSpace
        ? this.api.getCurrentSpace()?.name || 'this space'
        : 'any space';
      return [new MessageItem(`No results for "${this.query}" in ${scope}`, 'info')];
    }

    return this.results.map((result) => new SearchResultItem(result));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
