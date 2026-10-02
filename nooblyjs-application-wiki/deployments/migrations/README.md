# Data migrations

One-off, self-contained Node scripts that transform on-disk data during a
deployment. Each is safe to copy onto the target host and run with just Node
(>= 16.7) — they do **not** import the app's source.

Naming: `YYYY-MM-DD-<description>.js`.

Run them in date order. Where a later migration reverses an earlier one, only the
**latest** reflects the code — the older entry is kept for provenance.

---

## 2026-07-21-artifacts-to-folder-local-system.js  ← current

Moves per-document artifacts to a **folder-local** `.system/`, beside the
documents they describe. **Supersedes the 2026-07-13 migration below for
`derived` / `originals` / `context`** — that one pulled those three *up* into a
space-root namespace mirroring the tree; this puts them back *down* next to their
source.

Why the reversal: space folders are symlinks to separate git repositories, so a
space-root namespace stranded every repo's artifacts **outside** the repo —
unversioned, and missing after a fresh clone. Folder-local artifacts are
committed and cloned with the content they describe.

```
<folder>/<Doc>.pdf
<folder>/.system/derived/<Doc>.pdf.md      extracted text (search + context)
<folder>/.system/originals/<Doc>.docx      untouched source of a converted page
<folder>/.system/context/<Doc>.pdf.md      AI context  (+ _folder.md roll-up)
<folder>/.system/file-order.json           child ordering
<folder>/.system/file-types.json           child status colours
```

### Legacy layouts handled

| Legacy | Becomes |
|---|---|
| `<space>/.system/{derived,originals,context}/<folder>/<name>` | `<space>/<folder>/.system/<kind>/<name>` |
| `<space>/{.derived,.originals,.context}/<folder>/<name>` | `<space>/<folder>/.system/<kind>/<name>` |
| `<folder>/.system/.derived/<Doc>.md` | `<folder>/.system/derived/<Doc>.pdf.md` |
| `<folder>/{.derived,.originals,.context}/<name>` | `<folder>/.system/<kind>/<name>` |
| `<folder>/.settings/{file-order,file-types}.json` | `<folder>/.system/<same>` |

### Name recovery — the subtle part

The old **per-folder** derived sidecar dropped the source's extension
(`Report.pdf` → `.derived/Report.md`); the new one keeps it
(`.system/derived/Report.pdf.md`) so `Report.pdf` and `Report.docx` in one folder
cannot collide. A blind move would therefore produce names the application never
looks up. Each artifact is matched back to a real source document in its folder
and renamed accordingly. Context follows the same rule: a **markdown** source
keeps its own name, any **other** source keeps its full name plus `.md`;
`_folder.md` is a folder roll-up and passes through.

Anything with no surviving source is an **orphan** — reported and left alone, or
deleted with `--prune-orphans`.

### The space root is special

The space root is itself a folder holding documents, so its `.system/` carries
**both** its own artifacts (for files sitting at the root) **and** the
space-scoped folders. `templates`, `useractivity`, `dashboards`,
`continuous-explorations` and `archive` belong to the space rather than to any
document and are never touched — the script reports which it found.

`.aicontext/` (the chat's disposable retrieval cache) is also left completely
alone; it is *not* a synonym for `.system/context/`.

### Procedure (production)

```bash
# 1. Deploy the new application code.
# 2. STOP the backend (it recreates legacy paths while running).
pm2 stop knowledge-repository

# 3. Preview — makes NO changes:
node deployments/migrations/2026-07-21-artifacts-to-folder-local-system.js

# 4. Apply:
node deployments/migrations/2026-07-21-artifacts-to-folder-local-system.js --apply

# 5. Start the backend again.
pm2 start knowledge-repository
```

### Flags / env

| Flag | Env | Default | Purpose |
|---|---|---|---|
| `--apply` | | *(dry run)* | Actually move files. Omit to preview. |
| `--force` | | off | Apply even if the backend port is still listening. |
| `--prune-orphans` | | off | Delete artifacts whose source document is gone. |
| `--port <n>` | `PORT` | `9101` | Port health-checked by the running-server guard. |
| `--app-base <dir>` | `APP_BASE_DIR` | `<repo>/../.application` | Location of the `.application` data dir. |
| `--base <dir>` | | repo root | Base for resolving relative space paths. |
| `--space <name>` | | all | Limit to one space (repeatable). |
| `--no-manifest` | | off | Skip writing the audit manifest. |

**Idempotent** — artifacts already folder-local are left alone, so a second run
moves nothing. Never overwrites an existing target; a collision is reported and
skipped. On `--apply` it writes
`artifact-folder-local-migration-<timestamp>.json` into the app base dir.

### Superseded scripts — do NOT run

These describe the old direction and would undo the above:
`backend/scripts/migrate-context-to-system.js`,
`backend/scripts/migrate-dotfolders-to-system.js`, and the 2026-07-13 migration
below (for `derived`/`originals`/`context`; its `useractivity`/`templates`/
`dashboards` moves remain correct).

---

## 2026-07-13-consolidate-dotfolders-to-system.js  *(superseded in part)*

Moves the six legacy **space-root** hidden folders into a single per-space
`.system/` namespace (matches the code change of the same date):

| Legacy | New |
|---|---|
| `.derived` | `.system/derived` |
| `.useractivity` | `.system/useractivity` |
| `.dashboards` | `.system/dashboards` |
| `.continuous-explorations` | `.system/continuous-explorations` |
| `.templates` | `.system/templates` |
| `.archive` | `.system/archive` |

Runs against every space content dir (from `.application/spaces/spaces.json`,
whose paths are relative to `../knowledge-content/`) **plus** the app base dir
(its global `.useractivity`). Per-folder items (`.settings`, `.aicontext`,
`.context`, `.originals`, `.home.md`) are left untouched.

### Procedure (production)

```bash
# 1. Deploy the new application code.
# 2. STOP the backend service — while it runs it keeps writing to the old
#    folders, so the migration would leave leftovers. The script refuses to
#    --apply while the port is live (guard below).
pm2 stop knowledge-repository        # or however the service is stopped

# 3. Preview — makes NO changes:
node deployments/migrations/2026-07-13-consolidate-dotfolders-to-system.js

# 4. Apply:
node deployments/migrations/2026-07-13-consolidate-dotfolders-to-system.js --apply

# 5. Start the backend again (now on the new code, reading/writing .system/).
pm2 start knowledge-repository
```

### Flags / env

| Flag | Env | Default | Purpose |
|---|---|---|---|
| `--apply` | | *(dry run)* | Actually move files. Omit to preview. |
| `--force` | | off | Apply even if the backend port is still listening. |
| `--port <n>` | `PORT` | `9101` | Port health-checked by the running-server guard. |
| `--app-base <dir>` | `APP_BASE_DIR` | `<repo>/../.application` | Location of the `.application` data dir. |
| `--base <dir>` | | repo root | Base for resolving relative space paths (the server's cwd). |
| `--no-manifest` | | off | Skip writing the audit manifest. |

### Notes

- **Dry run is the default.** Nothing moves until you pass `--apply`.
- **Idempotent.** Re-running after success is a no-op. If a target already
  exists (a partial prior run), children are merged in *without* overwriting.
- **Audit trail.** On `--apply` it writes `dotfolder-migration-<timestamp>.json`
  into the app base dir listing every move (source of a manual rollback).
- **cwd-independent.** Paths are anchored on the script location, so it works
  regardless of the directory you launch it from.
- **Out-of-repo follow-up.** `.system/dashboards/<prefix>.md` is written by the
  sibling `nooblyjs-app-wiki-workflows` repo. The wiki frontend
  reads `.system/dashboards/` then falls back to legacy `.dashboards/`, so
  dashboards keep working until that workflow's output path is updated.
