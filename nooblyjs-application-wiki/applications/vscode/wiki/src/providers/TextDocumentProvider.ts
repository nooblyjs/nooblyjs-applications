import * as vscode from 'vscode';
import { WikiApiClient } from '../api/WikiApiClient';
import { describeError } from '../api/errors';

export const WIKI_TEXT_SCHEME = 'wikidoc';

/**
 * Serves code and plain-text documents into VS Code's own editor.
 *
 * These used to render in a webview with highlight.js pulled from a CDN at view
 * time — which fails closed behind a corporate proxy, and reimplements badly
 * what the editor already does well. A virtual read-only document instead gets
 * real syntax highlighting from the user's theme, native find, folding,
 * go-to-line, and the ability to diff or copy out of it.
 *
 * The URI keeps the document's real extension, which is what lets VS Code pick
 * the language mode without this provider knowing anything about languages:
 *
 *   wikidoc://<spaceId>/<space-relative path>
 */
export class WikiTextDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private api: WikiApiClient) {}

  static uriFor(spaceId: number, filePath: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: WIKI_TEXT_SCHEME,
      authority: String(spaceId),
      path: '/' + filePath.replace(/^\/+/, '')
    });
  }

  static parse(uri: vscode.Uri): { spaceId: number; filePath: string } {
    return {
      spaceId: Number(uri.authority),
      filePath: uri.path.replace(/^\/+/, '')
    };
  }

  /** Force a re-fetch of an already open virtual document. */
  refresh(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { spaceId, filePath } = WikiTextDocumentProvider.parse(uri);

    if (!Number.isFinite(spaceId)) {
      return `Could not work out which space "${filePath}" belongs to.`;
    }

    try {
      const payload = await this.api.getDocument(spaceId, filePath);
      return payload.content;
    } catch (error) {
      // Returned as content rather than thrown: an editor showing the reason is
      // more useful than an error toast over an empty tab.
      return [
        `Could not load ${filePath}`,
        '',
        describeError(error)
      ].join('\n');
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
