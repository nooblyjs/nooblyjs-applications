# NooblyJS Wiki Daemon

A folder monitoring daemon that keeps chosen wiki folders and local folders in
sync, both ways. You pick which folders to mirror from a browser — the daemon
serves its own setup screen and configuration UI on port **11100** — and it
mirrors each one into a local directory, uploading local edits and applying
remote changes as they happen.

## Quick start

```bash
cd applications/daemon/wiki
npm install
npm start
```

Then open **<http://localhost:11100>** and fill in the setup screen:

| | |
|---|---|
| **Server URL** | pre-filled with `https://localhost:9101/` |
| **API token** | create one in the wiki under **Profile → API tokens** |

Nothing is synced until both are supplied and verified. The daemon starts,
serves the setup screen, and waits — it will not guess a server.

Once connected, choose what to sync — a whole space, or individual folders
within one. Each selection starts mirroring immediately, and you can come back
to **Configure** at any time to add more, remove them, or change the server and
token.

## Features

- **Setup in the browser** — no file editing to get started; the server URL and
  token are entered on a first-run screen and stored locally
- **Space- and folder-level selection** — mirror a whole space, or just the
  folders you want from it; a selection is a (space, folder) pair, so the same
  path in two spaces stays two distinct mirrors
- **Find folders by content** — search documents across every space and pick the
  folder they live in, correctly attributed to its own space
- **Bidirectional sync** — local edits upload; wiki changes download
- **Real-time monitoring** — chokidar watches each mirrored folder
- **Live status dashboard** — spaces, per-folder counters, connection state and a
  streaming activity feed (see [Status Dashboard](#status-dashboard))
- **Resumes after downtime** — the change-feed position is persisted, so changes
  made in the wiki while the daemon was stopped are applied on the next start
- **Reconfigure while running** — adding or removing a folder does not restart
  the daemon or re-mirror anything else
- **Service Registry** — runs on `digital-technologies-core` for structured file
  logging (`.application/logs/`) and optional dashboard authentication

## Configuration

There are **two** places configuration lives, and the split is deliberate.

### 1. What to sync — `.daemon-config.json` (managed from the dashboard)

The server URL, the API token, the local folder to mirror into and the folder
selection. Written by the setup screen and the **Configure** sheet; never edited
by hand. Git-ignored, written with `0600` permissions.

```jsonc
{
  "version": 1,
  "serverUrl": "https://wiki.example.com",
  "token": "dtk_…",
  "baseFolder": "C:\\Users\\you\\Documents\\NooblyJS Wiki",
  "folders": [
    {
      "id": "12::Commercial Services/Technology",
      "spaceId": "12",
      "spaceName": "Engineering Space",
      "remotePath": "Commercial Services/Technology",
      "addedAt": "2026-09-04T09:12:00.000Z"
    }
  ]
}
```

A `remotePath` of `""` means the whole space — that is how the older
mirror-everything behaviour is still expressed.

### 2. How to run — `.env`

Deployment settings only. Copy `.env.example` to `.env` to change any of them.

| Variable | Description | Default |
|----------|-------------|---------|
| `SYNC_INTERVAL` | How often to poll the wiki change feed (ms) | `5000` |
| `IGNORE_PATTERNS` | Comma-separated folder/file names to skip | `.git,node_modules,.DS_Store,Thumbs.db,.idea,.vscode` |
| `WIKI_TLS_INSECURE` | Accept a self-signed/untrusted TLS cert (dev only; prefer `--use-system-ca` / `NODE_EXTRA_CA_CERTS`) | `false` |
| `DASHBOARD_PORT` | Port for the dashboard and setup screen | `11100` |
| `DASHBOARD_HOST` | Interface to bind. **Localhost by default** — the dashboard holds the token form and can delete local folders | `127.0.0.1` |
| `DASHBOARD_REQUIRE_AUTH` | Require auth (Basic or Bearer `dtk_`) to view the dashboard | `false` |
| `DASHBOARD_USER` | Dashboard admin email; created on first run when auth is required | *(none)* |
| `DASHBOARD_PASSWORD` | Dashboard admin password (used with `DASHBOARD_USER`) | *(none)* |

`WIKI_URL`, `WIKI_API_TOKEN` and `WATCH_FOLDER` are read **only on a first
run**, to pre-fill the setup form when `.daemon-config.json` does not exist yet
— so an install that already ran from `.env` is not stranded behind a blank
screen. Once a value has been saved from the UI they are never read again, so
there is one answer to "which server are we talking to" and one answer to "where
my files are".

> **Removed:** `SPACE_FILTER`, `SPACE_NAME`, `WIKI_USERNAME` / `WIKI_PASSWORD`
> and `CHANGES_SINCE`. Folders are chosen in the UI; authentication is by token;
> and the change cursor is persisted automatically, so replaying history by hand
> is no longer needed.

### Ignore patterns

`IGNORE_PATTERNS` skips any path containing one of the listed names as a
segment. For example, `.git` skips `.git/`, `repo/.git/HEAD`, etc. Patterns are
matched against path segments — they are not glob patterns.

### Folder layout

A selected folder is mirrored under a per-space folder, **keeping its remote
path**, so the local tree reads exactly like the wiki, pruned to what you chose:

```
<local folder>/
└── Engineering Space/
    ├── Commercial Services/
    │   └── Technology/          ← selected
    │       └── roadmap.md
    └── Finance/
        └── Reports/             ← selected
            └── q3.md
```

Names are sanitised per segment for the filesystem (characters illegal on
Windows — `/ \ : * ? " < > |` — become `_`). Keeping the nesting is what stops
`Sales/Reports` and `Finance/Reports` from colliding.

### The local folder

Where that tree lives is set on the **setup screen** and can be changed later
from **Configure → Change local folder**. It defaults to a `Knowledge
Repository` folder inside your **Documents** — read from the Windows shell
folder registry rather than assumed to be `%USERPROFILE%\Documents`, because
OneDrive's Known Folder Move relocates Documents and the profile copy then
usually does not exist at all.

You can type `~`, `%USERPROFILE%` or a quoted path; it is expanded and resolved
before being stored. Three locations are refused, each because of a way the
mirror would go wrong later and quietly:

| Refused | Why |
|---------|-----|
| a drive root (`C:\`) | removing a selection prunes empty parents upward — from a drive root that is a walk up the whole disk |
| anything containing the daemon's data folder | the config file, your API token and the sync state would be uploaded to the wiki as documents |
| anything inside the daemon's data folder | the next tidy-up deletes them |

Writability is proved by writing a probe file, not by `fs.access` — on Windows
the access bits routinely say yes where a write says no, and the first sign
would otherwise be every file failing after setup reported success. What gets
stored is then the path as the filesystem itself spells it: an MS-DOS 8.3 short
name (`C:\Users\SRBOOY~1\…`, which is what `%TEMP%` expands to on many
machines) **crashes libuv's watcher**, so it is resolved to its long form first.

**Changing it moves what is already there.** Each selected folder is renamed to
the new root and its state file re-keyed, so nothing is downloaded again — local
edits that have not been uploaded yet move with it. Renames are done with the
watchers stopped and the sync units suspended, for the same reason removal is:
an `fs.rename` of a watched directory rains `unlink` events into the delete
path, which forwards deletions to the server.

A rename that cannot happen — a different drive (`EXDEV`), a file held open by
another program — is reported rather than hidden: that folder keeps its files
where they are, loses its state file, and is mirrored again at the new location.
The dialog says how many folders that happened to, and the old copies are left
for you to remove.

> **Upgrading from a build before this was configurable:** an existing
> `.daemon-config.json` has no `baseFolder`, and it keeps the location that
> build used (`WATCH_FOLDER`, else `./watch`, else `~/NooblyJS Wiki` when
> installed). Only a first run gets the Documents default — defaulting an
> existing install to a new folder would abandon its mirror and re-download
> everything somewhere else.

## Choosing what to sync

A selection is a **(space, folder) pair**, and both halves matter. The same
folder path exists in several spaces, and because spaces are curated *lenses*
over shared content directories, that is the normal case rather than an edge
one — `Reports` in Engineering Space and `Reports` in Fintech Space are two
different things that happen to share a name.

So the **space is a row in the picker, not a filter above it**. It sits at the
top of its own folder tree, it is selectable in its own right (meaning "mirror
this whole space"), and every folder chosen beneath it is bound to it. The
selected list on the right is grouped by space for the same reason, and the
local layout puts the space folder at the top so two identical paths never
collide on disk.

The **Configure** sheet has two halves: find on the left, chosen on the right.

**Browse.** Every space you can see is listed; expand one to walk its folders.
The tree is *lazy* — the server returns two levels at a time and marks deeper
folders as not-yet-listed; expanding one fetches it. This matters because the
content roots are directories of symlinked git repositories, where an exhaustive
walk means thousands of sequential directory listings.

**Search.** Type into the search box to find folders by what is *inside* them.
The platform indexes documents, not folders — there is no folder search to
call — so the daemon searches document content and offers each hit's parent
folder, ranked by how many documents matched. A folder whose documents are not
indexed will not appear here; browse for it instead.

Search spans **every space** unless you narrow it with the dropdown, and each
result names the space it belongs to — because that space is half of what you
are selecting.

> **Why the search fans out across spaces instead of running one unscoped
> query.** The search index stamps each document with a single space name —
> whichever space indexed that content directory last — so an unscoped search
> answers with a space that is a guess, and falls back to the first public space
> when even the stamp does not resolve. Binding a sync unit to a guessed space is
> not a cosmetic mislabel: the unit addresses the filing API as `space-<id>`, and
> a space whose `allowedPaths` does not cover the folder answers 404 for every
> file in it — a mirror that silently stays empty. A *scoped* search answers with
> the space that was asked for, so the daemon asks each space separately (a few
> at a time; the server caches each for five minutes) and keys every result by
> the space it asked, never by the stamp that came back.

Click a space or a folder to add or remove it.

### Removing a selection deletes its local copy

That is what removal means here, and the UI says so before you commit: the Save
button names how many folders will be deleted, and a confirmation lists them.

**The documents stay in the wiki.** Deleting a watched directory makes the file
watcher see every file disappear at once, and its normal job is to forward
deletions to the server — so removal explicitly suspends the sync unit before
closing the watcher and before touching the disk. Verified end-to-end: removing
a whole-space selection holding six files, including nested subfolders, issued
**zero** delete calls to the server.

## Usage

```bash
npm start        # production
npm run dev      # auto-restart on change
```

Press `Ctrl+C` to stop (closes the dashboard, stops watchers, flushes state and
the change cursor).

### Working with files

- **Create / edit** a file inside a mirrored folder → uploaded to the wiki
- **Delete** a file inside a mirrored folder → deleted in the wiki
- Changes made in the wiki are downloaded as they happen

## Status Dashboard

With the daemon running, open <http://localhost:11100>. It shows, updating in
real time:

- **Status & connection** — running/error, the server URL, auth state, the local
  folder, poll interval, and a live "next poll" countdown
- **Counters** — uploads, downloads, deletes, change events applied, polls, and
  errors (plus bytes transferred)
- **Synced folders** — one row per selected folder: space, folder path, tracked
  file count, per-folder ↑/↓/✕ counts, and last-activity time
- **Activity feed** — a streaming, filterable log of every operation

Updates arrive over Server-Sent Events (`/api/stream`), falling back to polling
if the stream drops. If startup fails (e.g. the server is unreachable) the
dashboard **stays up and shows the error** instead of the process dying.

| Endpoint | Purpose |
|----------|---------|
| `GET /` | Dashboard, or the setup screen when unconfigured |
| `GET /api/status` | Full state snapshot as JSON |
| `GET /api/stream` | Server-Sent Events: `snapshot` \| `stats` \| `activity` |
| `GET /healthz` | Liveness probe (`{ ok, status, uptimeSec }`) |
| `GET /api/config` | Current configuration (token **masked**) |
| `POST /api/config/connection` | Set and verify server URL + token (and the local folder, from setup) |
| `POST /api/config/base-folder` | Set the local folder, moving existing mirrors to it |
| `POST /api/config/disconnect` | Forget the token; keeps folders and files |
| `POST /api/config/trust-certificate` | Pin a server certificate the operator accepted |
| `POST /api/config/untrust-certificate` | Remove a pinned certificate |
| `GET /api/browse/spaces` | Spaces the token can see |
| `GET /api/browse/tree` | One level of a space's folder tree |
| `GET /api/browse/search` | Folders found by searching document content |
| `POST /api/config/folders` | Replace the folder selection |
| `GET /services/` | The `digital-technologies-core` service registry UI |

### Securing the dashboard

The dashboard binds to **127.0.0.1** by default, because it carries the API
token form and can delete local folders. Set `DASHBOARD_HOST=0.0.0.0` to widen
it — and set `DASHBOARD_REQUIRE_AUTH=true` if you do. Requests must then present
either HTTP Basic credentials or a Bearer `dtk_` personal access token, both
validated by the core authservice. Set `DASHBOARD_USER` / `DASHBOARD_PASSWORD`
to have an admin account provisioned on first run.

> The token is never sent back to the browser — `/api/config` returns a masked
> hint (`dtk_abcd…wxyz`). Changing it means re-entering it.

> Structured logs are written to `.application/logs/` regardless of the
> dashboard, via the core file logger. `.application/` is created next to the
> daemon and is git-ignored.

## How It Works

### Architecture

```
┌──────────────┐        ┌───────────────┐
│  Dashboard   │───────▶│  ConfigStore  │  .daemon-config.json
│  (setup/UI)  │        └───────┬───────┘  server, token, folders
└──────────────┘                │
                                ▼
                        ┌───────────────┐
                        │  SyncEngine   │  one unit per selected folder
                        └───┬───────┬───┘
              ┌─────────────┘       └─────────────┐
              ▼                                   ▼
     ┌─────────────────┐                 ┌────────────────┐
     │ FolderWatcher   │                 │ Change-feed    │
     │ (chokidar)      │                 │ poll (5s)      │
     └────────┬────────┘                 └───────┬────────┘
              │                                  │
              ▼                                  ▼
        ┌──────────────────────────────────────────────┐
        │              FileSync (per unit)             │
        │  remoteRoot ⇄ local path, ownership checks   │
        └──────┬────────────────────────────┬──────────┘
               ▼                            ▼
        ┌─────────────┐              ┌──────────────┐
        │StateManager │              │  API Client  │──▶ Wiki
        │  (.json)    │              │  (bearer)    │
        └─────────────┘              └──────────────┘
```

### Components

1. **Config Store** (`lib/config-store.js`) — the persisted server URL, token and
   folder selection; atomic writes, corrupt files preserved rather than
   overwritten, tokens masked before they reach the browser
2. **Sync Engine** (`lib/sync-engine.js`) — owns one sync unit per selected
   folder and the single change-feed poll that feeds all of them; diffs a new
   selection against the live one so only the delta is acted on
3. **API Client** (`lib/api-client.js`) — the filing API, the folder tree, search
   and the change feed, over bearer-token auth
4. **TLS Trust** (`lib/tls-trust.js`) — decides when an untrusted certificate
   is worth offering to pin, reads back what the server presented, and builds a
   trust store that ADDS pins to Node's defaults rather than replacing them
6. **Folder Search** (`lib/folder-search.js`) — collapses document search hits
   onto selectable folders, binding each to the space that was *searched* rather
   than the space the index stamped on the hit
6. **Local Paths** (`lib/local-paths.js`) — pure derivation of a folder's local
   directory (dependency-free, so it is directly testable)
7. **State Manager** (`lib/state-manager.js`) — file↔document mappings and content
   hashes, one instance per unit
8. **File Sync** (`lib/file-sync.js`) — upload/download, and the `remoteRoot`
   arithmetic that decides which unit owns a path
9. **Folder Watcher** (`lib/folder-watcher.js`) — chokidar per unit
10. **Monitor** (`lib/monitor.js`) — in-memory model of live activity behind the
   dashboard
11. **Daemon Log** (`lib/daemon-log.js`) — fans each line to terminal, file logger
   and the dashboard feed
12. **Dashboard** (`lib/dashboard.js` + `public/`) — status page, setup screen,
    config API and SSE stream
12. **Main** (`index.js`) — registry init, lifecycle, and the controller that keeps
    the persisted config and the live engine in step

### Sync strategy

**Local → Wiki.** A file created or modified inside a mirrored folder is hashed;
if the content actually changed it is uploaded under its full space-relative
path. A deleted local file is removed from the wiki.

**Wiki → Local.** The daemon polls `/applications/wiki/api/changes` and routes
each event to the units that own its path. The poll is a self-rearming timer, so
a slow tick can never overlap the next one.

**Folder scoping.** Each unit knows the space-relative folder it mirrors and
ignores everything outside it. Matching is on whole path segments, so a unit
mirroring `Sales` does not claim `SalesOps`.

**Resuming.** The change-feed cursor is persisted (`.daemon-cursor.json`). On
start, a folder that is already mirrored resumes from that cursor instead of
being walked again; if the server has rolled past the cursor it reports
`truncated` and every folder is re-mirrored. Without this, a document edited in
the wiki while the daemon was stopped was never pulled — a bulk sync only
reconciles which files *exist*, since the browse API returns no size or
timestamp to compare.

### State persistence

One state file per selected folder, `.daemon-state-<hash>.json`, tracking two
mirrored key spaces so either side can resolve the other in O(1):

- **`files`** is keyed by the **local path** — absolute, forward-slashed, and
  lowercased on Windows. A filesystem event knows the local path and resolves the
  remote document from here.
- **`documents`** is keyed by the **remote path** — relative to the *space* root,
  POSIX separators, no leading `./` or `/`. A change-feed event knows the remote
  path and resolves the local file from here.

Removing a folder deletes its state file, so re-adding it later mirrors cleanly
rather than mistaking an empty directory for a pile of remote deletions.

## Troubleshooting

### Setup screen keeps rejecting the token

The daemon performs a real authenticated call before saving, so the message at
the form is the server's own. `401` means the token is wrong or expired — issue
a new one under **Profile → API tokens**. A connection error means the URL is
wrong or unreachable from this machine.

### TLS: the server's certificate is not trusted

Connecting to a development server over HTTPS usually fails the first time:

```
Failed to list spaces (no response): DEPTH_ZERO_SELF_SIGNED_CERT - self-signed
certificate; if the root CA is installed locally, try running Node.js with
--use-system-ca
```

**The daemon now handles this itself.** The setup screen shows the certificate
the server actually presented — subject, issuer, expiry and SHA-256
fingerprint — and offers to trust it. Accept it once and it is remembered.

Nothing to export, nothing to edit, and it works the same in the installed
build.

#### Why the error's own advice doesn't work here

`--use-system-ca` adds the **Windows certificate store** as trust *anchors*,
which fixes a certificate issued by an internal **CA**. It cannot fix a
certificate that is its own issuer, and `DEPTH_ZERO` is Node saying the failure
is at the leaf — there is no chain to anchor. The certificate this repo
generates (`backend/certs/server.crt`) is exactly that case:

```bash
echo | openssl s_client -connect localhost:9101 -servername localhost 2>/dev/null \
  | openssl x509 -noout -subject -issuer
# subject=CN=localhost
# issuer=CN=localhost      <- identical: self-signed, no CA involved
```

#### Pinning, not disabling

Accepting a certificate **pins** it: the exact certificate is added to the trust
store, so verification stays fully on — the chain must still validate, the
hostname must still match, and expiry still applies. It is the trust decision
SSH asks for on a first connection, and a far smaller grant than
`rejectUnauthorized: false`, which would accept any certificate from anyone.

Consequences worth knowing:

- Pins are **added to** Node's trust store, never substituted for it, so pinning
  a localhost certificate cannot stop the daemon trusting a public server.
- A **regenerated** development certificate has a new fingerprint and is
  prompted for again. That re-prompt is the point of pinning.
- An **expired** certificate or a **hostname mismatch** is never offered for
  one-click trust. Pinning cannot fix the first, and the second is the one case
  where the warning may be describing a real attack.
- Pins are listed under **Configure → Connection**, with the fingerprint, and
  can be removed there.

#### Other ways, if you prefer them

| | |
|---|---|
| `NODE_EXTRA_CA_CERTS` | Trust one certificate process-wide. Must be a **real environment variable** — OpenSSL reads it as Node boots, before `dotenv` runs, so `.env` has no effect. |
| `WIKI_TLS_INSECURE=true` | Disables verification for the daemon's API client only. Blunt; fine for localhost, never for an untrusted network. |
| `--use-system-ca` | The right answer when the certificate **was** issued by a CA you can install in the Windows store. Already passed by `npm start` and the installed launcher. |

### Connection errors that just say "Error"

Fixed, but worth knowing why it happened: Node reports a failed connection as an
**AggregateError** — one entry per address the host resolved to — and its own
`message` is the literal string `Error`. The daemon now unwraps it, so a server
that is not running reports `ECONNREFUSED - connect ECONNREFUSED ::1:9101`
instead of a blank `Error` that looks like a TLS problem.

### Files not syncing

- Check the activity feed on the dashboard for errors
- Confirm the file is inside a *selected* folder — files outside one are ignored
- Check `.daemon-state-<hash>.json` for the expected mappings

### `Assertion failed: !_wcsnicmp(...)` on Windows

libuv's file watcher crashes when the watched path contains an MS-DOS **8.3
short name** (`C:\Users\SRBOOY~1\…`). Saving the local folder resolves it to the long
form for you — that is what `%TEMP%` expands to on many machines — so this should
no longer be reachable through the UI. A path forced in through `WATCH_FOLDER` on
a first run is not resolved, so spell that one in full.

### Duplicate documents

- Remove the folder from the configuration and add it back — this deletes the
  local copy and its state file, then re-mirrors from the wiki
- Clean up duplicates in the wiki

### Port already in use

`npm run kill` in `backend/`, or set `DASHBOARD_PORT`. The daemon logs the
conflict and keeps syncing without a dashboard rather than exiting.

## Development

### Project structure

```
applications/daemon/wiki/
├── index.js              # Registry init, lifecycle, config controller
├── lib/
│   ├── config-store.js   # Persisted server/token/folder selection
│   ├── sync-engine.js    # Sync units, selection diffing, change-feed poll
│   ├── local-paths.js    # Pure local-path derivation
│   ├── folder-search.js  # Search hits -> selectable folders (space-bound)
│   ├── api-client.js     # Filing API, folder tree, search, change feed
│   ├── state-manager.js  # State persistence
│   ├── file-sync.js      # Sync logic + folder scoping
│   ├── folder-watcher.js # File monitoring
│   ├── monitor.js        # Live activity model
│   ├── daemon-log.js     # console → file logger + dashboard fan-out
│   └── dashboard.js      # Status page, setup + config API, SSE
├── public/               # Dashboard & setup UI
├── build/
│   ├── build.js          # Assembles the installer payload (app + deps + Node)
│   └── installer.iss     # Inno Setup script (per-user Windows installer)
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

### Tests

The pure pieces — config store, path derivation and folder scoping — are covered
by the repo's Jest suite:

```bash
cd backend
npm run tests -- ../tests/backend/components/daemonFolderSync.test.js
```

The sync loop itself has no automated coverage; exercise it against a running
wiki by selecting a folder, editing a file locally, and editing one in the wiki.

## Building the Windows installer

```bash
npm run build       # assemble build/staging  (~275 MB)
npm run installer   # ...then compile build/dist/KnowledgeRepositorySync-Setup-1.0.0.exe (~57 MB)
```

`npm run installer` needs [Inno Setup 6](https://jrsoftware.org/isinfo.php)
(`winget install JRSoftware.InnoSetup`). The build itself needs nothing but Node.

### What ships, and why it is not a single .exe

The installer bundles **the app plus its own Node runtime** rather than a
compiled executable. `pkg` was tried first and rejected on evidence:

- pkg 5.8.1 is the last release and cannot target beyond **Node 18**, which is
  end-of-life and cannot read the Windows certificate store — `--use-system-ca`
  arrived in Node 22, and `npm start` already relies on it.
- Its Node 18 runtime could not resolve axios's `exports` map from inside the
  read-only snapshot; the resulting 220 MB executable died at startup with
  `MODULE_NOT_FOUND`.
- `digital-technologies-core` loads services with a fully dynamic
  ``require(`${__dirname}/src/${serviceName}`)``, which no static bundler can
  follow — so that tree has to ship verbatim under any packaging scheme anyway.

Bundling the runtime avoids all three: the app runs on exactly the Node it was
tested against, dynamic requires work, and an update is a file copy.

Dependencies are resolved as a **production closure** computed from
`package.json` metadata — the same rule `npm install --omit=dev` applies — not
from watching which modules a test run happened to load. A runtime observation
would be smaller and wrong: only 111 of core's 503 production packages load on a
normal boot, so trusting it would hand the first operator to enable an untested
option a `MODULE_NOT_FOUND` instead of a feature.

| | |
|---|---|
| Staged payload | ~275 MB (app 5 MB · core 147 MB · Node 98 MB) |
| Installer | ~57 MB |
| Installed | ~340 MB |

> **Slimming, if it matters later.** Core's closure carries provider SDKs this
> daemon never loads — `pdf-parse` (27 MB), Azure, `@google-cloud/tasks`,
> `openai`, `mongodb`, `@aws-sdk/client-s3`. Excluding them by name would save
> roughly 90 MB, at the cost of a hand-maintained deny-list that only stays
> correct while core's own requires do. It was left out on purpose.

### What the installer does

**Per-user, no administrator rights.** The daemon syncs one person's files with
one person's API token into one person's home folder, so a machine-wide service
would have no good answer to "whose token?".

| | |
|---|---|
| Program files | `%LOCALAPPDATA%\Programs\NooblyJS Wiki Sync` |
| Settings, state, logs | `%LOCALAPPDATA%\NooblyJS Wiki Sync` |
| Default mirror | `%USERPROFILE%\NooblyJS Wiki` |

It creates three Start Menu entries — the app, a shortcut straight to the
dashboard, and the uninstaller — plus an optional desktop icon, and registers in
Add/Remove Programs. Launching it starts the daemon in a console window (closing
that window stops syncing) and opens the dashboard once the port is actually
accepting connections.

**Uninstalling never deletes your documents.** The mirrored files are yours and
are always left alone. The uninstaller offers to remove the settings folder —
server address, API token, folder selection — and defaults to *keeping* it, so
an unattended uninstall is never destructive.

### Silent deployment

```bat
KnowledgeRepositorySync-Setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

Add `/DIR="..."` to relocate, `/LOG="install.log"` to trace. The uninstaller
takes the same switches and, being silent, keeps user settings.

### Separating "installed" from "a working tree"

The build writes an `.installed` marker beside `index.js`, and `lib/app-paths.js`
keys off it. This is load-bearing: an installed copy is plain `node.exe` running
plain `index.js`, byte-for-byte indistinguishable from a developer checkout by
any process-level signal. Without the marker an installed copy writes its
config, state and logs into its own program folder — which the next upgrade
replaces.

Set `DAEMON_DATA_DIR` to point the data folder anywhere, which is how a packaged
build is tested without installing it.


## Security notes

- `.daemon-config.json` holds the API token in plaintext (as `.env` did). It is
  git-ignored and written `0600`.
- The dashboard binds to localhost by default; widen it deliberately and turn on
  `DASHBOARD_REQUIRE_AUTH` if you do.
- The token is never returned to the browser — only a masked hint.
- State files contain local file paths; review before sharing.

## License

ISC
