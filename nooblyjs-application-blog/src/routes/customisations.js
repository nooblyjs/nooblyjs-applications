'use strict';

const path = require('path');
const { promises: fs } = require('fs');
const { DEFAULT_SITE_SETTINGS, sendJson, sendError } = require('./shared/helpers');

const SETTINGS_FILE_PATH = path.join(process.cwd(), '.data', 'blog-settings.json');

const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Returns true for a hex colour that is safe to inject into CSS.
 * @param {*} value
 * @return {boolean}
 */
function isSafeColor(value) {
  return typeof value === 'string' && COLOR_PATTERN.test(value);
}

/**
 * Returns true for an empty value or an absolute http(s) URL (blocks javascript: and data: links).
 * @param {*} value
 * @return {boolean}
 */
function isSafeUrl(value) {
  if (value === '' || value === undefined) return true;
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Loads site settings from file or returns defaults.
 */
async function loadSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return DEFAULT_SITE_SETTINGS;
    }
    throw error;
  }
}

/**
 * Saves site settings to file.
 */
async function saveSettings(settings, log) {
  try {
    const dataDir = path.dirname(SETTINGS_FILE_PATH);
    await fs.mkdir(dataDir, { recursive: true });

    const { id, key, createdAt, updatedAt, ...cleanSettings } = settings;

    await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(cleanSettings, null, 2), 'utf8');
    return cleanSettings;
  } catch (error) {
    log.error('Failed to save settings file', { error: error.message });
    throw error;
  }
}

/**
 * Registers customisation/settings routes.
 * @param {Object} app Express application
 * @param {Object} log Logger instance
 * @param {Function} requireAuthor Middleware guarding settings changes
 */
const registerCustomisationsRoutes = (app, log, requireAuthor) => {
  /**
   * GET SITE SETTINGS
   */
  app.get('/applications/blog/api/settings', async (_req, res) => {
    try {
      const settings = await loadSettings();
      sendJson(res, 200, settings);
    } catch (error) {
      log.error('Failed to load settings', { error: error.message });
      sendError(res, 500, 'SETTINGS_FETCH_FAILED', 'Unable to load site settings.');
    }
  });

  /**
   * UPDATE SITE SETTINGS
   */
  app.patch('/applications/blog/api/settings', requireAuthor, async (req, res) => {
    try {
      const payload = req.body || {};

      for (const field of ['primaryColor', 'backgroundColor']) {
        if (payload[field] !== undefined && !isSafeColor(payload[field])) {
          return sendError(res, 400, 'VALIDATION_ERROR', `${field} must be a hex colour such as #C2471F.`);
        }
      }
      const urls = {
        bannerImage: payload.bannerImage,
        'links.twitter': payload.links?.twitter,
        'links.instagram': payload.links?.instagram,
        'links.tiktok': payload.links?.tiktok,
        'links.custom.url': payload.links?.custom?.url
      };
      if (payload.tagline !== undefined && (typeof payload.tagline !== 'string' || payload.tagline.length > 160)) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'tagline must be text of 160 characters or fewer.');
      }
      for (const [field, value] of Object.entries(urls)) {
        if (!isSafeUrl(value)) {
          return sendError(res, 400, 'VALIDATION_ERROR', `${field} must be an http(s) URL.`);
        }
      }
      const currentSettings = await loadSettings();

      const updatedSettings = {
        ...currentSettings,
        title: payload.title !== undefined ? payload.title : currentSettings.title,
        tagline: payload.tagline !== undefined ? payload.tagline.trim() : currentSettings.tagline || '',
        primaryColor: payload.primaryColor !== undefined ? payload.primaryColor : currentSettings.primaryColor,
        backgroundColor: payload.backgroundColor !== undefined ? payload.backgroundColor : currentSettings.backgroundColor,
        bannerImage: payload.bannerImage !== undefined ? payload.bannerImage : currentSettings.bannerImage,
        links: {
          twitter: payload.links?.twitter !== undefined ? payload.links.twitter : currentSettings.links?.twitter || '',
          instagram: payload.links?.instagram !== undefined ? payload.links.instagram : currentSettings.links?.instagram || '',
          tiktok: payload.links?.tiktok !== undefined ? payload.links.tiktok : currentSettings.links?.tiktok || '',
          custom: {
            name: payload.links?.custom?.name !== undefined ? payload.links.custom.name : currentSettings.links?.custom?.name || '',
            url: payload.links?.custom?.url !== undefined ? payload.links.custom.url : currentSettings.links?.custom?.url || ''
          }
        }
      };

      await saveSettings(updatedSettings, log);
      sendJson(res, 200, updatedSettings);
    } catch (error) {
      log.error('Failed to update settings', { error: error.message });
      sendError(res, 500, 'SETTINGS_UPDATE_FAILED', 'Unable to update site settings.');
    }
  });
};

module.exports = registerCustomisationsRoutes;
module.exports.loadSettings = loadSettings;
module.exports.isSafeColor = isSafeColor;
