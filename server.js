const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// 방 목록: { roomCode: { socketId: { name } } }
const rooms = {};

io.on('connection', (socket) => {
  console.log('접속:', socket.id);

  let currentRoom = null;
  let currentName = null;

  // 방 입장
  socket.on('join', ({ room, name }) => {
    currentRoom = room;
    currentName = name;

    socket.join(room);

    if (!rooms[room]) rooms[room] = {};

    // 기존 유저들 목록 전달
    Object.entries(rooms[room]).forEach(([id, data]) => {
      socket.emit('user-joined', { id, name: data.name });
    });

    // 새 유저 등록
    rooms[room][socket.id] = { name };

    // 다른 유저들에게 알림
    socket.to(room).emit('user-joined', { id: socket.id, name });

    console.log(`[${room}] ${name} 입장 (총 ${Object.keys(rooms[room]).length}명)`);
  });

  // 움직임 브로드캐스트
  socket.on('move', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('user-moved', { id: socket.id, ...data });
  });

  // 나감
  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom][socket.id];
      io.to(currentRoom).emit('user-left', { id: socket.id });

      if (Object.keys(rooms[currentRoom]).length === 0) {
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
