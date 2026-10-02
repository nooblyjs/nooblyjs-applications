# Quick Start Guide

## 5-Minute Setup

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Start Server
```bash
npm start
```

Server runs on http://localhost:3000

### Step 3: Create Account
- Go to http://localhost:3000/auth/register
- Fill in username, email, password
- Click "Create Account"

### Step 4: Create Your First Site
- Login with your credentials
- Click "My Sites"
- Click "New Site"
- Fill in site details
- Click "Create Site"

### Step 5: Build Your Site
- Click "Edit" on your site
- Create new pages or edit existing ones
- Use the CodeMirror editor to add HTML content
- Click "Save Page"

### Step 6: Publish
- Click "Publish" button
- Your site is now live at http://localhost:3000/sites/published/{sitename}

## What You Get

### 🎨 Visual Site Builder
- Drag-and-drop interface (in builder view)
- CodeMirror HTML editor
- Live preview
- Real-time editing

### 📄 Page Management
- Create unlimited pages
- Organize pages
- Draft & publish
- Version history (via dataservice)

### 🖼️ Media Management
- Upload images and files
- Organize by site
- Quick access in builder

### 📊 Full-Featured CMS
- User accounts & authentication
- Multi-site support
- SEO fields
- Site settings

### 🔒 Security Built-in
- Password hashing
- Session authentication
- CSRF protection
- Input validation

## File Structure

```
nooblyjs-apps-cms/
├── index.js                  # Main server
├── src/
│   ├── routes/              # API endpoints
│   └── views/               # HTML templates
├── public/
│   ├── css/style.css        # Bootstrap styling
│   ├── js/utils.js          # Helper functions
│   └── uploads/             # User files
└── sites/
    ├── published/           # Live sites
    └── unpublished/         # Drafts
```

## Key Endpoints

### Views (HTML pages)
- `/auth/login` - Login page
- `/auth/register` - Sign up
- `/` - Dashboard (requires login)
- `/sites` - Site management
- `/builder/:siteId` - Page editor

### API (JSON)
- `POST /auth/register` - Create account
- `POST /auth/login` - Login
- `GET /api/sites` - Your sites
- `POST /api/sites` - Create site
- `POST /api/pages` - Create page
- `POST /api/media/upload` - Upload file
- `POST /api/publish/:siteId` - Publish

## Database

Uses **Nooblyjs-core** with file-based storage:
- Users: `.noobly-core/data/users/`
- Sites: `.noobly-core/data/sites/`
- Pages: `.noobly-core/data/pages/`
- Media: `.noobly-core/data/media/`

## Usage Tips

### Creating HTML Content

In the builder, write standard HTML:

```html
<h1>Welcome</h1>
<p>This is my website</p>
<img src="/uploads/image.jpg" alt="My Image">
```

### Site URLs

- **Unpublished**: Draft sites stored in `sites/unpublished/{sitename}/`
- **Published**: Live sites at `http://localhost:3000/sites/published/{sitename}`

### Managing Files

1. Upload files via "My Sites" → "Edit" → Media section
2. Files saved to `public/uploads/{siteId}/`
3. Reference in HTML as `/uploads/{siteId}/{filename}`

### Editing Site Settings

Click "Settings" on site card to customize:
- Colors (primary/secondary)
- Fonts (heading/body)
- Logo/Favicon
- Description

## Common Tasks

### Create a New Site
```
1. Go to /sites
2. Click "New Site"
3. Fill form
4. Click "Create Site"
```

### Add a Page
```
1. Go to /builder/{siteId}
2. Click "New Page"
3. Enter page name and title
4. Click "Create"
```

### Edit Page Content
```
1. Select page from left panel
2. Edit title
3. Write HTML in editor
4. Click "Save Page"
```

### Upload Image
```
1. In builder, upload file
2. Get file URL from uploads folder
3. Use in HTML: <img src="/uploads/siteid/file.jpg">
4. Save page
```

### Publish Site
```
1. In builder, click "Publish"
2. Confirm action
3. Site available at /sites/published/{sitename}
```

## Troubleshooting

### Site won't start
```bash
# Check if port 3000 is in use
lsof -i :3000
# Kill process or change PORT in .env
PORT=3001 npm start
```

### Can't login
- Check username and password
- Verify user was created
- Clear browser cookies

### Files not uploading
- Check `public/uploads/` folder exists
- Verify file size under 10MB
- Check folder permissions

### Pages not saving
- Check browser console for errors
- Verify you're logged in
- Check dataservice is running

## Next Steps

1. ✅ Install & start server
2. ✅ Create user account
3. ✅ Create first site
4. ✅ Build pages
5. ✅ Upload media
6. ✅ Publish site
7. 🔄 Explore advanced features

## Documentation

- **Full Setup Guide**: See `SETUP.md`
- **CMS Features**: See `/docs/PRD-CMS-PLATFORM.md`
- **Implementation**: See `/docs/IMPLEMENTATION-ROADMAP.md`
- **Nooblyjs-core**: See `/docs/nooblyjs-core-usage.md`

## Support

- Check SETUP.md for detailed information
- Review error messages in browser console
- Check server logs in `.noobly-core/logs/`
- Refer to Bootstrap 5 docs for styling
- Check CodeMirror docs for editor features

## Performance Tips

1. **For Development**: Current setup is perfect
2. **For Production**:
   - Change SESSION_SECRET in .env
   - Use MongoDB instead of file storage
   - Enable caching with Redis
   - Serve assets from CDN
   - Use HTTPS

## Learning Resources

- **Bootstrap 5**: https://getbootstrap.com/
- **CodeMirror**: https://codemirror.net/
- **Axios**: https://axios-http.com/
- **Nooblyjs**: See `/docs/nooblyjs-core-usage.md`

---

**Ready to build amazing websites?** 🚀

Start with `npm start` and visit http://localhost:3000!
