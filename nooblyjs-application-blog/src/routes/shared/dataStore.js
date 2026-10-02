'use strict';

const createFilePostStore = require('../../services/filePostStore');
const { CONTAINERS, CACHE_KEYS, ONE_MINUTE, toSlug, buildExcerpt, estimateReadTime, normalizeTags, normalizeAuthor, buildSearchDocument } = require('./helpers');

/**
 * Initializes data store with services and returns data access functions.
 * @param {Object} options
 * @param {import('express').Application} options.app
 * @param {Object} options.logger
 * @param {Object} options.dataService
 * @param {Object} options.cache
 * @param {Object} options.filing
 * @param {Object} options.search
 * @return {Promise<Object>}
 */
async function initializeDataStore(options) {
  const { dataService, cache, filing, search, logger } = options;
  const provider = dataService.provider;
  const log = logger || {};

  const postStore = createFilePostStore({
    filing,
    logger: log,
    toSlug,
    buildExcerpt,
    estimateReadTime,
    normalizeTags,
    normalizeAuthor
  });

  const postsReady = postStore
    .ready()
    .catch((error) => {
      log.error?.('Failed to initialize post storage', { error: error.message });
      throw error;
    });

  // Warm up search index
  postsReady
    .then(async () => {
      if (!search) return;
      try {
        const posts = await postStore.listAll();
        // upsertSearchIndex will be called when data store is ready
        log.info?.('Post storage initialized', { count: posts.length });
      } catch (error) {
        log.warn?.('Failed to initialize posts', { error: error.message });
      }
    })
    .catch((error) => {
      log.warn?.('Post initialization skipped', { error: error.message });
    });

  /**
   * Ensures a container exists on the data service.
   */
  const ensureContainer = async (containerName) => {
    const containers = provider.containers;
    if (containers && containers.has(containerName)) {
      return;
    }
    try {
      await dataService.createContainer(containerName);
    } catch (error) {
      const alreadyExists = typeof error.message === 'string' && error.message.includes('already exists');
      if (!alreadyExists) {
        log.error?.('Failed to initialize container', { containerName, error: error.message });
        throw error;
      }
    }
  };

  const containersReady = (async () => {
    for (const container of Object.values(CONTAINERS)) {
      await ensureContainer(container);
    }
  })();

  /**
   * Retrieves the backing map for a container.
   */
  const getContainerMap = (container) => {
    return provider.containers?.get(container) || new Map();
  };

  /**
   * Lists all records for a container.
   */
  const listRecords = async (container) => {
    if (container === CONTAINERS.POSTS) {
      await postsReady;
      return postStore.listAll();
    }
    await containersReady;

    try {
      const records = await dataService.getAll(container);
      return Array.isArray(records) ? records : [];
    } catch (error) {
      log.warn?.('Failed to list records, falling back to empty array', { container, error: error.message });
      return [];
    }
  };

  /**
   * Retrieves a record by id.
   */
  const getRecord = async (container, id) => {
    if (container === CONTAINERS.POSTS) {
      await postsReady;
      return postStore.get(id);
    }
    await containersReady;
    try {
      const record = await dataService.getByUuid(container, id);
      return record || null;
    } catch (error) {
      return null;
    }
  };

  /**
   * Persists a new record.
   */
  const createRecord = async (container, payload) => {
    if (container === CONTAINERS.POSTS) {
      await postsReady;
      return postStore.create(payload);
    }
    await containersReady;
    const now = new Date().toISOString();
    const record = { ...payload, createdAt: payload.createdAt || now, updatedAt: payload.updatedAt || now };
    const id = await dataService.add(container, record);
    const saved = await dataService.getByUuid(container, id);
    return saved || { ...record, id };
  };

  /**
   * Updates an existing record in-place.
   */
  const updateRecord = async (container, id, updater) => {
    if (container === CONTAINERS.POSTS) {
      await postsReady;
      return postStore.update(id, updater);
    }
    await containersReady;
    try {
      const existing = await dataService.getByUuid(container, id);
      if (!existing) return null;

      const now = new Date().toISOString();
      const next = typeof updater === 'function' ? updater(existing) : { ...existing, ...updater };
      next.id = id;
      next.updatedAt = now;

      await dataService.update(container, id, next);
      return next;
    } catch (error) {
      log.error?.('Failed to update record', { container, id, error: error.message });
      return null;
    }
  };

  /**
   * Removes a record.
   */
  const deleteRecord = async (container, id) => {
    if (container === CONTAINERS.POSTS) {
      await postsReady;
      return postStore.remove(id);
    }
    await containersReady;
    try {
      const success = await dataService.remove(container, id);
      return success;
    } catch (error) {
      log.error?.('Failed to delete record', { container, id, error: error.message });
      return false;
    }
  };

  /**
   * Invalidates cached feed data.
   */
  const invalidateFeedCache = async () => {
    if (cache && typeof cache.delete === 'function') {
      await cache.delete(CACHE_KEYS.HOME_FEED);
    }
  };

  /**
   * Updates the search index for a post.
   */
  const upsertSearchIndex = async (post) => {
    if (!search) return;
    try {
      await search.remove(post.id, 'blog-posts');
    } catch (_) {
      // ignore remove errors
    }
    if (post.status !== 'published') return;
    const document = buildSearchDocument(post);
    if (!document) return;
    try {
      log.info?.('Indexing post for search', {
        postId: post.id,
        title: post.title,
        hasSearchText: !!document.searchText,
        searchTextLength: document.searchText?.length || 0,
        searchTextSample: document.searchText?.substring(0, 100)
      });
      await search.add(post.id, document, 'blog-posts');
      log.info?.('Successfully indexed post', { postId: post.id });
    } catch (error) {
      log.warn?.('Failed to index post for search', { postId: post.id, error: error.message });
    }
  };

  /**
   * Removes a post from the search index.
   */
  const removeFromSearchIndex = async (id) => {
    if (!search) return;
    try {
      await search.remove(id, 'blog-posts');
    } catch (error) {
      log.warn?.('Failed to remove post from search index', { postId: id, error: error.message });
    }
  };

  /**
   * Builds the home feed payload.
   */
  const buildHomeFeed = async () => {
    const posts = await listRecords(CONTAINERS.POSTS);
    const published = posts.filter((post) => post.status === 'published');

    const sortedByFreshness = [...published].sort((a, b) => {
      const dateB = new Date(b.publishedAt || b.updatedAt || b.createdAt).getTime();
      const dateA = new Date(a.publishedAt || a.updatedAt || a.createdAt).getTime();
      return dateB - dateA;
    });

    const trending = [...published].sort((a, b) => {
      const scoreA = (a.stats?.claps || 0) * 3 + (a.stats?.bookmarks || 0) * 2 + (a.stats?.views || 0);
      const scoreB = (b.stats?.claps || 0) * 3 + (b.stats?.bookmarks || 0) * 2 + (b.stats?.views || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      const freshB = new Date(b.publishedAt || b.updatedAt || b.createdAt).getTime();
      const freshA = new Date(a.publishedAt || a.updatedAt || a.createdAt).getTime();
      return freshB - freshA;
    });

    const featured = trending.slice(0, 1);
    const latest = sortedByFreshness.slice(0, 6);
    const trendingShort = trending.slice(0, 5);

    const tagCounts = new Map();
    published.forEach((post) => {
      (post.tags || []).forEach((tag) => {
        const count = tagCounts.get(tag) || 0;
        tagCounts.set(tag, count + 1);
      });
    });
    const tags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count, slug: toSlug(tag) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const drafts = posts.filter((post) => post.status !== 'published');

    return {
      featured,
      latest,
      trending: trendingShort,
      tags,
      drafts: drafts.slice(0, 6),
      totals: {
        posts: posts.length,
        published: published.length,
        drafts: drafts.length
      }
    };
  };

  /**
   * Retrieves the home feed with caching.
   */
  const getHomeFeed = async () => {
    if (cache && typeof cache.get === 'function' && typeof cache.put === 'function') {
      const cached = await cache.get(CACHE_KEYS.HOME_FEED);
      if (cached && cached.expiresAt && cached.expiresAt > Date.now() && cached.value) {
        return cached.value;
      }
      const fresh = await buildHomeFeed();
      await cache.put(CACHE_KEYS.HOME_FEED, { value: fresh, expiresAt: Date.now() + ONE_MINUTE });
      return fresh;
    }
    return buildHomeFeed();
  };

  // Initialize containers and search
  containersReady
    .then(async () => {
      try {
        const posts = await postStore.listAll();
        await Promise.allSettled(posts.map((post) => upsertSearchIndex(post)));
        log.info?.('Search index warmed with existing posts', { count: posts.length });
      } catch (error) {
        log.warn?.('Failed to warm search index', { error: error.message });
      }
    })
    .catch((error) => {
      log.warn?.('Search warmup skipped', { error: error.message });
    });

  return {
    postsReady,
    containersReady,
    getContainerMap,
    listRecords,
    getRecord,
    createRecord,
    updateRecord,
    deleteRecord,
    invalidateFeedCache,
    upsertSearchIndex,
    removeFromSearchIndex,
    buildHomeFeed,
    getHomeFeed
  };
}

module.exports = { initializeDataStore };
