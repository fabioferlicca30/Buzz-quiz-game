// La fase di gioco della modalità impostore. Sta in un file suo perché GameRoom è già grosso,
// e perché queste sono tutte cose che non c'entrano niente con le domande a risposta multipla.
//
// Le funzioni qui dentro vengono innestate sul prototipo di GameRoom (vedi in fondo), quindi
// `this` è la stanza: usano i suoi giocatori, il suo punteggio e il suo sistema di ripristino.
//
// REGOLA DI SICUREZZA: la parola segreta e il ruolo NON passano mai per un evento di stanza.
// Vengono mandati socket per socket, altrimenti chiunque apra la console vede chi è l'impostore.

const imp = require('./ImpostorGame');
const host = require('./Host');

// Tempi di gioco. Una stanza può sovrascriverli con `room.impostorTimings`: serve ai test, che
// altrimenti dovrebbero aspettare davvero tre quarti d'ora per giocare una manche.
const TIMINGS = {
  word: 45000, // per consegnare la propria parola quando tocca a te
  vote: 60000,
  rps: 12000,
  guess: 30000,
  reveal: 2600, // pausa sulle rivelazioni, perché si legga quel che è successo
  intro: 2200,
};

function T(room, key) {
  const override = room.impostorTimings && room.impostorTimings[key];
  return Number.isFinite(override) ? override : TIMINGS[key];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Attesa generica con scadenza: si chiude quando `isDone()` dice di sì (perché è arrivato
// l'ultimo input che serviva) oppure quando scade il tempo. Il "watcher" viene richiamato dal
// server a ogni input dei giocatori.
function waitForInputs(room, watcherName, isDone, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      room[watcherName] = null;
      clearTimeout(timer);
      resolve();
    };
    room[watcherName] = () => { if (isDone()) done(); };
    const timer = setTimeout(done, timeoutMs);
    if (isDone()) done();
  });
}

const ImpostorPhase = {
  // ---- Stato e viste --------------------------------------------------------

  impostorPlayers() {
    return this.playerList.filter((p) => p.connected && !p.leftMatch).map((p) => p.id);
  },

  nicknameOf(id) {
    return this.players.get(id)?.nickname || '???';
  },

  // Quello che un singolo giocatore ha diritto di sapere. Va mandato SOLO a lui.
  impostorRoleFor(socketId) {
    const r = this.impostorRound;
    if (!r) return null;
    const isImpostor = r.impostorId === socketId;
    return {
      manche: r.manche,
      totalManches: r.totalManches,
      theme: r.theme,
      isImpostor,
      word: isImpostor ? null : r.word,
      clue: isImpostor ? r.clue : null,
    };
  },

  emitImpostorRole(io, socketId) {
    const role = this.impostorRoleFor(socketId);
    if (role) io.to(socketId).emit('impostor:role', role);
  },

  // Il tabellone che vedono tutti: le parole consegnate, divise per giocatore e per giro.
  // Non contiene né la parola segreta né chi è l'impostore.
  impostorBoard() {
    const r = this.impostorRound;
    if (!r) return null;
    return {
      manche: r.manche,
      totalManches: r.totalManches,
      theme: r.theme,
      giro: r.giro,
      totalGiri: imp.ROUNDS_PER_MATCH,
      order: r.order.map((id) => ({ id, nickname: this.nicknameOf(id) })),
      currentPlayerId: r.currentPlayerId,
      players: r.players.map((id) => ({
        id,
        nickname: this.nicknameOf(id),
        words: r.submissions.filter((s) => s.playerId === id).map((s) => ({ giro: s.giro, word: s.word })),
      })),
      scoreboard: this.scoreboard(),
    };
  },

  broadcastImpostorBoard(io, extra = {}) {
    const payload = { ...this.impostorBoard(), ...extra };
    io.to(this.code).emit('impostor:board', payload);
    this.rememberStep('impostor:board', payload, extra.timeLimitMs || null);
    return payload;
  },

  // ---- Input dei giocatori (chiamati da server.js) --------------------------

  submitImpostorWord(socketId, word, cb) {
    const r = this.impostorRound;
    if (!r || r.phase !== 'words') return cb && cb({ error: 'Non è il momento delle parole' });
    if (r.currentPlayerId !== socketId) return cb && cb({ error: 'Non è il tuo turno' });

    const check = imp.validateSubmission(word, {
      secretWord: r.word,
      usedWords: r.submissions.map((s) => s.word),
    });
    if (check.error) return cb && cb({ error: check.error });

    r.submissions.push({ playerId: socketId, giro: r.giro, word: check.word });
    cb && cb({ ok: true, word: check.word });
    if (this._impostorWatcher) this._impostorWatcher();
  },

  submitImpostorVote(socketId, targetId, cb) {
    const r = this.impostorRound;
    if (!r || r.phase !== 'vote') return cb && cb({ error: 'Non è il momento del voto' });
    if (!r.players.includes(socketId)) return cb && cb({ error: 'Non stai giocando questa manche' });
    if (!r.players.includes(targetId)) return cb && cb({ error: 'Voto non valido' });

    r.votes.set(socketId, targetId);
    cb && cb({ ok: true });
    if (this._impostorWatcher) this._impostorWatcher();
    return { voted: r.votes.size, total: r.players.length };
  },

  // I tiri restano nascosti finché non hanno tirato tutti: se li mandassi alla stanza appena
  // arrivano, chi tira per ultimo vedrebbe gli altri e vincerebbe sempre.
  submitImpostorThrow(socketId, symbol, cb) {
    const r = this.impostorRound;
    if (!r || r.phase !== 'rps') return cb && cb({ error: 'Non è il momento della morra' });
    if (!r.tiedPlayers.includes(socketId)) return cb && cb({ error: 'Non sei tra i pari merito' });
    if (!imp.RPS_SYMBOLS.includes(symbol)) return cb && cb({ error: 'Simbolo non valido' });

    r.throws.set(socketId, symbol);
    cb && cb({ ok: true, symbol });
    if (this._impostorWatcher) this._impostorWatcher();
    return { thrown: r.throws.size, total: r.tiedPlayers.length };
  },

  submitImpostorGuess(socketId, word, cb) {
    const r = this.impostorRound;
    if (!r || r.phase !== 'guess') return cb && cb({ error: 'Non è il momento del tentativo' });
    if (r.impostorId !== socketId) return cb && cb({ error: 'Non tocca a te' });

    r.guess = String(word || '').trim();
    cb && cb({ ok: true });
    if (this._impostorWatcher) this._impostorWatcher();
  },

  // ---- Svolgimento della manche --------------------------------------------

  async runImpostorManche(io, manche, totalManches) {
    const players = this.impostorPlayers();
    const { pair, recycled } = imp.words.pick(this.impostorUsedWords);
    if (!pair) return null;
    this.impostorUsedWords.add(pair.word);

    const impostorId = imp.pickImpostor(players, this.impostorTimesAsImpostor, this.lastImpostorId);
    this.lastImpostorId = impostorId;
    this.impostorTimesAsImpostor.set(impostorId, (this.impostorTimesAsImpostor.get(impostorId) || 0) + 1);

    this.impostorRound = {
      manche,
      totalManches,
      players,
      impostorId,
      word: pair.word,
      clue: pair.clue,
      theme: pair.theme,
      giro: 0,
      order: players,
      currentPlayerId: null,
      submissions: [],
      votes: new Map(),
      tiedPlayers: [],
      throws: new Map(),
      guess: null,
      phase: 'words',
      recycled,
    };

    // Ruolo e parola: uno per uno, mai alla stanza.
    for (const id of players) this.emitImpostorRole(io, id);
    io.to(this.code).emit('impostor:mancheStart', {
      manche,
      totalManches,
      theme: pair.theme,
      players: players.map((id) => ({ id, nickname: this.nicknameOf(id) })),
    });
    this.rememberContext('impostor:mancheStart', {
      manche,
      totalManches,
      theme: pair.theme,
      players: players.map((id) => ({ id, nickname: this.nicknameOf(id) })),
    });
    io.to(this.code).emit('host:say', host.say('impostorStart', {}, { mode: this.hostMode }));
    await wait(T(this, 'intro'));

    await this.runImpostorWordRounds(io);
    const accusedId = await this.runImpostorVote(io);
    await this.resolveImpostorManche(io, accusedId);

    const round = this.impostorRound;
    this.impostorRound = null;
    return round;
  },

  // Tre giri di parole. Chi apre cambia a ogni giro: parlare per ultimi avendo già sentito
  // tutti è un vantaggio troppo grosso per lasciarlo sempre alla stessa persona.
  async runImpostorWordRounds(io) {
    const r = this.impostorRound;

    for (let giro = 0; giro < imp.ROUNDS_PER_MATCH; giro++) {
      r.giro = giro;
      r.order = imp.turnOrder(r.players, giro);

      for (const playerId of r.order) {
        const player = this.players.get(playerId);
        if (!player || !player.connected) continue; // chi è caduto salta il turno

        r.currentPlayerId = playerId;
        const before = r.submissions.length;
        this.broadcastImpostorBoard(io, { timeLimitMs: T(this, 'word'), startTs: Date.now() });

        await waitForInputs(this, '_impostorWatcher', () => r.submissions.length > before, T(this, 'word'));

        // Tempo scaduto senza consegna: si annota il passo e si va avanti, per non piantare
        // la partita su chi ha messo via il telefono.
        if (r.submissions.length === before) {
          r.submissions.push({ playerId, giro, word: '—' });
        }
      }
    }

    r.currentPlayerId = null;
    this.broadcastImpostorBoard(io);
  },

  // ---- Voto e spareggio ----------------------------------------------------

  async runImpostorVote(io) {
    const r = this.impostorRound;
    r.phase = 'vote';
    r.votes = new Map();

    const votePayload = {
      candidates: r.players.map((id) => ({ id, nickname: this.nicknameOf(id) })),
      timeLimitMs: T(this, 'vote'),
      startTs: Date.now(),
    };
    io.to(this.code).emit('impostor:vote', votePayload);
    this.rememberStep('impostor:vote', votePayload, T(this, 'vote'));
    io.to(this.code).emit('host:say', host.say('impostorVote', {}, { mode: this.hostMode }));

    const connected = () => r.players.filter((id) => this.players.get(id)?.connected).length;
    await waitForInputs(this, '_impostorWatcher', () => r.votes.size >= connected(), T(this, 'vote'));

    const tally = imp.tallyVotes(r.votes);
    io.to(this.code).emit('impostor:voteResult', {
      votes: [...r.votes.entries()].map(([voterId, targetId]) => ({
        voterId,
        voterName: this.nicknameOf(voterId),
        targetId,
        targetName: this.nicknameOf(targetId),
      })),
      counts: [...tally.counts.entries()].map(([id, n]) => ({ id, nickname: this.nicknameOf(id), votes: n })),
      tied: tally.tied.map((id) => ({ id, nickname: this.nicknameOf(id) })),
    });
    await wait(T(this, 'reveal'));

    if (tally.accusedId) return tally.accusedId;
    if (tally.noVotes) return null; // non ha votato nessuno: nessuna accusa
    return this.runImpostorTieBreak(io, tally.tied);
  },

  // Sasso, carta, forbice tra i pari merito. Chi tira il simbolo vincente si salva; chi resta
  // solo alla fine è l'accusato.
  async runImpostorTieBreak(io, tied) {
    const r = this.impostorRound;
    r.phase = 'rps';
    let stillIn = [...tied];

    for (let giro = 0; giro < imp.RPS_MAX_ROUNDS + 1; giro++) {
      r.tiedPlayers = stillIn;
      r.throws = new Map();

      const rpsPayload = {
        giro: giro + 1,
        players: stillIn.map((id) => ({ id, nickname: this.nicknameOf(id) })),
        symbols: imp.RPS_SYMBOLS,
        timeLimitMs: T(this, 'rps'),
        startTs: Date.now(),
      };
      io.to(this.code).emit('impostor:rps', rpsPayload);
      this.rememberStep('impostor:rps', rpsPayload, T(this, 'rps'));

      await waitForInputs(this, '_impostorWatcher', () => r.throws.size >= stillIn.length, T(this, 'rps'));

      // Chi non ha tirato in tempo tira a caso: meglio di una sconfitta a tavolino.
      const throws = imp.fillMissingThrows(stillIn, r.throws);
      const outcome = imp.resolveRpsRound(throws);

      io.to(this.code).emit('impostor:rpsResult', {
        throws: [...throws.entries()].map(([id, symbol]) => ({ id, nickname: this.nicknameOf(id), symbol })),
        decided: outcome.decided,
        winningSymbol: outcome.winningSymbol || null,
        safeIds: outcome.safeIds,
        stillIn: outcome.stillIn,
      });
      await wait(T(this, 'reveal'));

      if (outcome.decided && outcome.stillIn.length) stillIn = outcome.stillIn;

      const step = imp.nextTieBreakStep(stillIn, giro);
      if (step.accusedId) {
        if (step.byLot) io.to(this.code).emit('host:say', host.say('impostorTieByLot', {}, { mode: this.hostMode }));
        return step.accusedId;
      }
    }
    return stillIn[0] || null;
  },

  // ---- Esito della manche ---------------------------------------------------

  async resolveImpostorManche(io, accusedId) {
    const r = this.impostorRound;
    const caught = accusedId === r.impostorId;
    let guessCorrect = false;

    // L'impostore scoperto ha un'ultima carta: se ha capito la parola, ribalta la manche.
    if (caught) {
      r.phase = 'guess';
      r.guess = null;
      io.to(this.code).emit('impostor:guessWait', {
        impostorId: r.impostorId,
        nickname: this.nicknameOf(r.impostorId),
        timeLimitMs: T(this, 'guess'),
        startTs: Date.now(),
      });
      io.to(r.impostorId).emit('impostor:guessPrompt', { timeLimitMs: T(this, 'guess'), startTs: Date.now() });
      this.rememberStep('impostor:guessWait', {
        impostorId: r.impostorId,
        nickname: this.nicknameOf(r.impostorId),
        timeLimitMs: T(this, 'guess'),
      }, T(this, 'guess'));

      await waitForInputs(this, '_impostorWatcher', () => r.guess !== null, T(this, 'guess'));
      guessCorrect = Boolean(r.guess) && imp.sameWord(r.guess, r.word);
    }

    const { points, outcome } = imp.scoreRound({
      impostorId: r.impostorId,
      accusedId,
      votes: r.votes,
      guessCorrect,
    });
    for (const [id, n] of points.entries()) {
      const p = this.players.get(id);
      if (p) p.score += n;
    }

    r.phase = 'result';
    const resultPayload = {
      manche: r.manche,
      totalManches: r.totalManches,
      word: r.word,
      clue: r.clue,
      theme: r.theme,
      impostorId: r.impostorId,
      impostorName: this.nicknameOf(r.impostorId),
      accusedId,
      accusedName: accusedId ? this.nicknameOf(accusedId) : null,
      outcome,
      guess: r.guess || null,
      guessCorrect,
      points: [...points.entries()].map(([id, n]) => ({ id, nickname: this.nicknameOf(id), points: n })),
      scoreboard: this.scoreboard(),
    };
    io.to(this.code).emit('impostor:mancheResult', resultPayload);
    this.rememberStep('impostor:mancheResult', resultPayload);

    const line = outcome === 'impostorGuessed' ? 'impostorGuessed'
      : outcome === 'impostorCaught' ? 'impostorCaught' : 'impostorEscaped';
    io.to(this.code).emit('host:say', host.say(line, { name: this.nicknameOf(r.impostorId), word: r.word }, { mode: this.hostMode }));
    await wait(T(this, 'reveal'));
  },

  // ---- La modalità intera ---------------------------------------------------

  async runImpostorMode(io) {
    this.state = 'impostor';
    this.activeCompetitorIds = null;
    this.clearResume();

    const players = this.impostorPlayers();
    // Sotto i cinque il voto è un lancio di dado, e la modalità non regge.
    if (players.length < imp.MIN_PLAYERS) {
      io.to(this.code).emit('impostor:tooFew', { needed: imp.MIN_PLAYERS, current: players.length });
      await this.finish(io, players);
      return;
    }

    // "Una a testa" (impostazione 0) significa tante manche quanti sono i giocatori: così tutti
    // fanno l'impostore lo stesso numero di volte, che qui conta più di ogni altra cosa.
    const total = this.impostorManches > 0 ? this.impostorManches : players.length;

    for (let manche = 1; manche <= total; manche++) {
      if (this.impostorPlayers().length < imp.MIN_PLAYERS) break;
      await this.runImpostorManche(io, manche, total);

      if (manche < total) {
        this.resetReadyTracking();
        io.to(this.code).emit('game:readyStatus', this.readyStatusPayload());
        await wait(600);
        await this.waitForReady(io, 45000);
      }
    }

    const order = this.playerList
      .filter((p) => !p.leftMatch)
      .sort((a, b) => b.score - a.score)
      .map((p) => p.id);
    await this.finish(io, order);
  },
};

module.exports = { ImpostorPhase, TIMINGS };
