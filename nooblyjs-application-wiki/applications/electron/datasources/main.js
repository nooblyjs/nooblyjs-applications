const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:9101';
const APP_PATH = '/applications/datasources/';
const LOGIN_PATH = '/services/authservice/views/login.html';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'NooblyJS Wiki - Datasources',
    icon: path.join(__dirname, 'nooblyjs-logo-colour.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false
  });

  // Show window once content is ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle connection errors (backend not running)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    mainWindow.loadFile(path.join(__dirname, 'error.html'));
  });

  // Intercept navigation: if the app redirects to the login page,
  // ensure the returnUrl points back to our app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsed = new URL(url, BACKEND_URL);

    // If navigating to login without a returnUrl, add one
    if (parsed.pathname.includes(LOGIN_PATH) && !parsed.searchParams.has('returnUrl')) {
      event.preventDefault();
      parsed.searchParams.set('returnUrl', APP_PATH);
      mainWindow.loadURL(parsed.toString());
    }
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.startsWith(BACKEND_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Update window title with page title
  mainWindow.webContents.on('page-title-updated', (event, title) => {
    mainWindow.setTitle(`${title} - Datasources`);
  });

  // Start by loading the app — if not authenticated, the app will
  // redirect to login, and our will-navigate handler adds the returnUrl
  mainWindow.loadURL(`${BACKEND_URL}${APP_PATH}`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
