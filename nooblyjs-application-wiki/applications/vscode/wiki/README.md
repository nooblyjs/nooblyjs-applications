# NooblyJS Wiki — VS Code extension

Browse, search and read the NooblyJS Wiki without leaving
the editor. Read-only: nothing here writes to the wiki.

Works in VS Code and in Code OSS forks (Kiro, VSCodium, Cursor).

## What it does

| View | |
|---|---|
| **Files** | The selected space's folder tree, loaded one level at a time |
| **Search** | Full-text search, scoped to the current space or across every space you can see |
| **Recent** | Documents you have opened |
| **Starred** | Documents you have starred, here or in the browser |

Documents open according to type:

- **Markdown** renders through the wiki's own parser, so landing bands, panes, linked
  documents, annotations and the rest look the way they do in the browser — not as raw
  code fences.
- **Code and plain text** open in a normal read-only editor tab, with real syntax
  highlighting from your theme, native find, folding and diff.
- **PDFs** render page by page via PDF.js.
- **Images** display inline.
- **Word and Excel files** show the markdown the platform converted them into on ingest,
  with a link to download the original.

Right-click any document for **Open in Browser**, **Star**, **Copy Document Path** and
**Copy Document Link**.

## Setup

1. Install the extension (`.vsix` via **Extensions: Install from VSIX…**, or from source
   below).
2. **Create an API token.** In the wiki, open **Profile → API tokens** and create one. It
   starts `dtk_` and is shown **once** — copy it straight away.
3. **Tell the extension where the wiki is and who you are.** Either open Settings and
   search for `nooblyjs-knowledge-repository`, or run
   **NooblyJS Wiki: Set API Token** from the command palette and paste it there.

| Setting | What it is |
|---|---|
| `nooblyjs-knowledge-repository.serverUrl` | Base URL of the wiki. Defaults to `https://localhost:9101`. |
| `nooblyjs-knowledge-repository.apiToken` | Your personal `dtk_` token. |

Both take effect immediately — no window reload. **NooblyJS Wiki: Test Connection**
tells you exactly which of the three things is wrong: no token, a rejected token, or an
unreachable server.

4. Pick a space. If you can see only one, it is selected for you.

## About the token

There is no sign-in flow. The token *is* the credential, and it acts as you, with your
roles — so the extension sees exactly the spaces you can see, and nothing else. Revoking it
in the wiki takes effect on the very next request.

Two things worth knowing:

- **It is stored in plain text** in your user `settings.json`, like any other VS Code
  setting. Treat it as a credential on disk; if it is exposed, revoke it in the wiki and
  create another.
- **Both settings are machine-scoped.** They cannot be set in workspace settings and do not
  travel through Settings Sync. That is deliberate: if a workspace could set `serverUrl`, a
  repository you opened could silently point the extension — and your token — at someone
  else's server.

If the server rejects your token mid-session, the extension says so once and offers to take
you to the setting, rather than failing silently on every subsequent action.


## Building from source

```bash
cd applications/vscode/wiki
npm install
npm run sync        # refresh vendored assets from the repo
npm run compile     # TypeScript -> out/
```

Then press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

To produce an installable package:

```bash
npm run package     # runs check + vsce package -> nooblyjs-knowledge-repository-<version>.vsix
```

### Verifying a change

```bash
npm run check       # sync:check + compile + lint — the gate to run before packaging
```

## Vendored assets

`media/vendor/` is **generated**, not authored. `scripts/sync-assets.js` copies these out
of the repo:

| File | Source | Why |
|---|---|---|
| `markdown-parser.js` | `public/js/markdown/markdown-parser.js` | renders the wiki's custom blocks |
| `marked.min.js` | `node_modules/marked` — **must be 4.x** | the parser extends marked and needs it as a global |
| `kr-landing.css` | `public/css/kr-base.css` (Landing blocks) | styles the landing bands |
| `kr-markdown.css` | `public/css/kr-base.css` (Markdown rendering) | themes every markdown element and custom block, incl. `.kr-image` |
| `markdown-styles.css` | `applications/chrome/wiki/css/markdown-styles.css` | base `.md-doc` typography |
| `bootstrap-icons.min.css` + `fonts/*` | `applications/chrome/wiki/css/` | the parser emits `<i class="bi bi-…">` |
| `pdfjs/*` | `applications/web/wiki/public/js/vendor/pdfjs/` | VS Code webviews have no PDF plugin |

> **marked must stay on 4.x.** At v5 the renderer contract changed —
> `renderer.image(href, title, text)` became `renderer.image(token)` — and
> `markdown-parser.js` overrides `image` and `link` with the v4 signature. A newer
> marked hands it a token object where it expects a string, so **every image and
> link renders as `[object Object]`**. Nothing throws. `npm run sync` refuses to
> vendor the wrong major version for exactly this reason.

Edit the **source**, then `npm run sync`. Never edit `media/vendor/` directly — the next
sync overwrites it. `npm run sync:check` fails if a vendored copy has fallen behind, which
is what keeps this from drifting the way it did before.

The files are committed so a fresh clone compiles without a sync step first.

`media/wiki-theme.css` **is** authored: it maps the wiki's `--kr-*` design tokens onto
VS Code's theme colours, so documents follow your editor theme while keeping the wiki's
teal accent.

## Notes and limitations

- **Read-only.** There is no editing, and no comment, note or review support.
- **Mermaid diagrams** render as code blocks — the parser looks for a Mermaid runtime that
  is not vendored here.
- **No live updates.** The wiki pushes file changes over Socket.IO to the web client;
  this extension does not subscribe. Use **Refresh**.
- **The folder tree is lazy.** Expanding a folder fetches its contents. This is deliberate:
  the content roots are directories of symlinked git repositories, and walking one
  exhaustively costs thousands of sequential directory listings.
- **Large binaries** (over 40 MB) are not previewed — open them in the browser instead.
- **Images** work both ways: base64 data URIs render inline, and images referenced by a
  relative path are fetched from the wiki and inlined (up to 40 per document). One the
  wiki does not have is shown as a note naming the missing reference, rather than a broken
  image icon.

## Troubleshooting

**Start here:** run **NooblyJS Wiki: Test Connection**. It distinguishes the three
failures that all look like an empty tree — no token set, a token the server rejected, and
a server it could not reach.

**"Your API token was rejected."** It is mistyped, expired, or was revoked in the wiki.
Create a new one under **Profile → API tokens** and run **Set API Token**.

**"Could not reach …".** Check `serverUrl`. The default is `https://localhost:9101` —
note **https**; a local backend served over plain http needs the setting changed to match.

**The tree is empty but the token is fine.** Pick a space — the Files view says so, with a
button. The status bar shows the current space.

**A document renders as plain text.** The vendored parser failed to load. Run
`npm run sync` and recompile.

**Anything else.** Run **NooblyJS Wiki: Show Log** from the command palette. The
log records failing requests with their status codes; tokens are redacted.
