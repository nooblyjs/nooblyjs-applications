/**
 * @fileoverview Blog Application
 * Factory module for creating a Blog application instance.
 * 
 * @author NooblyJS Team
 * @version 0.0.0
 * @since  0.0.0
 */

'use strict';

/**
 * Creates the CMS service
 * Automatically configures routes and views for the cms service.
 * Integrates with noobly-core services for data persistence, file storage, caching, etc.
 * @param {Object} app - The Express application instance
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @param {Object} serviceRegistry - NooblyJS Core service registry
 * @param {Object} options - Configuration options
 * @return {void}
 */
module.exports = (app, server, eventEmitter, serviceRegistry, options) => {

  // Launch the app service
  const appService = serviceRegistry.appservice();

  // Serve README.md from root directory
  app.get('/applications/blog/README.md', (req, res) => {
    res.sendFile(path.join(__dirname, 'README.md'));
  });

}
