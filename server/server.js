
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
      categories: r.categories,
    }));
}

function broadcastLobbyState(room) {
  io.to(room.code).emit('lobby:update', room.publicSummary());
  if (room.visibility === 'public') {
    io.emit('lobby:publicList', publicLobbies());
  }
}

io.on('connection', (socket) => {
  socket.on('lobby:create', ({ nickname, visibility, mode, difficulty, categories, hostMode }, cb) => {
    if (!nickname || !nickname.trim()) return cb && cb({ error: 'Nickname mancante' });
    const code = generateCode();
    const room = new GameRoom(code, socket.id, { visibility, mode, difficulty, categories, hostMode });
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

  // Rientro dopo una caduta di connessione: il giocatore riprende la sua scheda
  // (punteggio, eliminazione, qualificazione) invece di ripartire da capo.
  socket.on('lobby:reconnect', ({ code, nickname }, cb) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room) return cb && cb({ error: 'Partita non più attiva' });
    const player = room.reconnectPlayer(socket.id, nickname);
    if (!player) return cb && cb({ error: 'Nessun posto da recuperare con questo nome' });

    socketRoomCode.set(socket.id, room.code);
    socket.join(room.code);
    cb && cb({
      ok: true,
      code: room.code,
      state: room.state,
      you: { id: player.id, nickname: player.nickname, score: player.score, eliminated: player.eliminated },
      summary: room.publicSummary(),
    });
    room.notifyReadyWatcher();
    broadcastLobbyState(room);
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

  // Fase "brainfighting": il giocatore preme il pulsante rosso per prenotarsi.
  socket.on('game:buzz', () => {
    const code = socketRoomCode.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    room.buzz(socket.id);
  });

  // Fase "brainfighting": il giocatore che si è prenotato sceglie una risposta.
  socket.on('game:brainfightAnswer', ({ answerIndex }) => {
    const code = socketRoomCode.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    room.submitBrainfightAnswer(socket.id, answerIndex);
  });

  // Sfida a griglia: il giocatore prova a riempire una casella.
  socket.on('grid:answer', ({ cellIndex, answer }, cb) => {
    const code = socketRoomCode.get(socket.id);
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Stanza non trovata' });
    room.submitGridAnswer(socket.id, cellIndex, answer, cb);
  });

  // Il giocatore conferma di essere pronto a passare alla domanda successiva.
  socket.on('game:ready', () => {
    const code = socketRoomCode.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    room.markReady(socket.id);
  });

  // Il giocatore abbandona SOLO la partita in corso: resta nella stanza/sessione e potrà
  // rientrare nella prossima partita, ma non deve più cliccare "Pronto" né rispondere ora.
  socket.on('match:leave', (cb) => {
    const code = socketRoomCode.get(socket.id);
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Stanza non trovata' });
    if (room.state === 'lobby' || room.state === 'finished') {
      return cb && cb({ error: 'Nessuna partita in corso da abbandonare al momento.' });
    }
    room.leaveMatch(socket.id);
    cb && cb({ ok: true });
    broadcastLobbyState(room);
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

  // Il giocatore lascia del tutto la stanza/sessione (equivalente a disconnettersi, ma esplicito).
  socket.on('session:leave', () => {
    handleLeave(socket);
    socket.disconnect(true);
  });

  socket.on('disconnect', () => {
    handleLeave(socket);
  });
});

// Logica condivisa tra "disconnessione di rete" e "uscita esplicita dalla sessione".
function handleLeave(socket) {
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
  } else {
    room.notifyReadyWatcher();
  }
  broadcastLobbyState(room);
}

server.listen(PORT, () => {
  console.log(`Quiz Party in ascolto sulla porta ${PORT}`);
});
