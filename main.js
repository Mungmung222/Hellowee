const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

let win;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    transparent: true,         // 투명 배경
    frame: false,              // 창 테두리 없음
    alwaysOnTop: true,         // 항상 위에
    skipTaskbar: true,         // 작업표시줄에 안 보임
    resizable: false,
    focusable: false,          // 클릭 통과 (기본)
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile('index.html');

  // 마우스 이벤트 통과 (캐릭터 클릭할 때만 감지하도록 renderer에서 제어)
  win.setIgnoreMouseEvents(true, { forward: true });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
