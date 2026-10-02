'use strict';

/**
 * Constants
 */
const API_BASE_PATH = '/applications/blog/api';
const VIEW_BASE_PATH = '/applications/blog';

const CONTAINERS = {
  POSTS: 'blog_posts',
  COMMENTS: 'blog_comments',
  BOOKMARKS: 'blog_bookmarks',
  SITE_SETTINGS: 'blog_site_settings'
};

const CACHE_KEYS = {
  HOME_FEED: 'blog:feed:home'
};

const ONE_MINUTE = 60 * 1000;

const DEFAULT_SITE_SETTINGS = {
  title: 'NooblyJS Folio',
  tagline: '',
  primaryColor: '#C2471F',
  backgroundColor: '#F5F1EE',
  bannerImage: '',
  links: {
    twitter: '',
    instagram: '',
    tiktok: '',
    custom: {
      name: '',
      url: ''
    }
  },
  key: 'default'
};

/**
 * Normalizes a string into a URL-friendly slug.
 * @param {string} value
 * @return {string}
 */
function toSlug(value = '') {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generates a short excerpt from content.
 * @param {string} content
 * @param {number} length
 * @return {string}
 */
function buildExcerpt(content = '', length = 200) {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= length) return clean;
  return `${clean.substring(0, length).trim()}…`;
}

/**
 * Estimates read time in minutes based on word count.
 * @param {string} content
 * @return {number}
 */
function estimateReadTime(content = '') {
  const words = content ? content.trim().split(/\s+/).length : 0;
  return Math.max(1, Math.ceil(words / 220));
}

/**
 * Normalizes and deduplicates tags.
 * @param {Array<string>} tags
 * @return {Array<string>}
 */
function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) return [];
  const unique = new Set();
  tags.forEach((tag) => {
    if (typeof tag !== 'string') return;
    const trimmed = tag.trim();
    if (!trimmed) return;
    unique.add(trimmed.replace(/\s+/g, ' '));
  });
  return Array.from(unique).slice(0, 10);
}

/**
 * Normalizes an author payload.
 * @param {Object|string} author
 * @return {{name: string, handle: string, avatar: string|null, bio: string|null}}
 */
function normalizeAuthor(author) {
  if (!author) {
    return {
      name: 'Anonymous',
      handle: 'anonymous',
      avatar: null,
      bio: null
    };
  }
  if (typeof author === 'string') {
    return {
      name: author,
      handle: toSlug(author) || 'contributor',
      avatar: null,
      bio: null
    };
  }
  return {
    name: author.name || 'Anonymous',
    handle: author.handle || toSlug(author.name || 'contributor'),
    avatar: author.avatar || null,
    bio: author.bio || null
  };
}

/**
 * Builds a search document from a post with denormalized text for matching.
 * @param {Object} post
 * @return {Object|null}
 */
function buildSearchDocument(post) {
  if (!post || !post.id) return null;
  const tags = Array.isArray(post.tags) ? [...post.tags] : [];
  const doc = {
    id: post.id,
    title: post.title || '',
    subtitle: post.subtitle || '',
    slug: post.slug || '',
    excerpt: post.excerpt || '',
    content: post.content || '',
    coverImage: post.coverImage || null,
    tags,
    tagSlugs: Array.isArray(post.tagSlugs) ? [...post.tagSlugs] : tags.map((tag) => toSlug(tag)),
    author: post.author
      ? {
          name: post.author.name || '',
          handle: post.author.handle || toSlug(post.author.name || ''),
          avatar: post.author.avatar || null,
          bio: post.author.bio || null
        }
      : null,
    stats: {
      views: Number(post.stats?.views || 0),
      claps: Number(post.stats?.claps || 0),
      bookmarks: Number(post.stats?.bookmarks || 0),
      comments: Number(post.stats?.comments || 0)
    },
    status: post.status || 'draft',
    publishedAt: post.publishedAt || null,
    scheduledFor: post.scheduledFor || null,
    readTimeMinutes: Number(post.readTimeMinutes || estimateReadTime(post.content || '')),
    createdAt: post.createdAt || null,
    updatedAt: post.updatedAt || null,
    contentFormat: post.contentFormat || 'markdown',
    seo: post.seo
      ? {
          title: post.seo.title || post.title || '',
          description: post.seo.description || post.excerpt || '',
          canonicalUrl: post.seo.canonicalUrl || null
        }
      : null
  };

  doc.searchText = [
    doc.title,
    doc.subtitle,
    doc.excerpt,
    doc.content,
    tags.join(' '),
    doc.author?.name || '',
    doc.author?.handle || ''
  ]
    .filter(Boolean)
    .join('\n');

  return doc;
}

/**
 * Removes search-only metadata from a search document.
 * @param {Object|null} doc
 * @return {Object|null}
 */
function stripSearchMetadata(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const { searchText, ...rest } = doc;
  return rest;
}

/**
 * Escapes arbitrary text for XML contexts.
 * @param {string} value
 * @return {string}
 */
function escapeXml(value = '') {
  return value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds a safe default logger when the registry logger is unavailable.
 * @param {Object|undefined} logger
 * @return {{info: Function, warn: Function, error: Function, debug: Function}}
 */
function buildLogger(logger) {
  if (logger) return logger;
  return {
    info: console.log.bind(console, '[blog]'),
    warn: console.warn.bind(console, '[blog]'),
    error: console.error.bind(console, '[blog]'),
    debug: console.debug.bind(console, '[blog]')
  };
}

/**
 * Sends a standardized JSON response.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {*} data
 * @param {Object=} meta
 */
function sendJson(res, status, data, meta) {
  res.status(status).json({
    data,
    meta: meta || {}
  });
}

/**
 * Sends a standardized JSON error response.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Object=} details
 */
function sendError(res, status, code, message, details) {
  res.status(status).json({
    errors: [
      {
        code,
        message,
        details: details || {}
      }
    ]
  });
}

module.exports = {
  // Constants
  API_BASE_PATH,
  VIEW_BASE_PATH,
  CONTAINERS,
  CACHE_KEYS,
  ONE_MINUTE,
  DEFAULT_SITE_SETTINGS,
  // Helpers
  toSlug,
  buildExcerpt,
  estimateReadTime,
  normalizeTags,
  normalizeAuthor,
  buildSearchDocument,
  stripSearchMetadata,
  escapeXml,
  buildLogger,
  sendJson,
  sendError
};
