const { ipcRenderer } = require('electron');
const io = require('socket.io-client');
const { Tutorial } = require('./tutorial');
const { SoundManager } = require('./sound');

// ════ 설정 ════
const SERVER_URL = 'https://hellowee-server.onrender.com';
const CHAR_SIZE = 512;          // 스프라이트 원본 크기 (512px로 그리기)
const DISPLAY_SIZE = 128;       // 화면 표시 크기 (초선명 축소)
