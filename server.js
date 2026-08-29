
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const questionBank = require('./lib/QuestionBank');
const { GameRoom } = require('./lib/GameRoom');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/categories', (req, res) => {
  res.json({ categories: questionBank.getCategories(), nicheCategories: questionBank.getNicheCategories() });
});

app.post('/api/questions', (req, res) => {
  try {
    const question = questionBank.addQuestion(req.body);
    res.status(201).json({ question });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({ totalQuestions: questionBank.getAll().length, categories: questionBank.getCategories() });
});

const rooms = new Map();
const socketRoomCode = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function publicLobbies() {
  return [...rooms.values()]
    .filter((r) => r.visibility === 'public' && r.state === 'lobby')
    .map((r) => ({
      code: r.code,
      players: r.connectedCount,
      mode: r.mode,
      difficulty: r.difficulty,
      category: r.category,
    }));
}

function broadcastLobbyState(room) {
  io.to(room.code).emit('lobby:update', room.publicSummary());
  if (room.visibility === 'public') {
    io.emit('lobby:publicList', publicLobbies());
  }
}

io.on('connection', (socket) => {
  socket.on('lobby:create', ({ nickname, visibility, mode, difficulty, category, hostMode }, cb) => {
    if (!nickname || !nickname.trim()) return cb && cb({ error: 'Nickname mancante' });
    const code = generateCode();
    const room = new GameRoom(code, socket.id, { visibility, mode, difficulty, category, hostMode });
    room.addPlayer(socket.id, nickname.trim());
    rooms.set(code, room);
    socketRoomCode.set(socket.id, code);
    socket.join(code);
    cb && cb({ ok: true, code, summary: room.publicSummary() });
    broadcastLobbyState(room);
  });

  socket.on('lobby:join', ({ code, nickname }, cb) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room) return cb && cb({ error: 'Codice partita non trovato' });
    if (room.state !== 'lobby') return cb && cb({ error: 'La partita è già iniziata' });
    if (!nickname || !nickname.trim()) return cb && cb({ error: 'Nickname mancante' });
    room.addPlayer(socket.id, nickname.trim());
    socketRoomCode.set(socket.id, room.code);
    socket.join(room.code);
    cb && cb({ ok: true, code: room.code, summary: room.publicSummary() });
    broadcastLobbyState(room);
  });

  socket.on('lobby:joinPublic', ({ nickname }, cb) => {
    const open = [...rooms.values()].find((r) => r.visibility === 'public' && r.state === 'lobby');
    if (!open) return cb && cb({ error: 'Nessuna partita pubblica disponibile al momento, creane una tu!' });
    if (!nickname || !nickname.trim()) return cb && cb({ error: 'Nickname mancante' });
    open.addPlayer(socket.id, nickname.trim());
    socketRoomCode.set(socket.id, open.code);
    socket.join(open.code);
    cb && cb({ ok: true, code: open.code, summary: open.publicSummary() });
    broadcastLobbyState(open);
  });

  socket.on('lobby:list', (cb) => {
    cb && cb({ lobbies: publicLobbies() });
  });

  socket.on('lobby:start', (cb) => {
    const code = socketRoomCode.get(socket.id);
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Stanza non trovata' });
    if (room.hostSocketId !== socket.id) return cb && cb({ error: 'Solo il presentatore (host) può avviare la partita' });
    if (room.connectedCount < 2) return cb && cb({ error: 'Servono almeno 2 giocatori per iniziare' });
    if (room.state !== 'lobby') return cb && cb({ error: 'Partita già avviata' });
    cb && cb({ ok: true });
    io.emit('lobby:publicList', publicLobbies());
    room.run(io).catch((err) => {
      console.error('Errore durante la partita', room.code, err);
      io.to(room.code).emit('error', { message: 'Si è verificato un errore nella partita.' });
    });
  });

  socket.on('game:answer', ({ answerIndex }) => {
    const code = socketRoomCode.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    room.submitAnswer(socket.id, answerIndex);
  });

  // Avvia una nuova partita nella stessa stanza/sessione, mantenendo la classifica cumulativa.
  socket.on('match:next', (cb) => {
    const code = socketRoomCode.get(socket.id);
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Stanza non trovata' });
    if (room.hostSocketId !== socket.id) return cb && cb({ error: 'Solo il presentatore (host) può avviare una nuova partita' });
    if (room.state !== 'finished') return cb && cb({ error: 'La partita in corso non è ancora finita' });
    const started = room.startNextMatch(io);
    if (!started) return cb && cb({ error: 'Impossibile avviare una nuova partita' });
    cb && cb({ ok: true });
  });

  socket.on('disconnect', () => {
    const code = socketRoomCode.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) player.connected = false;
    socketRoomCode.delete(socket.id);

    if (room.state === 'lobby') {
      room.removePlayer(socket.id);
      if (room.hostSocketId === socket.id) {
        const next = room.playerList[0];
        if (next) {
          room.hostSocketId = next.id;
          next.isHost = true;
        }
      }
      if (room.playerList.length === 0) {
        rooms.delete(room.code);
      }
    }
    broadcastLobbyState(room);
  });
});

server.listen(PORT, () => {
  console.log(`Buzz-clone in ascolto sulla porta ${PORT}`);
});
