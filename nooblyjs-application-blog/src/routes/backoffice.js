'use strict';

const { API_BASE_PATH, VIEW_BASE_PATH, CONTAINERS, escapeXml, sendJson, sendError } = require('./shared/helpers');

/**
 * Registers backoffice/admin routes (status, feed, sitemaps).
 * @param {Object} app Express application
 * @param {Object} dataStore Data store instance
 * @param {Object} log Logger instance
 */
module.exports = (app, dataStore, log) => {
  const { listRecords, getHomeFeed } = dataStore;

  /**
   * GET BLOG STATUS (health check with statistics)
   */
  app.get(`${API_BASE_PATH}/status`, async (req, res) => {
    try {
      const posts = await listRecords(CONTAINERS.POSTS);
      // Comments live inside each post file, not in the blog_comments container.
      const comments = posts.flatMap((post) => (Array.isArray(post.comments) ? post.comments : []));
      const published = posts.filter((post) => post.status === 'published');
      sendJson(res, 200, {
        status: 'running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        totals: {
          posts: posts.length,
          published: published.length,
          comments: comments.length
        }
      });
    } catch (error) {
      log.error('Status endpoint failed', { error: error.message });
      sendError(res, 500, 'STATUS_ERROR', 'Unable to retrieve blog status.');
    }
  });

  /**
   * GET HOME FEED (featured, latest, trending, tags, drafts)
   */
  app.get(`${API_BASE_PATH}/feed/home`, async (_req, res) => {
    try {
      const feed = await getHomeFeed();
      sendJson(res, 200, feed, { cached: false });
    } catch (error) {
      log.error('Failed to load home feed', { error: error.message });
      sendError(res, 500, 'FEED_FETCH_FAILED', 'Unable to load home feed.');
    }
  });

  /**
   * GET XML SITEMAP (for search engines)
   */
  app.get('/sitemaps', async (req, res) => {
    try {
      const posts = await listRecords(CONTAINERS.POSTS);
      const published = posts
        .filter((post) => post.status === 'published')
        .sort((a, b) => {
          const dateB = new Date(b.updatedAt || b.publishedAt || b.createdAt || 0).getTime();
          const dateA = new Date(a.updatedAt || a.publishedAt || a.createdAt || 0).getTime();
          return dateB - dateA;
        });

      const forwardedProto = req.get('x-forwarded-proto');
      const forwardedHost = req.get('x-forwarded-host');
      const protocol = (forwardedProto ? forwardedProto.split(',')[0] : req.protocol || 'http') || 'http';
      const host = (forwardedHost ? forwardedHost.split(',')[0] : req.get('host')) || '';
      const baseUrl = host ? `${protocol}://${host}` : '';
      const postPrefix = `${baseUrl}${VIEW_BASE_PATH}/posts`;

      const urlEntries = published
        .map((post) => {
          const slug = encodeURIComponent(post.slug || post.id);
          const loc = `${postPrefix}/${slug}`;
          const lastMod = new Date(post.updatedAt || post.publishedAt || post.createdAt || Date.now()).toISOString();
          return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${escapeXml(lastMod)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`;
        })
        .join('\n');

      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        urlEntries,
        '</urlset>'
      ]
        .filter(Boolean)
        .join('\n');

      res.type('application/xml').send(xml);
    } catch (error) {
      log.error('Failed to build sitemap', { error: error.message });
      res
        .status(500)
        .type('application/xml')
        .send('<?xml version="1.0" encoding="UTF-8"?><error>Unable to generate sitemap</error>');
    }
  });
};
