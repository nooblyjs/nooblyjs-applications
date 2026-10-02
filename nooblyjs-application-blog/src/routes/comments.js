'use strict';

const { API_BASE_PATH, CONTAINERS, normalizeAuthor, sendJson, sendError } = require('./shared/helpers');

/**
 * Registers comment routes.
 * @param {Object} app Express application
 * @param {Object} dataStore Data store instance
 * @param {Object} log Logger instance
 * @param {Function} requireAuthor Middleware guarding moderation actions
 */
module.exports = (app, dataStore, log, requireAuthor) => {
  const { getRecord, updateRecord, invalidateFeedCache } = dataStore;

  /**
   * LIST COMMENTS FOR A POST
   */
  app.get(`${API_BASE_PATH}/posts/:id/comments`, async (req, res) => {
    try {
      const { id } = req.params;
      // Look up the post to get its actual ID and comments (id param might be a slug)
      const post = await getRecord(CONTAINERS.POSTS, id);
      if (!post) {
        return sendJson(res, 200, [], { total: 0 });
      }
      const comments = Array.isArray(post.comments) ? post.comments : [];
      const sorted = comments.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return dateA - dateB;
      });
      sendJson(res, 200, sorted, { total: sorted.length });
    } catch (error) {
      log.error('Failed to list comments', { error: error.message });
      sendError(res, 500, 'COMMENT_LIST_FAILED', 'Unable to load comments.');
    }
  });

  /**
   * CREATE COMMENT FOR A POST
   */
  app.post(`${API_BASE_PATH}/posts/:id/comments`, async (req, res) => {
    try {
      const { id } = req.params;
      const post = await getRecord(CONTAINERS.POSTS, id);
      if (!post) {
        return sendError(res, 404, 'POST_NOT_FOUND', 'Post not found.');
      }

      const { body, author } = req.body || {};
      if (!body || !body.trim()) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Comment text is required.');
      }

      const now = new Date().toISOString();
      const commentId = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const commentRecord = {
        id: commentId,
        postId: post.id,
        author: normalizeAuthor(author),
        body: body.trim(),
        status: 'published',
        createdAt: now,
        updatedAt: now
      };

      // Add comment to post's comments array
      const existingComments = Array.isArray(post.comments) ? post.comments : [];
      const updatedPost = await updateRecord(CONTAINERS.POSTS, post.id, (current) => ({
        ...current,
        comments: [...existingComments, commentRecord],
        stats: {
          ...current.stats,
          comments: existingComments.length + 1
        }
      }));
      
      await invalidateFeedCache();
      sendJson(res, 201, commentRecord);
    } catch (error) {
      log.error('Failed to create comment', { error: error.message });
      sendError(res, 500, 'COMMENT_CREATE_FAILED', 'Unable to create comment.');
    }
  });

  /**
   * UPDATE COMMENT
   */
  app.patch(`${API_BASE_PATH}/comments/:id`, requireAuthor, async (req, res) => {
    try {
      const { id } = req.params;
      const { body, status } = req.body || {};

      // Find the comment by searching through all posts
      // This is not the most efficient, but necessary since comments are stored in post files
      let foundComment = null;
      let postWithComment = null;
      
      const allPosts = await dataStore.listRecords(CONTAINERS.POSTS);
      for (const post of allPosts) {
        if (Array.isArray(post.comments)) {
          const comment = post.comments.find(c => c.id === id);
          if (comment) {
            foundComment = comment;
            postWithComment = post;
            break;
          }
        }
      }

      if (!foundComment || !postWithComment) {
        return sendError(res, 404, 'COMMENT_NOT_FOUND', 'Comment not found.');
      }

      // Update the comment in the post's comments array
      const updatedComments = postWithComment.comments.map(c => {
        if (c.id === id) {
          return {
            ...c,
            body: body !== undefined ? body.trim() : c.body,
            status: status || c.status,
            updatedAt: new Date().toISOString()
          };
        }
        return c;
      });

      const updated = await updateRecord(CONTAINERS.POSTS, postWithComment.id, (current) => ({
        ...current,
        comments: updatedComments
      }));

      await invalidateFeedCache();
      const updatedComment = updatedComments.find(c => c.id === id);
      sendJson(res, 200, updatedComment);
    } catch (error) {
      log.error('Failed to update comment', { error: error.message });
      sendError(res, 500, 'COMMENT_UPDATE_FAILED', 'Unable to update comment.');
    }
  });
};
