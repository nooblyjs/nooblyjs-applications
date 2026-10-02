# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NooblyJS Blog is a Medium-inspired publishing platform built on top of the NooblyJS Core accelerator. It provides an API-first backend with a Bootstrap 5 client for reading, authoring, and moderating blog content.

**Key Architecture Principles:**
- Native Node.js runtime with Express (no high-level frameworks)
- API-first design: all capabilities exposed through `/applications/blog/api/...` endpoints
- Service Registry pattern via NooblyJS Core for cross-cutting concerns (data, caching, filing, search, etc.)
- Decoupled client/API: Bootstrap 5 client consumes JSON endpoints via ES modules

## Development Commands

### Running the Application

```bash
# Start development server (runs on port 3003 by default)
npm run dev:web

# Stop server (kills process on port 3003)
npm run kill
```

### Environment

- Default port: `3003` (override with `PORT` environment variable)
- `nooblyjs-core` is a relative dependency (`../nooblyjs-core`); run `npm install` in that sibling folder too, or the app fails with `Cannot find module 'express'`
- Service data (users, sessions): `./.app-blog/data` (set via `options.dataDir` in `app.js`)
- Site settings: `./.data/blog-settings.json`
- Posts storage: `./posts/published` and `./posts/drafts` (scheduled posts live in `drafts`)
- `SESSION_SECRET`: required when `NODE_ENV=production`
- First run creates an `admin@localhost` user; its password is written to `./.app-blog/data/INITIAL_ADMIN_PASSWORD.txt` (or set `DEFAULT_ADMIN_PASSWORD`)

## Architecture Overview

### Application Bootstrap (`app.js`)

The entry point initializes the NooblyJS service registry with memory-based providers:

```javascript
const serviceRegistry = require('nooblyjs-core');
serviceRegistry.initialize(app, eventEmitter, options);
```

Services are instantiated as singletons using the provider pattern:
- `logger('console')` - Structured logging
- `cache('memory')` - In-memory caching (Redis in production)
- `dataService('memory')` - JSON document storage (posts use the file post store instead)
- `filing('local')` - Local file system operations (S3 in production)
- `queue('memory')` - Task queueing
- `scheduling('memory')` - Task scheduling
- `searching('memory')` - Full-text search
- `measuring('memory')` - Metrics collection
- `authservice('file')` - Authentication

### Application Factory (`index.js`)

The factory pattern is used to instantiate the blog application:

```javascript
module.exports = (app, server, eventEmitter, serviceRegistry, options) => {
  // Retrieve services from registry
  const logger = serviceRegistry.logger('console');
  const dataService = serviceRegistry.dataService('memory');

  // Register routes and views
  Routes(options, eventEmitter, services);
  Views(options, eventEmitter, services);
}
```

### Routes Layer (`src/routes/index.js`)

**API Base Path:** `/applications/blog/api`

The routes layer orchestrates:
1. **Data containers**: Uses NooblyJS dataService with predefined containers (`blog_posts`, `blog_comments`, `blog_bookmarks`, `blog_site_settings`). Posts are actually routed to the file post store, and comments are stored inside each post file.
2. **File-backed post store**: Custom storage implementation in `src/services/filePostStore.js` that persists posts as structured text files
3. **Search indexing**: Posts are automatically indexed for full-text search when published
4. **Feed caching**: Home feed is cached for 1 minute to reduce computation

**Authentication:** Author actions reuse `serviceRegistry.servicesAuthMiddleware` (admin role, via session cookie, `Authorization: Bearer <token>`, or API key). Guarded endpoints are marked 🔒 below; unauthenticated calls get 401 JSON. Reader actions (claps, bookmarks, new comments) stay public.

**Key API Endpoints:**
- `GET /api/status` - Service health
- `GET /api/feed/home` - Featured, latest, trending posts + tags
- `GET /api/posts?status=&tag=&author=&q=&limit=` - List/search posts
- `POST /api/posts` 🔒 - Create post
- `GET /api/posts/:id` - Get post by id or slug (increments view count)
- `PATCH /api/posts/:id` 🔒 - Update post (slug follows the title unless another post already uses it)
- `DELETE /api/posts/:id` 🔒 - Delete post
- `POST /api/posts/:id/publish` 🔒 - Publish or schedule post (nothing yet promotes scheduled posts when their time arrives)
- `POST /api/posts/:id/clap` - Add claps (1-50 per request)
- `POST /api/posts/:id/bookmark` - Bookmark post
- `GET /api/posts/:id/comments` - List comments
- `POST /api/posts/:id/comments` - Create comment
- `PATCH /api/comments/:id` 🔒 - Update/moderate comment
- `GET /api/tags` - List all tags with counts
- `GET /api/settings` / `PATCH /api/settings` 🔒 - Site settings (colours must be hex, links must be http(s))
- `GET /api/search?q=` - Search posts
- `GET /sitemaps` - XML sitemap for published posts

### Views Layer (`src/views/index.js`)

**View Base Path:** `/applications/blog`

Serves HTML pages and static assets:
- `/applications/blog` - Home page (`index.html`)
- `/applications/blog/posts/:slug` - Post detail page
- `/applications/blog/author` - Author dashboard (protected)
- `/applications/blog/assets/*` - Client JS modules from `src/views/js/`
- `/applications/blog/manifest.json` - PWA manifest

### File Post Store (`src/services/filePostStore.js`)

Custom storage implementation that persists posts as structured text files:

**File Structure:**
```
posts/
  published/
    post-slug.post
  drafts/
    another-post.post
```

**File Format:**
```
Title: Post Title
Subtitle: Subtitle text
Author: Author Name
Tags: tag1, tag2, tag3
Cover Image URL: https://...
Slug: post-slug
Status: published
Published: 2024/03/20
Schedule: 2024/06/01 11:00
Created: 2024-03-19T07:15:00.000Z
Updated: 2024-03-20T09:30:00.000Z
Claps: 312
Bookmarks: 146
Views: 1280
Comments: 14

Story:

Post content goes here...
```

**Key Operations:**
- `listAll()` - Reads all posts from both directories
- `get(id)` - Retrieves post by ID
- `create(payload)` - Creates new post with unique ID
- `update(id, updater)` - Updates post (can move between draft/published dirs)
- `remove(id)` - Deletes post file

Posts move between directories based on status changes (draft ↔ published).

## Data Model

### Post Record
```javascript
{
  id: string,              // Unique identifier (slug-based)
  title: string,
  subtitle: string,
  slug: string,            // URL-friendly identifier
  author: {
    name: string,
    handle: string,        // Slug of name
    avatar: string|null,
    bio: string|null
  },
  content: string,         // Markdown content
  excerpt: string,         // Auto-generated (220 chars)
  coverImage: string|null,
  tags: string[],          // Max 10 tags
  tagSlugs: string[],      // URL-friendly versions
  status: 'draft'|'published'|'scheduled',
  publishedAt: string|null,   // ISO timestamp
  scheduledFor: string|null,  // ISO timestamp
  readTimeMinutes: number,    // Auto-calculated (220 words/min)
  stats: {
    views: number,
    claps: number,        // Max 50 per request (not tracked per user)
    bookmarks: number,
    comments: number
  },
  seo: {
    title: string,
    description: string,
    canonicalUrl: string|null
  },
  contentFormat: 'markdown',
  createdAt: string,      // ISO timestamp
  updatedAt: string       // ISO timestamp
}
```

### Comment Record
```javascript
{
  id: string,
  postId: string,
  author: { name, handle, avatar, bio },
  body: string,
  status: 'published'|'pending'|'flagged',
  createdAt: string,
  updatedAt: string
}
```

## Search Implementation

Posts are indexed in the NooblyJS search service when:
1. Post status changes to 'published'
2. Published post is updated
3. Search warmup runs on application start

**Search Document Structure:**
- Denormalized with all searchable fields (title, subtitle, content, tags, author)
- Includes `searchText` field for full-text matching
- Only published posts are indexed

**Note:** `GET /api/search` does not query this index yet; it filters posts in memory on title, subtitle, excerpt, content, author, and tags.

## Feed Generation

The home feed aggregates:
- **Featured**: Top trending post
- **Latest**: 6 most recent published posts
- **Trending**: 5 posts ranked by `(claps × 3) + (bookmarks × 2) + views`
- **Tags**: Top 10 tags by post count
- **Drafts**: 6 most recent drafts
- **Totals**: Counts of all posts, published, and drafts

Feed is cached for 1 minute and invalidated on any post mutation.

## Client Architecture

Located in `src/views/`:
- `index.html` - Home and post detail pages
- `author.html` - Author dashboard for creating/editing posts
- `js/app.js` - Main client application module
- `js/author.js` - Author dashboard module
- `js/ui.js` - `BlogUI.toast()` / `BlogUI.confirm()` built on Bootstrap toasts and modals

Styling uses Bootstrap 5.3 and Bootstrap Icons (CDN), then `css/styles.css` (shared Noobly design system, copied verbatim from `nooblyjs/styling/styles.css` — don't edit it here), then `css/blog.css` for blog-specific overrides. The Customise Accent/Background colours override the `--accent`/`--bg` tokens via `generateThemeCSS()` in `src/views/index.js`.

Client fetches data from API endpoints and renders using vanilla JavaScript (no React/Vue).

## NooblyJS Core Integration

### Service Registry Pattern

All services are accessed through the service registry singleton:

```javascript
const cache = serviceRegistry.cache('memory');
const data = serviceRegistry.dataService('memory');
const filing = serviceRegistry.filing('local');
```

### Provider Swapping

Switch between providers by changing the provider name:
- Development: `memory`, `file`, `local`, `console`
- Production: `redis`, `postgres`, `s3`, `winston`

### Event System

Global EventEmitter for inter-service communication:
```javascript
eventEmitter.on('post:published', (data) => {
  // Handle post publication event
});
```

## Common Development Patterns

### Creating a New Endpoint

1. Add route handler in `src/routes/index.js`
2. Use helper functions: `sendJson()`, `sendError()`
3. Access data via `listRecords()`, `getRecord()`, `createRecord()`, `updateRecord()`, `deleteRecord()`
4. Invalidate feed cache with `invalidateFeedCache()` for mutations
5. Update search index with `upsertSearchIndex()` for published posts

### Modifying Post Schema

1. Update post creation/update logic in routes
2. Modify `buildRecordFromMeta()` in `filePostStore.js` for file parsing
3. Update `serializePost()` in `filePostStore.js` for file writing
4. Update `buildSearchDocument()` if search fields change
5. Update client-side TypeScript interfaces if using types

### Adding a New Service

1. Initialize service in `app.js`: `serviceRegistry.serviceName('provider')`
2. Pass to factory in `index.js`
3. Use in routes or views layer

## Testing

No test framework is currently configured in this repository. Tests would typically use:
- Node.js built-in test runner or Jest
- NooblyJS Core's memory providers for deterministic tests
- In-memory service registry for isolation

## Production Considerations

When deploying to production:

1. **Swap providers** in `app.js`:
   - `cache('redis')` with connection config
   - `dataService('postgres')` for relational guarantees
   - `filing('s3')` for distributed file storage

2. **Environment variables**:
   - `PORT` - Server port
   - `NODE_ENV=production`
   - Provider-specific configs (Redis host, S3 bucket, etc.)

3. **API Keys**:
   - Use `serviceRegistry.generateApiKey()`
   - Protect `/services/*` endpoints with API key middleware
   - Configure `requireApiKey` and `excludePaths` in registry initialization

4. **Observability**:
   - Enable structured logging with production logger
   - Export metrics from measuring service to Prometheus
   - Monitor feed cache hit rates

## Documentation References

- **Product Requirements**: `docs/nooblys-blog-prd.md` - Full feature specification and roadmap
- **NooblyJS Core Usage**: `docs/nooblyjs-core-usage-guide-concise.md` - Service registry patterns and API reference
- **NooblyJS Core GitHub**: https://github.com/StephenBooysen/nooblyjs-core
- **NooblyJS Core NPM**: https://www.npmjs.com/package/noobly-core
