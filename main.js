const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let win;
let isPinned = true; // 기본: 항상 위에

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
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

  win.loadFile('index.html');
  win.setIgnoreMouseEvents(true, { forward: true });
}

// ─── IPC: 마우스 이벤트 통과 제어 ───
ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (win) {
    win.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// ─── IPC: 항상 위에 토글 ───
ipcMain.on('toggle-pin', (event) => {
  isPinned = !isPinned;
  if (win) {
    win.setAlwaysOnTop(isPinned);
  }
  event.reply('pin-status', isPinned);
});

// ─── IPC: 핀 상태 요청 ───
ipcMain.on('get-pin-status', (event) => {
  event.reply('pin-status', isPinned);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
