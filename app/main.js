// GOD MODE Browser — Electron main process.
// Owns the window, the embedded web view (the "browser" surface), and the
// bridge that lets Claude drive that view. Renderer handles UI + LiveKit voice.

const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { runAgentTurn } = require('./agent/claude');

const TOPBAR = 64;  // reserved px at top for the address / control bar
const PANEL = 372;  // reserved px on the right for the AI + voice panel

let win = null;
let view = null; // the browsing surface Claude controls

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0806',
    title: 'GOD MODE',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // The browsing surface — a real web view Claude can navigate and read.
  view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.contentView.addChildView(view);
  layout();
  view.webContents.loadURL('about:blank');

  win.on('resize', layout);

  // Keep the renderer's address bar in sync as the view navigates.
  const report = () => {
    if (!view) return;
    win.webContents.send('view:state', {
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
      loading: view.webContents.isLoading(),
    });
  };
  view.webContents.on('did-navigate', report);
  view.webContents.on('did-navigate-in-page', report);
  view.webContents.on('did-start-loading', report);
  view.webContents.on('did-stop-loading', report);
  view.webContents.on('page-title-updated', report);

  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

function layout() {
  if (!win || !view) return;
  const { width, height } = win.getContentBounds();
  view.setBounds({ x: 0, y: TOPBAR, width: width - PANEL, height: height - TOPBAR });
}

// ── Browser control primitives (also exposed to Claude as tools) ──────────
const browser = {
  async navigate(url) {
    if (!/^[a-z]+:\/\//i.test(url)) {
      url = url.includes('.') && !url.includes(' ')
        ? 'https://' + url
        : 'https://duckduckgo.com/?q=' + encodeURIComponent(url);
    }
    await view.webContents.loadURL(url);
    return { url: view.webContents.getURL(), title: view.webContents.getTitle() };
  },
  back() { if (view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack(); },
  forward() { if (view.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward(); },
  reload() { view.webContents.reload(); },
  async readText() {
    return view.webContents.executeJavaScript(
      "document.body ? document.body.innerText.slice(0, 12000) : ''"
    );
  },
  async click(selector) {
    return view.webContents.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok:false, reason:'not found' }; el.click(); return { ok:true }; })()`
    );
  },
  async type(selector, text) {
    return view.webContents.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok:false, reason:'not found' };
        el.focus(); el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', {bubbles:true}));
        return { ok:true }; })()`
    );
  },
};

// ── IPC from the renderer UI ──────────────────────────────────────────────
ipcMain.handle('nav', (_e, url) => browser.navigate(url));
ipcMain.handle('back', () => browser.back());
ipcMain.handle('forward', () => browser.forward());
ipcMain.handle('reload', () => browser.reload());

// A user (typed or spoken-then-transcribed) message to the AI. Claude runs a
// tool loop against `browser`, streaming its thinking/replies to the renderer.
ipcMain.handle('agent:ask', async (_e, message) => {
  const emit = (evt) => win.webContents.send('agent:event', evt);
  try {
    const reply = await runAgentTurn({ message, browser, emit });
    return { ok: true, reply };
  } catch (err) {
    emit({ type: 'error', text: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  }
});

// Renderer asks for LiveKit connection details (URL + a token minted by the
// Living Labs API). Kept in main so secrets never touch the renderer.
ipcMain.handle('voice:config', async () => {
  const url = process.env.LIVEKIT_URL || '';
  const room = process.env.LIVEKIT_ROOM || 'godmode';
  let token = '';
  const api = process.env.LIVING_LABS_API_URL;
  if (api) {
    try {
      const res = await fetch(`${api.replace(/\/$/, '')}/livekit/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.LIVING_LABS_API_KEY
            ? { Authorization: `Bearer ${process.env.LIVING_LABS_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({ room, identity: 'godmode-desktop' }),
      });
      if (res.ok) token = (await res.json()).token || '';
    } catch (err) {
      // Living Labs API unreachable — renderer will show voice as offline.
    }
  }
  return { url, room, token, configured: Boolean(url && token) };
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    // Allow mic (for voice); deny the rest by default.
    cb(permission === 'media' || permission === 'audioCapture');
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
