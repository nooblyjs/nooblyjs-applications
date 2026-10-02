'use strict';

// Import shared utilities and data store
const { initializeDataStore } = require('./shared/dataStore');
const { buildLogger } = require('./shared/helpers');

// Import all route modules
const registerPostsRoutes = require('./posts');
const registerClapsRoutes = require('./claps');
const registerCommentsRoutes = require('./comments');
const registerTagsRoutes = require('./tags');
const registerSearchingRoutes = require('./searching');
const registerCustomisationsRoutes = require('./customisations');
const registerBackofficeRoutes = require('./backoffice');


/**
 * Configures and registers Blog API routes with the Express application.
 * Routes are organized into separate modules by feature for better maintainability.
 *
 * @param {Object} options Express binding
 * @param {import('events').EventEmitter} eventEmitter
 * @param {Object} services NooblyJS services
 */
module.exports = async (options, eventEmitter, services) => {
  const app = options.app;
  const { dataService, cache, logger, search, filing, servicesAuthMiddleware } = services;

  if (!app) {
    throw new Error('Blog routes require an Express application instance.');
  }

  if (!dataService || !dataService.provider) {
    throw new Error('Blog routes require the noobly-core dataService.');
  }

  if (!filing) {
    throw new Error('Blog routes require the filing service.');
  }

  if (typeof servicesAuthMiddleware !== 'function') {
    throw new Error('Blog routes require the servicesAuthMiddleware to protect author actions.');
  }

  const log = buildLogger(logger);
  const requireAuthor = servicesAuthMiddleware;

  // Initialize data store with all necessary services
  const dataStore = await initializeDataStore({
    app,
    dataService,
    cache,
    logger: log,
    search,
    filing
  });

  // Register all route modules
  registerPostsRoutes(app, dataStore, log, requireAuthor);
  registerClapsRoutes(app, dataStore, log);
  registerCommentsRoutes(app, dataStore, log, requireAuthor);
  registerTagsRoutes(app, dataStore, log);
  registerSearchingRoutes(app, dataStore, log);
  registerCustomisationsRoutes(app, log, requireAuthor);
  registerBackofficeRoutes(app, dataStore, log);

  log.info('All blog API routes registered successfully', { routes: 7 });
};
