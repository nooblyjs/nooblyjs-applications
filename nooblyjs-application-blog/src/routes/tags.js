'use strict';

const { API_BASE_PATH, CONTAINERS, toSlug, sendJson, sendError } = require('./shared/helpers');

/**
 * Registers tag routes.
 * @param {Object} app Express application
 * @param {Object} dataStore Data store instance
 * @param {Object} log Logger instance
 */
module.exports = (app, dataStore, log) => {
  const { listRecords } = dataStore;

  /**
   * GET ALL TAGS (with post counts, sorted by popularity)
   */
  app.get(`${API_BASE_PATH}/tags`, async (_req, res) => {
    try {
      const posts = await listRecords(CONTAINERS.POSTS);
      const tagCounts = new Map();
      posts.forEach((post) => {
        if (post.status !== 'published') return;
        (post.tags || []).forEach((tag) => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      });
      const tags = Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count, slug: toSlug(tag) }))
        .sort((a, b) => b.count - a.count);
      sendJson(res, 200, tags, { total: tags.length });
    } catch (error) {
      log.error('Failed to list tags', { error: error.message });
      sendError(res, 500, 'TAG_LIST_FAILED', 'Unable to load tags.');
    }
  });
};
