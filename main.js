const { app, BrowserWindow, screen, ipcMain, shell } = require('electron');
const path = require('path');

let mainWin, loginWin;
let isPinned = true;
let authData = null; // { nickname, parts, isGuest }

// ─── 로그인 창 ───
function createLoginWindow() {
  loginWin = new BrowserWindow({
    width: 400,
    height: 600,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  loginWin.loadFile('login.html');
  loginWin.center();
}

// ─── 메인 창 (시메지) ───
function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWin = new BrowserWindow({
    width, height,
    x: 0, y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWin.loadFile('index.html');
  mainWin.setIgnoreMouseEvents(true, { forward: true });

  // 캐릭터에 인증 데이터 전달
  mainWin.webContents.on('did-finish-load', () => {
    mainWin.webContents.send('auth-data', authData);
  });
}

// ─── 인증 IPC ───

// 자동 로그인 시도
ipcMain.on('try-auto-login', async (event) => {
  try {
    const { Auth } = require('./auth');
    const auth = new Auth();
    const user = await auth.tryAutoLogin();

    if (user) {
      event.reply('auto-login-result', {
        success: true,
        nickname: auth.getSavedNickname(),
        parts: auth.getSavedParts(),
        termsAccepted: !auth.needsTerms(),
      });
    } else {
      event.reply('auto-login-result', { success: false });
    }
  } catch (e) {
    event.reply('auto-login-result', { success: false });
  }
});

// 소셜 로그인
ipcMain.on('auth-login', async (event, provider) => {
  try {
    const { Auth } = require('./auth');
    const auth = new Auth();
    const result = await auth.loginWithProvider(provider);

    if (result.url) {
      // 외부 브라우저로 OAuth 열기
      shell.openExternal(result.url);
      // TODO: deep link 콜백 처리 (hellowee://auth/callback)
    }
    if (result.error) {
      event.reply('auth-result', { error: result.error });
    }
  } catch (e) {
    event.reply('auth-result', { error: e.message });
  }
});

// 인증 완료 (닉네임 + 약관 동의 후)
ipcMain.on('auth-complete', (event, data) => {
  authData = data;

  // 약관 동의 저장
  try {
    const { Auth } = require('./auth');
    const auth = new Auth();
    auth.acceptTerms();
    if (data.nickname) auth.updateNickname(data.nickname);
  } catch (e) {}

  // 로그인 창 닫고 메인 창 열기
  if (loginWin) {
    loginWin.close();
    loginWin = null;
  }
  createMainWindow();
});

// ─── 메인 창 IPC ───
ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (mainWin) mainWin.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('toggle-pin', (event) => {
  isPinned = !isPinned;
  if (mainWin) mainWin.setAlwaysOnTop(isPinned);
  event.reply('pin-status', isPinned);
});

ipcMain.on('get-pin-status', (event) => {
  event.reply('pin-status', isPinned);
});

// ─── 앱 시작 ───
app.whenReady().then(createLoginWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
