const { ipcRenderer } = require('electron');
const io = require('socket.io-client');

// ════════════════════════════════════════════
//  설정
// ════════════════════════════════════════════
const SERVER_URL = 'http://localhost:3000'; // 나중에 배포 URL로 교체
const SPRITE_SIZE = 64;
const FPS = 8;
const GRAVITY = 0.5;
const FLOOR_Y = window.innerHeight - SPRITE_SIZE;
const BUBBLE_DURATION = 4000;  // 말풍선 유지 시간 (ms)
const CLICK_THRESHOLD = 5;     // 클릭/드래그 구분 (px)

// ════════════════════════════════════════════
//  스프라이트 정의
// ════════════════════════════════════════════
const SPRITES = {
  idle:    { src: 'sprites/idle.png',    frames: 4 },
  walk:    { src: 'sprites/walk.png',    frames: 6 },
  fall:    { src: 'sprites/fall.png',    frames: 2 },
  grabbed: { src: 'sprites/grabbed.png', frames: 1 },
  land:    { src: 'sprites/land.png',    frames: 2 },
};

// 이미지 로드
const images = {};
Object.entries(SPRITES).forEach(([key, val]) => {
  const img = new Image();
  img.src = val.src;
  images[key] = img;
});

// ════════════════════════════════════════════
//  상태
// ════════════════════════════════════════════
const myChar = {
  x: window.innerWidth / 2,
  y: 100,
  vx: 0, vy: 0,
  state: 'fall',
  dir: 1,
  frame: 0,
  frameTimer: 0,
  isGrabbed: false,
  forcedGrab: false,   // 다른 사람이 잡은 상태
  name: 'me',
};

const otherChars = {};   // { socketId: { ...charData, el, ctx, nameEl } }
let unreadChat = 0;      // 안 읽은 전체채팅 수
let unreadWhisper = 0;   // 안 읽은 귓속말 수
let chatHistory = [];    // 전체채팅 기록
let whisperHistory = []; // 귓속말 기록

// ════════════════════════════════════════════
//  내 캐릭터 DOM
// ════════════════════════════════════════════
const myEl = document.createElement('canvas');
myEl.width = SPRITE_SIZE;
myEl.height = SPRITE_SIZE;
myEl.className = 'character';
myEl.style.left = myChar.x + 'px';
myEl.style.top = myChar.y + 'px';
document.body.appendChild(myEl);
const myCtx = myEl.getContext('2d');

// 느낌표 알림 뱃지
const alertBadge = document.createElement('div');
alertBadge.className = 'alert-badge';
alertBadge.textContent = '!';
alertBadge.style.display = 'none';
document.body.appendChild(alertBadge);

// ════════════════════════════════════════════
//  마우스 — 클릭/드래그 구분
// ════════════════════════════════════════════
let mouseDownPos = null;
let mouseDownTime = 0;
let dragTarget = null;      // 'self' | socketId | null
let dragOffset = { x: 0, y: 0 };
let isDragging = false;

// 내 캐릭터 mousedown
myEl.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  mouseDownPos = { x: e.clientX, y: e.clientY };
  mouseDownTime = Date.now();
  dragTarget = 'self';
  dragOffset.x = e.clientX - myChar.x;
  dragOffset.y = e.clientY - myChar.y;
  isDragging = false;
  ipcRenderer.send('set-ignore-mouse', false);
});

// 문서 전체 mousemove
document.addEventListener('mousemove', (e) => {
  if (!dragTarget) return;

  const dist = mouseDownPos
    ? Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y)
    : 0;

  // 드래그 시작 판정
  if (!isDragging && dist > CLICK_THRESHOLD) {
    isDragging = true;

    if (dragTarget === 'self') {
      myChar.isGrabbed = true;
      myChar.state = 'grabbed';
      myChar.vx = 0;
      myChar.vy = 0;
      myEl.classList.add('grabbed');
    } else {
      // 다른 캐릭터 잡기
      if (socket) socket.emit('grab-other', { targetId: dragTarget });
    }
  }

  // 드래그 중 위치 업데이트
  if (isDragging) {
    if (dragTarget === 'self') {
      myChar.x = e.clientX - dragOffset.x;
      myChar.y = e.clientY - dragOffset.y;
    } else {
      if (socket) {
        socket.emit('drag-other', {
          targetId: dragTarget,
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y,
        });
      }
    }
  }
});

// mouseup
document.addEventListener('mouseup', (e) => {
  if (!dragTarget) return;

  if (!isDragging) {
    // 클릭! (드래그 안 됨)
    if (dragTarget === 'self') {
      showMyMenu(e.clientX, e.clientY);
    } else {
      openWhisperInput(dragTarget);
    }
  } else {
    // 드래그 끝
    if (dragTarget === 'self') {
      myChar.isGrabbed = false;
      myChar.state = 'fall';
      myChar.vy = 2;
      myEl.classList.remove('grabbed');
    } else {
      if (socket) {
        socket.emit('throw-other', {
          targetId: dragTarget,
          vx: (e.clientX - mouseDownPos.x) * 0.1,
          vy: -3,
        });
      }
    }
  }

  ipcRenderer.send('set-ignore-mouse', true);
  dragTarget = null;
  mouseDownPos = null;
  isDragging = false;
});

// ════════════════════════════════════════════
//  팝업 메뉴 (내 캐릭터 단클릭)
// ════════════════════════════════════════════
let currentMenu = null;

function showMyMenu(x, y) {
  closeMenu();
  hideAlert(); // 알림 제거

  const menu = document.createElement('div');
  menu.className = 'popup-menu';
  menu.style.left = x + 'px';
  menu.style.top = (y - 160) + 'px';

  const items = [
    { icon: '💬', label: '전체채팅', action: () => openChatInput('chat') },
    { icon: '📖', label: '대화보기', action: () => openPhoneChat('chat') },
    { icon: '🤫', label: '귓속말보기', action: () => openPhoneChat('whisper') },
  ];

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'popup-menu-item';
    div.innerHTML = `<span>${item.icon}</span> ${item.label}`;
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      item.action();
    });
    menu.appendChild(div);
  });

  document.body.appendChild(menu);
  currentMenu = menu;

  // 메뉴 바깥 클릭하면 닫기
  setTimeout(() => {
    document.addEventListener('click', closeMenuOnClick);
  }, 50);
}

function closeMenu() {
  if (currentMenu) {
    currentMenu.remove();
    currentMenu = null;
  }
  document.removeEventListener('click', closeMenuOnClick);
}

function closeMenuOnClick(e) {
  if (currentMenu && !currentMenu.contains(e.target)) {
    closeMenu();
  }
}

// ════════════════════════════════════════════
//  채팅 입력 (간단 인풋)
// ════════════════════════════════════════════
const chatInputWrap = document.getElementById('chatInputWrap');
const chatInput = document.getElementById('chatInput');
const chatInputLabel = document.getElementById('chatInputLabel');
let chatMode = 'chat';       // 'chat' | 'whisper'
let whisperTargetId = null;

function openChatInput(mode) {
  chatMode = mode;
  chatInputLabel.textContent = '전체채팅';
  chatInputWrap.classList.add('visible');
  chatInput.value = '';
  chatInput.focus();
  ipcRenderer.send('set-ignore-mouse', false);
}

function openWhisperInput(targetId) {
  chatMode = 'whisper';
  whisperTargetId = targetId;
  const name = otherChars[targetId]?.name || '???';
  chatInputLabel.textContent = `🤫 ${name}에게 귓속말`;
  chatInputWrap.classList.add('visible');
  chatInput.value = '';
  chatInput.focus();
  ipcRenderer.send('set-ignore-mouse', false);
}

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && chatInput.value.trim()) {
    const msg = chatInput.value.trim();

    if (chatMode === 'chat') {
      socket.emit('chat', { message: msg });
    } else if (chatMode === 'whisper' && whisperTargetId) {
      socket.emit('whisper', { targetId: whisperTargetId, message: msg });
    }

    chatInput.value = '';
    chatInputWrap.classList.remove('visible');
    ipcRenderer.send('set-ignore-mouse', true);
  }

  if (e.key === 'Escape') {
    chatInputWrap.classList.remove('visible');
    ipcRenderer.send('set-ignore-mouse', true);
  }
});

// ════════════════════════════════════════════
//  말풍선
// ════════════════════════════════════════════
function showBubble(charX, charY, message, type) {
  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (type === 'whisper' ? ' whisper' : '');
  bubble.textContent = message;
  bubble.style.left = (charX + SPRITE_SIZE / 2) + 'px';
  bubble.style.top = (charY - 40) + 'px';
  document.body.appendChild(bubble);

  setTimeout(() => {
    bubble.style.opacity = '0';
    bubble.style.transition = 'opacity 0.3s';
    setTimeout(() => bubble.remove(), 300);
  }, BUBBLE_DURATION);

  return bubble;
}

// 말풍선 위치 업데이트 (캐릭터 따라다니게)
const activeBubbles = []; // { el, charGetter }

function createTrackedBubble(charGetter, message, type) {
  const pos = charGetter();
  const bubble = showBubble(pos.x, pos.y, message, type);
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
    b.el.style.left = (pos.x + SPRITE_SIZE / 2) + 'px';
    b.el.style.top = (pos.y - 40) + 'px';
  });
}

// ════════════════════════════════════════════
//  느낌표 알림
// ════════════════════════════════════════════
function showAlert() {
  alertBadge.style.display = 'block';
}
function hideAlert() {
  alertBadge.style.display = 'none';
  unreadChat = 0;
  unreadWhisper = 0;
}
function updateAlertPos() {
  alertBadge.style.left = (myChar.x + SPRITE_SIZE - 5) + 'px';
  alertBadge.style.top = (myChar.y - 10) + 'px';
}

// ════════════════════════════════════════════
//  핸드폰 채팅 기록창
// ════════════════════════════════════════════
const phoneChat = document.getElementById('phoneChat');
const phoneMessages = document.getElementById('phoneMessages');
const phoneChatClose = document.getElementById('phoneChatClose');
const phoneInput = document.getElementById('phoneInput');
const phoneSend = document.getElementById('phoneSend');
const phoneTabs = document.querySelectorAll('.phone-tab');
let phoneTab = 'chat';

function openPhoneChat(tab) {
  phoneTab = tab;
  phoneChat.classList.add('visible');
  phoneTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderPhoneMessages();
  ipcRenderer.send('set-ignore-mouse', false);

  if (tab === 'chat') unreadChat = 0;
  if (tab === 'whisper') unreadWhisper = 0;
  if (unreadChat === 0 && unreadWhisper === 0) hideAlert();
}

phoneChatClose.addEventListener('click', () => {
  phoneChat.classList.remove('visible');
  ipcRenderer.send('set-ignore-mouse', true);
});

phoneTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    openPhoneChat(tab.dataset.tab);
  });
});

function renderPhoneMessages() {
  phoneMessages.innerHTML = '';
  const log = phoneTab === 'chat' ? chatHistory : whisperHistory;

  log.forEach(msg => {
    const div = document.createElement('div');
    const isMine = msg.id === socket?.id || msg.fromId === socket?.id;
    div.className = 'phone-msg ' + (isMine ? 'mine' : 'other');

    const nameDiv = !isMine ? `<div class="phone-msg-name">${msg.name || msg.fromName}</div>` : '';
    const time = new Date(msg.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `${nameDiv}${msg.message}<div class="phone-msg-time">${time}</div>`;
    phoneMessages.appendChild(div);
  });

  phoneMessages.scrollTop = phoneMessages.scrollHeight;
}

// 핸드폰 입력
function sendPhoneMessage() {
  const msg = phoneInput.value.trim();
  if (!msg || !socket) return;

  if (phoneTab === 'chat') {
    socket.emit('chat', { message: msg });
  }
  // 귓속말은 대상이 없으면 전체채팅으로
  phoneInput.value = '';
}

phoneSend.addEventListener('click', sendPhoneMessage);
phoneInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendPhoneMessage();
});

// ════════════════════════════════════════════
//  랜덤 걷기
// ════════════════════════════════════════════
let walkTimer = 0;
function randomWalk() {
  const r = Math.random();
  if (r < 0.4) {
    myChar.state = 'walk';
    myChar.dir = Math.random() < 0.5 ? 1 : -1;
    myChar.vx = myChar.dir * 1.5;
    walkTimer = 60 + Math.random() * 120;
  } else {
    myChar.state = 'idle';
    myChar.vx = 0;
    walkTimer = 60 + Math.random() * 180;
  }
}

// ════════════════════════════════════════════
//  렌더링
// ════════════════════════════════════════════
function renderChar(ctx, el, char) {
  const spriteData = SPRITES[char.state] || SPRITES.idle;
  const img = images[char.state] || images.idle;

  ctx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  ctx.save();

  if (char.dir === -1) {
    ctx.translate(SPRITE_SIZE, 0);
    ctx.scale(-1, 1);
  }

  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(
      img,
      char.frame * SPRITE_SIZE, 0,
      SPRITE_SIZE, SPRITE_SIZE,
      0, 0,
      SPRITE_SIZE, SPRITE_SIZE
    );
  } else {
    ctx.fillStyle = '#ff6b9d';
    ctx.fillRect(8, 8, 48, 48);
    ctx.fillStyle = '#fff';
    ctx.font = '24px sans-serif';
    ctx.fillText('🐾', 12, 44);
  }

  ctx.restore();
  el.style.left = char.x + 'px';
  el.style.top = char.y + 'px';
}

// ════════════════════════════════════════════
//  메인 루프
// ════════════════════════════════════════════
let lastTime = 0;

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;

  // 물리 (내 캐릭터)
  if (!myChar.isGrabbed && !myChar.forcedGrab) {
    if (myChar.y < FLOOR_Y) {
      myChar.vy += GRAVITY;
      myChar.state = 'fall';
    } else {
      myChar.y = FLOOR_Y;
      myChar.vy = 0;

      if (myChar.state === 'fall') {
        myChar.state = 'land';
        setTimeout(() => { myChar.state = 'idle'; randomWalk(); }, 300);
      }

      walkTimer -= 1;
      if (walkTimer <= 0 && myChar.state !== 'land') randomWalk();
      myChar.x += myChar.vx;
    }

    myChar.y += myChar.vy;
    myChar.x = Math.max(0, Math.min(window.innerWidth - SPRITE_SIZE, myChar.x));
    myChar.y = Math.min(FLOOR_Y, myChar.y);
  }

  // 프레임 애니메이션
  myChar.frameTimer += dt;
  if (myChar.frameTimer > 1000 / FPS) {
    myChar.frameTimer = 0;
    const sd = SPRITES[myChar.state] || SPRITES.idle;
    myChar.frame = (myChar.frame + 1) % sd.frames;
  }

  // 렌더
  renderChar(myCtx, myEl, myChar);
  updateAlertPos();
  updateBubbles();

  // 다른 캐릭터 렌더링 + 이름표
  Object.values(otherChars).forEach(c => {
    if (c.ctx) {
      renderChar(c.ctx, c.el, c);
      c.nameEl.style.left = (c.x + SPRITE_SIZE / 2) + 'px';
      c.nameEl.style.top = (c.y - 18) + 'px';
    }
  });

  // 서버에 위치 전송
  if (socket && socket.connected) {
    socket.volatile.emit('move', {
      x: myChar.x,
      y: myChar.y,
      state: myChar.state,
      dir: myChar.dir,
      frame: myChar.frame,
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
  socket = io(SERVER_URL);

  socket.on('connect', () => {
    console.log('연결됨:', socket.id);
    socket.emit('join', { room: roomCode, name: userName });
  });

  // ─── 유저 입장 ───
  socket.on('user-joined', ({ id, name }) => {
    if (otherChars[id]) return; // 중복 방지

    const el = document.createElement('canvas');
    el.width = SPRITE_SIZE;
    el.height = SPRITE_SIZE;
    el.className = 'character';
    document.body.appendChild(el);

    const nameEl = document.createElement('div');
    nameEl.className = 'nameplate';
    nameEl.textContent = name;
    document.body.appendChild(nameEl);

    otherChars[id] = {
      x: Math.random() * (window.innerWidth - SPRITE_SIZE),
      y: FLOOR_Y,
      vx: 0, vy: 0,
      state: 'idle', dir: 1, frame: 0, frameTimer: 0,
      name,
      el, ctx: el.getContext('2d'), nameEl,
    };

    // 다른 캐릭터 마우스 이벤트
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      mouseDownPos = { x: e.clientX, y: e.clientY };
      mouseDownTime = Date.now();
      dragTarget = id;
      dragOffset.x = e.clientX - otherChars[id].x;
      dragOffset.y = e.clientY - otherChars[id].y;
      isDragging = false;
      ipcRenderer.send('set-ignore-mouse', false);
    });
  });

  // ─── 유저 움직임 ───
  socket.on('user-moved', ({ id, x, y, state, dir, frame }) => {
    if (otherChars[id]) {
      otherChars[id].x = x;
      otherChars[id].y = y;
      otherChars[id].state = state;
      otherChars[id].dir = dir;
      otherChars[id].frame = frame;
    }
  });

  // ─── 유저 나감 ───
  socket.on('user-left', ({ id }) => {
    if (otherChars[id]) {
      otherChars[id].el.remove();
      otherChars[id].nameEl.remove();
      delete otherChars[id];
    }
  });

  // ─── 전체 채팅 ───
  socket.on('chat-message', (data) => {
    chatHistory.push(data);

    // 말풍선 표시
    if (data.id === socket.id) {
      createTrackedBubble(() => ({ x: myChar.x, y: myChar.y }), data.message, 'chat');
    } else if (otherChars[data.id]) {
      const c = otherChars[data.id];
      createTrackedBubble(() => ({ x: c.x, y: c.y }), data.message, 'chat');
      unreadChat++;
      showAlert();
    }

    if (phoneChat.classList.contains('visible') && phoneTab === 'chat') {
      renderPhoneMessages();
      unreadChat = 0;
    }
  });

  // ─── 귓속말 ───
  socket.on('whisper-message', (data) => {
    whisperHistory.push(data);

    // 말풍선 (나와 상대만)
    if (data.fromId === socket.id) {
      createTrackedBubble(() => ({ x: myChar.x, y: myChar.y }), data.message, 'whisper');
    } else if (otherChars[data.fromId]) {
      const c = otherChars[data.fromId];
      createTrackedBubble(() => ({ x: c.x, y: c.y }), data.message, 'whisper');
      unreadWhisper++;
      showAlert();
    }

    if (phoneChat.classList.contains('visible') && phoneTab === 'whisper') {
      renderPhoneMessages();
      unreadWhisper = 0;
    }
  });

  // ─── 채팅기록 수신 ───
  socket.on('chat-history', (log) => { chatHistory = log; });
  socket.on('whisper-history', (log) => { whisperHistory = log; });

  // ─── 강제 잡힘 (다른 사람이 나를 잡음) ───
  socket.on('force-grabbed', ({ grabbedBy }) => {
    myChar.forcedGrab = true;
    myChar.state = 'grabbed';
    myChar.vx = 0;
    myChar.vy = 0;
  });

  // 잡힌 상태 위치 동기화
  socket.on('char-dragged', ({ targetId, x, y }) => {
    if (targetId === socket.id) {
      myChar.x = x;
      myChar.y = y;
    } else if (otherChars[targetId]) {
      otherChars[targetId].x = x;
      otherChars[targetId].y = y;
      otherChars[targetId].state = 'grabbed';
    }
  });

  // 던져짐
  socket.on('force-thrown', ({ vx, vy }) => {
    myChar.forcedGrab = false;
    myChar.state = 'fall';
    myChar.vx = vx;
    myChar.vy = vy;
  });

  socket.on('char-thrown', ({ targetId, vx, vy }) => {
    if (otherChars[targetId]) {
      otherChars[targetId].state = 'fall';
    }
  });

  socket.on('char-grabbed', ({ targetId, grabbedBy }) => {
    if (otherChars[targetId]) {
      otherChars[targetId].state = 'grabbed';
    }
  });
}

// ════════════════════════════════════════════
//  시작!
// ════════════════════════════════════════════
// TODO: 나중에 UI로 방코드/이름 입력받기
connectSocket('room01', 'guest');
requestAnimationFrame(loop);
