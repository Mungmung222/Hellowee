const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

// 방 목록 (영구 유지 — 서버 켜져있는 동안)
// rooms[code] = {
//   name: '방이름',
//   code: 'ABC123',
//   owner: socketId (최초 생성자, 나중에 userId로 교체),
//   members: { oderId: { name, parts, online: bool } },
//   kicked: [ userId ],  // 강퇴 목록
//   chatLog: [],
//   whisperLog: {},
// }
const rooms = {};

io.on('connection', (socket) => {
  console.log('접속:', socket.id);
  let currentRoom = null, currentName = null, currentParts = null;

  // ─── 방 만들기 ────────────────────────────
  socket.on('create-room', ({ roomName, name, parts }, callback) => {
    // 6자리 코드 생성 (중복 방지)
    let code;
    do { code = Math.random().toString(36).substring(2,8).toUpperCase(); } while (rooms[code]);

    rooms[code] = {
      name: roomName || 'Hellowee Room',
      code,
      owner: socket.id,
      members: {},
      kicked: [],
      chatLog: [],
      whisperLog: {},
    };

    // 방장 자동 입장
    joinRoomInternal(socket, code, name, parts);
    if (callback) callback({ success: true, code, roomName: rooms[code].name });
    console.log(`[${code}] "${roomName}" 방 생성 by ${name}`);
  });

  // ─── 방 입장 (이름 + 코드 매칭) ─────────────
  socket.on('join-room', ({ code, roomName, name, parts }, callback) => {
    code = (code || '').toUpperCase();
    const room = rooms[code];

    if (!room) {
      return callback({ success: false, error: '존재하지 않는 방이에요' });
    }
    if (room.name !== roomName) {
      return callback({ success: false, error: '방 이름이 일치하지 않아요' });
    }
    if (room.kicked.includes(name)) {
      return callback({ success: false, error: '이 방에서 강퇴되었어요' });
    }

    joinRoomInternal(socket, code, name, parts);
    callback({ success: true, code, roomName: room.name });
  });

  function joinRoomInternal(sock, code, name, parts) {
    currentRoom = code;
    currentName = name;
    currentParts = parts || {};
    sock.join(code);

    const room = rooms[code];

    // 기존 온라인 유저들 목록 전달
    Object.entries(room.members).forEach(([id, data]) => {
      if (data.online && id !== sock.id) {
        sock.emit('user-joined', { id, name: data.name, parts: data.parts });
      }
    });

    // 멤버 등록 (또는 재접속)
    room.members[sock.id] = { name, parts, online: true };

    // 다른 유저들에게 알림
    sock.to(code).emit('user-joined', { id: sock.id, name, parts });

    // 방 정보 전달
    sock.emit('room-info', {
      code: room.code,
      name: room.name,
      isOwner: room.owner === sock.id,
      memberCount: Object.values(room.members).filter(m => m.online).length,
    });

    // 채팅기록 전달
    sock.emit('chat-history', room.chatLog.slice(-50));
    const myWhispers = room.whisperLog[sock.id] || [];
    sock.emit('whisper-history', myWhispers.slice(-50));

    console.log(`[${code}] ${name} 입장 (온라인: ${Object.values(room.members).filter(m=>m.online).length}명)`);
  }

  // ─── 강퇴 (방장만) ─────────────────────────
  socket.on('kick-user', ({ targetId }) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    if (room.owner !== socket.id) return; // 방장만

    const target = room.members[targetId];
    if (target) {
      room.kicked.push(target.name); // 이름 기준 강퇴
      delete room.members[targetId];
      io.to(targetId).emit('kicked', { reason: '방장에 의해 강퇴되었습니다' });
      io.to(currentRoom).emit('user-left', { id: targetId, type: 'kicked' });
      // 해당 소켓 강제 퇴장
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) targetSocket.leave(currentRoom);
    }
  });

  // ─── 파츠 변경 ─────────────────────────────
  socket.on('update-parts', (parts) => {
    if (!currentRoom) return;
    currentParts = parts;
    if (rooms[currentRoom]?.members[socket.id]) {
      rooms[currentRoom].members[socket.id].parts = parts;
    }
    socket.to(currentRoom).emit('user-parts-updated', { id: socket.id, parts });
  });

  // ─── 캐릭터 움직임 ─────────────────────────
  socket.on('move', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('user-moved', { id: socket.id, ...data });
  });

  // ─── 전체 채팅 ─────────────────────────────
  socket.on('chat', ({ message }) => {
    if (!currentRoom || !message.trim()) return;
    const chatData = { id: socket.id, name: currentName, message: message.trim(), time: Date.now() };
    rooms[currentRoom].chatLog.push(chatData);
    if (rooms[currentRoom].chatLog.length > 200) rooms[currentRoom].chatLog.shift();
    io.to(currentRoom).emit('chat-message', chatData);
  });

  // ─── 귓속말 ────────────────────────────────
  socket.on('whisper', ({ targetId, message }) => {
    if (!currentRoom || !message.trim()) return;
    const d = { fromId: socket.id, fromName: currentName, toId: targetId, message: message.trim(), time: Date.now() };
    if (!rooms[currentRoom].whisperLog[socket.id]) rooms[currentRoom].whisperLog[socket.id] = [];
    if (!rooms[currentRoom].whisperLog[targetId]) rooms[currentRoom].whisperLog[targetId] = [];
    rooms[currentRoom].whisperLog[socket.id].push(d);
    rooms[currentRoom].whisperLog[targetId].push(d);
    socket.emit('whisper-message', d);
    io.to(targetId).emit('whisper-message', d);
  });

  // ─── 상호작용 ──────────────────────────────
  socket.on('interact', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('user-interact', { id: socket.id, ...data });
  });

  // ─── 잡기/끌기/던지기/떨구기 ────────────────
  socket.on('grab-other', ({ targetId }) => {
    if (!currentRoom) return;
    io.to(targetId).emit('force-grabbed', { grabbedBy: socket.id });
    io.to(currentRoom).emit('char-grabbed', { targetId, grabbedBy: socket.id });
  });
  socket.on('drag-other', ({ targetId, x, y }) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('char-dragged', { targetId, x, y });
  });
  socket.on('throw-other', ({ targetId, vx, vy }) => {
    if (!currentRoom) return;
    io.to(targetId).emit('force-thrown', { vx, vy });
    io.to(currentRoom).emit('char-thrown', { targetId, vx, vy });
  });
  socket.on('drop-other', ({ targetId }) => {
    if (!currentRoom) return;
    io.to(targetId).emit('force-dropped');
    io.to(currentRoom).emit('char-dropped', { targetId });
  });

  // ─── 나감 (종료) → 안녕 애니메이션 전송 ─────
  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];

      // 오프라인으로만 변경 (멤버에서 삭제 X → 재입장 가능)
      if (room.members[socket.id]) {
        room.members[socket.id].online = false;
      }

      // 다른 유저에게 "안녕" 후 사라짐 알림
      io.to(currentRoom).emit('user-leaving', { id: socket.id, name: currentName });

      // 모두 오프라인이면 채팅 기록만 유지하고 방 유지
      const onlineCount = Object.values(room.members).filter(m => m.online).length;
      console.log(`[${currentRoom}] ${currentName} 나감 (온라인: ${onlineCount}명)`);
    }
  });
});

app.get('/', (req, res) => res.send('Hellowee server running 🐾'));
server.listen(PORT, () => { console.log(`서버 시작: http://localhost:${PORT}`); });
