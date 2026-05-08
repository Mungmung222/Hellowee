const { app, BrowserWindow, screen, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let mainWin, loginWin, tray;
let isPinned = true;
let authData = null;

// ─── 시스템 트레이 ───
function createTray() {
  // 간단한 1x1 아이콘 (나중에 실제 아이콘으로 교체)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Hellowee 🐾');

  const contextMenu = Menu.buildFromTemplate([
    { label: '🐾 Hellowee 열기', click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); } } },
    { label: '📌 항상 위에', type: 'checkbox', checked: isPinned, click: (item) => { isPinned = item.checked; if (mainWin) mainWin.setAlwaysOnTop(isPinned); } },
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWin) { mainWin.show(); mainWin.focus(); }
  });
}

// ─── 로그인 창 ───
function createLoginWindow() {
  loginWin = new BrowserWindow({
    width: 400, height: 600,
    frame: false, transparent: true, resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  loginWin.loadFile('login.html');
  loginWin.center();
}

// ─── 메인 창 ───
function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWin = new BrowserWindow({
    width, height, x: 0, y: 0,
    transparent: true, frame: false, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  mainWin.loadFile('index.html');
  mainWin.setIgnoreMouseEvents(true, { forward: true });

  mainWin.webContents.on('did-finish-load', () => {
    mainWin.webContents.send('auth-data', authData);
  });

  // X 눌러도 트레이로 숨기기
  mainWin.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });
}

// ─── 인증 IPC ───
ipcMain.on('try-auto-login', async (event) => {
  try {
    const { Auth } = require('./auth');
    const auth = new Auth();
    const user = await auth.tryAutoLogin();
    if (user) {
      event.reply('auto-login-result', {
        success: true, nickname: auth.getSavedNickname(),
        parts: auth.getSavedParts(), termsAccepted: !auth.needsTerms(),
      });
    } else {
      event.reply('auto-login-result', { success: false });
    }
  } catch (e) { event.reply('auto-login-result', { success: false }); }
});

ipcMain.on('auth-login', async (event, provider) => {
  try {
    const { Auth } = require('./auth');
    const auth = new Auth();
    const result = await auth.loginWithProvider(provider);
    if (result.url) shell.openExternal(result.url);
    if (result.error) event.reply('auth-result', { error: result.error });
  } catch (e) { event.reply('auth-result', { error: e.message }); }
});

ipcMain.on('auth-complete', (event, data) => {
  authData = data;
  try {
    const { Auth } = require('./auth');
    const auth = new Auth();
    auth.acceptTerms();
    if (data.nickname) auth.updateNickname(data.nickname);
  } catch (e) {}
  if (loginWin) { loginWin.close(); loginWin = null; }
  createMainWindow();
});

// ─── 메인 창 IPC ───
ipcMain.on('set-ignore-mouse', (event, ignore) => { if (mainWin) mainWin.setIgnoreMouseEvents(ignore, { forward: true }); });
ipcMain.on('toggle-pin', (event) => { isPinned = !isPinned; if (mainWin) mainWin.setAlwaysOnTop(isPinned); event.reply('pin-status', isPinned); });
ipcMain.on('get-pin-status', (event) => { event.reply('pin-status', isPinned); });

// ─── 앱 시작 ───
app.whenReady().then(() => {
  createTray();
  createLoginWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { app.isQuitting = true; });
