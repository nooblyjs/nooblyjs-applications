import * as vscode from 'vscode';
import { WikiApiClient, Space, extensionOf, viewerFor } from './api/WikiApiClient';
import { DocumentViewer } from './webviews/DocumentViewer';
import { FileTreeProvider } from './providers/FileTreeProvider';
import { SearchProvider, OpenTarget } from './providers/SearchProvider';
import { ActivityProvider, UserActivityStore } from './providers/ActivityProviders';
import { WikiTextDocumentProvider, WIKI_TEXT_SCHEME } from './providers/TextDocumentProvider';
import { describeError } from './api/errors';

/**
 * Normalise whatever a view handed us into a single open target.
 *
 * The tree passes a FileSystemItem, search passes an OpenTarget carrying its
 * own spaceId, and a context-menu action passes the TreeItem itself. Rather
 * than each command guessing, everything funnels through here.
 */
function toOpenTarget(input: any): OpenTarget | undefined {
  if (!input) return undefined;

  const raw = input.itemData ?? input.result ?? input;
  if (!raw || typeof raw.path !== 'string') return undefined;

  const name = raw.name || raw.title || raw.path.split('/').pop() || raw.path;

  return {
    name,
    path: raw.path,
    type: raw.type === 'folder' ? 'file' : (raw.type || 'file'),
    extension: raw.extension || extensionOf(raw.path),
    spaceId: typeof raw.spaceId === 'number' ? raw.spaceId : undefined,
    spaceName: raw.spaceName
  };
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('NooblyJS Wiki');
  context.subscriptions.push(output);
  output.appendLine('NooblyJS Wiki extension activated.');

  const api = new WikiApiClient(context, output);
  context.subscriptions.push({ dispose: () => api.dispose() });

  const activityStore = new UserActivityStore(api);
  context.subscriptions.push({ dispose: () => activityStore.dispose() });

  const documentViewer = new DocumentViewer(context, api, activityStore);
  context.subscriptions.push({ dispose: () => documentViewer.dispose() });

  const fileTreeProvider = new FileTreeProvider(api);
  const searchProvider = new SearchProvider(api);
  const recentProvider = new ActivityProvider(api, activityStore, 'recent');
  const starredProvider = new ActivityProvider(api, activityStore, 'starred');

  context.subscriptions.push(
    { dispose: () => fileTreeProvider.dispose() },
    { dispose: () => searchProvider.dispose() },
    { dispose: () => recentProvider.dispose() },
    { dispose: () => starredProvider.dispose() }
  );

  const textProvider = new WikiTextDocumentProvider(api);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(WIKI_TEXT_SCHEME, textProvider),
    { dispose: () => textProvider.dispose() }
  );

  const explorerView = vscode.window.createTreeView('nooblyjs-knowledge-repository.explorer', {
    treeDataProvider: fileTreeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(
    explorerView,
    vscode.window.registerTreeDataProvider('nooblyjs-knowledge-repository.recent', recentProvider),
    vscode.window.registerTreeDataProvider('nooblyjs-knowledge-repository.starred', starredProvider),
    vscode.window.registerTreeDataProvider('nooblyjs-knowledge-repository.search', searchProvider)
  );

  // ── Status bar ────────────────────────────────────────────────────────────

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'nooblyjs-knowledge-repository.selectSpace';
  context.subscriptions.push(statusBarItem);

  function updateStatusBar(): void {
    if (!api.isAuthenticated()) {
      statusBarItem.hide();
      return;
    }
    const space = api.getCurrentSpace();
    if (space) {
      statusBarItem.text = `$(book) ${space.name}`;
      statusBarItem.tooltip = `NooblyJS Wiki — ${space.name}\nClick to switch space`;
    } else {
      statusBarItem.text = '$(book) Select a space';
      statusBarItem.tooltip = 'Click to choose a NooblyJS Wiki space';
    }
    statusBarItem.show();
  }

  function updateExplorerTitle(): void {
    const space = api.getCurrentSpace();
    explorerView.description = api.isAuthenticated() ? space?.name : undefined;
  }

  // Reacting to events rather than monkey-patching the client's methods, which
  // is what the previous version did to keep the status bar in step.
  context.subscriptions.push(
    api.onDidChangeAuth((authenticated) => {
      updateStatusBar();
      updateExplorerTitle();
      if (authenticated) {
        fileTreeProvider.reload();
        void activityStore.refresh();
      } else {
        fileTreeProvider.reload();
        activityStore.clear();
        searchProvider.clear();
      }
    }),
    api.onDidChangeSpace(() => {
      updateStatusBar();
      updateExplorerTitle();
      fileTreeProvider.reload();
    }),
    // Both settings are live: correcting a URL or pasting a new token takes
    // effect immediately rather than after a window reload.
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      const urlChanged = event.affectsConfiguration('nooblyjs-knowledge-repository.serverUrl');
      const tokenChanged = event.affectsConfiguration('nooblyjs-knowledge-repository.apiToken');
      if (!urlChanged && !tokenChanged) return;

      api.applyConfiguration();
      await vscode.commands.executeCommand(
        'setContext', 'nooblyjs-knowledge-repository.hasToken', api.hasToken()
      );
      if (urlChanged) output.appendLine(`Server URL is now ${api.getBaseUrl()}.`);
      if (tokenChanged) output.appendLine('API token changed; re-checking.');

      // A different server means a space picked from the old one is meaningless.
      if (urlChanged) await api.setCurrentSpace(undefined);

      const check = await api.validateToken();
      if (check.ok) {
        await autoSelectSpace();
        fileTreeProvider.reload();
        void activityStore.refresh();
      }
    })
  );

  // ── Space selection ───────────────────────────────────────────────────────

  async function pickSpace(): Promise<void> {
    if (!api.isAuthenticated()) {
      vscode.window.showWarningMessage('Set a NooblyJS Wiki API token first.');
      return;
    }

    try {
      const spaces = await vscode.window.withProgress(
        { location: { viewId: 'nooblyjs-knowledge-repository.explorer' } },
        () => api.getSpaces()
      );

      if (spaces.length === 0) {
        vscode.window.showInformationMessage('You do not have access to any spaces yet.');
        return;
      }

      const current = api.getCurrentSpace();
      const items = spaces.map((space) => ({
        label: space.id === current?.id ? `$(check) ${space.name}` : space.name,
        description: space.description || '',
        detail: [space.type, space.visibility].filter(Boolean).join(' · '),
        space
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a space',
        matchOnDescription: true
      });

      if (selected) {
        await api.setCurrentSpace(selected.space);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Could not load spaces: ${describeError(error)}`);
    }
  }

  /**
   * Pick a space automatically when there is only one sensible answer, so a
   * first run does not open on an empty tree with no explanation.
   */
  async function autoSelectSpace(): Promise<void> {
    if (api.getCurrentSpace()) return;
    try {
      const spaces = await api.getSpaces();
      if (spaces.length === 1) {
        await api.setCurrentSpace(spaces[0]);
      }
    } catch {
      // Not worth surfacing — the user can pick a space by hand.
    }
  }

  // ── Opening documents ─────────────────────────────────────────────────────

  async function openTarget(input: any): Promise<void> {
    const target = toOpenTarget(input);
    if (!target) {
      vscode.window.showErrorMessage('Nothing to open.');
      return;
    }

    const viewer = viewerFor(target.extension || extensionOf(target.path));

    // Code and plain text belong in the editor, not a webview: real syntax
    // highlighting from the user's theme, native find, folding and diff, and
    // no bundled highlighter to keep up to date.
    if (viewer === 'code' || viewer === 'text') {
      const space = await resolveSpaceFor(target);
      if (!space) return;

      try {
        const uri = WikiTextDocumentProvider.uriFor(space.id, target.path);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
        void api.recordVisit(target.path, space.name, target.name);
        void activityStore.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Could not open ${target.name}: ${describeError(error)}`);
      }
      return;
    }

    await documentViewer.open(target);
  }

  async function resolveSpaceFor(target: OpenTarget): Promise<Space | undefined> {
    const current = api.getCurrentSpace();
    if (target.spaceId === undefined || target.spaceId === current?.id) {
      if (!current) vscode.window.showWarningMessage('Select a space first.');
      return current;
    }
    try {
      const spaces = await api.getSpaces();
      return spaces.find((s) => s.id === target.spaceId) || current;
    } catch {
      return current;
    }
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  const command = (name: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));

  /**
   * Report the result of a token check in the terms of whatever actually went
   * wrong. An empty tree looks identical for all three failures, and each one
   * needs a different fix, so never collapse them into "could not connect".
   */
  async function reportTokenCheck(check: Awaited<ReturnType<typeof api.validateToken>>): Promise<void> {
    if (check.ok) {
      const who = check.user?.email ? ` as ${check.user.email}` : '';
      vscode.window.showInformationMessage(
        `Connected to ${api.getBaseUrl()}${who}.`
      );
      return;
    }

    if (check.reason === 'no-token') {
      const choice = await vscode.window.showWarningMessage(
        'No API token set. Create one in the wiki under Profile → API tokens, then paste it into settings.',
        'Enter token',
        'Open settings'
      );
      if (choice === 'Enter token') {
        await vscode.commands.executeCommand('nooblyjs-knowledge-repository.setToken');
      } else if (choice === 'Open settings') {
        await vscode.commands.executeCommand('nooblyjs-knowledge-repository.openSettings');
      }
      return;
    }

    if (check.reason === 'rejected') {
      const choice = await vscode.window.showErrorMessage(
        `${api.getBaseUrl()} rejected your API token. It may be mistyped, expired, or revoked.`,
        'Enter token'
      );
      if (choice === 'Enter token') {
        await vscode.commands.executeCommand('nooblyjs-knowledge-repository.setToken');
      }
      return;
    }

    const choice = await vscode.window.showErrorMessage(
      `Could not reach ${api.getBaseUrl()}. Check the server URL. (${check.detail || 'no response'})`,
      'Open settings',
      'Show log'
    );
    if (choice === 'Open settings') {
      await vscode.commands.executeCommand('nooblyjs-knowledge-repository.openSettings');
    } else if (choice === 'Show log') {
      output.show();
    }
  }

  command('nooblyjs-knowledge-repository.openSettings', () =>
    vscode.commands.executeCommand(
      'workbench.action.openSettings', 'nooblyjs-knowledge-repository'
    )
  );

  /**
   * Paste a token without hunting through the settings UI.
   *
   * `password: true` keeps it out of screen shares and shoulder-surfing while
   * it is being typed — it still lands in settings.json in plain text, which is
   * what the setting's own description says.
   */
  command('nooblyjs-knowledge-repository.setToken', async () => {
    const token = await vscode.window.showInputBox({
      title: 'NooblyJS Wiki API token',
      prompt: 'Create one in the wiki under Profile → API tokens. It is shown once.',
      placeHolder: 'dtk_…',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return 'Paste your API token, or press Escape to cancel.';
        if (!trimmed.startsWith('dtk_')) {
          return 'A NooblyJS Wiki API token starts with "dtk_".';
        }
        return undefined;
      }
    });

    if (token === undefined) return;

    await vscode.workspace.getConfiguration('nooblyjs-knowledge-repository')
      .update('apiToken', token.trim(), vscode.ConfigurationTarget.Global);

    // The configuration listener re-reads and re-validates, so just report.
    const check = await api.validateToken();
    await reportTokenCheck(check);
    if (check.ok) {
      await autoSelectSpace();
      fileTreeProvider.reload();
      void activityStore.refresh();
    }
  });

  command('nooblyjs-knowledge-repository.testConnection', async () => {
    api.applyConfiguration();
    const check = await api.validateToken();
    await reportTokenCheck(check);
  });

  command('nooblyjs-knowledge-repository.selectSpace', pickSpace);

  command('nooblyjs-knowledge-repository.refresh', async () => {
    if (!api.isAuthenticated()) return;
    // Actually re-fetch. The previous version only fired the tree-change event,
    // which redraws from cache — so Refresh reported success and changed nothing.
    fileTreeProvider.reload();
    await activityStore.refresh();
  });

  command('nooblyjs-knowledge-repository.openFile', openTarget);

  command('nooblyjs-knowledge-repository.search', () => searchProvider.search());

  command('nooblyjs-knowledge-repository.clearSearch', () => searchProvider.clear());

  command('nooblyjs-knowledge-repository.searchAllSpaces', () => searchProvider.setScopeToSpace(false));

  command('nooblyjs-knowledge-repository.searchThisSpace', () => searchProvider.setScopeToSpace(true));

  command('nooblyjs-knowledge-repository.openInBrowser', async (item: any) => {
    const target = toOpenTarget(item);
    if (!target) return;
    const space = await resolveSpaceFor(target);
    if (!space) return;
    await vscode.env.openExternal(vscode.Uri.parse(api.webUrlFor(space, target.path)));
  });

  command('nooblyjs-knowledge-repository.copyPath', async (item: any) => {
    const target = toOpenTarget(item);
    if (!target) return;
    await vscode.env.clipboard.writeText(target.path);
    vscode.window.showInformationMessage('Document path copied.');
  });

  command('nooblyjs-knowledge-repository.copyLink', async (item: any) => {
    const target = toOpenTarget(item);
    if (!target) return;
    const space = await resolveSpaceFor(target);
    if (!space) return;
    await vscode.env.clipboard.writeText(api.webUrlFor(space, target.path));
    vscode.window.showInformationMessage('Document link copied.');
  });

  command('nooblyjs-knowledge-repository.toggleStar', async (item: any) => {
    const target = toOpenTarget(item);
    if (!target) return;
    const space = await resolveSpaceFor(target);
    if (!space) return;

    try {
      if (!activityStore.hasLoaded()) await activityStore.refresh();
      const starred = activityStore.isStarred(target.path);
      await api.toggleStar(target.path, space.name, target.name, starred ? 'unstar' : 'star');
      await activityStore.refresh();
      vscode.window.showInformationMessage(
        starred ? `Removed ${target.name} from starred.` : `Starred ${target.name}.`
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Could not update star: ${describeError(error)}`);
    }
  });

  command('nooblyjs-knowledge-repository.showOutput', () => output.show());

  // ── Startup ───────────────────────────────────────────────────────────────

  void (async () => {
    await api.clearObsoleteCredentials();

    await vscode.commands.executeCommand(
      'setContext', 'nooblyjs-knowledge-repository.searchAllSpaces', false
    );
    // Drives the welcome view: "paste a token" vs "check your token".
    await vscode.commands.executeCommand(
      'setContext', 'nooblyjs-knowledge-repository.hasToken', api.hasToken()
    );

    const check = await api.validateToken();
    updateStatusBar();
    updateExplorerTitle();

    if (check.ok) {
      await autoSelectSpace();
      fileTreeProvider.reload();
      void activityStore.refresh();
      return;
    }

    // Startup is not the moment for a modal. The welcome view already says what
    // to do, and Test Connection gives the detail on demand — except for an
    // unreachable server, which the view cannot distinguish from a bad token.
    switch (check.reason) {
      case 'no-token':
        output.appendLine('No API token configured — set one to start browsing.');
        break;
      case 'rejected':
        output.appendLine(`Token rejected by ${api.getBaseUrl()}.`);
        break;
      default:
        output.appendLine(`Could not reach ${api.getBaseUrl()}: ${check.detail}`);
        break;
    }
  })();
}

export function deactivate() {
  // Everything is registered through context.subscriptions.
}
