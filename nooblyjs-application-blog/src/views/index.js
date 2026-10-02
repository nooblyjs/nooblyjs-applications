'use strict';

const path = require('path');
const express = require('express');
const { promises: fs } = require('fs');
const { DEFAULT_SITE_SETTINGS } = require('../routes/shared/helpers');
const { loadSettings, isSafeColor } = require('../routes/customisations');

const VIEW_BASE_PATH = '/applications/blog';
const STATIC_PATH = `${VIEW_BASE_PATH}/assets`;

/**
 * Returns true when white text would be hard to read on the colour (WCAG relative luminance).
 * @param {string} hex e.g. #C2471F
 * @return {boolean}
 */
function isLightColor(hex) {
  let value = hex.replace('#', '');
  if (value.length === 3 || value.length === 4) {
    value = value.slice(0, 3).split('').map((c) => c + c).join('');
  }
  const channel = (offset) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.4;
}

/**
 * Generates the per-site theme: the Customise Accent and Background colours map to the
 * --accent and --bg tokens from styles.css. Defaults emit nothing so styles.css stays authoritative.
 */
function generateThemeCSS(settings) {
  // Values are injected into a <style> block, so anything that isn't a plain hex colour falls back to the default.
  const accent = isSafeColor(settings.primaryColor) ? settings.primaryColor : DEFAULT_SITE_SETTINGS.primaryColor;
  const background = isSafeColor(settings.backgroundColor) ? settings.backgroundColor : DEFAULT_SITE_SETTINGS.backgroundColor;

  const declarations = [];
  if (accent.toLowerCase() !== DEFAULT_SITE_SETTINGS.primaryColor.toLowerCase()) {
    declarations.push(
      `--accent: ${accent};`,
      `--accent-link: color-mix(in srgb, ${accent} 85%, #000);`,
      `--accent-soft: color-mix(in srgb, ${accent} 20%, #FFF);`,
      `--accent-tint: color-mix(in srgb, ${accent} 8%, #FFF);`,
      `--on-accent: ${isLightColor(accent) ? '#241C1A' : '#FFFFFF'};`
    );
  }
  if (background.toLowerCase() !== DEFAULT_SITE_SETTINGS.backgroundColor.toLowerCase()) {
    declarations.push(`--bg: ${background};`);
  }
  if (!declarations.length) return '';
  return `<style id="theme-overrides">:root { ${declarations.join(' ')} }</style>`;
}

/**
 * Injects theme CSS into HTML content
 */
function injectThemeCSS(htmlContent, themeCSS) {
  // Insert after blog.css so the overrides win over styles.css defaults
  return htmlContent.replace(
    '</head>',
    `${themeCSS}\n</head>`
  );
}

/**
 * Registers view routes for the blog experience.
 *
 * @param {Object} options Express binding
 * @param {import('events').EventEmitter} eventEmitter
 * @param {Object} services NooblyJS services (logger, cache, dataService, etc.)
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.app;
  const { logger, servicesAuthMiddleware } = services;

  const log = logger || {
    info: console.log.bind(console, '[blog:view]'),
    error: console.error.bind(console, '[blog:view]')
  };

  const viewRoot = __dirname;
  const staticRoot = path.join(__dirname, 'js');
  const styleRoot = path.join(__dirname, 'css');

  // Serve compiled client assets (vanilla JS modules, helpers)
  app.use(`${STATIC_PATH}/css`, express.static(styleRoot));
  app.use(STATIC_PATH, express.static(staticRoot));

  // HTML entrypoints for the blog interfaces with injected theme CSS
  const sendIndex = async (_req, res) => {
    try {
      const settings = await loadSettings();
      let htmlContent = await fs.readFile(path.join(viewRoot, 'index.html'), 'utf8');
      const themeCSS = generateThemeCSS(settings);
      htmlContent = injectThemeCSS(htmlContent, themeCSS);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(htmlContent);
    } catch (error) {
      log.error('Error rendering index', { error: error.message });
      res.sendFile(path.join(viewRoot, 'index.html'));
    }
  };

  const sendAuthor = async (_req, res) => {
    try {
      const settings = await loadSettings();
      let htmlContent = await fs.readFile(path.join(viewRoot, 'author.html'), 'utf8');
      const themeCSS = generateThemeCSS(settings);
      htmlContent = injectThemeCSS(htmlContent, themeCSS);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(htmlContent);
    } catch (error) {
      log.error('Error rendering author', { error: error.message });
      res.sendFile(path.join(viewRoot, 'author.html'));
    }
  };

  if (typeof servicesAuthMiddleware !== 'function') {
    throw new Error('Blog views require the servicesAuthMiddleware to protect the author dashboard.');
  }
  const protect = servicesAuthMiddleware;

  app.get(VIEW_BASE_PATH, sendIndex);
  app.get(`${VIEW_BASE_PATH}/`, sendIndex);
  app.get(`${VIEW_BASE_PATH}/posts/:slug`, sendIndex);
  app.get(`${VIEW_BASE_PATH}/posts/:slug/`, sendIndex);
  app.get(`${VIEW_BASE_PATH}/author`, protect, sendAuthor);
  app.get(`${VIEW_BASE_PATH}/author/`, protect, sendAuthor);

  // Provide a lightweight manifest endpoint for client bootstrapping
  app.get(`${VIEW_BASE_PATH}/manifest.json`, (_req, res) => {
    res.json({
      name: 'NooblyJS Blog',
      short_name: 'NooblyBlog',
      description: 'A Medium-inspired publishing experience built on NooblyJS Core.',
      icons: [],
      start_url: VIEW_BASE_PATH,
      display: 'standalone',
      lang: 'en'
    });
  });

  log.info('Blog views registered', { basePath: VIEW_BASE_PATH, assets: STATIC_PATH, authorPath: `${VIEW_BASE_PATH}/author` });
};
