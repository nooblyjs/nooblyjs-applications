# CMS Platform Development Task List
## Detailed Implementation Tasks by Phase

**Status**: Ready for Implementation
**Total Tasks**: 180+ hours of development
**Estimated Team**: 6-8 engineers
**Timeline**: 12 months

---

## PHASE 1: Foundation & MVP (Months 1-3)
### Estimated: 480 hours

### ✅ Sprint 1.1: Project Setup & Infrastructure (Week 1-2)
- [ ] **1.1.1** Initialize Git repository with branch strategy
  - Subtasks: main, dev, feature branches
  - Effort: 2 hours

- [ ] **1.1.2** Create project structure and folder hierarchy
  - Create: `/backend`, `/frontend`, `/docs`, `/tests` directories
  - Effort: 2 hours

- [ ] **1.1.3** Initialize Nooblyjs-core service registry
  - Install `noobly-core` package
  - Create `app.js` with service initialization
  - Initialize: authservice, dataservice, logging, filing, caching
  - Effort: 8 hours
  - Reference: docs/nooblyjs-core-usage.md sections 1-3

- [ ] **1.1.4** Set up Express.js server
  - Configure middleware (json, urlencoded, cors)
  - Set up error handling middleware
  - Create environment configuration
  - Effort: 6 hours

- [ ] **1.1.5** Configure database persistence
  - Set up file-based storage for dataservice (initial MVP)
  - Create data directory structure
  - Effort: 4 hours

- [ ] **1.1.6** Implement logging system
  - Set up file-based logging
  - Create log directory
  - Implement request logging middleware
  - Effort: 4 hours

- [ ] **1.1.7** Set up authentication middleware
  - Install passport.js and dependencies
  - Configure session middleware
  - Create auth middleware functions
  - Effort: 6 hours

- [ ] **1.1.8** Create API documentation scaffolding
  - Install swagger-ui-express
  - Create Swagger configuration
  - Document first endpoints
  - Effort: 4 hours

- [ ] **1.1.9** Set up frontend project
  - Create React project with Vite
  - Install essential dependencies (React Router, Axios, etc.)
  - Set up folder structure (components, pages, services, styles)
  - Effort: 6 hours

- [ ] **1.1.10** Configure build pipeline
  - Set up webpack/Vite configuration
  - Create production and development builds
  - Configure hot module replacement
  - Effort: 4 hours

- [ ] **1.1.11** Set up environment configuration
  - Create .env.example file
  - Configure environment variables for backend
  - Configure environment variables for frontend
  - Effort: 3 hours

- [ ] **1.1.12** Initialize testing framework
  - Install Jest for backend
  - Install Vitest for frontend
  - Create test directory structure
  - Effort: 4 hours

**Subtotal Sprint 1.1: 53 hours**

---

### ✅ Sprint 1.2: User Management (Week 3-4)
- [ ] **1.2.1** Design User and Auth database schemas
  - Define User model structure
  - Define Session model structure
  - Create data validation schemas
  - Effort: 6 hours
  - Reference: nooblyjs-core-usage.md section 4b

- [ ] **1.2.2** Implement user registration API
  - Create POST /api/auth/register endpoint
  - Add email validation
  - Add password hashing (bcrypt)
  - Add email uniqueness check
  - Effort: 8 hours
  - Nooblyjs: authservice.createUser()

- [ ] **1.2.3** Implement user login API
  - Create POST /api/auth/login endpoint
  - Implement Passport local strategy
  - Create session management
  - Effort: 8 hours
  - Nooblyjs: authservice with passport

- [ ] **1.2.4** Implement logout API
  - Create POST /api/auth/logout endpoint
  - Clear session data
  - Effort: 4 hours

- [ ] **1.2.5** Implement password reset flow
  - Create POST /api/auth/forgot-password endpoint
  - Generate reset token
  - Send reset email (mock for MVP)
  - Effort: 8 hours

- [ ] **1.2.6** Implement password reset completion
  - Create POST /api/auth/reset-password endpoint
  - Validate reset token
  - Update password hash
  - Effort: 6 hours

- [ ] **1.2.7** Implement email verification
  - Create verification token system
  - Create GET /api/auth/verify-email endpoint
  - Add verification middleware
  - Effort: 6 hours

- [ ] **1.2.8** Create user profile endpoints
  - Create GET /api/users/profile endpoint
  - Create PUT /api/users/profile endpoint
  - Add profile update validation
  - Effort: 6 hours
  - Nooblyjs: dataservice for profile storage

- [ ] **1.2.9** Create profile UI components
  - Create Login component
  - Create Signup component
  - Create Profile page
  - Create Password reset page
  - Effort: 12 hours

- [ ] **1.2.10** Implement password reset email template
  - Create email template
  - Add email service integration (mock)
  - Effort: 4 hours

- [ ] **1.2.11** Create session management
  - Implement session middleware
  - Configure session storage with caching service
  - Add session expiration logic
  - Effort: 6 hours
  - Nooblyjs: caching service for session storage

- [ ] **1.2.12** Create role-based access control (RBAC)
  - Define roles (admin, editor, viewer)
  - Create permission matrix
  - Implement permission middleware
  - Effort: 8 hours

- [ ] **1.2.13** Create role assignment API
  - Create POST /api/admin/assign-role endpoint
  - Add role validation
  - Add audit logging
  - Effort: 6 hours

- [ ] **1.2.14** Write authentication tests
  - Write unit tests for auth functions
  - Write integration tests for auth flow
  - Effort: 8 hours

**Subtotal Sprint 1.2: 110 hours**

---

### ✅ Sprint 1.3: Site & Page Management (Week 5-6)
- [ ] **1.3.1** Design Site and Page database schemas
  - Define Site model with all required fields
  - Define Page model with hierarchy support
  - Create validation schemas
  - Effort: 6 hours

- [ ] **1.3.2** Create site CRUD endpoints
  - POST /api/sites (create)
  - GET /api/sites (list user's sites)
  - GET /api/sites/:id (read)
  - PUT /api/sites/:id (update)
  - DELETE /api/sites/:id (delete)
  - Effort: 12 hours
  - Nooblyjs: dataservice for site storage

- [ ] **1.3.3** Implement page CRUD endpoints
  - POST /api/sites/:siteId/pages (create)
  - GET /api/sites/:siteId/pages (list)
  - GET /api/sites/:siteId/pages/:pageId (read)
  - PUT /api/sites/:siteId/pages/:pageId (update)
  - DELETE /api/sites/:siteId/pages/:pageId (delete)
  - Effort: 12 hours
  - Nooblyjs: dataservice for page storage

- [ ] **1.3.4** Implement page hierarchy/navigation
  - Add parentPageId field to page model
  - Create page tree structure API
  - Create GET /api/sites/:siteId/pages/tree endpoint
  - Effort: 8 hours

- [ ] **1.3.5** Implement page ordering
  - Add order field to page model
  - Create PUT /api/sites/:siteId/pages/:pageId/order endpoint
  - Implement drag-drop ordering
  - Effort: 6 hours

- [ ] **1.3.6** Implement page versioning
  - Create page version schema
  - Create auto-save mechanism (every 30s)
  - Create GET /api/pages/:pageId/versions endpoint
  - Effort: 10 hours
  - Nooblyjs: dataservice for version storage

- [ ] **1.3.7** Implement version restore
  - Create POST /api/pages/:pageId/versions/:versionId/restore endpoint
  - Add restore validation
  - Effort: 6 hours

- [ ] **1.3.8** Create site management UI
  - Create Sites list page
  - Create Create new site modal
  - Create Edit site settings page
  - Create Delete site confirmation
  - Effort: 14 hours

- [ ] **1.3.9** Create page management UI
  - Create Pages list component
  - Create Create page modal
  - Create Page tree navigator
  - Create Delete page confirmation
  - Effort: 14 hours

- [ ] **1.3.10** Create version history UI
  - Create Version history panel
  - Create Version diff viewer
  - Create Restore button
  - Effort: 10 hours

- [ ] **1.3.11** Implement page slugs
  - Add slug generation from page name
  - Ensure slug uniqueness within site
  - Add slug validation
  - Effort: 6 hours

- [ ] **1.3.12** Write site/page tests
  - Write CRUD tests
  - Write hierarchy tests
  - Write versioning tests
  - Effort: 10 hours

**Subtotal Sprint 1.3: 114 hours**

---

### ✅ Sprint 1.4: Visual Builder Foundation (Week 7-8)
- [ ] **1.4.1** Define component type system
  - Create component type definitions
  - Define Hero component type with props
  - Define Section component type
  - Define Button component type
  - Define Text component type
  - Define Image component type
  - Define Container component type
  - Define Grid component type
  - Define Form component type
  - Define Footer component type
  - Effort: 8 hours

- [ ] **1.4.2** Design Component model/schema
  - Define component JSON structure
  - Add props, children, styling fields
  - Add metadata fields (locked, hidden, animated)
  - Effort: 6 hours

- [ ] **1.4.3** Create component storage API
  - Implement save component structure to page content
  - Create component retrieval logic
  - Effort: 6 hours
  - Nooblyjs: dataservice for storing component tree

- [ ] **1.4.4** Create visual builder canvas
  - Set up Konva.js for canvas
  - Create canvas rendering engine
  - Implement component rendering on canvas
  - Effort: 16 hours

- [ ] **1.4.5** Implement drag-and-drop system
  - Implement component dragging
  - Implement drop target detection
  - Implement position snapping
  - Implement undo on drop
  - Effort: 14 hours

- [ ] **1.4.6** Create component selection system
  - Implement element selection
  - Create selection handles/indicators
  - Implement selection keyboard shortcuts
  - Effort: 8 hours

- [ ] **1.4.7** Create property panel
  - Create property editor UI
  - Implement property input controls
  - Add real-time property updates
  - Effort: 12 hours

- [ ] **1.4.8** Create component library sidebar
  - Create component list UI
  - Add component search
  - Add component descriptions
  - Implement drag-from-library
  - Effort: 10 hours

- [ ] **1.4.9** Implement real-time preview
  - Create preview panel component
  - Implement live preview rendering
  - Add preview refresh on property change
  - Effort: 10 hours

- [ ] **1.4.10** Create responsive breakpoint system
  - Add desktop, tablet, mobile breakpoints
  - Create breakpoint selector UI
  - Implement breakpoint-specific styles
  - Effort: 12 hours

- [ ] **1.4.11** Implement undo/redo functionality
  - Create action history system
  - Implement undo stack
  - Implement redo stack
  - Create undo/redo UI buttons
  - Effort: 10 hours

- [ ] **1.4.12** Create page save functionality
  - POST /api/pages/:pageId/content endpoint
  - Implement auto-save (every 30s)
  - Add save status indicator
  - Effort: 8 hours
  - Nooblyjs: dataservice and workflow for saving

- [ ] **1.4.13** Create builder layout
  - Create Header with file menu
  - Create Left sidebar with components
  - Create Center canvas
  - Create Right properties panel
  - Create Bottom status bar
  - Effort: 10 hours

- [ ] **1.4.14** Create file menu
  - Create New page option
  - Create Open page option
  - Create Save option
  - Create Publish option
  - Create Settings option
  - Effort: 8 hours

- [ ] **1.4.15** Write builder tests
  - Write canvas rendering tests
  - Write drag-drop tests
  - Write property update tests
  - Effort: 10 hours

**Subtotal Sprint 1.4: 157 hours**

---

### ✅ Sprint 1.5: Media Management (Week 9-10)
- [ ] **1.5.1** Create media library schema
  - Define Media model
  - Add metadata fields (size, type, dimensions)
  - Add organization fields (folder, tags)
  - Effort: 4 hours

- [ ] **1.5.2** Implement file upload API
  - Create POST /api/media/upload endpoint
  - Implement multer file handling
  - Add file validation (size, type)
  - Add virus scanning (mock for MVP)
  - Effort: 8 hours
  - Nooblyjs: filing service for storage

- [ ] **1.5.3** Implement image optimization
  - Create image resizing pipeline
  - Add automatic compression
  - Add format conversion (WebP)
  - Effort: 10 hours
  - Nooblyjs: working service for parallel processing

- [ ] **1.5.4** Create image variants
  - Generate thumbnail variant
  - Generate medium variant
  - Generate large variant
  - Effort: 6 hours

- [ ] **1.5.5** Implement media deletion API
  - Create DELETE /api/media/:id endpoint
  - Remove file from storage
  - Remove database record
  - Effort: 4 hours

- [ ] **1.5.6** Create media library UI
  - Create upload area component
  - Create media grid view
  - Create media list view
  - Add search/filter
  - Effort: 12 hours

- [ ] **1.5.7** Create media folder system
  - Create folder hierarchy
  - Implement folder navigation
  - Add folder CRUD operations
  - Effort: 8 hours

- [ ] **1.5.8** Create image insertion feature
  - Add image selection from library
  - Add image insertion into components
  - Add image alt text editing
  - Effort: 8 hours

- [ ] **1.5.9** Create media usage tracking
  - Track which pages use which media
  - Display usage information
  - Prevent deletion of in-use media
  - Effort: 6 hours
  - Nooblyjs: searching service for usage search

- [ ] **1.5.10** Write media tests
  - Write upload tests
  - Write optimization tests
  - Write deletion tests
  - Effort: 8 hours

**Subtotal Sprint 1.5: 74 hours**

---

### ✅ Sprint 1.6: Publishing & Deployment (Week 11-12)
- [ ] **1.6.1** Create publishing workflow
  - Define publish steps (validation, snapshot, deploy)
  - Create workflow definition
  - Effort: 6 hours
  - Nooblyjs: workflow service

- [ ] **1.6.2** Implement publish validation
  - Check required fields
  - Verify images are loaded
  - Check for broken links
  - Effort: 8 hours

- [ ] **1.6.3** Create publish endpoints
  - POST /api/sites/:siteId/publish endpoint
  - POST /api/sites/:siteId/schedule-publish endpoint
  - GET /api/sites/:siteId/publish-history endpoint
  - Effort: 10 hours

- [ ] **1.6.4** Implement site rendering
  - Create public site renderer
  - Implement page route resolution
  - Add template rendering engine
  - Effort: 14 hours

- [ ] **1.6.5** Create public site frontend
  - Create responsive site renderer
  - Implement component rendering for visitors
  - Add navigation/routing
  - Effort: 16 hours

- [ ] **1.6.6** Implement domain assignment
  - Add domain field to site model
  - Create domain assignment API
  - Add basic domain routing logic
  - Effort: 8 hours

- [ ] **1.6.7** Set up SSL/HTTPS
  - Create SSL certificate generation (Let's Encrypt)
  - Implement auto-renewal
  - Force HTTPS redirect
  - Effort: 8 hours

- [ ] **1.6.8** Create site settings UI
  - Create domain settings page
  - Create site metadata settings
  - Create publish settings
  - Create advanced settings
  - Effort: 10 hours

- [ ] **1.6.9** Create publish UI
  - Create publish button in editor
  - Create publish confirmation dialog
  - Create schedule publish modal
  - Create publish history view
  - Effort: 10 hours

- [ ] **1.6.10** Implement analytics tracking code
  - Create tracking pixel
  - Inject into public sites
  - Add visitor tracking
  - Effort: 8 hours
  - Nooblyjs: measuring service for analytics

- [ ] **1.6.11** Create analytics dashboard (basic)
  - Display page views
  - Display unique visitors
  - Display traffic over time
  - Effort: 10 hours

- [ ] **1.6.12** Implement backup system
  - Create daily backup schedule
  - Create backup storage
  - Create GET /api/sites/:siteId/backups endpoint
  - Effort: 8 hours
  - Nooblyjs: scheduling for daily backups, filing for storage

- [ ] **1.6.13** Create restore functionality
  - Create POST /api/sites/:siteId/backups/:backupId/restore endpoint
  - Implement restore validation
  - Add restore confirmation
  - Effort: 6 hours

- [ ] **1.6.14** Write publishing tests
  - Write workflow tests
  - Write rendering tests
  - Write backup/restore tests
  - Effort: 10 hours

**Subtotal Sprint 1.6: 132 hours**

---

## PHASE 2: Content & Collaboration (Months 4-6)
### Estimated: 320 hours

### ✅ Sprint 2.1: Rich Text Editor (Week 13-14)
- [ ] **2.1.1** Evaluate rich text editor libraries
  - Evaluate TipTap
  - Evaluate Draft.js
  - Evaluate Slate
  - Decide on TipTap
  - Effort: 4 hours

- [ ] **2.1.2** Implement TipTap integration
  - Install TipTap and extensions
  - Create custom extensions
  - Configure toolbar
  - Effort: 8 hours

- [ ] **2.1.3** Create rich text component
  - Create text component with editor
  - Implement property binding
  - Add content serialization
  - Effort: 8 hours

- [ ] **2.1.4** Implement text formatting
  - Bold, italic, underline
  - Strikethrough
  - Text alignment
  - Font size, font family
  - Effort: 10 hours

- [ ] **2.1.5** Implement headings and paragraphs
  - H1-H6 support
  - Paragraph formatting
  - Block quote support
  - Code block support
  - Effort: 8 hours

- [ ] **2.1.6** Implement lists
  - Ordered lists
  - Unordered lists
  - Nested lists
  - List formatting options
  - Effort: 8 hours

- [ ] **2.1.7** Implement links
  - Add internal link support
  - Add external link support
  - Add link preview
  - Link target options (new tab, etc.)
  - Effort: 8 hours

- [ ] **2.1.8** Implement inline media
  - Add image insertion
  - Add video embedding
  - Add audio embedding
  - Media preview
  - Effort: 10 hours

- [ ] **2.1.9** Implement embeds
  - YouTube embed
  - Vimeo embed
  - Spotify embed
  - Custom iframe embed
  - Effort: 8 hours

- [ ] **2.1.10** Implement text formatting toolbar
  - Create formatting toolbar UI
  - Add keyboard shortcuts
  - Add formatting options
  - Effort: 8 hours

- [ ] **2.1.11** Add rich text to component system
  - Create RichText component
  - Integrate with visual builder
  - Implement property binding
  - Effort: 8 hours

- [ ] **2.1.12** Create rich text tests
  - Test formatting
  - Test link insertion
  - Test embed insertion
  - Effort: 6 hours

**Subtotal Sprint 2.1: 102 hours**

---

### ✅ Sprint 2.2: Collections/Database (Week 15-16)
- [ ] **2.2.1** Design collection schema
  - Define collection structure
  - Define field types
  - Define collection relationships
  - Effort: 6 hours

- [ ] **2.2.2** Create collection CRUD endpoints
  - POST /api/sites/:siteId/collections (create)
  - GET /api/sites/:siteId/collections (list)
  - PUT /api/sites/:siteId/collections/:collectionId (update)
  - DELETE /api/sites/:siteId/collections/:collectionId (delete)
  - Effort: 10 hours
  - Nooblyjs: dataservice for collection storage

- [ ] **2.2.3** Implement field type system
  - Text field
  - Number field
  - Date field
  - Dropdown/Select field
  - Multi-select field
  - Rich text field
  - Image field
  - Reference field
  - Effort: 12 hours

- [ ] **2.2.4** Create collection item CRUD
  - POST /api/collections/:collectionId/items (create)
  - GET /api/collections/:collectionId/items (list)
  - GET /api/collections/:collectionId/items/:itemId (read)
  - PUT /api/collections/:collectionId/items/:itemId (update)
  - DELETE /api/collections/:collectionId/items/:itemId (delete)
  - Effort: 12 hours
  - Nooblyjs: dataservice for item storage

- [ ] **2.2.5** Implement field validation
  - Required field validation
  - Format validation (email, URL, etc.)
  - Type validation
  - Custom validation rules
  - Effort: 10 hours

- [ ] **2.2.6** Create schema builder UI
  - Create field type selector
  - Create field name input
  - Create field settings panel
  - Create field ordering
  - Effort: 12 hours

- [ ] **2.2.7** Create collection manager UI
  - Create collection list
  - Create collection details view
  - Create item management table
  - Create item creation/editing form
  - Effort: 14 hours

- [ ] **2.2.8** Implement collection search
  - Full-text search on collections
  - Filter by field values
  - Sort by fields
  - Effort: 10 hours
  - Nooblyjs: searching service

- [ ] **2.2.9** Implement bulk operations
  - Bulk edit items
  - Bulk delete items
  - CSV import
  - CSV export
  - Effort: 12 hours

- [ ] **2.2.10** Create collection relationship view
  - Show relationships between collections
  - Create relationship visualization
  - Allow relationship editing
  - Effort: 10 hours

- [ ] **2.2.11** Create collection API
  - Expose collection data via REST API
  - Add query parameters (filter, sort, limit)
  - Add pagination
  - Effort: 10 hours

- [ ] **2.2.12** Write collection tests
  - Test schema creation
  - Test item CRUD
  - Test validation
  - Test bulk operations
  - Effort: 10 hours

**Subtotal Sprint 2.2: 128 hours**

---

### ✅ Sprint 2.3: Team Collaboration (Week 17-18)
- [ ] **2.3.1** Create team member management
  - POST /api/sites/:siteId/members (invite)
  - GET /api/sites/:siteId/members (list)
  - PUT /api/sites/:siteId/members/:memberId (update)
  - DELETE /api/sites/:siteId/members/:memberId (remove)
  - Effort: 10 hours
  - Nooblyjs: dataservice, authservice for member storage

- [ ] **2.3.2** Implement role assignment
  - Owner role
  - Admin role
  - Editor role
  - Viewer role
  - Custom roles
  - Effort: 8 hours

- [ ] **2.3.3** Implement permission checks
  - Permission middleware
  - Resource-level permissions
  - Action-level permissions
  - Effort: 10 hours

- [ ] **2.3.4** Create permission matrix
  - Define permission levels
  - Define role capabilities
  - Create permission data model
  - Effort: 8 hours

- [ ] **2.3.5** Implement activity logging
  - Log all user actions
  - Store action metadata
  - Create activity API
  - Effort: 10 hours
  - Nooblyjs: logging service

- [ ] **2.3.6** Create audit trail UI
  - Display activity log
  - Filter activity by user
  - Filter activity by action
  - Filter activity by date range
  - Effort: 10 hours

- [ ] **2.3.7** Create team management UI
  - Create member invite dialog
  - Create member list
  - Create role assignment controls
  - Create member removal
  - Effort: 10 hours

- [ ] **2.3.8** Implement comment system
  - Create Comment data model
  - POST /api/pages/:pageId/comments (add)
  - GET /api/pages/:pageId/comments (list)
  - DELETE /api/pages/:pageId/comments/:commentId (delete)
  - Effort: 10 hours
  - Nooblyjs: dataservice for comment storage

- [ ] **2.3.9** Create comment UI
  - Create comment thread view
  - Create comment input
  - Create comment editing
  - Add timestamp and author info
  - Effort: 10 hours

- [ ] **2.3.10** Implement @mentions in comments
  - Parse @mentions in comment text
  - Send notification to mentioned users
  - Create mention UI
  - Effort: 8 hours
  - Nooblyjs: notifying service

- [ ] **2.3.11** Write collaboration tests
  - Test permission checking
  - Test activity logging
  - Test comments
  - Effort: 8 hours

**Subtotal Sprint 2.3: 102 hours**

---

### ✅ Sprint 2.4: Real-time Collaboration (Week 19-20)
- [ ] **2.4.1** Set up Socket.io server
  - Install and configure Socket.io
  - Create socket connection handling
  - Add authentication to sockets
  - Effort: 8 hours

- [ ] **2.4.2** Create presence tracking
  - Track user presence on pages
  - Broadcast presence to other users
  - Show presence indicators
  - Effort: 10 hours

- [ ] **2.4.3** Implement live page updates
  - Broadcast component changes
  - Handle concurrent edits
  - Implement conflict resolution
  - Effort: 14 hours

- [ ] **2.4.4** Create real-time notifications
  - Notify on page changes
  - Notify on comments
  - Notify on mentions
  - Effort: 10 hours
  - Nooblyjs: notifying service

- [ ] **2.4.5** Implement cursor position tracking
  - Show other users' cursor positions
  - Display user avatars
  - Handle cursor movement
  - Effort: 10 hours

- [ ] **2.4.6** Create locking system for concurrent edits
  - Lock element when user edits
  - Release lock on save/disconnect
  - Show lock status
  - Effort: 8 hours

- [ ] **2.4.7** Create notification center
  - Display all notifications
  - Mark notifications as read
  - Filter notifications
  - Effort: 10 hours

- [ ] **2.4.8** Implement Socket.io reconnection
  - Handle disconnection gracefully
  - Auto-reconnect
  - Sync state on reconnect
  - Effort: 8 hours

- [ ] **2.4.9** Write real-time collaboration tests
  - Test presence tracking
  - Test live updates
  - Test concurrent edit handling
  - Effort: 10 hours

**Subtotal Sprint 2.4: 88 hours**

---

### ✅ Sprint 2.5: Advanced Editor Features (Week 21-22)
- [ ] **2.5.1** Implement undo/redo for collaborative editing
  - Handle undo/redo across multiple users
  - Ensure consistency
  - Effort: 12 hours

- [ ] **2.5.2** Create responsive editor
  - Add desktop breakpoint editor
  - Add tablet breakpoint editor
  - Add mobile breakpoint editor
  - Breakpoint preview switching
  - Effort: 14 hours

- [ ] **2.5.3** Implement breakpoint-specific properties
  - Show relevant properties per breakpoint
  - Save breakpoint-specific styles
  - Apply breakpoint overrides
  - Effort: 12 hours

- [ ] **2.5.4** Create layers panel
  - Display component hierarchy
  - Select component from layers
  - Show/hide components
  - Lock/unlock components
  - Effort: 12 hours

- [ ] **2.5.5** Implement component grouping
  - Group selected components
  - Ungroup components
  - Nested grouping
  - Effort: 10 hours

- [ ] **2.5.6** Add animation support
  - Define animation properties
  - Animation type selector
  - Animation timing controls
  - Effort: 12 hours

- [ ] **2.5.7** Create animation UI
  - Animation panel
  - Keyframe editor
  - Animation preview
  - Effort: 10 hours

- [ ] **2.5.8** Implement keyboard shortcuts
  - Ctrl+Z for undo
  - Ctrl+Y for redo
  - Ctrl+C/V/X for copy/paste
  - Delete for remove
  - Effort: 8 hours

- [ ] **2.5.9** Write advanced editor tests
  - Test undo/redo
  - Test responsive editing
  - Test animations
  - Effort: 10 hours

**Subtotal Sprint 2.5: 100 hours**

---

## PHASE 3: E-commerce (Months 7-9)
### Estimated: 320 hours

### ✅ Sprint 3.1: Product Management (Week 25-26)
- [ ] **3.1.1** Design product schema
  - Define Product model
  - Define variant structure
  - Define pricing fields
  - Effort: 6 hours

- [ ] **3.1.2** Create product CRUD endpoints
  - POST /api/sites/:siteId/products (create)
  - GET /api/sites/:siteId/products (list)
  - GET /api/sites/:siteId/products/:productId (read)
  - PUT /api/sites/:siteId/products/:productId (update)
  - DELETE /api/sites/:siteId/products/:productId (delete)
  - Effort: 12 hours
  - Nooblyjs: dataservice for product storage

- [ ] **3.1.3** Implement product variants
  - Define variant schema
  - Create variant CRUD
  - Add variant pricing
  - Effort: 10 hours

- [ ] **3.1.4** Implement product categories
  - Create category CRUD
  - Assign products to categories
  - Create category hierarchy
  - Effort: 8 hours

- [ ] **3.1.5** Create product gallery
  - Upload multiple images
  - Set featured image
  - Reorder images
  - Effort: 8 hours
  - Nooblyjs: filing service for image storage

- [ ] **3.1.6** Implement product search
  - Full-text search
  - Filter by category
  - Filter by price range
  - Filter by attributes
  - Effort: 10 hours
  - Nooblyjs: searching service

- [ ] **3.1.7** Create product UI
  - Create product list page
  - Create product detail page
  - Create product creation form
  - Create product editing form
  - Effort: 16 hours

- [ ] **3.1.8** Create product component for builder
  - Create product display component
  - Create product grid component
  - Create product filter component
  - Effort: 12 hours

- [ ] **3.1.9** Implement product SEO
  - Add SEO fields to product
  - Create product schema markup
  - Add canonical tags
  - Effort: 8 hours

- [ ] **3.1.10** Write product tests
  - Test CRUD operations
  - Test search
  - Test variants
  - Effort: 8 hours

**Subtotal Sprint 3.1: 98 hours**

---

### ✅ Sprint 3.2: Shopping Cart (Week 27-28)
- [ ] **3.2.1** Design cart schema
  - Define Cart model
  - Define CartItem structure
  - Effort: 4 hours

- [ ] **3.2.2** Create cart API
  - POST /api/cart/add (add item)
  - DELETE /api/cart/remove/:itemId (remove)
  - PUT /api/cart/update/:itemId (update quantity)
  - GET /api/cart (get cart)
  - POST /api/cart/clear (clear cart)
  - Effort: 10 hours
  - Nooblyjs: caching service for cart persistence

- [ ] **3.2.3** Create cart UI component
  - Create cart display
  - Create cart item list
  - Create quantity controls
  - Create remove button
  - Effort: 10 hours

- [ ] **3.2.4** Implement cart calculations
  - Calculate subtotal
  - Calculate total items
  - Calculate discount
  - Effort: 6 hours

- [ ] **3.2.5** Create cart persistence
  - Save cart to localStorage
  - Sync with backend
  - Handle session restoration
  - Effort: 8 hours

- [ ] **3.2.6** Implement cart page
  - Create cart display page
  - Create continue shopping link
  - Create checkout button
  - Create coupon input
  - Effort: 10 hours

- [ ] **3.2.7** Create mini cart widget
  - Create header cart widget
  - Display item count
  - Quick view and checkout
  - Effort: 8 hours

- [ ] **3.2.8** Implement cart animations
  - Add to cart animation
  - Remove from cart animation
  - Quantity change animation
  - Effort: 6 hours

- [ ] **3.2.9** Create abandoned cart tracking
  - Track cart abandonment
  - Store abandoned carts
  - Effort: 6 hours
  - Nooblyjs: dataservice for abandoned cart storage

- [ ] **3.2.10** Write cart tests
  - Test add/remove
  - Test calculations
  - Test persistence
  - Effort: 8 hours

**Subtotal Sprint 3.2: 76 hours**

---

### ✅ Sprint 3.3: Payment Processing (Week 29-30)
- [ ] **3.3.1** Set up Stripe integration
  - Install stripe library
  - Configure Stripe keys
  - Create Stripe service wrapper
  - Effort: 6 hours

- [ ] **3.3.2** Create checkout page
  - Create multi-step checkout
  - Create progress indicator
  - Step 1: Shipping address
  - Step 2: Shipping method
  - Step 3: Payment
  - Effort: 14 hours

- [ ] **3.3.3** Create payment form
  - Implement Stripe Elements
  - Create card input component
  - Add zip code input
  - Add error handling
  - Effort: 10 hours

- [ ] **3.3.4** Implement shipping address form
  - Create address input form
  - Add address validation
  - Add autocomplete
  - Effort: 8 hours

- [ ] **3.3.5** Implement shipping method selection
  - Fetch available shipping methods
  - Display shipping options
  - Calculate shipping cost
  - Effort: 8 hours

- [ ] **3.3.6** Create payment processing endpoint
  - POST /api/checkout/process-payment
  - Create payment intent
  - Process payment
  - Handle payment success/failure
  - Effort: 12 hours

- [ ] **3.3.7** Implement payment confirmation
  - Show confirmation page
  - Send confirmation email
  - Provide order tracking
  - Effort: 10 hours

- [ ] **3.3.8** Create payment error handling
  - Handle Stripe errors
  - Display user-friendly messages
  - Implement retry logic
  - Effort: 8 hours

- [ ] **3.3.9** Implement tax calculation
  - Calculate tax based on address
  - Update total with tax
  - Display tax breakdown
  - Effort: 8 hours

- [ ] **3.3.10** Write payment tests
  - Test payment processing
  - Test error handling
  - Test confirmation flow
  - Effort: 10 hours

**Subtotal Sprint 3.3: 94 hours**

---

### ✅ Sprint 3.4: Order Management (Week 31-32)
- [ ] **3.4.1** Design order schema
  - Define Order model
  - Define order status
  - Define order metadata
  - Effort: 6 hours

- [ ] **3.4.2** Create order CRUD
  - POST /api/orders (create from checkout)
  - GET /api/sites/:siteId/orders (list)
  - GET /api/orders/:orderId (read)
  - PUT /api/orders/:orderId (update status)
  - Effort: 10 hours
  - Nooblyjs: dataservice for order storage

- [ ] **3.4.3** Create order dashboard
  - Display all orders
  - Filter by status
  - Sort by date
  - Search by order ID/customer
  - Effort: 12 hours

- [ ] **3.4.4** Create order detail view
  - Display order items
  - Display order total
  - Display customer info
  - Display shipping info
  - Effort: 10 hours

- [ ] **3.4.5** Implement order status updates
  - Update status to "processing"
  - Update status to "shipped"
  - Update status to "delivered"
  - Send notifications
  - Effort: 10 hours
  - Nooblyjs: notifying service for notifications

- [ ] **3.4.6** Create fulfillment UI
  - Create fulfillment form
  - Add tracking number input
  - Mark as shipped button
  - Effort: 8 hours

- [ ] **3.4.7** Implement order notifications
  - Send order confirmation email
  - Send shipping notification
  - Send delivery notification
  - Effort: 10 hours
  - Nooblyjs: queueing and notifying services

- [ ] **3.4.8** Create customer order history
  - Customer portal to view orders
  - Display order list
  - Display order details
  - Implement order tracking
  - Effort: 12 hours

- [ ] **3.4.9** Implement refund processing
  - Create refund form
  - Process refund to Stripe
  - Update order status
  - Send refund notification
  - Effort: 10 hours

- [ ] **3.4.10** Write order tests
  - Test order creation
  - Test status updates
  - Test notifications
  - Effort: 10 hours

**Subtotal Sprint 3.4: 98 hours**

---

### ✅ Sprint 3.5: Inventory Management (Week 33-34)
- [ ] **3.5.1** Add inventory fields to product
  - Add stock quantity
  - Add low stock threshold
  - Add reorder point
  - Effort: 4 hours

- [ ] **3.5.2** Create inventory tracking API
  - POST /api/products/:productId/inventory/adjust
  - GET /api/products/:productId/inventory
  - Effort: 8 hours
  - Nooblyjs: dataservice for inventory storage

- [ ] **3.5.3** Implement stock deduction on purchase
  - Deduct stock on order
  - Handle insufficient stock
  - Effort: 8 hours

- [ ] **3.5.4** Create low stock alerts
  - Check stock on product updates
  - Send notifications when low
  - Effort: 8 hours
  - Nooblyjs: notifying service for alerts

- [ ] **3.5.5** Create inventory dashboard
  - Display all products with stock
  - Show low stock items
  - Show out of stock items
  - Effort: 10 hours

- [ ] **3.5.6** Implement bulk inventory import
  - Create CSV upload
  - Parse inventory data
  - Update inventory in bulk
  - Effort: 10 hours

- [ ] **3.5.7** Create inventory export
  - Export inventory to CSV
  - Include all fields
  - Effort: 6 hours

- [ ] **3.5.8** Implement inventory history
  - Track stock changes
  - Record reason for change
  - Display history
  - Effort: 8 hours

- [ ] **3.5.9** Create stock management UI
  - Manual stock adjustment form
  - Stock history view
  - Low stock alert settings
  - Effort: 10 hours

- [ ] **3.5.10** Write inventory tests
  - Test stock deduction
  - Test alerts
  - Test import/export
  - Effort: 8 hours

**Subtotal Sprint 3.5: 80 hours**

---

### ✅ Sprint 3.6: E-commerce SEO (Week 35-36)
- [ ] **3.6.1** Add SEO fields to products
  - Meta title
  - Meta description
  - Keywords
  - Slug
  - Effort: 6 hours

- [ ] **3.6.2** Implement product schema markup
  - Add Product schema
  - Add AggregateOffer schema
  - Add Review schema
  - Effort: 8 hours

- [ ] **3.6.3** Create product listing schema
  - Add ItemList schema
  - Add BreadcrumbList schema
  - Effort: 6 hours

- [ ] **3.6.4** Implement product image SEO
  - Add alt text fields
  - Generate optimized images
  - Add image sitemap
  - Effort: 8 hours

- [ ] **3.6.5** Create category page SEO
  - Add meta fields to categories
  - Generate category schema markup
  - Create category sitemap
  - Effort: 8 hours

- [ ] **3.6.6** Implement breadcrumb navigation
  - Add breadcrumb display
  - Add breadcrumb schema
  - Effort: 6 hours

- [ ] **3.6.7** Create product sitemap
  - Generate product sitemap
  - Include variant information
  - Effort: 6 hours

- [ ] **3.6.8** Write e-commerce SEO tests
  - Test schema generation
  - Test sitemap generation
  - Effort: 6 hours

**Subtotal Sprint 3.6: 54 hours**

---

## PHASE 4: Marketing & Analytics (Months 10-12)
### Estimated: 280 hours

### ✅ Sprint 4.1: Analytics Foundation (Week 37-38)
- [ ] **4.1.1** Create analytics tracking system
  - Inject tracking code to sites
  - Track page views
  - Track unique visitors
  - Track visitor properties
  - Effort: 12 hours
  - Nooblyjs: measuring service

- [ ] **4.1.2** Create analytics data schema
  - Define analytics event structure
  - Define visitor properties
  - Define session structure
  - Effort: 6 hours

- [ ] **4.1.3** Create analytics API
  - GET /api/sites/:siteId/analytics/pageviews
  - GET /api/sites/:siteId/analytics/visitors
  - GET /api/sites/:siteId/analytics/sessions
  - Effort: 12 hours
  - Nooblyjs: searching service for analytics queries

- [ ] **4.1.4** Create analytics dashboard
  - Display page views chart
  - Display unique visitors chart
  - Display bounce rate
  - Display average session duration
  - Effort: 14 hours

- [ ] **4.1.5** Implement date range filtering
  - Create date range picker
  - Support preset ranges (today, week, month)
  - Support custom ranges
  - Effort: 8 hours

- [ ] **4.1.6** Create traffic overview
  - Display key metrics
  - Show trends (up/down)
  - Show comparison to previous period
  - Effort: 10 hours

- [ ] **4.1.7** Implement traffic sources report
  - Track referrer sources
  - Display referrer breakdown
  - Show top referrers
  - Effort: 10 hours

- [ ] **4.1.8** Create real-time analytics
  - Show live page views
  - Show current visitors
  - Display live traffic map
  - Effort: 12 hours

- [ ] **4.1.9** Create analytics export
  - Export as CSV
  - Export as PDF
  - Schedule email reports
  - Effort: 10 hours

- [ ] **4.1.10** Write analytics tests
  - Test tracking
  - Test aggregation
  - Test filtering
  - Effort: 10 hours

**Subtotal Sprint 4.1: 104 hours**

---

### ✅ Sprint 4.2: SEO Tools (Week 39-40)
- [ ] **4.2.1** Create SEO analyzer
  - Analyze page title
  - Analyze meta description
  - Check heading structure
  - Check keyword usage
  - Effort: 12 hours

- [ ] **4.2.2** Create SEO scoring system
  - Generate overall score
  - Identify issues
  - Provide recommendations
  - Effort: 10 hours

- [ ] **4.2.3** Create meta tag editor
  - Edit meta title
  - Edit meta description
  - Edit og:title, og:description, og:image
  - Edit twitter:title, twitter:description, twitter:image
  - Effort: 10 hours

- [ ] **4.2.4** Implement sitemap generation
  - Generate XML sitemap
  - Include all pages
  - Set update frequency
  - Set priority
  - Effort: 10 hours

- [ ] **4.2.5** Create robots.txt editor
  - Edit robots.txt
  - Preview robots.txt
  - Effort: 6 hours

- [ ] **4.2.6** Create sitemap submission
  - Submit to Google
  - Submit to Bing
  - Show submission status
  - Effort: 8 hours

- [ ] **4.2.7** Implement breadcrumb schema
  - Add breadcrumb schema markup
  - Validate schema
  - Effort: 6 hours

- [ ] **4.2.8** Create keyword research tool
  - Suggest keywords
  - Show keyword stats
  - Show keyword difficulty
  - Effort: 10 hours

- [ ] **4.2.9** Create internal link suggestions
  - Analyze internal links
  - Suggest internal links
  - Display internal link graph
  - Effort: 10 hours

- [ ] **4.2.10** Create SEO UI
  - Create SEO dashboard
  - Show all issues
  - Show recommendations
  - Display score card
  - Effort: 12 hours

- [ ] **4.2.11** Write SEO tools tests
  - Test analyzer
  - Test sitemap generation
  - Test schema markup
  - Effort: 8 hours

**Subtotal Sprint 4.2: 102 hours**

---

### ✅ Sprint 4.3: Email Marketing (Week 41-42)
- [ ] **4.3.1** Create email list management
  - Create email list schema
  - Create list CRUD
  - Subscribe/unsubscribe endpoints
  - Effort: 10 hours
  - Nooblyjs: dataservice for list storage

- [ ] **4.3.2** Create email template builder
  - Create drag-drop email builder
  - Add email components
  - Style email components
  - Effort: 14 hours

- [ ] **4.3.3** Implement email template storage
  - Save email templates
  - Create template CRUD
  - Effort: 6 hours
  - Nooblyjs: dataservice for template storage

- [ ] **4.3.4** Create email campaign builder
  - Campaign name and description
  - Select email template
  - Select recipient list
  - Schedule sending
  - Effort: 12 hours

- [ ] **4.3.5** Implement email delivery
  - Integrate SendGrid or similar
  - Queue emails for sending
  - Track delivery status
  - Effort: 12 hours
  - Nooblyjs: queueing service for email queue

- [ ] **4.3.6** Create email analytics
  - Track open rates
  - Track click rates
  - Track unsubscribe rates
  - Effort: 10 hours
  - Nooblyjs: measuring service for analytics

- [ ] **4.3.7** Create email UI
  - Create campaigns list
  - Create campaign editor
  - Create template selector
  - Create send confirmation
  - Effort: 12 hours

- [ ] **4.3.8** Implement subscriber management
  - Create subscriber list
  - Allow subscriber import
  - Allow subscriber export
  - Implement subscriber preferences
  - Effort: 10 hours

- [ ] **4.3.9** Implement automated emails
  - Welcome email on signup
  - Order confirmation email
  - Abandoned cart email
  - Effort: 12 hours
  - Nooblyjs: workflow and scheduling services

- [ ] **4.3.10** Write email marketing tests
  - Test campaign creation
  - Test delivery
  - Test analytics
  - Effort: 8 hours

**Subtotal Sprint 4.3: 106 hours**

---

### ✅ Sprint 4.4: API & Integrations (Week 43-44)
- [ ] **4.4.1** Document REST API
  - Write Swagger/OpenAPI spec
  - Document all endpoints
  - Document request/response formats
  - Effort: 16 hours

- [ ] **4.4.2** Implement API versioning
  - Create /v1 API routes
  - Support backward compatibility
  - Plan v2 routes
  - Effort: 8 hours

- [ ] **4.4.3** Implement API authentication
  - API key generation
  - API key validation middleware
  - Rate limiting by API key
  - Effort: 10 hours

- [ ] **4.4.4** Create API key management
  - Generate API keys
  - Rotate API keys
  - Revoke API keys
  - View API key usage
  - Effort: 10 hours

- [ ] **4.4.5** Implement webhook system
  - Create webhook schema
  - Create webhook CRUD
  - Implement webhook sending
  - Implement webhook retry logic
  - Effort: 14 hours
  - Nooblyjs: workflow for webhook triggers

- [ ] **4.4.6** Create webhook events
  - Order created event
  - Order updated event
  - Page published event
  - Product created event
  - Customer signup event
  - Effort: 10 hours

- [ ] **4.4.7** Create Zapier integration
  - Create Zapier triggers
  - Create Zapier actions
  - Effort: 12 hours

- [ ] **4.4.8** Create Google Analytics integration
  - Connect to Google Analytics
  - Fetch analytics data
  - Display in dashboard
  - Effort: 10 hours

- [ ] **4.4.9** Create developer dashboard
  - Display API documentation
  - Show API key management
  - Show webhook management
  - Show usage analytics
  - Effort: 12 hours

- [ ] **4.4.10** Write API tests
  - Test all endpoints
  - Test authentication
  - Test rate limiting
  - Effort: 12 hours

**Subtotal Sprint 4.4: 114 hours**

---

## PHASE 5: Polish & Enterprise (Months 13+)
### Estimated: 240 hours

### ✅ Sprint 5.1-5.6: Implementation Tasks
[Refer to IMPLEMENTATION-ROADMAP.md Phase 5 sprints for detailed breakdown]

---

## Summary by Task Count

| Phase | Sprints | Tasks | Hours |
|-------|---------|-------|-------|
| Phase 1 | 6 | 85 | 480 |
| Phase 2 | 6 | 60 | 320 |
| Phase 3 | 6 | 56 | 320 |
| Phase 4 | 4 | 48 | 280 |
| Phase 5 | 6 | 56 | 240 |
| **TOTAL** | **28** | **305** | **1,640** |

---

## Implementation Tips

### For Sprint Planning
1. Assign 1-2 engineers per sprint
2. Plan 2-week sprints
3. Daily standups (15 min)
4. End-of-sprint reviews
5. Retrospectives for continuous improvement

### For Development
1. Follow Git flow branching strategy
2. Create feature branches for each task
3. Require code review for all PRs
4. Write tests alongside features
5. Document API changes

### For Quality
1. Aim for 80%+ test coverage
2. Use linting (ESLint, Prettier)
3. Perform security scans (OWASP)
4. Load test critical paths
5. User acceptance testing before release

### For Nooblyjs-core Integration
1. Refer to nooblyjs-core-usage.md constantly
2. Use proper service initialization order
3. Leverage built-in dashboard UIs
4. Use dependency injection from registry
5. Follow singleton pattern for services

---

**Document Version**: 1.0
**Last Updated**: October 2024
**Ready for Development**: Yes
