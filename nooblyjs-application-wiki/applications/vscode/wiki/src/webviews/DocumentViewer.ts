import * as vscode from 'vscode';
import { WikiApiClient, Space, DocumentPayload } from '../api/WikiApiClient';
import { UserActivityStore } from '../providers/ActivityProviders';
import { OpenTarget } from '../providers/SearchProvider';
import { describeError } from '../api/errors';

/** Escape for interpolation into HTML text or an attribute value. */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

interface OpenPanel {
  panel: vscode.WebviewPanel;
  space: Space;
  target: OpenTarget;
}

/**
 * Renders wiki documents in webview panels.
 *
 * Everything the webview loads is vendored under media/ — there is no runtime
 * CDN, both because a corporate host may not reach one and because a strict
 * CSP is only meaningful if nothing needs an exception. Markdown goes through
 * the wiki's OWN parser (media/vendor/markdown-parser.js, refreshed by
 * `npm run sync`), so custom blocks — landing bands, panes, linked documents,
 * annotations — render as they do in the browser instead of as raw fences.
 */
export class DocumentViewer {
  private panels = new Map<string, OpenPanel>();

  constructor(
    private context: vscode.ExtensionContext,
    private api: WikiApiClient,
    private activity: UserActivityStore
  ) {}

  private keyFor(space: Space, path: string): string {
    return `${space.id}:${path}`;
  }

  /**
   * Resolve which space a target belongs to.
   *
   * A search hit carries its own `spaceId`, and honouring it is what stops a
   * result opening through whichever space happens to be selected — several
   * spaces are curated views of one content root, so the wrong one shows the
   * same path under different rules rather than failing visibly.
   */
  private async resolveSpace(target: OpenTarget): Promise<Space | undefined> {
    const current = this.api.getCurrentSpace();
    if (target.spaceId === undefined || target.spaceId === current?.id) {
      return current;
    }

    try {
      const spaces = await this.api.getSpaces();
      return spaces.find((s) => s.id === target.spaceId) || current;
    } catch {
      return current;
    }
  }

  async open(target: OpenTarget): Promise<void> {
    if (!target || !target.path) {
      vscode.window.showErrorMessage('Nothing to open.');
      return;
    }

    const space = await this.resolveSpace(target);
    if (!space) {
      vscode.window.showWarningMessage('Select a space first.');
      return;
    }

    const key = this.keyFor(space, target.path);
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'nooblyjs-knowledge-repository-document',
      target.name,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
      }
    );

    const entry: OpenPanel = { panel, space, target };
    this.panels.set(key, entry);

    panel.onDidDispose(() => this.panels.delete(key), null, this.context.subscriptions);

    panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(entry, message),
      undefined,
      this.context.subscriptions
    );

    await this.render(entry);
  }

  private async handleMessage(entry: OpenPanel, message: any): Promise<void> {
    switch (message?.command) {
      case 'toggleStar':
        await this.toggleStar(entry);
        break;
      case 'openInBrowser':
        await vscode.env.openExternal(
          vscode.Uri.parse(this.api.webUrlFor(entry.space, entry.target.path))
        );
        break;
      case 'copyPath':
        await vscode.env.clipboard.writeText(entry.target.path);
        vscode.window.showInformationMessage('Document path copied.');
        break;
      case 'reload':
        await this.render(entry);
        break;
      case 'resolveImages':
        await this.resolveImages(entry, message.sources);
        break;
    }
  }

  /**
   * Fetch images the document refers to by RELATIVE path and send them back as
   * data URIs.
   *
   * A webview is served from its own origin, so `images/diagram.png` in a wiki
   * document resolves against the webview — not the wiki — and simply 404s.
   * Fetching here rather than in the page is also what lets the bearer token
   * stay in a header: the alternative is a `?token=` URL, which puts the
   * credential in markup.
   */
  private async resolveImages(entry: OpenPanel, sources: unknown): Promise<void> {
    if (!Array.isArray(sources) || sources.length === 0) return;

    const docDir = entry.target.path.includes('/')
      ? entry.target.path.slice(0, entry.target.path.lastIndexOf('/'))
      : '';

    // A document full of images should not fire off unbounded requests.
    const wanted = sources.filter((s): s is string => typeof s === 'string').slice(0, MAX_INLINE_IMAGES);

    for (const source of wanted) {
      const resolved = resolveRelative(docDir, source);
      if (!resolved) continue;

      try {
        const payload = await this.api.getDocument(entry.space.id, resolved);
        if (!payload.base64) continue;
        entry.panel.webview.postMessage({
          command: 'imageResolved',
          source,
          dataUri: `data:${mimeForImage(payload.extension)};base64,${payload.base64}`
        });
      } catch {
        // A broken image reference is the document's problem, not an error
        // worth interrupting the reader over. The alt text stands.
        entry.panel.webview.postMessage({ command: 'imageFailed', source });
      }
    }
  }

  private async toggleStar(entry: OpenPanel): Promise<void> {
    const wasStarred = this.activity.isStarred(entry.target.path);
    try {
      await this.api.toggleStar(
        entry.target.path,
        entry.space.name,
        entry.target.name,
        wasStarred ? 'unstar' : 'star'
      );
      await this.activity.refresh();
      entry.panel.webview.postMessage({
        command: 'starState',
        starred: this.activity.isStarred(entry.target.path)
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Could not update star: ${describeError(error)}`);
      // Put the button back where it was rather than leaving it lying.
      entry.panel.webview.postMessage({ command: 'starState', starred: wasStarred });
    }
  }

  private async render(entry: OpenPanel): Promise<void> {
    const { panel, space, target } = entry;
    const webview = panel.webview;

    panel.webview.html = this.shell(webview, target, 'loading');

    try {
      let payload: DocumentPayload = await this.api.getDocument(space.id, target.path);

      // An office file has no viewer here, but the platform converts it on
      // ingest into a readable sibling markdown page — show that instead of
      // refusing outright.
      let convertedFrom: string | undefined;
      if (payload.viewer === 'office') {
        const markdown = await this.api.getOfficeMarkdown(space.id, target.path);
        if (markdown !== null) {
          convertedFrom = target.path;
          payload = { ...payload, content: markdown, viewer: 'markdown' };
        }
      }

      if (!this.activity.hasLoaded()) {
        await this.activity.refresh();
      }
      const starred = this.activity.isStarred(target.path);

      panel.webview.html = this.shell(webview, target, payload.viewer, {
        payload,
        starred,
        convertedFrom
      });

      if (payload.viewer === 'markdown') {
        webview.postMessage({ command: 'renderMarkdown', markdown: payload.content });
      } else if (payload.viewer === 'pdf') {
        // Sent after the shell so a large document never becomes a
        // multi-megabyte HTML string.
        webview.postMessage({ command: 'renderPdf', base64: payload.base64 });
      } else if (payload.viewer === 'image') {
        webview.postMessage({
          command: 'renderImage',
          dataUri: `data:${mimeForImage(payload.extension)};base64,${payload.base64}`
        });
      }

      void this.api.recordVisit(target.path, space.name, target.name);
      void this.activity.refresh();
    } catch (error) {
      panel.webview.html = this.shell(webview, target, 'error', { error: describeError(error) });
    }
  }

  /**
   * The page shell: toolbar plus a body chosen by viewer type.
   *
   * `default-src 'none'` with no CDN exception is the point — every script and
   * stylesheet is a vendored local resource, so nothing here needs the network.
   */
  private shell(
    webview: vscode.Webview,
    target: OpenTarget,
    viewer: string,
    options: {
      payload?: DocumentPayload;
      starred?: boolean;
      error?: string;
      convertedFrom?: string;
    } = {}
  ): string {
    const media = (...parts: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', ...parts));

    const scriptNonce = nonce();
    const themeCss = media('wiki-theme.css');
    const iconsCss = media('vendor', 'bootstrap-icons.min.css');
    const markdownCss = media('vendor', 'markdown-styles.css');
    // The wiki's OWN markdown chrome. Loaded after the base typography so its
    // rules win: it is what the web app actually uses, and it is the only place
    // `.kr-image` — the figure an embedded base64 image renders inside — is
    // styled at all.
    const krMarkdownCss = media('vendor', 'kr-markdown.css');
    const landingCss = media('vendor', 'kr-landing.css');
    const markedJs = media('vendor', 'marked.min.js');
    const parserJs = media('vendor', 'markdown-parser.js');
    const pdfJs = media('vendor', 'pdfjs', 'pdf.min.mjs');
    const pdfWorker = media('vendor', 'pdfjs', 'pdf.worker.min.mjs');

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: blob:`,
      `script-src ${webview.cspSource} 'nonce-${scriptNonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `worker-src ${webview.cspSource} blob:`,
      `connect-src blob: data:`
    ].join('; ');

    const body = this.bodyFor(viewer, options, target);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(target.name)}</title>
  <link rel="stylesheet" href="${iconsCss}">
  <link rel="stylesheet" href="${themeCss}">
  <link rel="stylesheet" href="${markdownCss}">
  <link rel="stylesheet" href="${krMarkdownCss}">
  <link rel="stylesheet" href="${landingCss}">
</head>
<body>
  <div class="wiki-toolbar">
    <div class="wiki-toolbar-left">
      <span class="wiki-file-name">${escapeHtml(target.name)}</span>
      <span class="wiki-file-path">${escapeHtml(target.path)}</span>
    </div>
    <div class="wiki-toolbar-right">
      <button class="wiki-btn" id="starBtn" type="button"
              aria-pressed="${options.starred ? 'true' : 'false'}"
              title="${options.starred ? 'Remove from starred' : 'Add to starred'}">
        <span id="starGlyph">${options.starred ? '★' : '☆'}</span>
        <span id="starLabel">${options.starred ? 'Starred' : 'Star'}</span>
      </button>
      <button class="wiki-btn" id="copyPathBtn" type="button" title="Copy the document path">Copy path</button>
      <button class="wiki-btn" id="browserBtn" type="button" title="Open this document in the browser">Open in browser</button>
    </div>
  </div>
  ${body}
  <script nonce="${scriptNonce}" src="${markedJs}"></script>
  <script nonce="${scriptNonce}" src="${parserJs}"></script>
  <script nonce="${scriptNonce}">
    const vscodeApi = acquireVsCodeApi();

    document.getElementById('starBtn').addEventListener('click', () => {
      vscodeApi.postMessage({ command: 'toggleStar' });
    });
    document.getElementById('copyPathBtn').addEventListener('click', () => {
      vscodeApi.postMessage({ command: 'copyPath' });
    });
    document.getElementById('browserBtn').addEventListener('click', () => {
      vscodeApi.postMessage({ command: 'openInBrowser' });
    });

    function setStarState(starred) {
      const btn = document.getElementById('starBtn');
      btn.setAttribute('aria-pressed', starred ? 'true' : 'false');
      btn.title = starred ? 'Remove from starred' : 'Add to starred';
      document.getElementById('starGlyph').textContent = starred ? '\\u2605' : '\\u2606';
      document.getElementById('starLabel').textContent = starred ? 'Starred' : 'Star';
    }

    function renderMarkdown(markdown) {
      const host = document.getElementById('mdHost');
      if (!host) return;
      // parseMarkdown is the wiki's own parser (vendored). Falling back to
      // escaped text keeps a document readable if the vendored copy is stale
      // or failed to load, rather than showing an empty page.
      if (typeof window.parseMarkdown === 'function') {
        try {
          host.innerHTML = window.parseMarkdown(markdown);
          requestRelativeImages();
          return;
        } catch (err) {
          console.error('parseMarkdown failed', err);
        }
      }
      const pre = document.createElement('pre');
      pre.textContent = markdown;
      host.replaceChildren(pre);
    }

    /**
     * Images the document names by relative path cannot load here — the webview
     * is its own origin, so "images/diagram.png" points at nothing. Collect them
     * and ask the extension host, which can fetch them with the bearer token.
     * Base64 data URIs and absolute http(s) URLs are already fine.
     */
    function requestRelativeImages() {
      const host = document.getElementById('mdHost');
      if (!host) return;

      const sources = [];
      host.querySelectorAll('img[src]').forEach((img) => {
        const raw = img.getAttribute('src') || '';
        if (!raw || /^(data:|https?:|blob:)/i.test(raw)) return;
        img.dataset.pendingSrc = raw;
        // Keep the box from collapsing to nothing while the bytes are fetched.
        img.style.minHeight = '1em';
        if (sources.indexOf(raw) === -1) sources.push(raw);
      });

      if (sources.length > 0) {
        vscodeApi.postMessage({ command: 'resolveImages', sources: sources });
      }
    }

    function applyResolvedImage(source, dataUri) {
      const host = document.getElementById('mdHost');
      if (!host) return;
      host.querySelectorAll('img[data-pending-src]').forEach((img) => {
        if (img.dataset.pendingSrc !== source) return;
        img.src = dataUri;
        img.style.minHeight = '';
        delete img.dataset.pendingSrc;
      });
      // The pan/zoom chrome sizes itself from naturalWidth, so it has to run
      // again now that these images finally have bytes.
      if (window.MarkdownParser && window.MarkdownParser.enhancePendingImages) {
        window.MarkdownParser.enhancePendingImages();
      }
    }

    function markImageFailed(source) {
      const host = document.getElementById('mdHost');
      if (!host) return;
      host.querySelectorAll('img[data-pending-src]').forEach((img) => {
        if (img.dataset.pendingSrc !== source) return;
        img.style.minHeight = '';
        img.replaceWith(Object.assign(document.createElement('span'), {
          className: 'wiki-image-missing',
          textContent: (img.getAttribute('alt') || 'Image') + ' (not found: ' + source + ')'
        }));
      });
    }

    function renderImage(dataUri) {
      const host = document.getElementById('imageHost');
      if (!host) return;
      const img = document.createElement('img');
      img.src = dataUri;
      img.alt = document.querySelector('.wiki-file-name').textContent || '';
      host.replaceChildren(img);
    }

    async function renderPdf(base64) {
      const host = document.getElementById('pdfHost');
      const status = document.getElementById('pdfStatus');
      if (!host) return;

      try {
        const pdfjs = await import('${pdfJs}');
        pdfjs.GlobalWorkerOptions.workerSrc = '${pdfWorker}';

        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        host.replaceChildren();

        // Draw at zoom x device pixel ratio so the bitmap is sharp on HiDPI,
        // then set the CSS size back to the zoom alone so it lays out at the
        // intended size rather than the pixel count.
        const zoom = 1.3;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale = zoom * dpr;

        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
          if (status) status.textContent = 'Rendering page ' + pageNumber + ' of ' + doc.numPages + '…';
          const page = await doc.getPage(pageNumber);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = (viewport.width / dpr) + 'px';
          host.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }

        if (status) status.remove();
      } catch (err) {
        console.error('PDF render failed', err);
        if (status) {
          status.textContent = 'This PDF could not be rendered here. Use "Open in browser" to view it.';
        }
      }
    }

    window.addEventListener('message', (event) => {
      const message = event.data || {};
      switch (message.command) {
        case 'renderMarkdown': renderMarkdown(message.markdown); break;
        case 'renderImage':    renderImage(message.dataUri); break;
        case 'renderPdf':      renderPdf(message.base64); break;
        case 'starState':      setStarState(message.starred); break;
        case 'imageResolved':  applyResolvedImage(message.source, message.dataUri); break;
        case 'imageFailed':    markImageFailed(message.source); break;
      }
    });
  </script>
</body>
</html>`;
  }

  private bodyFor(
    viewer: string,
    options: { payload?: DocumentPayload; error?: string; convertedFrom?: string },
    target: OpenTarget
  ): string {
    if (viewer === 'error') {
      return `<div class="wiki-error"><p class="wiki-error-message">${escapeHtml(options.error || 'Could not load this document.')}</p></div>`;
    }

    if (viewer === 'loading') {
      return `<div class="wiki-empty">Loading ${escapeHtml(target.name)}…</div>`;
    }

    const notice = options.convertedFrom
      ? `<p class="wiki-notice">Showing the converted markdown for <code>${escapeHtml(options.convertedFrom.split('/').pop() || '')}</code>. Use <strong>Open in browser</strong> to download the original.</p>`
      : '';

    switch (viewer) {
      case 'markdown':
        return `<div class="wiki-body">${notice}<div class="md-doc markdown-content" id="mdHost"></div></div>`;

      case 'image':
        return `<div class="wiki-body"><div class="wiki-image-wrap" id="imageHost"></div></div>`;

      case 'pdf':
        return `<div class="wiki-body"><div class="wiki-pdf" id="pdfHost"></div><div class="wiki-pdf-status" id="pdfStatus">Loading PDF…</div></div>`;

      case 'office':
        return `<div class="wiki-body"><div class="wiki-empty">
          <p>No converted markdown exists for this document yet.</p>
          <p>Use <strong>Open in browser</strong> to download the original.</p>
        </div></div>`;

      case 'video':
      case 'audio':
        return `<div class="wiki-body"><div class="wiki-empty">
          <p>${escapeHtml(target.name)} is a media file.</p>
          <p>Use <strong>Open in browser</strong> to play it.</p>
        </div></div>`;

      default:
        return `<div class="wiki-body"><div class="wiki-empty">
          <p>No preview available for this file type.</p>
          <p>Use <strong>Open in browser</strong> to download it.</p>
        </div></div>`;
    }
  }

  dispose(): void {
    for (const { panel } of this.panels.values()) panel.dispose();
    this.panels.clear();
  }
}

/** Cap per document — enough for a page of diagrams, not a runaway. */
const MAX_INLINE_IMAGES = 40;

/**
 * Resolve a document-relative image reference to a space-relative path.
 *
 * Handles `./`, `../` and a leading `/` (which in a wiki document means the
 * space root, not the filesystem root). Returns null for anything that climbs
 * out of the space — the server would refuse it anyway, and there is no reason
 * to ask.
 */
function resolveRelative(docDir: string, source: string): string | null {
  const cleaned = source.split('#')[0].split('?')[0].replace(/\\/g, '/').trim();
  if (!cleaned) return null;

  const absolute = cleaned.startsWith('/');
  const base = absolute ? [] : docDir.split('/').filter(Boolean);

  for (const segment of cleaned.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (base.length === 0) return null;
      base.pop();
      continue;
    }
    base.push(segment);
  }

  const path = base.join('/');
  return path ? decodeURIComponent(path) : null;
}

function mimeForImage(extension: string): string {
  switch (extension.toLowerCase()) {
    case 'svg': return 'image/svg+xml';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'ico': return 'image/x-icon';
    default: return `image/${extension.toLowerCase()}`;
  }
}
