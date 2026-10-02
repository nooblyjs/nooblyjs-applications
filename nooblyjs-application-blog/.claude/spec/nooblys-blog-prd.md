# Noobly Blog Application PRD

## 1. Product Overview
- Build a Medium-style publishing platform targeted at independent writers and small teams.
- Deliver an API-first backend on native Node.js (no frameworks that abstract the HTTP layer) exposing JSON endpoints while leveraging the NooblyJS Core service registry for cross-cutting capabilities.
- Provide a Bootstrap 5 powered client UI that consumes the public API via client-side JavaScript (ES modules) with Bootstrap Icons for visual affordances.
- Support responsive, accessible reading and writing experiences without using React or other component frameworks.

## 2. Goals
- Enable authenticated authors to draft, publish, and manage rich blog posts with tags and cover images.
- Offer readers a modern, distraction-free interface with fast load times, robust content discovery, and engagement tools.
- Make the platform extensible through the REST API to allow future native mobile or partner integrations.
- Ensure the system is production-ready with authentication, role-based permissions, moderation tools, and analytics hooks.

### Non-Goals
- Native mobile apps (deferred but API-friendly).
- Real-time collaborative editing (single-author editing only for v1).
- WYSIWYG editor beyond core text formatting and media embedding.

## 3. Success Metrics
- Time to first meaningful paint on landing page ≤ 2 seconds on 3G.
- ≥ 70% of draft posts published without backend errors or validation failures.
- Reader engagement: average read time ≥ 3 minutes within first month.
- API availability ≥ 99.5%, measured over rolling 30-day window.

## 4. Target Users & Personas
- **Independent Writer:** Publishes weekly, values simple draft-to-publish flow, expects analytics and tagging.
- **Publication Editor:** Manages multiple authors, needs story curation, editing, and scheduled publishing.
- **Reader:** Interested in discovering new content, expects clean reading view, search, bookmarking, and comment capability.
- **Moderator/Admin:** Oversees community guidelines, handles reports, manages user roles, monitors platform health.

## 5. Experience Principles
- API-first: every user-facing capability must be accessible via documented JSON endpoints.
- Progressive disclosure: advanced options hidden until needed (e.g., scheduling, SEO).
- Reader-first: typography, spacing, and theme optimized for long-form reading.
- Performance & accessibility: bootstrap theming configured for WCAG AA, server responds with compressed JSON, interface optimized for minimal blocking scripts.

## 6. Functional Requirements

### 6.1 Authentication & Authorization
- Email/password registration and login with email verification token flow.
- Password reset via emailed token (configurable SMTP provider).
- Session management with HTTP-only cookies (JWT signed session tokens stored server-side for invalidation).
- Role-based permissions: `reader`, `author`, `editor`, `admin`.

### 6.2 Authoring & Publishing
- Draft creation with auto-save (client batches changes, calls PATCH `/posts/:id`).
- Rich text editor supporting headings, bold/italic, blockquotes, code snippets, inline links, ordered/unordered lists.
- Media embedding: cover image upload (single image), inline image uploads (stored via file service), YouTube/Vimeo link embeds.
- Tag management (max 5 per post) with auto-complete from existing tags.
- SEO metadata fields (title tag, description, canonical URL).
- Publishing workflow: draft → review (optional) → published with scheduled release support.
- Version history tracking for posts.

### 6.3 Reading Experience
- Home feed with featured stories, latest posts, trending tags.
- Article page with reading time estimate, author bio, related articles, share buttons.
- Adaptive typography toggle (serif/sans-serif, dark mode).
- Offline-friendly reading through Service Worker caching for last 10 articles viewed.

### 6.4 Discovery & Engagement
- Search across titles, tags, and author names with relevance sorting.
- Tag landing pages with description, follower count, top stories.
- Bookmarking (save to reading list) with pagination.
- Comments with threaded replies, Markdown subset support, moderation queue, and abuse reporting.
- Applause/clap mechanic (per-user limit per post).

### 6.5 Notifications & Emails
- In-app notifications for comment replies, publication invites, scheduled publish success/failure.
- Email digests for subscribed tags/authors (daily/weekly).
- Webhooks for editors to receive third-party notifications (future usage).

### 6.6 Admin & Moderation
- Dashboard to review reported content, manage tags, view analytics snapshots.
- Content takedown and user suspension actions.
- Audit log for admin actions.
- Rate limiting policies configurable per endpoint group.

### 6.7 Analytics
- Track page views, read completion (50% scroll), conversions (signup, publish).
- Author dashboard with post-level metrics (views, reads, claps, comments).
- API endpoints exposing analytics summaries for integration.

## 7. API-First Architecture

### 7.1 Architectural Principles
- Bootstrap the platform with NooblyJS Core's `serviceRegistry`, providing dependency injection, provider pattern, and event-driven coordination across services.
- Maintain a native Node.js `http` server as the entry point; bridge requests into the registry through a thin compatibility layer so we preserve low-level control while reusing accelerator middleware.
- Separate public JSON APIs (`/v1/...`) from accelerator service endpoints (`/services/...`) and static asset delivery to keep clear boundaries.
- Use JSON:API-style conventions: consistent envelope `{ data, meta, errors }`, pagination via `page` and `pageSize`.
- Input validation using JSON Schema per endpoint; responses typed and versioned (`/v1` prefix) with schema references published in the NooblyJS Core documentation portal.
- Authentication via bearer tokens in Authorization header for API clients; session cookies for browser clients hitting the same endpoints, wired through the registry's `authservice`.
- Document API with OpenAPI 3.1 spec stored in repo (`docs/api/openapi.yaml`) and auto-generated HTML docs, synchronized with the registry catalog.

### 7.2 NooblyJS Core Service Integration
- **Initialization:** `serviceRegistry.initialize(app, { apiKeys, requireApiKey, excludePaths })` invoked during bootstrap; API keys required for `/services/...` endpoints, optional for public `/v1/...` routes.
- **Caching:** leverage `serviceRegistry.cache('redis')` for session tokens, feed fragments, and rate-limit counters; fallback to `memory` in local dev.
- **Data storage:** implement a custom `dataservice` provider backed by PostgreSQL for strong relational guarantees; keep `memory` provider for ephemeral test fixtures.
- **Authentication:** use `authservice` provider (`passport` variant) to coordinate email/password, OAuth, and session management.
- **File & media:** use `filing` service (`s3` provider in production, `local` in dev) for cover images and inline assets, wired to CDN invalidation hooks.
- **Messaging & jobs:** combine `queueing` (BullMQ-backed provider) and `scheduling` services for background tasks such as email digests, scheduled publishes, and analytics aggregation.
- **Observability:** connect `logging` (`console` provider writing structured logs) and `measuring` (`memory` or external API) to export metrics to Prometheus.
- **Search:** start with `searching('memory')` for metadata indexing, with roadmap to plug in an external search provider using the same interface.
- **Workflow & moderation:** configure `workflow` service to orchestrate review queues and moderation escalations by chaining data, notifying, and working services.
- **Service endpoints:** expose administrative utilities (health, cache inspection, metrics snapshots) via `/services/{service}/{provider}/...` routes secured by API keys.

### 7.3 API Endpoints (v1)
- `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/logout`.
- `POST /v1/auth/verify-email`, `POST /v1/auth/password-reset/request`, `POST /v1/auth/password-reset/confirm`.
- `GET|POST /v1/users`, `PATCH /v1/users/:id`, `GET /v1/users/:id`.
- `GET|POST /v1/posts`, `GET /v1/posts/:id`, `PATCH /v1/posts/:id`, `DELETE /v1/posts/:id`.
- `POST /v1/posts/:id/publish`, `POST /v1/posts/:id/schedule`, `GET /v1/posts/:id/history`.
- `GET /v1/drafts`, `POST /v1/drafts`, `PATCH /v1/drafts/:id`.
- `GET|POST /v1/tags`, `GET /v1/tags/:slug`, `POST /v1/tags/:slug/follow`, `DELETE /v1/tags/:slug/follow`.
- `GET /v1/feed`, `GET /v1/feed/trending`, `GET /v1/feed/recommended`.
- `GET|POST /v1/posts/:id/comments`, `PATCH /v1/comments/:id`, `DELETE /v1/comments/:id`, `POST /v1/comments/:id/report`.
- `POST /v1/posts/:id/clap`, `DELETE /v1/posts/:id/clap`.
- `GET /v1/bookmarks`, `POST /v1/posts/:id/bookmark`, `DELETE /v1/bookmarks/:id`.
- `GET /v1/notifications`, `PATCH /v1/notifications/:id/read`.
- `GET /v1/analytics/overview`, `GET /v1/analytics/posts/:id`.
- `GET /v1/admin/moderation/queue`, `POST /v1/admin/moderation/:id/resolve`.
- `POST /v1/media/upload`, `DELETE /v1/media/:id`.
- System health: `GET /v1/status`, `GET /v1/status/dependencies`.

### 7.4 API Error Handling
- Standard error envelope `{ errors: [{ code, message, field?, details? }] }`.
- HTTP status conventions: 200/201 success, 400 validation, 401 unauthenticated, 403 unauthorized, 404 missing, 409 conflict (duplicate slug), 429 rate limit, 500 server error.
- Rate limiting headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`.
- Mirror NooblyJS Core error codes (`MISSING_API_KEY`, `INVALID_API_KEY`, etc.) for consistency across `/services/...` and `/v1/...` responses, with translation layer to human-readable messages.

### 7.5 Versioning Strategy
- Path-based API versioning (`/v1/...`), with deprecation headers `Sunset` and `Deprecation` when versions phase out.
- Changelog maintained in `docs/api/changelog.md`.

## 8. Data Model (Initial)
- **User**: id, email, password_hash, display_name, bio, avatar_url, roles[], followers_count, created_at, updated_at.
- **Post**: id, author_id, title, slug, subtitle, content_html, content_raw, cover_image_url, status (draft/published/scheduled), published_at, scheduled_for, read_time_minutes, seo_title, seo_description, canonical_url, created_at, updated_at, version.
- **Tag**: id, name, slug, description, created_at, updated_at.
- **PostTag**: post_id, tag_id.
- **Comment**: id, post_id, author_id, parent_comment_id, body_html, body_raw, status (published/pending/flagged), created_at, updated_at.
- **Bookmark**: id, user_id, post_id, created_at.
- **Clap**: id, user_id, post_id, count (max 50 per user per post), created_at.
- **Notification**: id, user_id, type, payload_json, read_at, created_at.
- **Media**: id, owner_id, type (cover/inline/avatar), url, metadata_json, created_at.
- **AuditLog**: id, actor_id, action, subject_type, subject_id, meta_json, created_at.

## 9. Client-Side Interface (Bootstrap 5)
- Single-page navigation but multi-page architecture (each page loads via HTML templates and fetches data via API; no React SPA).
- Use ES modules for organizing client-side code (`/public/js` with module loader).
- Bootstrap 5 layout grid, typography, and utilities; custom SCSS for theming (compiled ahead).
- Bootstrap Icons for nav, actions (bookmark, clap, edit, delete), status indicators.
- Page templates:
  - Landing/Home feed (`index.html`).
  - Article view (`post.html`).
  - Tag listing (`tag.html`).
  - Author profile (`author.html`).
  - Dashboard (author/editor) (`dashboard/index.html`).
  - Admin area (`admin/index.html`).
  - Auth (`login.html`, `register.html`, `forgot.html`).
- Client script responsibilities:
  - Fetch data via Fetch API with token handling, refreshing session when needed.
  - Manage state in-memory per page (no global store) with localStorage for offline reading list.
  - Render templates using template literals and DOM manipulation, augmented with Bootstrap modals/toasts.
  - Form validation leveraging Bootstrap validation patterns and server-side error displays.

## 10. Backend Technical Overview
- Node.js LTS (18+) running a native `http`/`https` server that forwards requests into NooblyJS Core's Express-compatible bridge; preserves full control over low-level networking while gaining accelerator middleware.
- NooblyJS Core `serviceRegistry` singleton bootstrapped at startup; configuration pulled from environment-driven manifest for provider selection and API key enforcement.
- Database: PostgreSQL 14 accessed through a custom `dataservice` provider using the `pg` library and SQL templates; ensures transactional guarantees and leverages registry lifecycle hooks.
- ORM/Query builder: minimalist SQL helper layer (e.g., `postgres` or hand-rolled) wrapped by repository modules injected via `serviceRegistry.dataService('postgres')`.
- Caching: Redis provider registered via `serviceRegistry.cache('redis')` for sessions, rate limiting, and feed caching; TTL policies managed centrally.
- Background jobs: BullMQ-backed workers integrated through `queueing('redis')` and `working('memory')` providers, with scheduling orchestrated by `scheduling`.
- File storage: `filing('s3')` for production cover assets and `filing('local')` for development/test; hooks trigger CDN purges and generate signed URLs.
- Logging: `logging('console')` providing structured (pino-compatible) JSON logs with correlation IDs; forwarded to monitoring stack.
- Metrics & telemetry: `measuring` service emits counters/histograms exported through Prometheus endpoint; event emitter used for custom analytics.
- Testing: Node `node:test` or Jest for unit/integration; harness spins up an in-memory `serviceRegistry` with `memory` providers for deterministic tests.

## 11. Non-Functional Requirements
- **Performance:** API response median < 150ms; use caching for feeds, compress responses (gzip/brotli).
- **Scalability:** Stateless API nodes behind load balancer; horizontal scaling with shared DB and Redis.
- **Security:** OWASP best practices, rate limiting, password hashing with Argon2, CSRF protection via same-site cookies + double-submit token for form posts, strict CSP headers.
- **Compliance:** GDPR-ready data export/delete endpoints (`/v1/users/:id/export`, `/v1/users/:id/delete` future).
- **Accessibility:** WCAG 2.1 AA, semantic HTML, keyboard navigation, aria labels for icons.
- **Internationalization:** English default; allow translation-ready strings client-side (deferred full i18n).

## 12. Telemetry & Monitoring
- Request logging with correlation IDs emitted through `logging('console')` and aggregated by centralized monitoring.
- Metrics exported from the `measuring` service via Prometheus endpoint (`/v1/status/metrics`), capturing latency, error rates, job queues, service registry health.
- Client analytics using first-party script sending events via `/v1/analytics/events`, processed by queueing workers and stored through the data service.
- Error tracking through Sentry-compatible endpoint or similar service with hooks registered on the service registry's global event emitter.

## 13. Release Plan
- **Milestone 1:** Initialize NooblyJS Core registry with memory providers, wire authentication, establish core API skeleton, deliver public read endpoints, and ship Bootstrap static pages consuming mock data.
- **Milestone 2:** Swap in Redis/PostgreSQL-backed providers, build draft editor with autosave, tagging, publishing workflow, reader-facing feed, and basic analytics capture.
- **Milestone 3:** Enable comments, claps, bookmarks, notifications, moderation tooling, and expose relevant `/services/...` admin utilities with API key gating.
- **Milestone 4:** Launch analytics dashboards, email digests, offline caching, performance polish, documentation, and finalize provider hardening for GA.
- Beta launch with selected authors, gather feedback, stabilize for GA.

## 14. Risks & Mitigations
- **Rich text complexity:** Use well-tested markdown-to-HTML pipeline with sanitization to avoid XSS; progressive enhancement for formatting features.
- **API auth & rate limits:** Implement thorough testing and monitoring; provide detailed error messages and HATEOAS links to documentation.
- **Scalability:** Use load testing before GA; design caching strategy early.
- **Content moderation load:** Provide tooling for admins and escalation path; integrate third-party moderation (future) if needed.
- **Custom NooblyJS Core providers:** Harden the PostgreSQL-backed `dataservice` provider and Express bridge with contract tests to ensure parity with memory providers and prevent regressions during accelerator upgrades.

## 15. Dependencies
- `noobly-core` npm package (service registry accelerator) and provider configuration files.
- PostgreSQL instance, Redis cache, SMTP provider, optional S3-compatible storage.
- CDN for static assets (Bootstrap, icons, client scripts) with self-hosted fallback.
- CI pipeline (GitHub Actions) for tests, linting, and deployment scripts.

## 16. Open Questions
- Should we support custom domains for publications in v1 or reserve for post-MVP?
- What moderation policy (manual vs. automated) is acceptable for launch?
- Are there legal requirements for content licensing or revenue sharing?
- Preferred analytics provider integration (Mixpanel, Segment) or rely on in-house only?
- Requirement for paid subscriptions or paywall features in roadmap?

## 17. Appendix
- Future enhancements: native mobile apps, collaborative editing, AI-assisted drafting, monetization features (paid memberships), integration marketplace.
- Documentation tasks: maintain developer portal with API docs, quickstart scripts, and Postman collection.
