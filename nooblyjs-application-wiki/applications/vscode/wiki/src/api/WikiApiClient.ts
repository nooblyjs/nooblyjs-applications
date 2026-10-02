import * as vscode from 'vscode';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { rehydratePaths } from './treePaths';
import { describeError } from './errors';

export interface Space {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  visibility?: string;
  type?: string;
  permissions?: string;
}

/**
 * A node in the wiki folder tree.
 *
 * `truncated: true` means NOT LISTED YET — the server stopped walking here and
 * the children arrive on a separate request for this path. It never means the
 * folder is empty, and treating it that way silently hides whole subtrees.
 */
export interface FileSystemItem {
  name: string;
  path: string;
  type: 'file' | 'folder' | 'document';
  extension?: string;
  size?: number;
  modified?: string;
  children?: FileSystemItem[];
  truncated?: boolean;
}

export interface DocumentPayload {
  /** Decoded text, for anything the extension renders as text. */
  content: string;
  /** Base64 bytes, for images and PDFs. */
  base64?: string;
  viewer: ViewerType;
  extension: string;
  fileName: string;
}

export interface SearchResult {
  id?: string;
  title: string;
  path: string;
  spaceName?: string;
  /** Resolved by the server so a hit opens in the space it came from. */
  spaceId?: number | null;
  excerpt?: string;
  /** Match-centred context with the term wrapped in <mark>. */
  snippet?: string;
  type?: string;
}

export interface ActivityEntry {
  path: string;
  title: string;
  /**
   * Not sent by the server any more: per-user artefacts belong to a PATH, not
   * a space, so nothing stamps a space name on them. Kept optional only so a
   * legacy record still parses.
   */
  spaceName?: string;
  lastVisited?: string;
  starredAt?: string;
}

export interface UserActivity {
  recent: ActivityEntry[];
  starred: ActivityEntry[];
}

/**
 * The outcome of checking the configured token.
 *
 * The reason is the useful part: an empty tree looks the same whether no token
 * was pasted, the server rejected it, or the server is unreachable — and the
 * three need different fixes.
 */
export interface TokenCheck {
  ok: boolean;
  reason?: 'no-token' | 'rejected' | 'unreachable';
  detail?: string;
  user?: { email?: string; name?: string; roles?: string[] };
}

export type ViewerType =
  | 'markdown' | 'code' | 'text' | 'image' | 'pdf' | 'video' | 'audio' | 'office' | 'unknown';

/**
 * Keys an earlier version of this extension wrote a session token to, before
 * access moved to a user-supplied API token in settings. Cleared on activation
 * so a stale credential is not left behind in the OS keychain.
 */
export const OBSOLETE_SECRET_KEY = 'nooblyjs-knowledge-repository.authToken';
export const OBSOLETE_STATE_KEY = 'authToken';

/** Beyond this the webview is more likely to hang than to render. */
export const MAX_BINARY_BYTES = 40 * 1024 * 1024;

const VIEWER_BY_EXTENSION: { [key: string]: ViewerType } = {
  md: 'markdown', markdown: 'markdown',
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', mjs: 'code', cjs: 'code',
  py: 'code', java: 'code', c: 'code', h: 'code', cpp: 'code', cs: 'code',
  css: 'code', scss: 'code', html: 'code', json: 'code', xml: 'code',
  yaml: 'code', yml: 'code', sh: 'code', bash: 'code', ps1: 'code', sql: 'code',
  go: 'code', rs: 'code', rb: 'code', php: 'code', swift: 'code', kt: 'code',
  txt: 'text', log: 'text', csv: 'text', ini: 'text', cfg: 'text', env: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
  svg: 'image', webp: 'image', bmp: 'image', ico: 'image',
  pdf: 'pdf',
  docx: 'office', doc: 'office', xlsx: 'office', xls: 'office',
  pptx: 'office', ppt: 'office',
  mp4: 'video', webm: 'video', mkv: 'video', avi: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', aac: 'audio'
};

export function extensionOf(nameOrPath: string): string {
  const base = nameOrPath.split('/').pop() || nameOrPath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function viewerFor(extension: string): ViewerType {
  return VIEWER_BY_EXTENSION[extension.toLowerCase()] || 'unknown';
}

export class WikiApiClient {
  private axios: AxiosInstance;
  private baseUrl!: string;
  private apiBase!: string;
  private filingBase!: string;
  private token: string | undefined;
  private authenticated = false;

  private readonly _onDidChangeAuth = new vscode.EventEmitter<boolean>();
  /** Fires whenever the configured token starts or stops being accepted. */
  readonly onDidChangeAuth = this._onDidChangeAuth.event;

  private readonly _onDidChangeSpace = new vscode.EventEmitter<Space | undefined>();
  readonly onDidChangeSpace = this._onDidChangeSpace.event;

  constructor(private context: vscode.ExtensionContext, private output: vscode.OutputChannel) {
    this.applyConfiguration();

    this.axios = axios.create({
      // The token is the credential; cookies are never part of this flow, and
      // sending them risks a browser session being adopted server-side.
      withCredentials: false,
      timeout: 60000,
      headers: { 'Content-Type': 'application/json' }
    });

    this.axios.interceptors.request.use((config) => {
      if (this.token) {
        config.headers['Authorization'] = `Bearer ${this.token}`;
      }
      return config;
    });

    this.axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error.response?.status;
        const url = this.redact(error.config?.url);
        this.log(`Request failed: ${status ?? 'no response'} ${url}`);
        // A revoked or expired token should read as "your token was rejected",
        // not as an unexplained failure on every subsequent action.
        if (status === 401 || status === 403) {
          void this.markTokenRejected();
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Re-read both settings. Called at construction and whenever either changes,
   * so a corrected URL or a freshly pasted token takes effect immediately
   * rather than after a window reload.
   */
  applyConfiguration(): void {
    const config = vscode.workspace.getConfiguration('nooblyjs-knowledge-repository');

    const configured = (config.get<string>('serverUrl') || 'https://localhost:9101').trim();
    this.baseUrl = configured.replace(/\/+$/, '');
    this.apiBase = `${this.baseUrl}/applications/wiki/api`;
    this.filingBase = `${this.baseUrl}/services/filing/api`;

    // Tolerate a pasted value that arrived with whitespace or quotes around it,
    // which is the most common way this setting is got wrong.
    const rawToken = (config.get<string>('apiToken') || '').trim();
    this.token = rawToken.replace(/^["']|["']$/g, '') || undefined;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  hasToken(): boolean {
    return Boolean(this.token);
  }

  /**
   * Drop any credential written by the previous, session-based version of this
   * extension. One-time housekeeping — leaving a live token in the OS keychain
   * that nothing reads is worse than useless.
   */
  async clearObsoleteCredentials(): Promise<void> {
    try {
      if (await this.context.secrets.get(OBSOLETE_SECRET_KEY)) {
        await this.context.secrets.delete(OBSOLETE_SECRET_KEY);
        this.log('Removed a session token stored by an earlier version.');
      }
    } catch {
      // SecretStorage is unavailable on some hosts; nothing to clean up there.
    }
    if (this.context.globalState.get(OBSOLETE_STATE_KEY) !== undefined) {
      await this.context.globalState.update(OBSOLETE_STATE_KEY, undefined);
    }
    if (this.context.globalState.get('isAuthenticated') !== undefined) {
      await this.context.globalState.update('isAuthenticated', undefined);
    }
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  /** Never let a token reach the log, even inside a URL. */
  private redact(url?: string): string {
    if (!url) return '(unknown url)';
    return url.replace(/([?&]token=)[^&]+/gi, '$1<redacted>');
  }

  // ── Token-based access ────────────────────────────────────────────────────

  /**
   * Check that the configured token is accepted by the configured server.
   *
   * There is no sign-in flow: the user creates a personal API token in the wiki
   * (Profile -> API tokens) and pastes it into settings. The token acts as its
   * owner with their real roles, so the extension sees exactly the spaces that
   * person can see, and revoking it in the wiki takes effect on the very next
   * request.
   *
   * The failure REASON matters more than the boolean — "you have not pasted a
   * token", "the server rejected it" and "the server is unreachable" all look
   * identical from an empty tree, and each needs a different fix.
   */
  async validateToken(): Promise<TokenCheck> {
    if (!this.token) {
      await this.setAuthenticated(false);
      return { ok: false, reason: 'no-token' };
    }

    try {
      const response = await this.axios.get(`${this.baseUrl}/api/auth/check`);
      const authenticated = response.data?.authenticated === true;

      if (!authenticated) {
        await this.setAuthenticated(false);
        return { ok: false, reason: 'rejected' };
      }

      const user = response.data.user || {};
      await this.context.globalState.update('userEmail', user.email);
      await this.setAuthenticated(true);
      this.log(`Token accepted for ${user.email || 'unknown user'}.`);
      return { ok: true, user };
    } catch (error: any) {
      const status = error.response?.status;
      await this.setAuthenticated(false);

      if (status === 401 || status === 403) {
        this.log('Token rejected by the server.');
        return { ok: false, reason: 'rejected' };
      }

      this.log(`Could not reach ${this.baseUrl}: ${error.message}`);
      return { ok: false, reason: 'unreachable', detail: describeError(error, 'no response') };
    }
  }

  /**
   * Fired when a request comes back 401/403 mid-session — a token revoked in
   * the wiki, or one that has expired. Prompts once rather than on every
   * subsequent failing request.
   */
  private async markTokenRejected(): Promise<void> {
    if (!this.authenticated) return;
    await this.setAuthenticated(false);

    void vscode.window.showWarningMessage(
      'Your NooblyJS Wiki API token was rejected. It may have been revoked or expired.',
      'Open settings'
    ).then((choice) => {
      if (choice === 'Open settings') {
        void vscode.commands.executeCommand('nooblyjs-knowledge-repository.openSettings');
      }
    });
  }

  private async setAuthenticated(value: boolean): Promise<void> {
    this.authenticated = value;
    await vscode.commands.executeCommand(
      'setContext', 'nooblyjs-knowledge-repository.authenticated', value
    );
    this._onDidChangeAuth.fire(value);
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  getUserEmail(): string | undefined {
    return this.context.globalState.get<string>('userEmail');
  }

  // ── Spaces ────────────────────────────────────────────────────────────────

  async getSpaces(): Promise<Space[]> {
    const response: AxiosResponse<Space[]> = await this.axios.get(`${this.apiBase}/spaces`);
    return Array.isArray(response.data) ? response.data : [];
  }

  getCurrentSpace(): Space | undefined {
    return this.context.globalState.get<Space>('currentSpace');
  }

  async setCurrentSpace(space: Space | undefined): Promise<void> {
    await this.context.globalState.update('currentSpace', space);
    this._onDidChangeSpace.fire(space);
  }

  // ── Folder tree ───────────────────────────────────────────────────────────

  /**
   * List one level of a space's folder tree.
   *
   * Deliberately the LAZY route. The content roots are directories of symlinked
   * git repositories, so an exhaustive walk costs thousands of sequential
   * directory listings — the older `/spaces/:id/folders` endpoint does exactly
   * that and was measured in seconds. A TreeDataProvider only ever renders one
   * level at a time, so it fits the lazy contract naturally.
   *
   * @param spaceId - space to list
   * @param folderPath - space-relative folder, '' for the space root
   */
  async getFolderTree(spaceId: number, folderPath = ''): Promise<FileSystemItem[]> {
    const response = await this.axios.get(
      `${this.apiBase}/spaces/${spaceId}/folder-tree`,
      { params: folderPath ? { path: folderPath } : {} }
    );

    const tree = response.data?.tree;
    if (!Array.isArray(tree)) return [];

    // The response is DELIBERATELY lean — see leanTree() in filingRoutes.js.
    // `path` is over 40% of the payload and is implied by the nesting, so the
    // server strips it and every client rebuilds it. Skipping this step does
    // not fail loudly: every node ends up with `path: undefined`, each folder
    // then asks for the subtree at "no path", and the server answers with the
    // ROOT — so the tree renders the same folders inside themselves forever.
    // Every node has a `path` once rehydrated — that is the function's whole
    // job — which is why FileSystemItem can require it.
    return rehydratePaths(tree, folderPath) as FileSystemItem[];
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  /**
   * The filing service's direct download URL for a space file. Used only from
   * the extension host, which sends the token as a header — the `?token=`
   * query form the backend also accepts is avoided so credentials stay out of
   * URLs, logs and webview markup.
   */
  private downloadUrl(spaceId: number, filePath: string): string {
    const encoded = filePath.split('/').map(encodeURIComponent).join('/');
    return `${this.filingBase}/space-${spaceId}/download/${encoded}`;
  }

  /** Open a document in the browser-based wiki, at the same path. */
  webUrlFor(space: Space, filePath: string): string {
    const params = new URLSearchParams({ space: space.name, path: filePath });
    return `${this.baseUrl}/applications/wiki/?${params.toString()}`;
  }

  /**
   * Fetch a document for display.
   *
   * Text arrives decoded; images and PDFs arrive as base64 and are handed to
   * the webview over postMessage rather than inlined into its HTML, so a large
   * file does not become a multi-megabyte markup string.
   */
  async getDocument(spaceId: number, filePath: string): Promise<DocumentPayload> {
    const extension = extensionOf(filePath);
    const viewer = viewerFor(extension);
    const fileName = filePath.split('/').pop() || filePath;
    const url = this.downloadUrl(spaceId, filePath);

    if (viewer === 'image' || viewer === 'pdf') {
      const response = await this.axios.get(url, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      if (buffer.byteLength > MAX_BINARY_BYTES) {
        throw new Error(
          `${fileName} is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB — too large to preview here. Open it in the browser instead.`
        );
      }
      return { content: '', base64: buffer.toString('base64'), viewer, extension, fileName };
    }

    const response = await this.axios.get(url);
    let content: string;
    const contentType = String(response.headers['content-type'] || '');

    if (contentType.includes('application/json') && response.data?.data !== undefined) {
      // The filing service wraps text files as { data, encoding }.
      content = String(response.data.data);
    } else if (typeof response.data === 'string') {
      content = response.data;
    } else {
      content = JSON.stringify(response.data, null, 2);
    }

    return { content, viewer, extension, fileName };
  }

  /**
   * The markdown the platform derived from an office document, if it exists.
   *
   * A `.docx` is converted on ingest into a visible sibling `<name>.md`, so the
   * readable version of `Report.docx` is `Report.md` next to it. Returns null
   * when there is no converted copy, which is the signal to offer a download
   * rather than render bytes the extension cannot display.
   */
  async getOfficeMarkdown(spaceId: number, filePath: string): Promise<string | null> {
    const candidate = filePath.replace(/\.[^./]+$/, '.md');
    if (candidate === filePath) return null;

    try {
      const response = await this.axios.get(this.downloadUrl(spaceId, candidate));
      const data = response.data;
      if (data && typeof data === 'object' && data.data !== undefined) return String(data.data);
      return typeof data === 'string' ? data : null;
    } catch {
      return null;
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async search(query: string, spaceId?: number): Promise<SearchResult[]> {
    const params: Record<string, string | number | boolean> = {
      q: query,
      includeContent: false
    };
    if (spaceId !== undefined && spaceId !== null) {
      params.spaceId = spaceId;
    }

    const response: AxiosResponse<SearchResult[]> = await this.axios.get(
      `${this.apiBase}/search`, { params }
    );
    return Array.isArray(response.data) ? response.data : [];
  }

  // ── Per-user activity ─────────────────────────────────────────────────────

  async getUserActivity(): Promise<UserActivity> {
    const response: AxiosResponse<UserActivity> = await this.axios.get(
      `${this.apiBase}/user/activity`
    );
    return {
      recent: response.data?.recent ?? [],
      starred: response.data?.starred ?? []
    };
  }

  /**
   * Whether a path is starred, read from the server rather than guessed.
   *
   * Records are keyed by path alone — a starred document belongs to the path,
   * not to the space it happened to be starred from.
   */
  async isStarred(filePath: string): Promise<boolean> {
    try {
      const activity = await this.getUserActivity();
      const normalised = filePath.replace(/\\/g, '/');
      return activity.starred.some((item) => item.path?.replace(/\\/g, '/') === normalised);
    } catch {
      return false;
    }
  }

  async toggleStar(
    filePath: string, spaceName: string, title: string, action: 'star' | 'unstar'
  ): Promise<void> {
    await this.axios.post(`${this.apiBase}/user/star`, {
      path: filePath, spaceName, title, action
    });
  }

  async recordVisit(filePath: string, spaceName: string, title: string): Promise<void> {
    try {
      await this.axios.post(`${this.apiBase}/user/visit`, {
        path: filePath, spaceName, title, action: 'viewed'
      });
    } catch (error: any) {
      // Visit tracking is never worth failing a document open over.
      this.log(`Could not record visit for ${filePath}: ${error.message}`);
    }
  }

  dispose(): void {
    this._onDidChangeAuth.dispose();
    this._onDidChangeSpace.dispose();
  }
}
