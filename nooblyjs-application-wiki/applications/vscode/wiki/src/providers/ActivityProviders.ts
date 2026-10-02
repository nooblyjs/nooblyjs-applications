import * as vscode from 'vscode';
import { WikiApiClient, ActivityEntry, extensionOf } from '../api/WikiApiClient';
import { OpenTarget } from './SearchProvider';

/**
 * One fetch of `/user/activity`, shared by the Recent and Starred views.
 *
 * Both views draw from the same endpoint, so giving each its own loader meant
 * two identical requests on every refresh and two chances to disagree about
 * what is starred.
 */
export class UserActivityStore {
  private recent: ActivityEntry[] = [];
  private starred: ActivityEntry[] = [];
  private loading: Promise<void> | undefined;
  private loadedOnce = false;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private api: WikiApiClient) {}

  getRecent(): ActivityEntry[] {
    return this.recent;
  }

  getStarred(): ActivityEntry[] {
    return this.starred;
  }

  hasLoaded(): boolean {
    return this.loadedOnce;
  }

  isStarred(filePath: string): boolean {
    const normalised = filePath.replace(/\\/g, '/');
    return this.starred.some((item) => item.path?.replace(/\\/g, '/') === normalised);
  }

  clear(): void {
    this.recent = [];
    this.starred = [];
    this.loadedOnce = false;
    this._onDidChange.fire();
  }

  /** Re-fetch, coalescing concurrent callers onto one request. */
  async refresh(): Promise<void> {
    if (!this.api.isAuthenticated()) {
      this.clear();
      return;
    }
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const activity = await this.api.getUserActivity();
        this.recent = activity.recent;
        this.starred = activity.starred;
        this.loadedOnce = true;
      } catch (error: any) {
        // A user with no activity file yet is the common case here, and it is
        // not an error worth a modal about.
        this.recent = [];
        this.starred = [];
        this.loadedOnce = true;
      } finally {
        this.loading = undefined;
        this._onDidChange.fire();
      }
    })();

    return this.loading;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

class ActivityItem extends vscode.TreeItem {
  constructor(entry: ActivityEntry, kind: 'recent' | 'starred') {
    super(entry.title || entry.path, vscode.TreeItemCollapsibleState.None);

    const folder = entry.path.includes('/')
      ? entry.path.slice(0, entry.path.lastIndexOf('/'))
      : '';

    this.description = folder;
    this.iconPath = new vscode.ThemeIcon(kind === 'recent' ? 'history' : 'star-full');
    this.contextValue = kind === 'recent' ? 'wikiRecentItem' : 'wikiStarredItem';

    const stamp = kind === 'recent' ? entry.lastVisited : entry.starredAt;
    const when = stamp ? new Date(stamp) : null;
    const whenText = when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : null;

    this.tooltip = new vscode.MarkdownString(
      [
        `\`${entry.path}\``,
        whenText ? `\n${kind === 'recent' ? 'Opened' : 'Starred'} ${whenText}` : ''
      ].join('\n')
    );

    // No spaceId: per-user artefacts belong to a PATH, not a space, so the
    // entry genuinely does not know which space it came from. The open command
    // resolves it against the current space, which is correct — every space
    // that can see this path is an equally valid way to open it.
    const target: OpenTarget = {
      name: entry.title || entry.path.split('/').pop() || entry.path,
      path: entry.path,
      type: 'file',
      extension: extensionOf(entry.path)
    };

    this.command = {
      command: 'nooblyjs-knowledge-repository.openFile',
      title: 'Open Document',
      arguments: [target]
    };
  }
}

class EmptyItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

type ActivityNode = ActivityItem | EmptyItem;

export class ActivityProvider implements vscode.TreeDataProvider<ActivityNode> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<ActivityNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly subscription: vscode.Disposable;

  constructor(
    private api: WikiApiClient,
    private store: UserActivityStore,
    private kind: 'recent' | 'starred'
  ) {
    this.subscription = this.store.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(element: ActivityNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ActivityNode): Promise<ActivityNode[]> {
    if (element) return [];
    if (!this.api.isAuthenticated()) return [];

    if (!this.store.hasLoaded()) {
      await this.store.refresh();
    }

    const entries = this.kind === 'recent' ? this.store.getRecent() : this.store.getStarred();

    if (entries.length === 0) {
      return [new EmptyItem(
        this.kind === 'recent'
          ? 'No documents opened yet'
          : 'No starred documents yet'
      )];
    }

    return entries.map((entry) => new ActivityItem(entry, this.kind));
  }

  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
