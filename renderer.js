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
const ATTENTION_THRESHOLD = 10;   // 알림 몇 개부터 쫓아다니기
const MOUSE_IDLE_TIME = 2000;     // 마우스 멈춤 판정 (ms)
const CHASE_SPEED = 3;            // 쫓아가는 속도

// ════════════════════════════════════════════
//  레이어 기반 파츠 시스템
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
  idle:    2,
  walk:    3,
  fall:    1,
  grabbed: 1,
  land:    1,
  thrown:  1,
};

// ─── 이미지 캐시 ────────────────────────────
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
  x: window.innerWidth / 2,
  y: 100,
  vx: 0, vy: 0,
  state: 'fall',
  dir: 1,
  frame: 0,
  frameTimer: 0,
  isGrabbed: false,
  forcedGrab: false,
  name: 'me',
  parts: {
    body:      'default',
    eyes:      'round',
    mouth:     'smile',
    hair:      'short',
    clothes:   'hoodie',
    accessory: 'none',
  },
};

const otherChars = {};
let unreadChat = 0;
let unreadWhisper = 0;
let chatHistory = [];
let whisperHistory = [];

// ════════════════════════════════════════════
//  마우스 추적 (어텐션 모드용)
// ════════════════════════════════════════════
let mousePos = { x: window.innerWidth / 2, y: FLOOR_Y };
let lastMouseMoveTime = Date.now();
let mouseIsIdle = false;
let hasGrabbedMouse = false;  // 이번 어텐션 모드에서 이미 잡았는지

// 전역 마우스 위치 추적
document.addEventListener('mousemove', (e) => {
  mousePos.x = e.clientX;
  mousePos.y = e.clientY;
  lastMouseMoveTime = Date.now();

  // 마우스 움직이면 잡기 해제
  if (mouseIsIdle && hasGrabbedMouse) {
    mouseIsIdle = false;
    // 잡기 해제 → 떨어짐
    if (myChar.forcedGrab && myChar.attentionGrab) {
      myChar.attentionGrab = false;
      myChar.forcedGrab = false;
      myChar.state = 'fall';
      myChar.vy = -3;
      myChar.vx = (Math.random() - 0.5) * 4;
    }
  }
});

function getTotalUnread() {
  return unreadChat + unreadWhisper;
}

function isAttentionMode() {
  return getTotalUnread() >= ATTENTION_THRESHOLD;
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
//  레이어 기반 렌더링
// ════════════════════════════════════════════
function renderChar(ctx, el, char) {
  const action = char.state || 'idle';
  const frames = ANIM_FRAMES[action] || ANIM_FRAMES.idle;
  const frame = char.frame % frames;

  ctx.clearRect(0, 0, CHAR_SIZE, CHAR_SIZE);
  ctx.save();

  if (char.dir === -1) {
    ctx.translate(CHAR_SIZE, 0);
    ctx.scale(-1, 1);
  }

  let hasAnyImage = false;

  LAYER_ORDER.forEach(layer => {
    const option = char.parts?.[layer];
    if (!option || option === 'none') return;

    const img = getPartImage(layer, option, action);
    if (img && img.complete && img.naturalWidth > 0) {
      hasAnyImage = true;
      ctx.drawImage(
        img,
        frame * CHAR_SIZE, 0,
        CHAR_SIZE, CHAR_SIZE,
        0, 0,
        CHAR_SIZE, CHAR_SIZE
      );
    }
  });

  if (!hasAnyImage) {
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
//  마우스 — 클릭/드래그 구분
// ════════════════════════════════════════════
let mouseDownPos = null;
let mouseDownTime = 0;
let dragTarget = null;
let dragOffset = { x: 0, y: 0 };
let isDragging = false;

myEl.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  mouseDownPos = { x: e.clientX, y: e.clientY };
  mouseDownTime = Date.now();
  dragTarget = 'self';
  dragOffset.x = e.clientX - myChar.x;
  dragOffset.y = e.clientY - myChar.y;
  isDragging = false;
  ipcRenderer.send('set-ignore-mouse', false);

  // 어텐션 잡기 해제
  if (myChar.attentionGrab) {
    myChar.attentionGrab = false;
    myChar.forcedGrab = false;
  }
});

document.addEventListener('mousemove', (e) => {
  if (!dragTarget) return;

  const dist = mouseDownPos
    ? Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y)
    : 0;

  if (!isDragging && dist > CLICK_THRESHOLD) {
    isDragging = true;
    if (dragTarget === 'self') {
      myChar.isGrabbed = true;
      myChar.state = 'grabbed';
      myChar.vx = 0;
      myChar.vy = 0;
      myEl.classList.add('grabbed');
    } else {
      if (socket) socket.emit('grab-other', { targetId: dragTarget });
    }
  }

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

document.addEventListener('mouseup', (e) => {
  if (!dragTarget) return;

  if (!isDragging) {
    if (dragTarget === 'self') {
      showMyMenu(e.clientX, e.clientY);
    } else {
      openWhisperInput(dragTarget);
    }
  } else {
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
//  팝업 메뉴
// ════════════════════════════════════════════
let currentMenu = null;

function showMyMenu(x, y) {
  closeMenu();
  hideAlert();

  const menu = document.createElement('div');
  menu.className = 'popup-menu';
  menu.style.left = x + 'px';
  menu.style.top = (y - 200) + 'px';

  const items = [
    { icon: '💬', label: '전체채팅',   action: () => openChatInput('chat') },
    { icon: '📖', label: '대화보기',   action: () => openPhoneChat('chat') },
    { icon: '🤫', label: '귓속말보기', action: () => openPhoneChat('whisper') },
    { icon: '🎨', label: '꾸미기',     action: () => openCustomizer() },
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

  setTimeout(() => {
    document.addEventListener('click', closeMenuOnClick);
  }, 50);
}

function closeMenu() {
  if (currentMenu) { currentMenu.remove(); currentMenu = null; }
  document.removeEventListener('click', closeMenuOnClick);
}

function closeMenuOnClick(e) {
  if (currentMenu && !currentMenu.contains(e.target)) closeMenu();
}

// ════════════════════════════════════════════
//  꾸미기 패널
// ════════════════════════════════════════════
let customizerEl = null;

function openCustomizer() {
  if (customizerEl) { customizerEl.remove(); customizerEl = null; return; }
  ipcRenderer.send('set-ignore-mouse', false);

  customizerEl = document.createElement('div');
  customizerEl.className = 'customizer';

  const title = document.createElement('div');
  title.className = 'customizer-title';
  title.textContent = '🎨 꾸미기';
  customizerEl.appendChild(title);

  const labelMap = {
    body: '피부', eyes: '눈', mouth: '입',
    hair: '헤어', clothes: '옷', accessory: '악세서리',
  };

  LAYER_ORDER.forEach(layer => {
    const row = document.createElement('div');
    row.className = 'customizer-row';

    const label = document.createElement('div');
    label.className = 'customizer-label';
    label.textContent = labelMap[layer];
    row.appendChild(label);

    const btnWrap = document.createElement('div');
    btnWrap.className = 'customizer-options';

    PARTS_OPTIONS[layer].forEach(option => {
      const btn = document.createElement('button');
      btn.className = 'customizer-btn';
      if (myChar.parts[layer] === option) btn.classList.add('active');
      btn.textContent = option;
      btn.addEventListener('click', () => {
        myChar.parts[layer] = option;
        btnWrap.querySelectorAll('.customizer-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (socket) socket.emit('update-parts', myChar.parts);
      });
      btnWrap.appendChild(btn);
    });

    row.appendChild(btnWrap);
    customizerEl.appendChild(row);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'customizer-close';
  closeBtn.textContent = '✕ 닫기';
  closeBtn.addEventListener('click', () => {
    customizerEl.remove(); customizerEl = null;
    ipcRenderer.send('set-ignore-mouse', true);
  });
  customizerEl.appendChild(closeBtn);

  document.body.appendChild(customizerEl);
}

// ════════════════════════════════════════════
//  채팅 입력
// ════════════════════════════════════════════
const chatInputWrap = document.getElementById('chatInputWrap');
const chatInput = document.getElementById('chatInput');
const chatInputLabel = document.getElementById('chatInputLabel');
let chatMode = 'chat';
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
const activeBubbles = [];

function showBubble(charX, charY, message, type) {
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
//  느낌표 알림
// ════════════════════════════════════════════
function showAlert() {
  alertBadge.style.display = 'block';
  // 어텐션 모드 진입 시 뱃지에 숫자 표시
  const total = getTotalUnread();
  alertBadge.textContent = total >= ATTENTION_THRESHOLD ? '!!' : '!';
  alertBadge.style.background = total >= ATTENTION_THRESHOLD ? '#ff2020' : '#ff4757';
}
function hideAlert() {
  alertBadge.style.display = 'none';
  unreadChat = 0;
  unreadWhisper = 0;
  hasGrabbedMouse = false;  // 리셋
}
function updateAlertPos() {
  alertBadge.style.left = (myChar.x + CHAR_SIZE - 5) + 'px';
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
  tab.addEventListener('click', () => openPhoneChat(tab.dataset.tab));
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

function sendPhoneMessage() {
  const msg = phoneInput.value.trim();
  if (!msg || !socket) return;
  if (phoneTab === 'chat') {
    socket.emit('chat', { message: msg });
  }
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
//  어텐션 모드 — 마우스 쫓아가기 + 잡기
// ════════════════════════════════════════════
function updateAttentionMode() {
  if (!isAttentionMode()) return false;
  if (myChar.isGrabbed || myChar.forcedGrab) return false;
  if (myChar.y < FLOOR_Y) return false; // 공중이면 무시

  const charCenterX = myChar.x + CHAR_SIZE / 2;
  const targetX = mousePos.x;
  const dist = Math.abs(targetX - charCenterX);
  const now = Date.now();

  // 마우스가 멈춤 판정
  mouseIsIdle = (now - lastMouseMoveTime) > MOUSE_IDLE_TIME;

  // 마우스 쫓아가기
  if (dist > CHAR_SIZE / 2) {
    // 아직 멀면 빠르게 쫓아감
    myChar.state = 'walk';
    myChar.dir = targetX > charCenterX ? 1 : -1;
    myChar.vx = myChar.dir * CHASE_SPEED;
  } else {
    // 가까이 왔을 때
    myChar.vx = 0;

    if (mouseIsIdle && !hasGrabbedMouse) {
      // 마우스가 멈추고 + 아직 안 잡았으면 → 강제 잡기!
      hasGrabbedMouse = true;
      myChar.state = 'grabbed';
      myChar.attentionGrab = true;
      myChar.forcedGrab = true;

      // 마우스 커서 위치에 달라붙기
      myChar.x = mousePos.x - CHAR_SIZE / 2;
      myChar.y = mousePos.y - CHAR_SIZE / 2;

      // 강제로 메뉴 열기 (채팅 읽으라고!)
      setTimeout(() => {
        showMyMenu(mousePos.x, mousePos.y);
      }, 500);
    } else if (!mouseIsIdle) {
      myChar.state = 'idle';
    }
  }

  return true; // 어텐션 모드 활성
}

// ════════════════════════════════════════════
//  메인 루프
// ════════════════════════════════════════════
let lastTime = 0;

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;

  // 물리
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

      // 어텐션 모드가 아닐 때만 랜덤 걷기
      const isAttention = updateAttentionMode();
      if (!isAttention) {
        walkTimer -= 1;
        if (walkTimer <= 0 && myChar.state !== 'land') randomWalk();
      }

      myChar.x += myChar.vx;
    }

    myChar.y += myChar.vy;
    myChar.x = Math.max(0, Math.min(window.innerWidth - CHAR_SIZE, myChar.x));
    myChar.y = Math.min(FLOOR_Y, myChar.y);
  } else if (myChar.attentionGrab) {
    // 어텐션 잡기 중에는 마우스 따라다님
    myChar.x = mousePos.x - CHAR_SIZE / 2;
    myChar.y = mousePos.y - CHAR_SIZE / 2;
  }

  // 프레임 애니메이션
  myChar.frameTimer += dt;
  if (myChar.frameTimer > 1000 / FPS) {
    myChar.frameTimer = 0;
    const frames = ANIM_FRAMES[myChar.state] || ANIM_FRAMES.idle;
    myChar.frame = (myChar.frame + 1) % frames;
  }

  // 렌더
  renderChar(myCtx, myEl, myChar);
  updateAlertPos();
  updateBubbles();

  Object.values(otherChars).forEach(c => {
    if (c.ctx) {
      renderChar(c.ctx, c.el, c);
      c.nameEl.style.left = (c.x + CHAR_SIZE / 2) + 'px';
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
    socket.emit('join', { room: roomCode, name: userName, parts: myChar.parts });
  });

  socket.on('user-joined', ({ id, name, parts }) => {
    if (otherChars[id]) return;

    const el = document.createElement('canvas');
    el.width = CHAR_SIZE;
    el.height = CHAR_SIZE;
    el.className = 'character';
    el.style.width = CHAR_SIZE + 'px';
    el.style.height = CHAR_SIZE + 'px';
    document.body.appendChild(el);

    const nameEl = document.createElement('div');
    nameEl.className = 'nameplate';
    nameEl.textContent = name;
    document.body.appendChild(nameEl);

    otherChars[id] = {
      x: Math.random() * (window.innerWidth - CHAR_SIZE),
      y: FLOOR_Y,
      vx: 0, vy: 0,
      state: 'idle', dir: 1, frame: 0, frameTimer: 0,
      name,
      parts: parts || {},
      el, ctx: el.getContext('2d'), nameEl,
    };

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

  socket.on('user-parts-updated', ({ id, parts }) => {
    if (otherChars[id]) otherChars[id].parts = parts;
  });

  socket.on('user-moved', ({ id, x, y, state, dir, frame }) => {
    if (otherChars[id]) {
      otherChars[id].x = x;
      otherChars[id].y = y;
      otherChars[id].state = state;
      otherChars[id].dir = dir;
      otherChars[id].frame = frame;
    }
  });

  socket.on('user-left', ({ id }) => {
    if (otherChars[id]) {
      otherChars[id].el.remove();
      otherChars[id].nameEl.remove();
      delete otherChars[id];
    }
  });

  socket.on('chat-message', (data) => {
    chatHistory.push(data);
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

  socket.on('whisper-message', (data) => {
    whisperHistory.push(data);
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

  socket.on('chat-history', (log) => { chatHistory = log; });
  socket.on('whisper-history', (log) => { whisperHistory = log; });

  socket.on('force-grabbed', ({ grabbedBy }) => {
    myChar.forcedGrab = true;
    myChar.state = 'grabbed';
    myChar.vx = 0;
    myChar.vy = 0;
  });

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

  socket.on('force-thrown', ({ vx, vy }) => {
    myChar.forcedGrab = false;
    myChar.attentionGrab = false;
    myChar.state = 'fall';
    myChar.vx = vx;
    myChar.vy = vy;
  });

  socket.on('char-thrown', ({ targetId }) => {
    if (otherChars[targetId]) otherChars[targetId].state = 'fall';
  });

  socket.on('char-grabbed', ({ targetId }) => {
    if (otherChars[targetId]) otherChars[targetId].state = 'grabbed';
  });
}

// ════════════════════════════════════════════
//  시작!
// ════════════════════════════════════════════
// TODO: 로비 UI로 방코드/이름/커스텀 입력받기
connectSocket('room01', 'guest');
requestAnimationFrame(loop);
