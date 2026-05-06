const { ipcRenderer } = require('electron');
const io = require('socket.io-client');

// ─── 설정 ───────────────────────────────────────────
const SERVER_URL = 'http://localhost:3000'; // 나중에 배포 URL로 교체
const SPRITE_SIZE = 64;   // 스프라이트 한 프레임 크기 (px)
const FPS = 8;            // 애니메이션 속도

// ─── 스프라이트 정의 ─────────────────────────────────
// 각 동작: { src: '파일경로', frames: 프레임수 }
const SPRITES = {
  idle:         { src: 'sprites/idle.png',    frames: 4 },
  walk:         { src: 'sprites/walk.png',    frames: 6 },
  fall:         { src: 'sprites/fall.png',    frames: 2 },
  grabbed:      { src: 'sprites/grabbed.png', frames: 1 },
  land:         { src: 'sprites/land.png',    frames: 2 },
};

// ─── 캐릭터 상태 ─────────────────────────────────────
const myChar = {
  x: window.innerWidth / 2,
  y: 100,
  vx: 0,
  vy: 0,
  state: 'fall',    // idle | walk | fall | grabbed | land
  dir: 1,           // 1 = 오른쪽, -1 = 왼쪽
  frame: 0,
  frameTimer: 0,
  isGrabbed: false,
  name: 'me',
};

const otherChars = {}; // { socketId: { x, y, state, dir, frame, name, el } }

const GRAVITY = 0.5;
const FLOOR_Y = window.innerHeight - SPRITE_SIZE;

// ─── 내 캐릭터 DOM 생성 ──────────────────────────────
const myEl = document.createElement('canvas');
myEl.width = SPRITE_SIZE;
myEl.height = SPRITE_SIZE;
myEl.className = 'character';
myEl.style.left = myChar.x + 'px';
myEl.style.top = myChar.y + 'px';
document.body.appendChild(myEl);
const myCtx = myEl.getContext('2d');

// ─── 스프라이트 이미지 로드 ───────────────────────────
const images = {};
Object.entries(SPRITES).forEach(([key, val]) => {
  const img = new Image();
  img.src = val.src;
  images[key] = img;
});

// ─── 드래그 (grab) ───────────────────────────────────
let dragOffsetX = 0, dragOffsetY = 0;

myEl.addEventListener('mousedown', (e) => {
  myChar.isGrabbed = true;
  myChar.state = 'grabbed';
  myChar.vx = 0;
  myChar.vy = 0;
  dragOffsetX = e.clientX - myChar.x;
  dragOffsetY = e.clientY - myChar.y;

  // 마우스 이벤트 통과 해제 (잡는 동안은 클릭 받아야 함)
  ipcRenderer.send('set-ignore-mouse', false);
  myEl.classList.add('grabbed');
});

document.addEventListener('mousemove', (e) => {
  if (!myChar.isGrabbed) return;
  myChar.x = e.clientX - dragOffsetX;
  myChar.y = e.clientY - dragOffsetY;
});

document.addEventListener('mouseup', (e) => {
  if (!myChar.isGrabbed) return;
  myChar.isGrabbed = false;
  myChar.state = 'fall';
  myChar.vy = 2;
  ipcRenderer.send('set-ignore-mouse', true);
  myEl.classList.remove('grabbed');
});

// ─── 랜덤 걷기 ───────────────────────────────────────
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

// ─── 메인 루프 ───────────────────────────────────────
let lastTime = 0;
function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;

  // 물리
  if (!myChar.isGrabbed) {
    if (myChar.y < FLOOR_Y) {
      myChar.vy += GRAVITY;
      myChar.state = 'fall';
    } else {
      myChar.y = FLOOR_Y;
      myChar.vy = 0;

      // 걷기 타이머
      if (myChar.state === 'fall') {
        myChar.state = 'land';
        setTimeout(() => { myChar.state = 'idle'; randomWalk(); }, 300);
      }

      walkTimer -= 1;
      if (walkTimer <= 0) randomWalk();

      myChar.x += myChar.vx;
    }

    // 화면 밖 막기
    myChar.x = Math.max(0, Math.min(window.innerWidth - SPRITE_SIZE, myChar.x));
  }

  // 프레임 애니메이션
  myChar.frameTimer += dt;
  if (myChar.frameTimer > 1000 / FPS) {
    myChar.frameTimer = 0;
    const spriteData = SPRITES[myChar.state] || SPRITES.idle;
    myChar.frame = (myChar.frame + 1) % spriteData.frames;
  }

  // 렌더링
  renderChar(myCtx, myEl, myChar);

  // 다른 캐릭터 렌더링
  Object.values(otherChars).forEach(c => {
    if (c.ctx) renderChar(c.ctx, c.el, c);
  });

  // 서버에 위치 전송 (30fps)
  if (socket && ts % 2 < 1) {
    socket.emit('move', {
      x: myChar.x,
      y: myChar.y,
      state: myChar.state,
      dir: myChar.dir,
      frame: myChar.frame,
    });
  }

  requestAnimationFrame(loop);
}

function renderChar(ctx, el, char) {
  const spriteData = SPRITES[char.state] || SPRITES.idle;
  const img = images[char.state] || images.idle;

  ctx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);

  ctx.save();
  if (char.dir === -1) {
    ctx.translate(SPRITE_SIZE, 0);
    ctx.scale(-1, 1);
  }

  if (img.complete) {
    ctx.drawImage(
      img,
      char.frame * SPRITE_SIZE, 0,  // 스프라이트시트에서 잘라내기
      SPRITE_SIZE, SPRITE_SIZE,
      0, 0,
      SPRITE_SIZE, SPRITE_SIZE
    );
  } else {
    // 이미지 없을 때 임시 박스
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

// ─── Socket.io 연결 ──────────────────────────────────
let socket;

function connectSocket(roomCode, userName) {
  socket = io(SERVER_URL);

  socket.on('connect', () => {
    console.log('연결됨:', socket.id);
    socket.emit('join', { room: roomCode, name: userName });
  });

  // 다른 유저 캐릭터 생성
  socket.on('user-joined', ({ id, name }) => {
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
      x: 0, y: FLOOR_Y,
      state: 'idle', dir: 1, frame: 0,
      name,
      el,
      ctx: el.getContext('2d'),
      nameEl,
    };
  });

  // 다른 유저 움직임 수신
  socket.on('user-moved', ({ id, x, y, state, dir, frame }) => {
    if (otherChars[id]) {
      otherChars[id].x = x;
      otherChars[id].y = y;
      otherChars[id].state = state;
      otherChars[id].dir = dir;
      otherChars[id].frame = frame;

      // 이름표 위치
      otherChars[id].nameEl.style.left = (x + SPRITE_SIZE / 2) + 'px';
      otherChars[id].nameEl.style.top = (y - 20) + 'px';
    }
  });

  // 유저 나감
  socket.on('user-left', ({ id }) => {
    if (otherChars[id]) {
      otherChars[id].el.remove();
      otherChars[id].nameEl.remove();
      delete otherChars[id];
    }
  });
}

// ─── 시작 ────────────────────────────────────────────
// TODO: 나중에 UI로 방코드/이름 입력받기
// 지금은 임시로 하드코딩
connectSocket('room01', 'guest');
requestAnimationFrame(loop);
