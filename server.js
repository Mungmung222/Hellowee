const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// 방 목록
const rooms = {};

io.on('connection', (socket) => {
  console.log('접속:', socket.id);

  let currentRoom = null;
  let currentName = null;
  let currentParts = null;

  // ─── 방 입장 ──────────────────────────────
  socket.on('join', ({ room, name, parts }) => {
    currentRoom = room;
    currentName = name;
    currentParts = parts || {};
    socket.join(room);

    if (!rooms[room]) {
      rooms[room] = { users: {}, chatLog: [], whisperLog: {} };
    }

    // 기존 유저들 목록 전달 (파츠 정보 포함)
    Object.entries(rooms[room].users).forEach(([id, data]) => {
      socket.emit('user-joined', { id, name: data.name, parts: data.parts });
    });

    // 새 유저 등록
    rooms[room].users[socket.id] = { name, parts };

    // 다른 유저들에게 알림 (파츠 정보 포함)
    socket.to(room).emit('user-joined', { id: socket.id, name, parts });

    // 최근 채팅기록 전달
    socket.emit('chat-history', rooms[room].chatLog.slice(-50));

    // 귓속말 기록 전달
    const myWhispers = rooms[room].whisperLog[socket.id] || [];
    socket.emit('whisper-history', myWhispers.slice(-50));

    console.log(`[${room}] ${name} 입장 (총 ${Object.keys(rooms[room]).length}명)`);
  });

  // ─── 파츠 변경 (실시간 커스텀) ──────────────
  socket.on('update-parts', (parts) => {
    if (!currentRoom) return;
    currentParts = parts;
    if (rooms[currentRoom] && rooms[currentRoom].users[socket.id]) {
      rooms[currentRoom].users[socket.id].parts = parts;
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

    const chatData = {
      id: socket.id,
      name: currentName,
      message: message.trim(),
      time: Date.now(),
    };

    rooms[currentRoom].chatLog.push(chatData);
    if (rooms[currentRoom].chatLog.length > 200) {
      rooms[currentRoom].chatLog.shift();
    }

    io.to(currentRoom).emit('chat-message', chatData);
  });

  // ─── 귓속말 ────────────────────────────────
  socket.on('whisper', ({ targetId, message }) => {
    if (!currentRoom || !message.trim()) return;

    const whisperData = {
      fromId: socket.id,
      fromName: currentName,
      toId: targetId,
      message: message.trim(),
      time: Date.now(),
    };

    if (!rooms[currentRoom].whisperLog[socket.id]) {
      rooms[currentRoom].whisperLog[socket.id] = [];
    }
    if (!rooms[currentRoom].whisperLog[targetId]) {
      rooms[currentRoom].whisperLog[targetId] = [];
    }
    rooms[currentRoom].whisperLog[socket.id].push(whisperData);
    rooms[currentRoom].whisperLog[targetId].push(whisperData);

    socket.emit('whisper-message', whisperData);
    io.to(targetId).emit('whisper-message', whisperData);
  });

  // ─── 다른 유저 캐릭터 잡기 ──────────────────
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

  // ─── 나감 ─────────────────────────────────
  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].users[socket.id];
      io.to(currentRoom).emit('user-left', { id: socket.id });

      if (Object.keys(rooms[currentRoom].users).length === 0) {
        delete rooms[currentRoom];
      }

      console.log(`[${currentRoom}] ${currentName} 나감`);
    }
  });
});

app.get('/', (req, res) => res.send('Hellowee server running 🐾'));

server.listen(PORT, () => {
  console.log(`서버 시작: http://localhost:${PORT}`);
});
