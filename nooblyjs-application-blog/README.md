# NooblyJS Blog Platform
NooblyJS Blog is a Medium-inspired publishing experience built on top of the NooblyJS Core accelerator. It combines an API-first, native Node.js backend with a Bootstrap 5 client to deliver a responsive, extensible blog for independent writers, publications, and readers.

## Solution Overview
- **API-first design:** Every capability is exposed through JSON endpoints under `/applications/blog/api/...` (see `CLAUDE.md` for the endpoint list; an OpenAPI spec is planned). Future native apps or partner integrations consume the same APIs as the web client.
- **Native Node.js runtime:** A lightweight HTTP server delegates to the NooblyJS Core `serviceRegistry`, giving us provider-driven caching, data, logging, search, queueing, and workflow services without high-level frameworks.
- **Bootstrap 5 web client:** Progressive enhancement with ES modules and Bootstrap Icons provides a familiar, fast UI for reading, authoring, and moderating content—no React involved.
- **Extensible domain model:** Posts, tags, comments, bookmarks, claps, and notifications are modeled to support scheduled publishing, analytics, and moderation from day one.
- **Operational readiness:** Metrics, structured logging, background jobs, and admin utilities are surfaced through the accelerator’s `/services/...` endpoints with API-key protection.

## Architecture Highlights
- `noobly-core` accelerates common backend concerns via providers (PostgreSQL-backed data service, Redis cache, S3 media storage, BullMQ queues, etc.).
- Public APIs and the Bootstrap client are decoupled; static assets live in `public/`, client scripts fetch data via the documented endpoints.
- Service registry initialization is environment-driven, allowing memory-backed providers in local development and managed services (PostgreSQL, Redis, S3) in production.
- Observability is handled with structured logs, Prometheus metrics exported from the measuring service, and error/event hooks wired into the registry emitter.

## Documentation
- Product requirements live in `docs/nooblys-blog-prd.md`, covering features, milestones, risks, and NooblyJS Core integration details.
- Additional accelerator usage notes are under `docs/nooblyjs-core-usage-guide-concise.md`.

## Getting Started
1. Clone `nooblyjs-core` next to this repository (it is referenced as `../nooblyjs-core`) and run `npm install` in both folders.
2. Run `npm run dev:web` and open `http://localhost:3003/applications/blog`.
3. Sign in to the author dashboard at `/applications/blog/author` as `admin@localhost`. The first run writes the password to `.app-blog/data/INITIAL_ADMIN_PASSWORD.txt` (or set `DEFAULT_ADMIN_PASSWORD` beforehand). Delete that file once you have signed in.
4. In production, set `NODE_ENV=production` and `SESSION_SECRET`.

Creating, editing, publishing and deleting posts, moderating comments and changing site settings require an admin login. Reading, clapping, bookmarking and commenting are public.

## Status
The project is in active development. Follow the release milestones in the PRD to track upcoming capabilities (draft editor, engagement features, moderation tooling, analytics, and beyond).
