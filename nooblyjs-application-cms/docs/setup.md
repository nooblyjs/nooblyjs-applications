# CMS Platform - Setup & Installation Guide

A full-featured, monolithic CMS platform built with Express.js, Nooblyjs-core, Bootstrap 5, and native JavaScript.

## Features

✅ **User Authentication** - Secure login/registration with bcrypt
✅ **Site Management** - Create, edit, delete multiple sites
✅ **Page Builder** - Visual editor with CodeMirror
✅ **Media Management** - Upload and manage images/files
✅ **Publishing** - Publish sites to dedicated folders
✅ **Responsive Design** - Bootstrap 5 frontend
✅ **Native JavaScript** - No React/Vue, pure JS with Axios
✅ **Nooblyjs-core Integration** - All 13 services available

## Project Structure

```
nooblyjs-apps-cms/
├── index.js                    # Main server entry point
├── package.json
├── .env.example
├── src/
│   ├── routes/
│   │   ├── auth.js            # Authentication endpoints
│   │   ├── sites.js           # Site management endpoints
│   │   ├── pages.js           # Page management endpoints
│   │   ├── media.js           # Media upload endpoints
│   │   └── publish.js         # Publishing endpoints
│   └── views/
│       ├── layout.ejs         # Base layout
│       ├── login.ejs          # Login page
│       ├── register.ejs       # Registration page
│       ├── dashboard.ejs      # Dashboard
│       ├── sites.ejs          # Sites management
│       ├── builder.ejs        # Page builder
│       ├── 404.ejs            # 404 error page
│       └── error.ejs          # Error page
├── public/
│   ├── css/
│   │   └── style.css          # Custom styling
│   ├── js/
│   │   └── utils.js           # Utility functions
│   └── uploads/               # User uploads
├── sites/
│   ├── published/             # Published sites
│   └── unpublished/           # Draft sites
└── .noobly-core/
    ├── data/                  # Data storage
    └── logs/                  # Application logs
```

## Installation

### 1. Prerequisites

- Node.js 14+
- npm or yarn
- Git (optional)

### 2. Install Dependencies

```bash
cd nooblyjs-apps-cms
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and update values as needed.

### 4. Start the Server

```bash
npm start
```

The application will be available at `http://localhost:3000`

## Usage

### Create an Account

1. Navigate to http://localhost:3000/auth/register
2. Fill in username, email, and password
3. Click "Create Account"
4. You'll be redirected to the login page

### Login

1. Navigate to http://localhost:3000/auth/login
2. Enter your credentials
3. Click "Sign In"

### Create a Site

1. After login, click "My Sites" or go to /sites
2. Click "New Site" button
3. Fill in:
   - Site Name (URL-friendly, no spaces)
   - Site Title (display name)
   - Description (optional)
4. Click "Create Site"

### Edit Pages

1. Click "Edit" on a site card or go to /builder/{siteId}
2. Create a new page or select existing one
3. Edit the page title
4. Write HTML content in the CodeMirror editor
5. Add SEO meta description
6. Click "Save Page"

### Publish a Site

1. After editing pages, click "Publish" in builder
2. Confirm publication
3. Site will be available at `/sites/published/{sitename}`

### Manage Media

1. Use the Media API to upload files
2. Access files at `/uploads/{siteId}/{filename}`

## API Endpoints

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login user
- `POST /auth/logout` - Logout user
- `GET /auth/user` - Get current user

### Sites
- `GET /api/sites` - List user's sites
- `POST /api/sites` - Create new site
- `GET /api/sites/:siteId` - Get site details
- `PUT /api/sites/:siteId` - Update site
- `DELETE /api/sites/:siteId` - Delete site

### Pages
- `GET /api/pages/:siteId` - List site pages
- `POST /api/pages` - Create page
- `GET /api/pages/:siteId/:pageId` - Get page
- `PUT /api/pages/:pageId` - Update page
- `DELETE /api/pages/:pageId` - Delete page

### Media
- `POST /api/media/upload` - Upload file
- `GET /api/media/:siteId` - List media
- `DELETE /api/media/:mediaId` - Delete media

### Publishing
- `POST /api/publish/:siteId` - Publish site
- `POST /api/publish/:siteId/unpublish` - Unpublish site

## Configuration Options

### Nooblyjs Services Used

The CMS integrates with these Nooblyjs-core services:

1. **authservice** - User authentication (file provider)
2. **dataservice** - Data storage (file provider)
3. **filing** - Media uploads (local provider)
4. **caching** - Session caching (memory provider)
5. **logging** - Application logging (file provider)

### Site Directory Structure

**Unpublished Sites:**
```
sites/unpublished/{sitename}/
  └── index.html
```

**Published Sites:**
```
sites/published/{sitename}/
  ├── index.html
  └── media/
      ├── image1.jpg
      ├── image2.png
      └── ...
```

## Development

### Adding New Services

To add a new Nooblyjs-core service:

1. Import in `index.js`:
```javascript
const myService = serviceRegistry.myservice('provider');
```

2. Pass to route module:
```javascript
const myRoutes = require('./src/routes/myroutes')(myService, logger);
```

### Creating Custom Routes

Add new route file in `src/routes/`:

```javascript
const express = require('express');

module.exports = (services) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    // Your route handler
  });

  return router;
};
```

Then mount in `index.js`:
```javascript
app.use('/api/myroute', requireAuth, myRoutes);
```

### Creating Custom Views

Add new EJS file in `src/views/`:

```ejs
<!DOCTYPE html>
<html>
<head>
  <title>My Page</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
  <h1>Hello World</h1>
  <script src="/js/utils.js"></script>
</body>
</html>
```

Then add route in `index.js`:
```javascript
app.get('/mypage', requireAuth, (req, res) => {
  res.render('mypage');
});
```

## Editor Features

### CodeMirror Integration

The page builder uses CodeMirror for HTML editing with:
- Syntax highlighting
- Line numbers
- Dracula theme
- HTML, CSS, JavaScript support

### Content Types

Supported HTML blocks:
- Headings (H1-H6)
- Paragraphs
- Images
- Custom HTML

## File Upload

### Upload Limits

- Max file size: 10MB (configurable in .env)
- Allowed types: All file types
- Storage: Local filesystem

### Upload Example

```javascript
const formData = new FormData();
formData.append('file', file);
formData.append('siteId', siteId);

const response = await axios.post('/api/media/upload', formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
```

## Security

### Implemented Features

✅ Password hashing with bcrypt
✅ Session-based authentication
✅ CSRF protection via session
✅ Input validation
✅ SQL injection prevention (using dataservice)
✅ XSS protection via EJS escaping
✅ CORS configuration
✅ Secure HTTP headers

### Best Practices

1. Change SESSION_SECRET in production
2. Use HTTPS in production
3. Implement rate limiting
4. Regular security audits
5. Keep dependencies updated

## Troubleshooting

### Port Already in Use

```bash
# Change port in .env
PORT=3001

# Or kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Database Errors

```bash
# Clear data and restart
rm -rf .noobly-core/data/*
npm start
```

### Upload Directory Issues

```bash
# Ensure uploads directory exists
mkdir -p public/uploads

# Set correct permissions
chmod -R 755 public/uploads
```

### Session Issues

Restart the server:
```bash
npm start
```

## Performance Optimization

### Caching
- Implement Redis for production
- Use browser caching headers
- Minify CSS/JS

### Database
- Use MongoDB for production instead of file storage
- Add database indexing

### CDN
- Serve media from CDN
- Implement image compression

## Deployment

### Heroku Deployment

1. Create Procfile:
```
web: node index.js
```

2. Deploy:
```bash
heroku create your-app-name
git push heroku main
```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t cms-app .
docker run -p 3000:3000 cms-app
```

## Support & Documentation

- Nooblyjs-core: See `/docs/nooblyjs-core-usage.md`
- Bootstrap 5: https://getbootstrap.com/docs/5.3/
- CodeMirror: https://codemirror.net/
- Axios: https://axios-http.com/

## License

ISC License

## Contributing

Feel free to fork and submit pull requests for any improvements!

## Changelog

### Version 1.0.0
- Initial release
- Site management
- Page builder with CodeMirror
- Media uploads
- Publishing system
- User authentication
