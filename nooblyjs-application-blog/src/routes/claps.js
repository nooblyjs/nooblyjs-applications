'use strict';

const { API_BASE_PATH, CONTAINERS, sendJson, sendError } = require('./shared/helpers');

/**
 * Registers clap and bookmark routes.
 * @param {Object} app Express application
 * @param {Object} dataStore Data store instance
 * @param {Object} log Logger instance
 */
module.exports = (app, dataStore, log) => {
  const { getRecord, updateRecord, invalidateFeedCache } = dataStore;

  /**
   * CLAP FOR A POST (add applause, max 50 per request)
   */
  app.post(`${API_BASE_PATH}/posts/:id/clap`, async (req, res) => {
    try {
      const { id } = req.params;
      const { amount = 1 } = req.body || {};
      const clapsToAdd = Math.max(1, Math.min(Number(amount) || 1, 50));

      const updated = await updateRecord(CONTAINERS.POSTS, id, (current) => {
        if (!current) return null;
        const stats = {
          ...current.stats,
          claps: (current.stats?.claps || 0) + clapsToAdd
        };
        return { ...current, stats };
      });

      if (!updated) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      await invalidateFeedCache();
      sendJson(res, 200, updated);
    } catch (error) {
      log.error('Failed to clap post', { error: error.message });
      sendError(res, 500, 'POST_CLAP_FAILED', 'Unable to record applause.');
    }
  });

  /**
   * BOOKMARK A POST (increment bookmark count)
   */
  app.post(`${API_BASE_PATH}/posts/:id/bookmark`, async (req, res) => {
    try {
      const { id } = req.params;
      const updated = await updateRecord(CONTAINERS.POSTS, id, (current) => {
        if (!current) return null;
        const stats = {
          ...current.stats,
          bookmarks: (current.stats?.bookmarks || 0) + 1
        };
        return { ...current, stats };
      });
      if (!updated) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }
      await invalidateFeedCache();
      sendJson(res, 200, updated);
    } catch (error) {
      log.error('Failed to bookmark post', { error: error.message });
      sendError(res, 500, 'POST_BOOKMARK_FAILED', 'Unable to bookmark post.');
    }
  });
};
