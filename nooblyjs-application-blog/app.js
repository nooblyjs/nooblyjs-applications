/**
 * @fileoverview The file define and instantiates the various NooblyJS applications.
 *
 * @author NooblyJS Core Team
 * @version 1.0.1
 * @since 2025-08-24
 */

'use strict';

const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('passport');
const path = require('path');

const { EventEmitter } = require('events');

// Iniitiate the Web and Api Interface
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3003;

app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
app.use(bodyParser.json({ limit: '2mb' }));

// Sessions let the author dashboard and API writes see the logged-in user.
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production.');
  process.exit(1);
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(passport.initialize());
app.use(passport.session());

// Initialise our options
var options = { 
  logDir:  path.join(__dirname, './.app-blog/', 'logs'),
  dataDir : path.join(__dirname, './.app-blog/', 'data'),
};

// Initialise event system
const eventEmitter = new EventEmitter()  

// Initiate the service Registry
const serviceRegistry = require('nooblyjs-core');
serviceRegistry.initialize(app,eventEmitter,options);

const log = serviceRegistry.logger('console');
const cache = serviceRegistry.cache('memory');
const dataservice = serviceRegistry.dataService('memory');
const filing = serviceRegistry.filing('local');
const queue = serviceRegistry.queue('memory');
const scheduling = serviceRegistry.scheduling('memory');
const searching = serviceRegistry.searching('memory');
const measuring = serviceRegistry.measuring('memory');
const notifying = serviceRegistry.notifying('memory');
const worker = serviceRegistry.working('memory');
const workflow = serviceRegistry.workflow('memory');
const authservice = serviceRegistry.authservice('file',{
  saveReferer: true,
});

// The auth provider registers its serializers on nooblyjs-core's own copy of passport,
// so register them on ours as well or req.logIn() fails and login is rejected.
const { serializeUser, deserializeUser } = authservice.getAuthStrategy();
passport.serializeUser(serializeUser);
passport.deserializeUser(deserializeUser);

// Launch the application docs folder
app.use('/docs', express.static(path.join(__dirname, 'docs')));

// Launch the application docs folder
app.use('/readme', express.static(path.join(__dirname, 'README.md')));

const blog = require('./index.js');
blog(app, server, eventEmitter, serviceRegistry,{});


// Redirect to services
app.get('/', (req, res) => {
  res.redirect('/applications/blog/');
});

server.listen(process.env.PORT || 3003, () => {
  log.warn(`====================================`);
  log.warn(`Nooblyjs Blog running on port ${process.env.PORT || 3003}`);
  log.warn(`====================================`);
});