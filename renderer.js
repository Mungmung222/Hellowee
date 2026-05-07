const { ipcRenderer } = require('electron');
const io = require('socket.io-client');

// ════════════════════════════════════════════
//  설정
// ════════════════════════════════════════════
const SERVER_URL = 'http://localhost:3000';
const CHAR_SIZE = 128;
const FPS = 8;
const GRAVITY = 0.5;
const FLOOR_Y = window.innerHeight - CHAR_SIZE;
const BUBBLE_DURATION = 4000;
const CLICK_THRESHOLD = 5;
const WHISPER_ATTENTION = 5;
const CHAT_ATTENTION = 30;
const MOUSE_IDLE_TIME = 3000;
const CHASE_SPEED = 3;

// 설정 상태
let settingPin = true;
let settingAttention = true;
let settingBubble = true;

// ════════════════════════════════════════════
//  파츠 시스템
// ════════════════════════════════════════════
const LAYER_ORDER = ['body', 'clothes', 'mouth', 'eyes', 'hair', 'accessory'];

const PARTS_OPTIONS = {
  body:      ['default', 'light', 'medium', 'dark'],
  eyes:      ['round', 'cat', 'sleepy'],
  mouth:     ['smile', 'neutral', 'pout'],
  hair:      ['short', 'long', 'ponytail'],
  clothes:   ['hoodie', 'shirt', 'dress'],
  accessory: ['none', 'hat', 'glasses', 'ribbon'],
};

const ANIM_FRAMES = {
  idle: 2, walk: 3, fall: 1, grabbed: 1, land: 1, thrown: 1,
};

const imageCache = {};
function getPartImage(layer, option, action) {
  if (option === 'none') return null;
  const key = `${layer}/${option}/${action}`;
  if (!imageCache[key]) {
    const img = new Image();
    img.src = `sprites/${key}.png`;
    imageCache[key] = img;
  }
  return imageCache[key];
}

// ════════════════════════════════════════════
//  캐릭터 상태
// ════════════════════════════════════════════
const myChar = {
  x: window.innerWidth / 2, y: 100,
  vx: 0, vy: 0,
  state: 'fall', dir: 1, frame: 0, frameTimer: 0,
  isGrabbed: false, forcedGrab: false, attentionGrab: false,
  name: 'guest',
  parts: {
    body: 'default', eyes: 'round', mouth: 'smile',
    hair: 'short', clothes: 'hoodie', accessory: 'none',
  },
};

const otherChars = {};
let unreadChat = 0, unreadWhisper = 0;
let chatHistory = [], whisperHistory = [];
let currentRoom = null;

// ════════════════════════════════════════════
//  마우스 추적
// ════════════════════════════════════════════
let mousePos = { x: window.innerWidth / 2, y: FLOOR_Y };
let lastActivityTime = Date.now();
let mouseIsIdle = false;
let hasGrabbedMouse = false;

document.addEventListener('mousemove', (e) => {
  mousePos.x = e.clientX;
  mousePos.y = e.clientY;
  lastActivityTime = Date.now();
  if (mouseIsIdle && hasGrabbedMouse && myChar.attentionGrab) {
    mouseIsIdle = false;
    myChar.attentionGrab = false;
    myChar.forcedGrab = false;
    myChar.state = 'fall';
    myChar.vy = -3;
    myChar.vx = (Math.random() - 0.5) * 4;
  }
});
document.addEventListener('mousedown', () => { lastActivityTime = Date.now(); });

function isAttentionMode() {
  return settingAttention && (unreadWhisper >= WHISPER_ATTENTION || unreadChat >= CHAT_ATTENTION);
}

// ════════════════════════════════════════════
//  내 캐릭터 DOM
// ════════════════════════════════════════════
const myEl = document.createElement('canvas');
myEl.width = CHAR_SIZE;
myEl.height = CHAR_SIZE;
myEl.className = 'character';
myEl.style.width = CHAR_SIZE + 'px';
myEl.style.height = CHAR_SIZE + 'px';
document.body.appendChild(myEl);
const myCtx = myEl.getContext('2d');

const alertBadge = document.createElement('div');
alertBadge.className = 'alert-badge';
alertBadge.textContent = '!';
alertBadge.style.display = 'none';
document.body.appendChild(alertBadge);

// ════════════════════════════════════════════
//  렌더링
// ════════════════════════════════════════════
function renderChar(ctx, el, char) {
  const action = char.state || 'idle';
  const frames = ANIM_FRAMES[action] || ANIM_FRAMES.idle;
  const frame = char.frame % frames;

  ctx.clearRect(0, 0, CHAR_SIZE, CHAR_SIZE);
  ctx.save();
  if (char.dir === -1) { ctx.translate(CHAR_SIZE, 0); ctx.scale(-1, 1); }

  let hasImg = false;
  LAYER_ORDER.forEach(layer => {
    const opt = char.parts?.[layer];
    if (!opt || opt === 'none') return;
    const img = getPartImage(layer, opt, action);
    if (img && img.complete && img.naturalWidth > 0) {
      hasImg = true;
      ctx.drawImage(img, frame * CHAR_SIZE, 0, CHAR_SIZE, CHAR_SIZE, 0, 0, CHAR_SIZE, CHAR_SIZE);
    }
  });

  if (!hasImg) {
    ctx.fillStyle = '#ff6b9d';
    ctx.roundRect(8, 8, CHAR_SIZE - 16, CHAR_SIZE - 16, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '36px sans-serif';
    ctx.fillText('🐾', CHAR_SIZE / 2 - 18, CHAR_SIZE / 2 + 12);
  }
  ctx.restore();
  el.style.left = char.x + 'px';
  el.style.top = char.y + 'px';
}

// ════════════════════════════════════════════
//  마우스 — 클릭/드래그
// ════════════════════════════════════════════
let mouseDownPos = null, dragTarget = null, dragOffset = { x: 0, y: 0 }, isDragging = false;

myEl.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  mouseDownPos = { x: e.clientX, y: e.clientY };
  dragTarget = 'self';
  dragOffset.x = e.clientX - myChar.x;
  dragOffset.y = e.clientY - myChar.y;
  isDragging = false;
  ipcRenderer.send('set-ignore-mouse', false);
  if (myChar.attentionGrab) { myChar.attentionGrab = false; myChar.forcedGrab = false; }
});

document.addEventListener('mousemove', (e) => {
  if (!dragTarget) return;
  const dist = mouseDownPos ? Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y) : 0;
  if (!isDragging && dist > CLICK_THRESHOLD) {
    isDragging = true;
    if (dragTarget === 'self') {
      myChar.isGrabbed = true; myChar.state = 'grabbed'; myChar.vx = 0; myChar.vy = 0;
    } else {
      if (socket) socket.emit('grab-other', { targetId: dragTarget });
    }
  }
  if (isDragging) {
    if (dragTarget === 'self') {
      myChar.x = e.clientX - dragOffset.x; myChar.y = e.clientY - dragOffset.y;
    } else if (socket) {
      socket.emit('drag-other', { targetId: dragTarget, x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    }
  }
});

document.addEventListener('mouseup', (e) => {
  if (!dragTarget) return;
  if (!isDragging) {
    if (dragTarget === 'self') {
      openPhone('chat'); // 내 캐릭터 클릭 → 핸드폰 UI 열기
    } else {
      openQuickWhisper(dragTarget, e.clientX, e.clientY);
    }
  } else {
    if (dragTarget === 'self') {
      myChar.isGrabbed = false; myChar.state = 'fall'; myChar.vy = 2;
    } else if (socket) {
      socket.emit('throw-other', { targetId: dragTarget, vx: (e.clientX - mouseDownPos.x) * 0.1, vy: -3 });
    }
  }
  ipcRenderer.send('set-ignore-mouse', true);
  dragTarget = null; mouseDownPos = null; isDragging = false;
});

// ════════════════════════════════════════════
//  핸드폰 UI — 통합
// ════════════════════════════════════════════
const phone = document.getElementById('phone');
const phoneClose = document.getElementById('phoneClose');
const navItems = document.querySelectorAll('.phone-nav-item');
const pages = document.querySelectorAll('.phone-page');
let currentPage = 'chat';

function openPhone(page) {
  currentPage = page || 'chat';
  phone.classList.add('visible');
  ipcRenderer.send('set-ignore-mouse', false);
  switchPage(currentPage);
  hideAlert();
}

function closePhone() {
  phone.classList.remove('visible');
  ipcRenderer.send('set-ignore-mouse', true);
}

phoneClose.addEventListener('click', closePhone);

navItems.forEach(item => {
  item.addEventListener('click', () => switchPage(item.dataset.page));
});

function switchPage(page) {
  currentPage = page;
  navItems.forEach(n => n.classList.toggle('active', n.dataset.page === page));
  pages.forEach(p => p.classList.toggle('active', p.id === 'page' + page));

  if (page === 'chat') renderChatMessages();
  if (page === 'lobby') updateLobbyUI();
}

// ════════════════════════════════════════════
//  채팅 페이지
// ════════════════════════════════════════════
const chatMessages = document.getElementById('chatMessages');
const chatPageInput = document.getElementById('chatPageInput');
const chatPageSend = document.getElementById('chatPageSend');
const chatSubTabs = document.querySelectorAll('.chat-sub-tab');
let chatSubTab = 'all';

chatSubTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    chatSubTab = tab.dataset.subtab;
    chatSubTabs.forEach(t => t.classList.toggle('active', t.dataset.subtab === chatSubTab));
    renderChatMessages();
    if (chatSubTab === 'all') unreadChat = 0;
    if (chatSubTab === 'whisper') unreadWhisper = 0;
  });
});

function renderChatMessages() {
  chatMessages.innerHTML = '';
  const log = chatSubTab === 'all' ? chatHistory : whisperHistory;
  log.forEach(msg => {
    const div = document.createElement('div');
    const isMine = msg.id === socket?.id || msg.fromId === socket?.id;
    div.className = 'chat-msg ' + (isMine ? 'mine' : 'other');
    const nameDiv = !isMine ? `<div class="chat-msg-name">${msg.name || msg.fromName}</div>` : '';
    const time = new Date(msg.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `${nameDiv}${msg.message}<div class="chat-msg-time">${time}</div>`;
    chatMessages.appendChild(div);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChatPageMsg() {
  const msg = chatPageInput.value.trim();
  if (!msg || !socket) return;
  if (chatSubTab === 'all') {
    socket.emit('chat', { message: msg });
  }
  chatPageInput.value = '';
}

chatPageSend.addEventListener('click', sendChatPageMsg);
chatPageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatPageMsg(); });

// ════════════════════════════════════════════
//  퀵 귓속말 (다른 캐릭터 클릭)
// ════════════════════════════════════════════
const quickChat = document.getElementById('quickChat');
const quickChatInput = document.getElementById('quickChatInput');
const quickChatLabel = document.getElementById('quickChatLabel');
let whisperTargetId = null;

function openQuickWhisper(targetId, x, y) {
  whisperTargetId = targetId;
  const name = otherChars[targetId]?.name || '???';
  quickChatLabel.textContent = `🤫 ${name}에게`;
  quickChat.style.left = x + 'px';
  quickChat.style.top = (y - 40) + 'px';
  quickChat.classList.add('visible');
  quickChatInput.value = '';
  quickChatInput.focus();
  ipcRenderer.send('set-ignore-mouse', false);
}

quickChatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && quickChatInput.value.trim()) {
    socket.emit('whisper', { targetId: whisperTargetId, message: quickChatInput.value.trim() });
    quickChatInput.value = '';
    quickChat.classList.remove('visible');
    ipcRenderer.send('set-ignore-mouse', true);
  }
  if (e.key === 'Escape') {
    quickChat.classList.remove('visible');
    ipcRenderer.send('set-ignore-mouse', true);
  }
});

// ════════════════════════════════════════════
//  로비 페이지
// ════════════════════════════════════════════
const lobbyCreate = document.getElementById('lobbyCreate');
const lobbyJoin = document.getElementById('lobbyJoin');
const lobbyMyName = document.getElementById('lobbyMyName');
const lobbyCode = document.getElementById('lobbyCode');
const lobbyJoinName = document.getElementById('lobbyJoinName');
const lobbyRoomCode = document.getElementById('lobbyRoomCode');
const lobbyMembers = document.getElementById('lobbyMembers');

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

lobbyCreate.addEventListener('click', () => {
  const name = lobbyMyName.value.trim() || 'guest';
  const code = generateRoomCode();
  joinRoom(code, name);
});

lobbyJoin.addEventListener('click', () => {
  const code = lobbyCode.value.trim().toUpperCase();
  const name = lobbyJoinName.value.trim() || 'guest';
  if (!code) return;
  joinRoom(code, name);
});

function joinRoom(code, name) {
  myChar.name = name;
  currentRoom = code;
  if (socket) socket.disconnect();
  connectSocket(code, name);
  updateLobbyUI();
  switchPage('chat');
}

function updateLobbyUI() {
  lobbyRoomCode.textContent = currentRoom || '---';
  lobbyMembers.innerHTML = '';

  if (currentRoom) {
    // 나
    const me = document.createElement('div');
    me.className = 'lobby-member';
    me.innerHTML = `<span class="lobby-member-dot"></span> ${myChar.name} (나)`;
    lobbyMembers.appendChild(me);

    // 다른 유저
    Object.values(otherChars).forEach(c => {
      const div = document.createElement('div');
      div.className = 'lobby-member';
      div.innerHTML = `<span class="lobby-member-dot"></span> ${c.name}`;
      lobbyMembers.appendChild(div);
    });
  }
}

// ════════════════════════════════════════════
//  꾸미기 페이지
// ════════════════════════════════════════════
const customSection = document.querySelector('.custom-section');
const labelMap = { body: '피부', eyes: '눈', mouth: '입', hair: '헤어', clothes: '옷', accessory: '악세서리' };

LAYER_ORDER.forEach(layer => {
  const row = document.createElement('div');
  row.className = 'custom-row';

  const label = document.createElement('div');
  label.className = 'custom-label';
  label.textContent = labelMap[layer];
  row.appendChild(label);

  const wrap = document.createElement('div');
  wrap.className = 'custom-options';

  PARTS_OPTIONS[layer].forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'custom-btn';
    if (myChar.parts[layer] === opt) btn.classList.add('active');
    btn.textContent = opt;
    btn.addEventListener('click', () => {
      myChar.parts[layer] = opt;
      wrap.querySelectorAll('.custom-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (socket) socket.emit('update-parts', myChar.parts);
    });
    wrap.appendChild(btn);
  });

  row.appendChild(wrap);
  customSection.appendChild(row);
});

// ════════════════════════════════════════════
//  설정 페이지
// ════════════════════════════════════════════
const togglePin = document.getElementById('togglePin');
const toggleAttention = document.getElementById('toggleAttention');
const toggleBubble = document.getElementById('toggleBubble');
const settingsLeave = document.getElementById('settingsLeave');

togglePin.addEventListener('click', () => {
  settingPin = !settingPin;
  togglePin.classList.toggle('on', settingPin);
  ipcRenderer.send('toggle-pin');
});

toggleAttention.addEventListener('click', () => {
  settingAttention = !settingAttention;
  toggleAttention.classList.toggle('on', settingAttention);
});

toggleBubble.addEventListener('click', () => {
  settingBubble = !settingBubble;
  toggleBubble.classList.toggle('on', settingBubble);
});

settingsLeave.addEventListener('click', () => {
  if (socket) socket.disconnect();
  currentRoom = null;
  Object.keys(otherChars).forEach(id => {
    otherChars[id].el.remove();
    otherChars[id].nameEl.remove();
    delete otherChars[id];
  });
  chatHistory = [];
  whisperHistory = [];
  updateLobbyUI();
  switchPage('lobby');
});

ipcRenderer.on('pin-status', (event, pinned) => {
  settingPin = pinned;
  togglePin.classList.toggle('on', pinned);
});
ipcRenderer.send('get-pin-status');

// ════════════════════════════════════════════
//  말풍선
// ════════════════════════════════════════════
const activeBubbles = [];

function showBubble(charX, charY, message, type) {
  if (!settingBubble) return null;
  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (type === 'whisper' ? ' whisper' : '');
  bubble.textContent = message;
  bubble.style.left = (charX + CHAR_SIZE / 2) + 'px';
  bubble.style.top = (charY - 40) + 'px';
  document.body.appendChild(bubble);
  setTimeout(() => {
    bubble.style.opacity = '0';
    bubble.style.transition = 'opacity 0.3s';
    setTimeout(() => bubble.remove(), 300);
  }, BUBBLE_DURATION);
  return bubble;
}

function createTrackedBubble(charGetter, message, type) {
  const pos = charGetter();
  const bubble = showBubble(pos.x, pos.y, message, type);
  if (!bubble) return;
  const tracker = { el: bubble, charGetter };
  activeBubbles.push(tracker);
  setTimeout(() => {
    const idx = activeBubbles.indexOf(tracker);
    if (idx > -1) activeBubbles.splice(idx, 1);
  }, BUBBLE_DURATION + 300);
}

function updateBubbles() {
  activeBubbles.forEach(b => {
    if (!b.el.parentElement) return;
    const pos = b.charGetter();
    b.el.style.left = (pos.x + CHAR_SIZE / 2) + 'px';
    b.el.style.top = (pos.y - 40) + 'px';
  });
}

// ════════════════════════════════════════════
//  알림
// ════════════════════════════════════════════
function showAlert() {
  alertBadge.style.display = 'block';
  const att = isAttentionMode();
  alertBadge.textContent = att ? '!!' : '!';
  alertBadge.style.background = att ? '#ff2020' : '#ff4757';
  // 채팅 탭 빨간 점
  document.getElementById('dotChat').classList.toggle('show', unreadChat > 0 || unreadWhisper > 0);
}
function hideAlert() {
  alertBadge.style.display = 'none';
  unreadChat = 0; unreadWhisper = 0;
  hasGrabbedMouse = false;
  document.getElementById('dotChat').classList.remove('show');
}
function updateAlertPos() {
  alertBadge.style.left = (myChar.x + CHAR_SIZE - 5) + 'px';
  alertBadge.style.top = (myChar.y - 10) + 'px';
}

// ════════════════════════════════════════════
//  랜덤 걷기 + 어텐션 모드
// ════════════════════════════════════════════
let walkTimer = 0;
function randomWalk() {
  if (Math.random() < 0.4) {
    myChar.state = 'walk';
    myChar.dir = Math.random() < 0.5 ? 1 : -1;
    myChar.vx = myChar.dir * 1.5;
    walkTimer = 60 + Math.random() * 120;
  } else {
    myChar.state = 'idle'; myChar.vx = 0;
    walkTimer = 60 + Math.random() * 180;
  }
}

function updateAttentionMode() {
  if (!isAttentionMode()) return false;
  if (myChar.isGrabbed || myChar.forcedGrab || myChar.y < FLOOR_Y) return false;

  const cx = myChar.x + CHAR_SIZE / 2;
  const dist = Math.abs(mousePos.x - cx);
  mouseIsIdle = (Date.now() - lastActivityTime) > MOUSE_IDLE_TIME;

  if (dist > CHAR_SIZE / 2) {
    myChar.state = 'walk';
    myChar.dir = mousePos.x > cx ? 1 : -1;
    myChar.vx = myChar.dir * CHASE_SPEED;
  } else {
    myChar.vx = 0;
    if (mouseIsIdle && !hasGrabbedMouse) {
      hasGrabbedMouse = true;
      myChar.state = 'grabbed'; myChar.attentionGrab = true; myChar.forcedGrab = true;
      myChar.x = mousePos.x - CHAR_SIZE / 2;
      myChar.y = mousePos.y - CHAR_SIZE / 2;
      setTimeout(() => openPhone('chat'), 500);
    } else if (!mouseIsIdle) {
      myChar.state = 'idle';
    }
  }
  return true;
}

// ════════════════════════════════════════════
//  메인 루프
// ════════════════════════════════════════════
let lastTime = 0;
function loop(ts) {
  const dt = ts - lastTime; lastTime = ts;

  if (!myChar.isGrabbed && !myChar.forcedGrab) {
    if (myChar.y < FLOOR_Y) {
      myChar.vy += GRAVITY; myChar.state = 'fall';
    } else {
      myChar.y = FLOOR_Y; myChar.vy = 0;
      if (myChar.state === 'fall') {
        myChar.state = 'land';
        setTimeout(() => { myChar.state = 'idle'; randomWalk(); }, 300);
      }
      if (!updateAttentionMode()) {
        walkTimer--;
        if (walkTimer <= 0 && myChar.state !== 'land') randomWalk();
      }
      myChar.x += myChar.vx;
    }
    myChar.y += myChar.vy;
    myChar.x = Math.max(0, Math.min(window.innerWidth - CHAR_SIZE, myChar.x));
    myChar.y = Math.min(FLOOR_Y, myChar.y);
  } else if (myChar.attentionGrab) {
    myChar.x = mousePos.x - CHAR_SIZE / 2;
    myChar.y = mousePos.y - CHAR_SIZE / 2;
  }

  myChar.frameTimer += dt;
  if (myChar.frameTimer > 1000 / FPS) {
    myChar.frameTimer = 0;
    myChar.frame = (myChar.frame + 1) % (ANIM_FRAMES[myChar.state] || 2);
  }

  renderChar(myCtx, myEl, myChar);
  updateAlertPos(); updateBubbles();

  Object.values(otherChars).forEach(c => {
    if (c.ctx) {
      renderChar(c.ctx, c.el, c);
      c.nameEl.style.left = (c.x + CHAR_SIZE / 2) + 'px';
      c.nameEl.style.top = (c.y - 18) + 'px';
    }
  });

  if (socket && socket.connected) {
    socket.volatile.emit('move', {
      x: myChar.x, y: myChar.y, state: myChar.state, dir: myChar.dir, frame: myChar.frame,
    });
  }
  requestAnimationFrame(loop);
}

// ════════════════════════════════════════════
//  Socket.io
// ════════════════════════════════════════════
let socket;

function connectSocket(roomCode, userName) {
  myChar.name = userName;
  currentRoom = roomCode;
  socket = io(SERVER_URL);

  socket.on('connect', () => {
    socket.emit('join', { room: roomCode, name: userName, parts: myChar.parts });
  });

  socket.on('user-joined', ({ id, name, parts }) => {
    if (otherChars[id]) return;
    const el = document.createElement('canvas');
    el.width = CHAR_SIZE; el.height = CHAR_SIZE;
    el.className = 'character';
    el.style.width = CHAR_SIZE + 'px'; el.style.height = CHAR_SIZE + 'px';
    document.body.appendChild(el);
    const nameEl = document.createElement('div');
    nameEl.className = 'nameplate'; nameEl.textContent = name;
    document.body.appendChild(nameEl);

    otherChars[id] = {
      x: Math.random() * (window.innerWidth - CHAR_SIZE), y: FLOOR_Y,
      vx: 0, vy: 0, state: 'idle', dir: 1, frame: 0, frameTimer: 0,
      name, parts: parts || {}, el, ctx: el.getContext('2d'), nameEl,
    };

    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      mouseDownPos = { x: e.clientX, y: e.clientY };
      dragTarget = id;
      dragOffset.x = e.clientX - otherChars[id].x;
      dragOffset.y = e.clientY - otherChars[id].y;
      isDragging = false;
      ipcRenderer.send('set-ignore-mouse', false);
    });

    updateLobbyUI();
  });

  socket.on('user-parts-updated', ({ id, parts }) => { if (otherChars[id]) otherChars[id].parts = parts; });

  socket.on('user-moved', ({ id, x, y, state, dir, frame }) => {
    if (!otherChars[id]) return;
    Object.assign(otherChars[id], { x, y, state, dir, frame });
  });

  socket.on('user-left', ({ id }) => {
    if (otherChars[id]) {
      otherChars[id].el.remove(); otherChars[id].nameEl.remove();
      delete otherChars[id];
      updateLobbyUI();
    }
  });

  socket.on('chat-message', (data) => {
    chatHistory.push(data);
    if (data.id === socket.id) {
      createTrackedBubble(() => ({ x: myChar.x, y: myChar.y }), data.message, 'chat');
    } else if (otherChars[data.id]) {
      createTrackedBubble(() => ({ x: otherChars[data.id].x, y: otherChars[data.id].y }), data.message, 'chat');
      unreadChat++; showAlert();
    }
    if (phone.classList.contains('visible') && currentPage === 'chat' && chatSubTab === 'all') {
      renderChatMessages(); unreadChat = 0;
    }
  });

  socket.on('whisper-message', (data) => {
    whisperHistory.push(data);
    if (data.fromId === socket.id) {
      createTrackedBubble(() => ({ x: myChar.x, y: myChar.y }), data.message, 'whisper');
    } else if (otherChars[data.fromId]) {
      createTrackedBubble(() => ({ x: otherChars[data.fromId].x, y: otherChars[data.fromId].y }), data.message, 'whisper');
      unreadWhisper++; showAlert();
    }
    if (phone.classList.contains('visible') && currentPage === 'chat' && chatSubTab === 'whisper') {
      renderChatMessages(); unreadWhisper = 0;
    }
  });

  socket.on('chat-history', (log) => { chatHistory = log; });
  socket.on('whisper-history', (log) => { whisperHistory = log; });

  socket.on('force-grabbed', () => { myChar.forcedGrab = true; myChar.state = 'grabbed'; myChar.vx = 0; myChar.vy = 0; });
  socket.on('char-dragged', ({ targetId, x, y }) => {
    if (targetId === socket.id) { myChar.x = x; myChar.y = y; }
    else if (otherChars[targetId]) { otherChars[targetId].x = x; otherChars[targetId].y = y; otherChars[targetId].state = 'grabbed'; }
  });
  socket.on('force-thrown', ({ vx, vy }) => {
    myChar.forcedGrab = false; myChar.attentionGrab = false; myChar.state = 'fall'; myChar.vx = vx; myChar.vy = vy;
  });
  socket.on('char-thrown', ({ targetId }) => { if (otherChars[targetId]) otherChars[targetId].state = 'fall'; });
  socket.on('char-grabbed', ({ targetId }) => { if (otherChars[targetId]) otherChars[targetId].state = 'grabbed'; });
}

// ════════════════════════════════════════════
//  시작 — 로비에서 시작
// ════════════════════════════════════════════
openPhone('lobby');
requestAnimationFrame(loop);
