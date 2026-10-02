# NooblyJS Core - AI Assistant Reference Guide

> **Purpose**: This guide is optimized for AI assistants to help developers implement nooblyjs-core.
> **Version**: 1.0.14+
> **Package**: `noobly-core` on npm

## Installation & Basic Setup

### Minimal Setup
```javascript
const express = require('express');
const serviceRegistry = require('noobly-core');

const app = express();
app.use(express.json());

// REQUIRED: Initialize registry first
serviceRegistry.initialize(app);

// Then get services
const cache = serviceRegistry.cache('memory');
const logger = serviceRegistry.logger('file');
const dataService = serviceRegistry.dataService('memory');

app.listen(3000);
```

### Production Setup with Security
```javascript
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const serviceRegistry = require('noobly-core');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session for service UI authentication
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

// Initialize with security
const apiKeys = (process.env.NOOBLY_API_KEYS || '').split(',').filter(Boolean);
serviceRegistry.initialize(app, null, {
  logDir: './.noobly-core/logs',
  dataDir: './.noobly-core/data',
  apiKeys: apiKeys,
  requireApiKey: apiKeys.length > 0,
  excludePaths: [
    '/services/*/status',
    '/services/',
    '/services/authservice/api/login',
    '/services/authservice/api/register'
  ]
});

const log = serviceRegistry.logger('file');
const auth = serviceRegistry.authservice('file');
const { configurePassport } = auth.passportConfigurator(auth.getAuthStrategy);
configurePassport(passport);

app.listen(3000);
```

## Critical Implementation Rules

1. **ALWAYS call `serviceRegistry.initialize(app)` BEFORE getting any services** - This is required
2. **Service initialization signature**: `serviceRegistry.initialize(app, eventEmitter, options)`
   - `app` (required): Express application instance
   - `eventEmitter` (optional): Custom EventEmitter, or pass `null` to use built-in
   - `options` (optional): Configuration object
3. **Dependency injection is automatic** - Services get their dependencies automatically based on hierarchy
4. **Singleton pattern** - Each `service:provider` combination is a singleton
5. **API routes**: All services expose routes at `/services/{service}/api/*` (NOT `/api/{service}/*`)
6. **Authentication**: Use `authservice` with passport for session-based auth; configure before routes

## Service Registry Quick Reference

### All 13 Services with Method Signatures

| Service | Method | Providers | Key Dependencies |
|---------|--------|-----------|------------------|
| **aiservice** | `serviceRegistry.aiservice(provider, options)` | `claude`, `chatgpt`, `ollama`, `api` | logging, caching, workflow, queueing |
| **authservice** | `serviceRegistry.authservice(provider, options)` | `file`, `memory`, `passport`, `google`, `api` | logging, caching, dataservice |
| **caching** | `serviceRegistry.cache(provider, options)` | `memory`, `inmemory`, `redis`, `memcached`, `file`, `api` | logging |
| **dataservice** | `serviceRegistry.dataService(provider, options)` | `memory`, `file`, `simpledb`, `mongodb`, `documentdb`, `api` | logging, filing |
| **filing** | `serviceRegistry.filing(provider, options)` or `.filer()` | `local`, `ftp`, `s3`, `git`, `gcp`, `sync`, `api` | logging |
| **logging** | `serviceRegistry.logger(provider, options)` | `memory`, `file`, `api` | none (foundation) |
| **measuring** | `serviceRegistry.measuring(provider, options)` | `memory`, `api` | logging, queueing, caching |
| **notifying** | `serviceRegistry.notifying(provider, options)` | `memory`, `api` | logging, queueing, scheduling |
| **queueing** | `serviceRegistry.queue(provider, options)` | `memory`, `api` | logging |
| **scheduling** | `serviceRegistry.scheduling(provider, options)` | `memory` | logging, working |
| **searching** | `serviceRegistry.searching(provider, options)` | `memory`, `file`, `api` | logging, caching, dataservice, queueing, working, scheduling |
| **workflow** | `serviceRegistry.workflow(provider, options)` | `memory`, `api` | logging, queueing, scheduling, measuring, working |
| **working** | `serviceRegistry.working(provider, options)` | `memory`, `api` | logging, queueing, caching |

### Service Dependency Hierarchy (Initialization Order)

**Level 0 - Foundation**: logging
**Level 1 - Infrastructure**: caching, filing, queueing
**Level 2 - Business Logic**: dataservice, working, measuring
**Level 3 - Application**: scheduling, searching, workflow
**Level 4 - Integration**: notifying, authservice, aiservice

## Common Provider Options

### Logging Service
```javascript
// File provider
serviceRegistry.logger('file', {
  logDir: './.noobly-core/logs',  // or use options passed to initialize()
  filename: 'app.log',
  maxFiles: 5,
  maxSize: '10m'
});

// Memory provider (default)
serviceRegistry.logger('memory');
```

### Caching Service
```javascript
// Redis provider
serviceRegistry.cache('redis', {
  host: 'localhost',
  port: 6379,
  password: 'secret',
  keyPrefix: 'myapp:',
  db: 0
});

// Memory provider
serviceRegistry.cache('memory'); // or 'inmemory'
```

### DataService
```javascript
// MongoDB provider
serviceRegistry.dataService('mongodb', {
  connectionString: 'mongodb://localhost:27017',
  database: 'myapp'
});

// File provider
serviceRegistry.dataService('file', {
  dataDir: './.noobly-core/data'  // or use options passed to initialize()
});
```

### Filing Service
```javascript
// S3 provider
serviceRegistry.filing('s3', {
  bucket: 'my-bucket',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Local provider
serviceRegistry.filing('local', {
  dataDir: './uploads'
});
```

### AI Service
```javascript
// Claude provider
serviceRegistry.aiservice('claude', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022',
  tokensStorePath: './.noobly-core/ai-tokens.json'
});

// Ollama provider (local)
serviceRegistry.aiservice('ollama', {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2'
});
```

### Authentication Service
```javascript
// File provider (recommended for production)
serviceRegistry.authservice('file', {
  dataDir: './.noobly-core/data'
});

// Memory provider (dev only)
serviceRegistry.authservice('memory', {
  createDefaultAdmin: true  // Creates admin:admin123 and user:user123
});

// Google OAuth provider
serviceRegistry.authservice('google', {
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback'
});
```

## REST API Reference

### API Authentication Methods
```bash
# Method 1: x-api-key header (recommended)
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/services/caching/api/get/mykey

# Method 2: Authorization Bearer
curl -H "Authorization: Bearer YOUR_KEY" http://localhost:3000/...

# Method 3: Query parameter
curl "http://localhost:3000/services/caching/api/get/mykey?api_key=YOUR_KEY"

# Method 4: api-key header
curl -H "api-key: YOUR_KEY" http://localhost:3000/...

# Method 5: Authorization ApiKey
curl -H "Authorization: ApiKey YOUR_KEY" http://localhost:3000/...
```

### Caching API
```bash
# Store data
POST /services/caching/api/put/:key
{"value": {...}}

# Retrieve data
GET /services/caching/api/get/:key

# Delete data
DELETE /services/caching/api/delete/:key

# List keys with analytics
GET /services/caching/api/list

# Status (no auth)
GET /services/caching/api/status
```

### DataService API

**IMPORTANT**: DataService uses UUID-based storage, NOT simple key-value like caching.

```bash
# Insert document (returns UUID automatically)
POST /services/dataservice/api/:container
Content-Type: application/json
{"name": "John", "status": "active", "profile": {"role": "developer"}}
# Response: {"id": "550e8400-e29b-41d4-a716-446655440000"}

# Retrieve by UUID
GET /services/dataservice/api/:container/:uuid

# Delete by UUID
DELETE /services/dataservice/api/:container/:uuid

# JSON Search - Custom JavaScript predicate
POST /services/dataservice/api/jsonFind/:container
{"predicate": "obj.status === 'active' && obj.profile.role === 'developer'"}

# JSON Search - By nested path
GET /services/dataservice/api/jsonFindByPath/:container/:path/:value
# Example: GET /services/dataservice/api/jsonFindByPath/users/profile.role/developer

# JSON Search - Multi-criteria (supports nested paths)
POST /services/dataservice/api/jsonFindByCriteria/:container
{"status": "active", "profile.role": "developer", "profile.department": "engineering"}
```

**Programmatic Usage**:
```javascript
// Insert returns UUID
const uuid = await dataService.add('users', {name: 'John', email: 'john@example.com'});

// Retrieve by UUID
const user = await dataService.getByUuid('users', uuid);

// Search examples
const activeUsers = await dataService.jsonFind('users', user => user.status === 'active');
const developers = await dataService.jsonFindByPath('users', 'profile.role', 'developer');
const results = await dataService.jsonFindByCriteria('users', {
  'status': 'active',
  'profile.department': 'engineering'
});
```

### Filing API
```bash
# Upload
POST /services/filing/api/upload/:path
[multipart file data]

# Download
GET /services/filing/api/download/:path

# Delete
DELETE /services/filing/api/remove/:path
```

### Scheduling API
```bash
# Schedule task with interval
POST /services/scheduling/api/schedule
{"task": "taskName", "scriptPath": "path/to/script.js", "intervalSeconds": 60}

# Stop task
DELETE /services/scheduling/api/cancel/:taskName

# Get analytics
GET /services/scheduling/api/analytics

# Status
GET /services/scheduling/api/status
```

### Workflow API
```bash
# Define workflow
POST /services/workflow/api/defineworkflow
{"name": "myWorkflow", "steps": ["/path/step1.js", "/path/step2.js"]}

# Start execution
POST /services/workflow/api/start
{"name": "myWorkflow", "data": {...}}
```

### Queue API
```bash
# Enqueue task
POST /services/queueing/api/enqueue/:queueName
{"task": {...}}

# Dequeue task
GET /services/queueing/api/dequeue/:queueName

# Queue size
GET /services/queueing/api/size/:queueName

# List all queues
GET /services/queueing/api/queues
```

### AI Service API

**Configuration**: Requires API keys/connection info in constructor.

```javascript
// Initialize with credentials
const claudeAI = serviceRegistry.aiservice('claude', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022',
  tokensStorePath: './.data/ai-tokens-claude.json'
});

const chatGPT = serviceRegistry.aiservice('chatgpt', {
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4'
});

const ollama = serviceRegistry.aiservice('ollama', {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2'
});

// Send prompt
const response = await claudeAI.prompt('Your prompt here', {
  maxTokens: 1000,
  temperature: 0.7
});
// Returns: {content, usage: {promptTokens, completionTokens, totalTokens, estimatedCost}}

// Get analytics
const analytics = claudeAI.getAnalytics();
// Returns: {modelUsage, totalSessions, totalCost, totalTokens}
```

**API Endpoints:**
```bash
# Send prompt
POST /services/ai/api/prompt
{"prompt": "...", "maxTokens": 500, "temperature": 0.7}

# Get analytics
GET /services/ai/api/analytics

# Status
GET /services/ai/api/status
```

## Implementation Patterns for Common Use Cases

### Pattern 1: Basic CRUD API
```javascript
const express = require('express');
const serviceRegistry = require('noobly-core');

const app = express();
app.use(express.json());

// Initialize
serviceRegistry.initialize(app, null, {
  logDir: './logs',
  dataDir: './data'
});

const log = serviceRegistry.logger('file');
const dataService = serviceRegistry.dataService('file');

// CRUD endpoints
app.post('/api/items', async (req, res) => {
  try {
    const uuid = await dataService.add('items', req.body);
    log.info('Item created', {uuid});
    res.json({id: uuid, item: req.body});
  } catch (error) {
    log.error('Create failed', error);
    res.status(500).json({error: error.message});
  }
});

app.get('/api/items/:id', async (req, res) => {
  try {
    const item = await dataService.getByUuid('items', req.params.id);
    if (!item) return res.status(404).json({error: 'Not found'});
    res.json(item);
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

app.get('/api/items', async (req, res) => {
  try {
    const items = await dataService.jsonFindByCriteria('items', req.query);
    res.json(items);
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

app.listen(3000);
```

### Pattern 2: Caching with Redis
```javascript
const cache = serviceRegistry.cache('redis', {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  keyPrefix: 'myapp:'
});

// Cache-aside pattern
async function getUser(userId) {
  const cacheKey = `user:${userId}`;

  // Try cache first
  let user = await cache.get(cacheKey);
  if (user) {
    log.info('Cache hit', {userId});
    return user;
  }

  // Cache miss - fetch from DB
  log.info('Cache miss', {userId});
  user = await dataService.getByUuid('users', userId);

  if (user) {
    // Store in cache for 1 hour
    await cache.put(cacheKey, user, 3600);
  }

  return user;
}
```

### Pattern 3: File Upload with S3
```javascript
const multer = require('multer');
const upload = multer({storage: multer.memoryStorage()});

const filing = serviceRegistry.filing('s3', {
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const filename = `${Date.now()}_${req.file.originalname}`;
    const filepath = `uploads/${filename}`;

    // Upload to S3
    const stream = require('stream').Readable.from(req.file.buffer);
    await filing.create(filepath, stream);

    // Store metadata in dataservice
    const uuid = await dataService.add('files', {
      filename,
      filepath,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString()
    });

    log.info('File uploaded', {uuid, filepath});
    res.json({id: uuid, filepath});
  } catch (error) {
    log.error('Upload failed', error);
    res.status(500).json({error: error.message});
  }
});
```

### Pattern 4: Authentication Service - Complete Setup

#### 4a. Basic Setup with Redirect-Based Authentication

The authservice provides built-in login/register pages that handle authentication flow automatically.

```javascript
const session = require('express-session');
const passport = require('passport');

// 1. Setup session middleware (REQUIRED - MUST come first)
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
    httpOnly: true,                                  // Prevent XSS
    maxAge: 24 * 60 * 60 * 1000                     // 24 hours
  }
}));

// 2. Initialize Passport (MUST come before authservice)
app.use(passport.initialize());
app.use(passport.session());

// 3. Initialize service registry
serviceRegistry.initialize(app, null, {
  logDir: './logs',
  dataDir: './data'
});

// 4. Get auth service
const authservice = serviceRegistry.authservice('file', {
  dataDir: './data/auth'
});

// 5. Configure Passport (CRITICAL - enables session creation)
const { configurePassport } = authservice.passportConfigurator(authservice.getAuthStrategy);
configurePassport(passport);

// 6. Create authentication middleware from authservice
const requireAuth = authservice.createAuthMiddleware({
  loginPath: '/services/authservice/views/login.html',
  saveReferer: true  // Track original URL for post-login redirect
});

// 7. Protect routes with authentication
app.use('/app', requireAuth, express.static(__dirname + '/public/app'));
app.use('/dashboard', requireAuth, (req, res) => {
  res.json({user: req.user, message: 'Welcome to dashboard'});
});

// Public routes remain accessible
app.use('/', express.static(__dirname + '/public'));
```

#### How the Redirect Flow Works

```
User Flow:
1. User visits /app (not logged in)
   ↓
2. Middleware checks: req.isAuthenticated() → FALSE
   ↓
3. Middleware redirects to: /services/authservice/views/login.html?returnUrl=/app
   ↓
4. User sees login page (provided by authservice)
   ↓
5. User enters username/password
   ↓
6. Login page submits to: /services/authservice/api/login
   ↓
7. Backend validates credentials (authservice handles this)
   ↓
8. Backend calls: req.logIn(user) ← Creates Passport session
   ↓
9. API returns: { success: true, redirectUrl: /app }
   ↓
10. Frontend redirects browser to: /app
    ↓
11. Middleware checks: req.isAuthenticated() → TRUE ✓
    ↓
12. Access granted! ✓
```

#### 4b. API-Based Authentication (for REST clients)

```javascript
const express = require('express');
const session = require('express-session');
const passport = require('passport');

const app = express();
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {maxAge: 24 * 60 * 60 * 1000}
}));

app.use(passport.initialize());
app.use(passport.session());

// Initialize
serviceRegistry.initialize(app);
const authservice = serviceRegistry.authservice('file');
const { configurePassport } = authservice.passportConfigurator(authservice.getAuthStrategy);
configurePassport(passport);

// API Login endpoint (for REST clients)
app.post('/api/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return res.status(500).json({success: false, error: err.message});
    }

    if (!user) {
      return res.status(401).json({success: false, error: info?.message || 'Invalid credentials'});
    }

    // Create Passport session
    req.logIn(user, (err) => {
      if (err) {
        return res.status(500).json({success: false, error: err.message});
      }

      res.json({
        success: true,
        message: 'Login successful',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      });
    });
  })(req, res, next);
});

// Register endpoint
app.post('/api/register', async (req, res) => {
  try {
    const {username, email, password} = req.body;

    // Check if user exists
    const existing = await authservice.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({success: false, error: 'User already exists'});
    }

    // Create user
    const user = await authservice.createUser({username, email, password, role: 'user'});

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({success: false, error: error.message});
  }
});

// Protected API endpoint
app.get('/api/profile', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({error: 'Not authenticated'});
  }

  res.json({
    user: req.user,
    message: 'This is protected data'
  });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({error: err.message});
    res.json({success: true, message: 'Logged out'});
  });
});
```

#### 4c. Protecting Multiple Routes with Different Auth Levels

```javascript
// Public routes - no authentication required
app.use('/', express.static('./public'));

// Member routes - basic authentication
const requireAuth = authservice.createAuthMiddleware();
app.use('/members', requireAuth, express.static('./public/members'));

// Admin routes - authentication + role check
const requireAdmin = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/services/authservice/views/login.html?returnUrl=' + encodeURIComponent(req.originalUrl));
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({error: 'Admin access required'});
  }

  next();
};

app.use('/admin', requireAdmin, express.static('./public/admin'));

// API routes with authentication
app.get('/api/data', requireAuth, (req, res) => {
  res.json({data: 'user-specific data', user: req.user});
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({message: 'Settings updated', admin: req.user});
});
```

#### 4d. AuthService API Reference

```javascript
const authservice = serviceRegistry.authservice('file');

// User Registration
const newUser = await authservice.createUser({
  username: 'john_doe',
  email: 'john@example.com',
  password: 'secure_password',
  role: 'user'  // Optional, defaults to 'user'
});

// User Authentication (internal use)
const result = await authservice.authenticateUser('john_doe', 'secure_password');
// Returns: {user: {...}, session: {token: '...', expiresAt: ...}}

// Get User by Username
const user = await authservice.getUserByUsername('john_doe');

// Get User by Email
const user = await authservice.getUserByEmail('john@example.com');

// Update User
const updated = await authservice.updateUser('john_doe', {
  email: 'newemail@example.com',
  password: 'new_password'
});

// Delete User
await authservice.deleteUser('john_doe');

// List All Users
const allUsers = await authservice.listUsers();

// Role Management
await authservice.addUserToRole('john_doe', 'admin');
const admins = await authservice.getUsersInRole('admin');
const roles = await authservice.listRoles();

// Service Status
const status = await authservice.getStatus();
```

#### 4e. Complete Example: Protected Application

```javascript
// app.js - Complete example
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const serviceRegistry = require('noobly-core');

const app = express();
app.use(express.json());
app.use(express.urlencoded({extended: true}));

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {secure: false, httpOnly: true, maxAge: 24*60*60*1000}
}));

// Passport setup
app.use(passport.initialize());
app.use(passport.session());

// Initialize services
serviceRegistry.initialize(app, null, {
  logDir: './logs',
  dataDir: './data'
});

const authservice = serviceRegistry.authservice('file');
const logger = serviceRegistry.logger('file');

// Configure Passport
const {configurePassport} = authservice.passportConfigurator(authservice.getAuthStrategy);
configurePassport(passport);

// Create auth middleware
const requireAuth = authservice.createAuthMiddleware({
  saveReferer: true
});

// Routes
app.use('/app', requireAuth, express.static('./public/app'));
app.use('/api/public', require('./routes/public'));
app.use('/api/protected', requireAuth, require('./routes/protected'));
app.use('/', express.static('./public'));

app.listen(3000, () => {
  logger.info('Server started on port 3000');
  logger.info('Login page: http://localhost:3000/services/authservice/views/login.html');
  logger.info('Protected app: http://localhost:3000/app');
});
```

#### Built-in AuthService Pages

The authservice automatically provides:

- **Login Page**: `/services/authservice/views/login.html`
  - User can enter username and password
  - Handles returnUrl query parameter for post-login redirect
  - Submits to `/services/authservice/api/login`

- **Register Page**: `/services/authservice/views/register.html`
  - Users can create new accounts
  - Form fields: username, email, password
  - Submits to `/services/authservice/api/register`

- **Service UI**: `/services/authservice/`
  - View all registered users
  - Manage roles
  - View authentication logs

#### Key Implementation Points

1. **Session MUST be set up before Passport**: Session middleware must come before `passport.initialize()` and `passport.session()`

2. **Passport MUST be configured before protecting routes**: Call `configurePassport(passport)` before creating the `requireAuth` middleware

3. **req.logIn() MUST complete before responding**: The login API waits for the session to be created before sending the response

4. **returnUrl is automatically tracked**: The middleware captures the original URL and passes it to the login page

5. **Credentials are secure**:
   - Passwords are hashed before storage
   - Sessions use HTTP-only cookies
   - HTTPS recommended for production

#### Configuration Options

```javascript
// Authservice creation options
const authservice = serviceRegistry.authservice('file', {
  dataDir: './data/auth',        // Where to store user data
  createDefaultAdmin: false      // Create admin:admin123 (memory provider only)
});

// Middleware creation options
const requireAuth = authservice.createAuthMiddleware({
  loginPath: '/services/authservice/views/login.html',  // Custom login page
  saveReferer: true                                      // Track original URL
});
```

### Pattern 5: AI Integration with Claude
```javascript
const aiservice = serviceRegistry.aiservice('claude', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022',
  tokensStorePath: './data/ai-tokens.json'
});

// Content generation endpoint
app.post('/api/ai/generate', async (req, res) => {
  try {
    const {prompt, maxTokens = 1000} = req.body;

    const response = await aiservice.prompt(prompt, {
      maxTokens,
      temperature: 0.7
    });

    log.info('AI response generated', {
      tokens: response.usage.totalTokens,
      cost: response.usage.estimatedCost
    });

    res.json({
      content: response.content,
      usage: response.usage
    });
  } catch (error) {
    log.error('AI generation failed', error);
    res.status(500).json({error: error.message});
  }
});

// Get AI usage analytics
app.get('/api/ai/analytics', (req, res) => {
  const analytics = aiservice.getAnalytics();
  res.json(analytics);
});
```

### Caching Patterns

**Basic Operations:**
```javascript
// Store with TTL
await cache.put('session:123', userData, 3600); // 1 hour

// Retrieve
const userData = await cache.get('session:123');

// Delete
await cache.delete('session:123');

// Analytics
const analytics = cache.getAnalytics();
```

**Session Management:**
```javascript
const sessionData = {userId: '123', roles: ['admin']};
await cache.put(`session:${token}`, sessionData, 86400); // 24h

const session = await cache.get(`session:${token}`);
if (session) {
  session.lastActivity = new Date().toISOString();
  await cache.put(`session:${token}`, session, 86400);
}
```

**Rate Limiting:**
```javascript
async function checkRateLimit(clientId, limit = 100, windowSec = 3600) {
  const key = `rate:${clientId}`;
  const current = await cache.get(key) || 0;

  if (current >= limit) throw new Error('Rate limit exceeded');

  await cache.put(key, current + 1, windowSec);
  return {remaining: limit - current - 1};
}
```

### DataService Patterns

**Database-Style Operations:**
```javascript
// Insert and get UUID
const userUuid = await dataService.add('users', {
  name: 'John',
  email: 'john@example.com',
  profile: {department: 'engineering', role: 'developer'}
});

// Retrieve by UUID
const user = await dataService.getByUuid('users', userUuid);

// Delete by UUID
await dataService.remove('users', userUuid);
```

**JSON Search:**
```javascript
// Custom predicate
const activeEngineers = await dataService.jsonFind('users',
  user => user.status === 'active' && user.profile.department === 'engineering'
);

// Path-based
const developers = await dataService.jsonFindByPath('users', 'profile.role', 'developer');

// Multi-criteria
const results = await dataService.jsonFindByCriteria('users', {
  'status': 'active',
  'profile.department': 'engineering'
});
```

**User Management Example:**
```javascript
async function createUser(userData) {
  // Check existing
  const existing = await dataService.jsonFindByPath('users', 'email', userData.email);
  if (existing.length > 0) throw new Error('User exists');

  // Create user
  const user = {
    ...userData,
    id: Date.now(),
    createdAt: new Date().toISOString(),
    status: 'active'
  };

  const uuid = await dataService.add('users', user);
  return {uuid, user};
}

async function findUsersByDepartment(dept) {
  return await dataService.jsonFindByPath('users', 'profile.department', dept);
}
```

### Filing Patterns

**Document Upload/Download:**
```javascript
const fs = require('fs');

// Upload
const fileStream = fs.createReadStream('./document.pdf');
await filing.create('documents/report.pdf', fileStream);

// Download
const downloadStream = await filing.read('documents/report.pdf');

// Check exists
const exists = await filing.exists('documents/report.pdf');

// Get metadata
const metadata = await filing.getMetadata('documents/report.pdf');

// Delete
await filing.delete('documents/report.pdf');
```

**Document Manager:**
```javascript
async function uploadDocument(userId, file, metadata = {}) {
  const filename = `${Date.now()}_${file.originalname}`;
  const filePath = `users/${userId}/documents/${filename}`;

  const fileStream = require('stream').Readable.from(file.buffer);
  await filing.create(filePath, fileStream);

  const record = {
    userId, filename, filePath,
    size: file.size,
    mimeType: file.mimetype,
    uploadedAt: new Date().toISOString(),
    metadata
  };

  const uuid = await dataService.add('documents', record);
  return {uuid, filePath, document: record};
}

async function downloadDocument(docUuid) {
  const doc = await dataService.getByUuid('documents', docUuid);
  if (!doc) throw new Error('Document not found');

  const stream = await filing.read(doc.filePath);
  const metadata = await filing.getMetadata(doc.filePath);

  return {stream, document: doc, metadata};
}
```

### AI Service Integration

```javascript
// Content generation
async function generateBlogPost(topic, keywords) {
  const prompt = `Write a blog post about ${topic}. Include: ${keywords.join(', ')}`;

  const response = await claudeAI.prompt(prompt, {
    maxTokens: 2000,
    temperature: 0.8
  });

  return {
    content: response.content,
    tokensUsed: response.usage.totalTokens,
    cost: response.usage.estimatedCost
  };
}

// Code review
async function reviewCode(code, language) {
  const prompt = `Review this ${language} code:\n\n${code}`;
  const response = await chatGPT.prompt(prompt, {maxTokens: 1500});
  return response.content;
}

// Batch processing with local LLM
async function summarizeDocuments(documents) {
  const summaries = [];
  for (const doc of documents) {
    const response = await ollama.prompt(`Summarize:\n${doc.content}`, {
      maxTokens: 500
    });
    summaries.push({documentId: doc.id, summary: response.content});
  }
  return summaries;
}
```

### Scheduling

```javascript
const scheduling = serviceRegistry.scheduling('memory', {
  dependencies: {
    working: serviceRegistry.working('memory') // Required dependency
  }
});

// Schedule task to run every N seconds
await scheduling.start(
  'backupTask',              // Task name
  'scripts/backup.js',       // Script path
  { config: 'production' },  // Data passed to script
  3600,                      // Interval in seconds (1 hour)
  (status, result) => {      // Callback on each execution
    if (status === 'completed') {
      console.log('Backup completed:', result);
    } else {
      console.error('Backup failed:', result);
    }
  }
);

// Stop a specific task
await scheduling.stop('backupTask');

// Check if task is running
const isRunning = await scheduling.isRunning('backupTask');

// Stop all tasks
await scheduling.stop();
```

### Workflow Orchestration

```javascript
const workflow = serviceRegistry.workflow('memory');

// Define steps
const steps = [
  path.resolve(__dirname, './steps/validateInput.js'),
  path.resolve(__dirname, './steps/processData.js'),
  path.resolve(__dirname, './steps/saveResults.js')
];

await workflow.defineWorkflow('dataProcessing', steps);

// Execute
workflow.runWorkflow('dataProcessing', {inputData: rawData}, (result) => {
  console.log('Workflow completed:', result);
});
```

### Pub/Sub Messaging

```javascript
const notifying = serviceRegistry.notifying('memory');

// Create topic
notifying.createTopic('user-events');

// Subscribe
notifying.subscribe('user-events', (message) => {
  console.log('Event:', message);
  // Handle event
});

notifying.subscribe('user-events', (message) => {
  analyticsService.track(message);
});

// Publish
notifying.notify('user-events', {
  type: 'user-registered',
  userId: '123',
  timestamp: new Date().toISOString()
});
```

**Event System Example:**
```javascript
// Setup subscribers for e-commerce
notifying.createTopic('orders');
notifying.createTopic('inventory');
notifying.createTopic('payments');

notifying.subscribe('orders', async (event) => {
  switch (event.type) {
    case 'order_placed':
      await processOrder(event.data);
      break;
    case 'order_shipped':
      await sendShippingNotification(event.data);
      break;
  }
});

notifying.subscribe('payments', async (event) => {
  if (event.type === 'payment_completed') {
    notifying.notify('orders', {
      type: 'payment_confirmed',
      orderId: event.data.orderId
    });
  }
});

// Publish events
notifying.notify('orders', {type: 'order_placed', data: orderData});
```

### Queue Processing

```javascript
const queueing = serviceRegistry.queueing('memory');

// Add tasks
await queueing.enqueue('emailQueue', {
  taskType: 'sendEmail',
  recipient: 'user@example.com',
  template: 'welcome'
});

// Process tasks
async function processQueue() {
  while (await queueing.size('emailQueue') > 0) {
    const task = await queueing.dequeue('emailQueue');
    await handleTask(task);
  }
}
```

## Web Interface

NooblyJS includes built-in web UIs for service management:

- **Service Registry Dashboard**: `/services/` - Overview of all services
- **Individual Service Dashboards**:
  - `/services/caching/` - Cache management and analytics
  - `/services/dataservice/` - Data operations and search
  - `/services/filing/` - File management
  - `/services/logging/` - Log viewer and analytics
  - `/services/queueing/` - Queue monitoring
  - `/services/scheduling/` - Task scheduler
  - `/services/searching/` - Search interface
  - `/services/workflow/` - Workflow management
  - `/services/authservice/` - User authentication
  - `/services/ai/` - AI service management

Each dashboard includes:
- Analytics with real-time metrics
- Interactive API testing
- Swagger/OpenAPI documentation
- Operation forms

## Configuration

### Initialize Options
```javascript
serviceRegistry.initialize(app, {
  // Security
  apiKeys: ['key1', 'key2'],
  requireApiKey: true,
  excludePaths: ['/services/*/status', '/public/*'],

  // Event system (optional)
  eventEmitter: customEventEmitter
});
```

### Service-Specific Options

**Redis Cache:**
```javascript
{host: 'localhost', port: 6379, password: 'secret', keyPrefix: 'app:'}
```

**S3 Filing:**
```javascript
{bucket: 'my-bucket', region: 'us-east-1', accessKeyId: '...', secretAccessKey: '...'}
```

**AI Services:**
```javascript
{apiKey: 'sk-...', model: 'claude-3-5-sonnet-20241022', tokensStorePath: './tokens.json'}
```

**File Logging:**
```javascript
{filename: './app.log', maxFiles: 5, maxSize: '10m'}
```

**Working Service (Background Tasks):**
```javascript
{maxThreads: 4, activitiesFolder: './activities'}
```

## Event System

Global EventEmitter for inter-service communication:

```javascript
const eventEmitter = serviceRegistry.getEventEmitter();

// Listen to service events
eventEmitter.on('cache:put', (data) => {
  console.log('Cache updated:', data.key);
});

eventEmitter.on('ai:usage', (data) => {
  console.log('AI tokens used:', data.tokens);
});

eventEmitter.on('workflow:complete', (data) => {
  console.log('Workflow done:', data.name);
});

// Emit custom events
eventEmitter.emit('custom:event', {data: 'value'});
```

## Best Practices

### 1. Service Selection
- Use **memory** providers for development/testing
- Use **redis/memcached** for distributed caching in production
- Use **s3** for cloud file storage at scale
- Use **file** provider for simple persistent storage

### 2. Error Handling
```javascript
try {
  const data = await cache.get('key');
  if (!data) {
    // Handle cache miss
  }
} catch (error) {
  logger.error('Cache error:', error);
  // Fallback logic
}
```

### 3. API Key Management
```javascript
// Generate secure keys
const apiKey = serviceRegistry.generateApiKey();

// Store in environment variables
process.env.API_KEY = apiKey;

// Exclude public paths
excludePaths: ['/health', '/services/*/status', '/docs']
```

### 4. Performance
- Set appropriate TTLs for cached data
- Use connection pooling for Redis
- Implement rate limiting for APIs
- Monitor service metrics via measuring service

### 5. Security
- Always use API keys in production
- Validate input data before storage
- Sanitize file paths to prevent directory traversal
- Use environment variables for credentials

## Testing

### Unit Tests
```bash
npm test
```

### Load Tests
```bash
npm run test-load
```

### Manual API Tests
Use `.http` files in `tests/api/` directory with REST clients.

## Deployment

### Docker
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```

### Environment Variables
```bash
NODE_ENV=production
PORT=3000
REDIS_HOST=redis.example.com
REDIS_PORT=6379
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
ANTHROPIC_API_KEY=...
```

## Troubleshooting

### Service Not Initializing
- Ensure `serviceRegistry.initialize(app)` is called before accessing services
- Check provider name is valid (e.g., 'memory', 'redis', not 'Memory')

### Cache Not Working
- Verify Redis connection if using redis provider
- Check if data exceeds size limits
- Confirm TTL is set appropriately

### File Upload Fails
- Ensure base directory exists for local provider
- Check S3 credentials and permissions
- Verify file size limits

### AI Service Errors
- Confirm API keys are set in constructor options
- Check token limits aren't exceeded
- Verify network connectivity to AI provider

### API Key Issues
- Ensure key is passed in correct header/parameter
- Check path isn't excluded from auth
- Verify key is in apiKeys array

### Scheduling Issues
- Ensure working service is initialized before scheduling service
- Check script paths are absolute
- Verify worker thread limits aren't exceeded

## Common Mistakes & Troubleshooting

### ❌ Mistake 1: Not initializing registry before getting services
```javascript
// WRONG
const cache = serviceRegistry.cache('memory');
serviceRegistry.initialize(app);  // Too late!

// CORRECT
serviceRegistry.initialize(app);
const cache = serviceRegistry.cache('memory');
```

### ❌ Mistake 2: Using wrong API paths
```javascript
// WRONG - Old documentation might show this
fetch('/api/caching/get/mykey')

// CORRECT - All service APIs are under /services/
fetch('/services/caching/api/get/mykey')
```

### ❌ Mistake 3: Treating dataService like caching
```javascript
// WRONG - dataService doesn't use simple keys
await dataService.put('mykey', {data: 'value'});
const data = await dataService.get('mykey');

// CORRECT - dataService uses containers and UUIDs
const uuid = await dataService.add('mycontainer', {data: 'value'});
const data = await dataService.getByUuid('mycontainer', uuid);
```

### ❌ Mistake 4: Wrong provider names
```javascript
// WRONG - Provider names are case-sensitive and specific
const cache = serviceRegistry.cache('Memory');      // Won't work
const cache = serviceRegistry.cache('in-memory');   // Won't work

// CORRECT
const cache = serviceRegistry.cache('memory');      // Works
const cache = serviceRegistry.cache('inmemory');    // Also works for caching
```

### ❌ Mistake 5: Missing authentication setup for authservice
```javascript
// WRONG - Passport not configured
const auth = serviceRegistry.authservice('file');
app.post('/login', passport.authenticate('local'), ...);  // Won't work!

// CORRECT - Configure passport first
const auth = serviceRegistry.authservice('file');
const {configurePassport} = auth.passportConfigurator(auth.getAuthStrategy);
configurePassport(passport);
app.post('/login', passport.authenticate('local'), ...);
```

### ❌ Mistake 6: Forgetting dependencies exist
```javascript
// WRONG - Scheduling service needs working service
const scheduling = serviceRegistry.scheduling('memory');
// This might fail because working service dependency not initialized

// CORRECT - Dependencies are automatic, but be aware
serviceRegistry.initialize(app);
// working service will be auto-created when you get scheduling
const scheduling = serviceRegistry.scheduling('memory');
```

### ❌ Mistake 7: Wrong EventEmitter parameter
```javascript
// WRONG - Third parameter is options, not eventEmitter
serviceRegistry.initialize(app, {apiKeys: ['key']}, myEventEmitter);

// CORRECT - EventEmitter is second parameter
serviceRegistry.initialize(app, myEventEmitter, {apiKeys: ['key']});

// Or use null to use built-in EventEmitter
serviceRegistry.initialize(app, null, {apiKeys: ['key']});
```

## Quick Reference Cheat Sheet

### Service Initialization
```javascript
// Always this order:
serviceRegistry.initialize(app, [eventEmitter], [options]);
const service = serviceRegistry.serviceName(provider, options);
```

### Most Common Methods
```javascript
// Logging
log.info(message, metadata);
log.error(message, error);

// Caching (key-value)
await cache.put(key, value, ttlSeconds);
const value = await cache.get(key);
await cache.delete(key);

// DataService (UUID-based)
const uuid = await dataService.add(container, object);
const object = await dataService.getByUuid(container, uuid);
await dataService.remove(container, uuid);
const results = await dataService.jsonFindByCriteria(container, {field: 'value'});

// Filing
await filing.create(path, stream);
const stream = await filing.read(path);
await filing.delete(path);

// AI Service
const response = await aiservice.prompt(prompt, {maxTokens, temperature});
// response: {content, usage: {promptTokens, completionTokens, totalTokens, estimatedCost}}

// Auth Service
await auth.registerUser(username, password, email, roles);
const result = await auth.authenticateUser(username, password);
const user = await auth.getUserByUsername(username);
```

### Environment Variables Template
```bash
# Required
NODE_ENV=production
SESSION_SECRET=your-secret-here
NOOBLY_API_KEYS=key1,key2,key3

# Optional - Service specific
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=secret
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
S3_BUCKET=my-bucket
AWS_REGION=us-east-1
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
OLLAMA_URL=http://localhost:11434
```

## Additional Resources

- **GitHub**: https://github.com/nooblyjs/nooblyjs-core
- **NPM**: https://www.npmjs.com/package/noobly-core
- **Built-in Docs**: Start server and visit `/services/` for interactive documentation
- **API Tests**: See `tests/api/` directory for HTTP file examples
- **Example Apps**: See `tests/app-*.js` for complete working examples
