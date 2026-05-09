const { ipcRenderer } = require('electron');
const io = require('socket.io-client');
const { Tutorial } = require('./tutorial');
const { SoundManager } = require('./sound');

// ════ 설정 ════
const SERVER_URL = 'https://hellowee-server.onrender.com';
