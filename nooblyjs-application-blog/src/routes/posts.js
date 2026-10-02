'use strict';

const { API_BASE_PATH, CONTAINERS, toSlug, buildExcerpt, estimateReadTime, normalizeTags, normalizeAuthor, sendJson, sendError } = require('./shared/helpers');

/**
 * Registers post CRUD routes.
 * @param {Object} app Express application
 * @param {Object} dataStore Data store instance
 * @param {Object} log Logger instance
 * @param {Function} requireAuthor Middleware guarding author-only mutations
 */
module.exports = (app, dataStore, log, requireAuthor) => {
  const { listRecords, getRecord, createRecord, updateRecord, deleteRecord, invalidateFeedCache, upsertSearchIndex, removeFromSearchIndex } = dataStore;

  /**
   * Helper: Create a post record with derived fields.
   */
  const createPostRecord = async (payload) => {
    const status = payload.status || 'draft';
    const publishedAt = status === 'published' ? payload.publishedAt || new Date().toISOString() : null;
    const tags = normalizeTags(payload.tags);
    const content = payload.content || '';
    const title = (payload.title || '').trim();
    const subtitle = (payload.subtitle || '').trim();
    const author = normalizeAuthor(payload.author);

    const baseRecord = {
      title,
      subtitle,
      slug: payload.slug || toSlug(title || `post-${Date.now()}`),
      author,
      content,
      excerpt: payload.excerpt || buildExcerpt(content, 220),
      coverImage: payload.coverImage || null,
      tags,
      tagSlugs: tags.map((tag) => toSlug(tag)),
      status,
      publishedAt,
      scheduledFor: payload.scheduledFor || null,
      readTimeMinutes: estimateReadTime(content),
      stats: {
        views: payload.stats?.views || 0,
        claps: payload.stats?.claps || 0,
        bookmarks: payload.stats?.bookmarks || 0,
        comments: payload.stats?.comments || 0
      },
      seo: {
        title: payload.seo?.title || title,
        description: payload.seo?.description || buildExcerpt(content, 160),
        canonicalUrl: payload.seo?.canonicalUrl || null
      },
      contentFormat: payload.contentFormat || 'markdown'
    };

    const created = await createRecord(CONTAINERS.POSTS, baseRecord);
    await upsertSearchIndex(created);
    await invalidateFeedCache();
    return created;
  };

  /**
   * GET POSTS COLLECTION (with filtering, searching, sorting)
   */
  app.get(`${API_BASE_PATH}/posts`, async (req, res) => {
    try {
      const { status, tag, author, q, limit } = req.query;
      const posts = await listRecords(CONTAINERS.POSTS);
      let filtered = posts;

      if (status) {
        filtered = filtered.filter((post) => post.status === status);
      }

      if (tag) {
        filtered = filtered.filter((post) => (post.tags || []).includes(tag));
      }

      if (author) {
        filtered = filtered.filter((post) => post.author?.handle === author || post.author?.name === author);
      }

      if (q) {
        const query = q.trim();
        const searchTerm = query.toLowerCase();
        filtered = filtered.filter((post) => {
          return (
            post.title?.toLowerCase().includes(searchTerm) ||
            post.subtitle?.toLowerCase().includes(searchTerm) ||
            post.excerpt?.toLowerCase().includes(searchTerm) ||
            post.author?.name?.toLowerCase().includes(searchTerm) ||
            (post.tags || []).some((tagValue) => tagValue.toLowerCase().includes(searchTerm))
          );
        });
      }

      filtered.sort((a, b) => {
        const dateB = new Date(b.publishedAt || b.updatedAt || b.createdAt).getTime();
        const dateA = new Date(a.publishedAt || a.updatedAt || a.createdAt).getTime();
        return dateB - dateA;
      });

      const limited = limit ? filtered.slice(0, Number(limit)) : filtered;

      sendJson(res, 200, limited, {
        total: filtered.length,
        limit: limit ? Number(limit) : undefined
      });
    } catch (error) {
      log.error('Failed to list posts', { error: error.message });
      sendError(res, 500, 'POST_LIST_FAILED', 'Unable to load posts.');
    }
  });

  /**
   * CREATE POST
   */
  app.post(`${API_BASE_PATH}/posts`, requireAuthor, async (req, res) => {
    try {
      const { title, content, tags, status, subtitle, author, coverImage, seo, scheduledFor } = req.body || {};
      if (!title || !content) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Title and content are required.');
      }

      const post = await createPostRecord({
        title,
        subtitle,
        content,
        tags,
        status,
        author,
        coverImage,
        seo,
        scheduledFor
      });

      sendJson(res, 201, post);
    } catch (error) {
      log.error('Failed to create post', { error: error.message });
      sendError(res, 500, 'POST_CREATE_FAILED', 'Unable to create post.');
    }
  });

  /**
   * GET POST DETAIL (increments view count)
   */
  app.get(`${API_BASE_PATH}/posts/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const post = await getRecord(CONTAINERS.POSTS, id);
      if (!post) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      const updated = await updateRecord(CONTAINERS.POSTS, post.id, (existing) => {
        const stats = {
          ...existing.stats,
          views: (existing.stats?.views || 0) + 1
        };
        return { ...existing, stats };
      });

      sendJson(res, 200, updated || post);
    } catch (error) {
      log.error('Failed to load post', { error: error.message });
      sendError(res, 500, 'POST_FETCH_FAILED', 'Unable to load post.');
    }
  });

  /**
   * UPDATE POST
   */
  app.patch(`${API_BASE_PATH}/posts/:id`, requireAuthor, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await getRecord(CONTAINERS.POSTS, id);
      if (!existing) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      const payload = req.body || {};
      if (payload.title !== undefined && !payload.title) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Title cannot be empty.');
      }
      if (payload.content !== undefined && !payload.content) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Content cannot be empty.');
      }

      // Keep the current slug if the requested one already belongs to another post.
      const requestedTitle = payload.title !== undefined ? payload.title.trim() : existing.title;
      let nextSlug = payload.slug ? toSlug(payload.slug) : toSlug(requestedTitle) || existing.slug;
      if (nextSlug !== existing.slug) {
        const posts = await listRecords(CONTAINERS.POSTS);
        const taken = posts.some((post) => post.id !== existing.id && (post.id === nextSlug || post.slug === nextSlug));
        if (taken) nextSlug = existing.slug;
      }

      const updated = await updateRecord(CONTAINERS.POSTS, existing.id, (current) => {
        const nextStatus = payload.status || current.status;
        const content = payload.content !== undefined ? payload.content : current.content;
        const tags = payload.tags ? normalizeTags(payload.tags) : current.tags;
        const title = payload.title !== undefined ? payload.title.trim() : current.title;
        const subtitle = payload.subtitle !== undefined ? payload.subtitle.trim() : current.subtitle;
        const author = payload.author ? normalizeAuthor(payload.author) : current.author;

        return {
          ...current,
          title,
          subtitle,
          slug: nextSlug,
          content,
          excerpt: payload.excerpt || buildExcerpt(content, 220),
          coverImage: payload.coverImage !== undefined ? payload.coverImage : current.coverImage,
          tags,
          tagSlugs: tags.map((tag) => toSlug(tag)),
          status: nextStatus,
          publishedAt: nextStatus === 'published' ? current.publishedAt || new Date().toISOString() : current.publishedAt,
          scheduledFor: payload.scheduledFor !== undefined ? payload.scheduledFor : current.scheduledFor,
          readTimeMinutes: estimateReadTime(content),
          stats: {
            ...current.stats
          },
          seo: {
            title: payload.seo?.title || current.seo?.title || title,
            description: payload.seo?.description || current.seo?.description || buildExcerpt(content, 160),
            canonicalUrl: payload.seo?.canonicalUrl !== undefined ? payload.seo?.canonicalUrl : current.seo?.canonicalUrl
          },
          author
        };
      });

      await upsertSearchIndex(updated);
      await invalidateFeedCache();
      sendJson(res, 200, updated);
    } catch (error) {
      log.error('Failed to update post', { error: error.message });
      sendError(res, 500, 'POST_UPDATE_FAILED', 'Unable to update post.');
    }
  });

  /**
   * DELETE POST
   */
  app.delete(`${API_BASE_PATH}/posts/:id`, requireAuthor, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await getRecord(CONTAINERS.POSTS, id);
      if (!existing) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      const success = await deleteRecord(CONTAINERS.POSTS, existing.id);
      if (!success) {
        return sendError(res, 500, 'POST_DELETE_FAILED', 'Unable to delete post.');
      }

      await removeFromSearchIndex(existing.id);
      await invalidateFeedCache();
      sendJson(res, 200, { id: existing.id }, { deleted: true });
    } catch (error) {
      log.error('Failed to delete post', { error: error.message });
      sendError(res, 500, 'POST_DELETE_FAILED', 'Unable to delete post.');
    }
  });

  /**
   * PUBLISH POST (or schedule it)
   */
  app.post(`${API_BASE_PATH}/posts/:id/publish`, requireAuthor, async (req, res) => {
    try {
      const { id } = req.params;
      const { scheduledFor } = req.body || {};
      const existing = await getRecord(CONTAINERS.POSTS, id);
      if (!existing) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      const updated = await updateRecord(CONTAINERS.POSTS, existing.id, (current) => ({
        ...current,
        status: scheduledFor ? 'scheduled' : 'published',
        scheduledFor: scheduledFor || null,
        publishedAt: scheduledFor ? current.publishedAt : current.publishedAt || new Date().toISOString()
      }));

      await upsertSearchIndex(updated);
      await invalidateFeedCache();
      sendJson(res, 200, updated);
    } catch (error) {
      log.error('Failed to publish post', { error: error.message });
      sendError(res, 500, 'POST_PUBLISH_FAILED', 'Unable to publish post.');
    }
  });
};
