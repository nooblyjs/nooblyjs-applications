'use strict';

const { API_BASE_PATH, CONTAINERS, sendJson, sendError } = require('./shared/helpers');

/**
 * Registers search routes.
 * @param {Object} app Express application
 * @param {Object} dataStore Data store instance
 * @param {Object} log Logger instance
 */
module.exports = (app, dataStore, log) => {
  const { listRecords } = dataStore;

  /**
   * SEARCH POSTS (full-text search across title, content, tags, author)
   */
  app.get(`${API_BASE_PATH}/search`, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || !q.trim()) {
        return sendJson(res, 200, []);
      }

      const posts = await listRecords(CONTAINERS.POSTS);
      const term = q.trim().toLowerCase();
      const matches = posts.filter((post) => {
        if (post.status !== 'published') return false;
        return (
          post.title?.toLowerCase().includes(term) ||
          post.subtitle?.toLowerCase().includes(term) ||
          post.excerpt?.toLowerCase().includes(term) ||
          post.content?.toLowerCase().includes(term) ||
          post.author?.name?.toLowerCase().includes(term) ||
          (post.tags || []).some((tag) => tag.toLowerCase().includes(term))
        );
      });
      log.info('Search completed', { query: q, matchCount: matches.length });
      sendJson(res, 200, matches);
    } catch (error) {
      log.error('Failed to search posts', { error: error.message });
      sendError(res, 500, 'SEARCH_FAILED', 'Unable to search posts.');
    }
  });
};
