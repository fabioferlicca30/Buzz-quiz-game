const questionBank = require('./QuestionBank');
const brainfightingBank = require('./BrainfightingBank');
const gridGame = require('./GridGame');
const host = require('./Host');

const PHASE1_QUESTIONS = 10;
const QUESTION_TIME_MS = 10000;
const HOST_BEAT_GAP_MS = 2600; // pausa tra la prima e la seconda battuta del presentatore
const READY_PRE_DELAY_MS = 1500; // piccola pausa fissa prima che appaia il pulsante "Pronto"
const READY_TIMEOUT_MS = 20000; // rete di sicurezza: si va avanti comunque dopo questo tempo
const BIG_PAUSE_MS = 6000;
const DIFFICULTY_ORDER = ['facile', 'medio', 'difficile', 'superdifficile', 'impossibile'];
const SESSION_POINTS = [1000, 500, 250]; // 1°, 2°, 3° posto di ogni partita; dal 4° in poi: 0 punti sessione

// ---- Fase "brainfighting" (calcoli a mente col pulsante buzz) --------------
const BRAINFIGHT_TRIGGER_ROUNDS = 10; // dopo 10 round di eliminazione normale con 2+ superstiti, si passa qui
const BRAINFIGHT_WINNING_SCORE = 3; // punti necessari per vincere l'intera partita
const BRAINFIGHT_MAX_WRONG_PER_PROBLEM = 3; // oltre questo numero di tentativi falliti, si cambia problema
const BUZZ_TIME_MS = 120000; // 2 minuti per prenotarsi
const BRAINFIGHT_ANSWER_LOCK_MS = 5000; // solo 5 secondi per rispondere dopo il buzz: bisogna prenotarsi già sapendo la risposta
// Categorie i cui problemi richiedono calcoli: qui il client mostra una calcolatrice sotto al buzz.
const CALC_CATEGORIES = new Set(['Matematica', 'Fisica', 'Ingegneria del Veicolo', 'Automobili e Motori', 'Formula 1', 'Scienza e Natura']);
const GRID_TIME_MS = 180000; // 3 minuti per completare una griglia 2x2
const GRID_CHANCE = 0.5; // probabilità di proporre una griglia invece di un problema a buzz, se la categoria la supporta

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundDifficulty(baseDifficulty, roundIndex) {
  const baseIdx = baseDifficulty === 'misto' ? 0 : DIFFICULTY_ORDER.indexOf(baseDifficulty);
  const idx = Math.min(DIFFICULTY_ORDER.length - 1, Math.max(0, baseIdx) + roundIndex);
  return DIFFICULTY_ORDER[idx];
}

class GameRoom {
  constructor(code, hostSocketId, settings) {
    this.code = code;
    this.visibility = settings.visibility === 'public' ? 'public' : 'private';
    this.mode = ['classic', 'brainfight'].includes(settings.mode) ? settings.mode : 'rush'; // 'rush' | 'classic' | 'brainfight'
    this.difficulty = settings.difficulty || 'misto'; // facile|medio|difficile|superdifficile|impossibile|misto
    this.categories = Array.isArray(settings.categories) ? settings.categories.filter(Boolean) : []; // [] = "tutte"
    this.hostMode = settings.hostMode === 'unfiltered' ? 'unfiltered' : 'family'; // presentatore: 'family' o 'unfiltered' (non family friendly)
    this.hostSocketId = hostSocketId;
    this.players = new Map(); // socketId -> player
    this.state = 'lobby'; // lobby | phase1 | elimination | finished
    this.usedQuestionIds = new Set();
    this.eliminationUsedIds = new Set();
    this.currentQuestion = null;
    this.acceptingAnswers = false;
    this.currentAnswers = new Map(); // socketId -> {answerIndex, elapsedMs}
    this.questionStartTs = 0;
    this.phase1Index = 0;
    this.previousLeaderId = null;
    this.createdAt = Date.now();

    // Una "sessione di gioco" può contenere più partite giocate di fila dallo stesso gruppo:
    // il punteggio di sessione si accumula partita dopo partita (chiave: nickname del giocatore).
    this.matchNumber = 1;
    this.sessionScores = new Map(); // nickname -> punteggio cumulativo di sessione

    // Statistiche cumulative della sessione, per il riepilogo finale (nickname -> dati).
    // Servono a produrre i "premi" di fine serata: più veloce, più preciso, e così via.
    this.sessionStats = new Map();

    // Tracciamento risposte-tutti-date (per chiudere la domanda in anticipo) e pulsante "Pronto".
    this._answerWatcher = null;
    this.readyPlayers = new Set();
    this._readyWatcher = null;

    // Fase "brainfighting": mazzo usato (non si ripete in sessione) e stato del pulsante buzz.
    this.brainfightingUsedIds = new Set();
    this.acceptingBuzz = false;
    this.buzzedPlayerId = null;
    this._buzzWatcher = null;
    this._bfAnswerWatcher = null;

    // Sfida a griglia (Calcio, F1, Cinema/Serie TV, Geografia): niente buzz, vince chi
    // completa per primo tutte e 4 le caselle.
    this.currentGrid = null;
    this.gridProgress = new Map(); // socketId -> { filled: Map(cellIndex -> nome), done: bool }
    this._gridWatcher = null;
  }

  addPlayer(socketId, nickname) {
    this.players.set(socketId, {
      id: socketId,
      nickname: nickname.slice(0, 16),
      score: 0,
      connected: true,
      isHost: socketId === this.hostSocketId,
      qualified: false,
      eliminated: false,
      eliminationRound: null,
      leftMatch: false, // il giocatore ha scelto di abbandonare la partita in corso (resta in sessione)
    });
  }

  // Riaggancia un giocatore che aveva perso la connessione: la scheda (punteggio, stato di
  // eliminazione, qualificazione) viene spostata sul nuovo socket, così rientra esattamente
  // dove era rimasto invece di ripartire da zero. Il match si riconosce dal nickname.
  reconnectPlayer(newSocketId, nickname) {
    const wanted = String(nickname || '').slice(0, 16).trim().toLowerCase();
    if (!wanted) return null;

    for (const [oldId, p] of this.players.entries()) {
      if (p.connected) continue; // solo chi risulta caduto
      if (p.nickname.trim().toLowerCase() !== wanted) continue;

      this.players.delete(oldId);
      p.id = newSocketId;
      p.connected = true;
      this.players.set(newSocketId, p);

      // Sposta anche i riferimenti al vecchio socket sparsi nello stato della partita,
      // altrimenti il giocatore rientra ma il gioco continua ad aspettare il socket morto.
      if (this.readyPlayers.delete(oldId)) this.readyPlayers.add(newSocketId);
      if (this.currentAnswers.has(oldId)) {
        this.currentAnswers.set(newSocketId, this.currentAnswers.get(oldId));
        this.currentAnswers.delete(oldId);
      }
      if (this.gridProgress.has(oldId)) {
        this.gridProgress.set(newSocketId, this.gridProgress.get(oldId));
        this.gridProgress.delete(oldId);
      }
      if (this.buzzedPlayerId === oldId) this.buzzedPlayerId = newSocketId;
      if (this.hostSocketId === oldId) this.hostSocketId = newSocketId;

      return p;
    }
    return null;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
  }

  get playerList() {
    return [...this.players.values()];
  }

  get connectedCount() {
    return this.playerList.filter((p) => p.connected).length;
  }

  publicSummary() {
    return {
      code: this.code,
      visibility: this.visibility,
      mode: this.mode,
      difficulty: this.difficulty,
      categories: this.categories,
      hostMode: this.hostMode,
      state: this.state,
      matchNumber: this.matchNumber,
      players: this.playerList.map((p) => ({ nickname: p.nickname, isHost: p.isHost, connected: p.connected })),
    };
  }

  scoreboard() {
    return this.playerList
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        connected: p.connected,
        eliminated: p.eliminated,
        leftMatch: p.leftMatch,
        sessionScore: this.sessionScores.get(p.nickname) || 0,
      }));
  }

  sessionScoreboard() {
    // Assicura che ogni giocatore attualmente in stanza compaia nella classifica di sessione, anche a 0.
    for (const p of this.playerList) {
      if (!this.sessionScores.has(p.nickname)) this.sessionScores.set(p.nickname, 0);
    }
    return [...this.sessionScores.entries()]
      .map(([nickname, sessionScore]) => ({ nickname, sessionScore }))
      .sort((a, b) => b.sessionScore - a.sessionScore);
  }

  // Riepilogo statistico della serata: i "premi" da leggere a fine sessione.
  // Restituisce solo le voci che hanno davvero un vincitore (niente premi a vuoto).
  sessionAwards() {
    const all = [...this.sessionStats.values()].filter((s) => s.answered > 0 || s.timedOut > 0);
    if (all.length === 0) return [];

    const awards = [];
    const pushBest = (title, list, pick, format) => {
      const eligible = list.filter(pick.filter);
      if (eligible.length === 0) return;
      const best = eligible.sort(pick.sort)[0];
      awards.push({ title, nickname: best.nickname, detail: format(best) });
    };

    pushBest(
      'Dito più veloce',
      all,
      { filter: (s) => s.correct > 0 && s.fastestMs !== null, sort: (a, b) => a.fastestMs - b.fastestMs },
      (s) => `Risposta esatta più rapida: ${(s.fastestMs / 1000).toFixed(2)}s`
    );

    pushBest(
      'Cecchino',
      all,
      { filter: (s) => s.answered >= 3, sort: (a, b) => (b.correct / b.answered) - (a.correct / a.answered) },
      (s) => `${s.correct} giuste su ${s.answered} (${Math.round((s.correct / s.answered) * 100)}%)`
    );

    pushBest(
      'Mano pesante',
      all,
      { filter: (s) => s.wrong > 0, sort: (a, b) => b.wrong - a.wrong },
      (s) => `${s.wrong} risposte sbagliate`
    );

    pushBest(
      'Mister punti',
      all,
      { filter: (s) => s.pointsGained > 0, sort: (a, b) => b.pointsGained - a.pointsGained },
      (s) => `${s.pointsGained} punti raccolti in totale`
    );

    pushBest(
      'Il pensatore',
      all,
      { filter: (s) => s.answered >= 3, sort: (a, b) => (b.totalMs / b.answered) - (a.totalMs / a.answered) },
      (s) => `Tempo medio di risposta: ${(s.totalMs / s.answered / 1000).toFixed(2)}s`
    );

    pushBest(
      'Colto in flagrante',
      all,
      { filter: (s) => s.timedOut > 0, sort: (a, b) => b.timedOut - a.timedOut },
      (s) => `${s.timedOut} volte senza rispondere in tempo`
    );

    return awards;
  }

  submitAnswer(socketId, answerIndex) {
    if (!this.acceptingAnswers) return;
    if (this.currentAnswers.has(socketId)) return;
    const player = this.players.get(socketId);
    if (!player || !player.connected) return;
    // Durante la fase a eliminazione rispondono solo i giocatori ancora in vita.
    if (this.state === 'elimination' && this.activeCompetitorIds && !this.activeCompetitorIds.has(socketId)) return;
    const elapsedMs = Date.now() - this.questionStartTs;
    this.currentAnswers.set(socketId, { answerIndex, elapsedMs: Math.max(0, elapsedMs) });
    if (this._answerWatcher) this._answerWatcher();
  }

  // Aspetta che tutti gli id in `eligibleIds` abbiano risposto, oppure che scada `timeoutMs`:
  // la domanda si chiude appena tutti hanno risposto, senza aspettare il tempo residuo.
  // Chi abbandona la partita mentre la domanda è in corso non viene più aspettato.
  waitForAnswers(eligibleIds, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this._answerWatcher = null;
        clearTimeout(timer);
        resolve();
      };
      this._answerWatcher = () => {
        const stillPending = eligibleIds.filter((id) => {
          const p = this.players.get(id);
          if (!p || !p.connected || p.leftMatch) return false;
          return !this.currentAnswers.has(id);
        });
        if (stillPending.length === 0) finish();
      };
      const timer = setTimeout(finish, timeoutMs);
      this._answerWatcher();
    });
  }

  // ---- Gestione del pulsante "Pronto" tra una domanda e l'altra ----------
  resetReadyTracking() {
    this.readyPlayers = new Set();
  }

  // Chi deve cliccare "Pronto": tutti i giocatori collegati che NON hanno abbandonato
  // questa partita (chi esce dalla partita non blocca più gli altri).
  get requiredReadyIds() {
    return this.playerList.filter((p) => p.connected && !p.leftMatch).map((p) => p.id);
  }

  readyStatusPayload() {
    return { ready: this.readyPlayers.size, total: this.requiredReadyIds.length };
  }

  markReady(socketId) {
    const player = this.players.get(socketId);
    if (!player || !player.connected) return;
    this.readyPlayers.add(socketId);
    if (this._readyWatcher) this._readyWatcher();
  }

  // Il giocatore abbandona la partita in corso ma resta nella sessione (potrà rientrare
  // nella prossima partita, se il presentatore ne avvia una). Non deve più cliccare "Pronto"
  // né rispondere alle domande per il resto di questa partita.
  leaveMatch(socketId) {
    const player = this.players.get(socketId);
    if (!player) return false;
    player.leftMatch = true;
    this.notifyReadyWatcher();
    if (this._answerWatcher) this._answerWatcher();
    return true;
  }

  // Chiamato anche alla disconnessione di un giocatore, così non si resta bloccati ad
  // aspettare il "pronto" di qualcuno che se n'è appena andato.
  notifyReadyWatcher() {
    if (this._readyWatcher) this._readyWatcher();
  }

  waitForReady(io, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this._readyWatcher = null;
        clearTimeout(timer);
        resolve();
      };
      this._readyWatcher = () => {
        io.to(this.code).emit('game:readyStatus', this.readyStatusPayload());
        const requiredIds = this.requiredReadyIds;
        if (requiredIds.length > 0 && requiredIds.every((id) => this.readyPlayers.has(id))) finish();
        if (requiredIds.length === 0) finish(); // nessuno resta da aspettare
      };
      const timer = setTimeout(finish, timeoutMs);
      this._readyWatcher();
    });
  }

  // Emette le battute del presentatore una dopo l'altra, con una piccola pausa tra la prima
  // e la seconda (se presente), così restano leggibili entrambe.
  async emitHostMessages(io, messages) {
    for (let i = 0; i < messages.length; i++) {
      io.to(this.code).emit('host:say', messages[i]);
      if (i < messages.length - 1) await wait(HOST_BEAT_GAP_MS);
    }
  }

  // Sceglie UN giocatore tra chi ha risposto male (o non ha risposto) e costruisce una battuta
  // specifica su quella risposta: usa una battuta scritta a mano per quella domanda se esiste
  // (question.wrongRoasts), altrimenti ricade su un modello generico che cita comunque la
  // risposta sbagliata data. Se nessuno ha sbagliato attivamente, prova con chi non ha risposto.
  buildWrongRoast(question, wrongActiveIds, timedOutIds, ctx) {
    const pool = wrongActiveIds.length ? wrongActiveIds : timedOutIds;
    if (!pool.length) return null;
    const victimId = pool[Math.floor(Math.random() * pool.length)];
    const victim = this.players.get(victimId);
    if (!victim) return null;

    if (wrongActiveIds.includes(victimId)) {
      const entry = this.currentAnswers.get(victimId);
      const wrongText = question.answers[entry.answerIndex];
      const curated = question.wrongRoasts && question.wrongRoasts[wrongText];
      if (curated) {
        return { text: curated.split('{name}').join(victim.nickname), mood: 'evil' };
      }
      return host.say('wrongSpecific', { name: victim.nickname, answer: wrongText }, ctx);
    }
    return host.say('timeout', { name: victim.nickname }, ctx);
  }

  // ---- Ciclo principale di UNA partita -----------------------------------
  async run(io) {
    this.state = 'phase1';
    io.to(this.code).emit('host:say', host.say('welcome', {}, { mode: this.hostMode }));
    await wait(1200);

    // Da seconda partita in poi, il presentatore prende in giro chi comanda/è ultimo in classifica di sessione.
    if (this.matchNumber > 1) {
      const board = this.sessionScoreboard();
      if (board.length >= 2 && board[0].sessionScore !== board[board.length - 1].sessionScore) {
        const leader = board[0];
        const last = board[board.length - 1];
        const line = Math.random() < 0.5
          ? host.say('sessionLeaderRoast', { name: leader.nickname }, { mode: this.hostMode })
          : host.say('sessionLastRoast', { name: last.nickname }, { mode: this.hostMode });
        io.to(this.code).emit('host:say', line);
        await wait(2500);
      }
    }

    // Modalità "solo brainfighting": si salta fase 1 e fase a eliminazione, si va dritti ai
    // problemi col pulsante buzz tra tutti i giocatori collegati.
    if (this.mode === 'brainfight') {
      const participants = this.playerList.filter((p) => p.connected && !p.leftMatch).map((p) => p.id);
      if (participants.length < 2) {
        // Con un solo giocatore non ha senso una gara al buzz: vince direttamente.
        await this.finish(io, participants);
        return;
      }
      this.state = 'elimination';
      const result = await this.runBrainfighting(io, participants);
      const others = participants.filter((id) => id !== result.winnerId);
      others.sort((a, b) => (result.scores.get(b) || 0) - (result.scores.get(a) || 0));
      await this.finish(io, [result.winnerId, ...others].filter(Boolean));
      return;
    }

    for (let i = 0; i < PHASE1_QUESTIONS; i++) {
      this.phase1Index = i;
      await this.askQuestion(io, {
        index: i,
        total: PHASE1_QUESTIONS,
        difficulty: this.difficulty,
        category: this.categories,
        scoringMode: this.mode,
        phase: 'phase1',
      });
      await wait(READY_PRE_DELAY_MS);
      await this.waitForReady(io, READY_TIMEOUT_MS);
    }

    await this.finishPhase1AndStartElimination(io);
  }

  async askQuestion(io, { index, total, difficulty, category, scoringMode, phase, activeIds = null }) {
    let question = questionBank.pickQuestions({
      count: 1,
      difficulty,
      category,
      excludeIds: this.usedQuestionIds,
    })[0];
    if (!question) {
      // Mazzo esaurito per questa sessione (categoria/difficoltà scelte troppo di nicchia
      // per il numero di domande già fatte): ricicla e riprova, piuttosto che bloccare la partita.
      this.usedQuestionIds = new Set();
      question = questionBank.pickQuestions({
        count: 1,
        difficulty,
        category,
        excludeIds: this.usedQuestionIds,
      })[0];
    }
    if (!question) return null; // davvero nessuna domanda disponibile per questa categoria
    this.usedQuestionIds.add(question.id);
    this.currentQuestion = question;
    this.currentAnswers = new Map();
    this.acceptingAnswers = true;
    this.questionStartTs = Date.now();
    this.activeCompetitorIds = activeIds; // null = tutti i giocatori collegati possono rispondere

    const eligibleIds = activeIds ? [...activeIds] : this.playerList.filter((p) => p.connected && !p.leftMatch).map((p) => p.id);

    io.to(this.code).emit('host:say', host.say('questionIntro', {}, { category: question.category, mode: this.hostMode }));
    io.to(this.code).emit('game:question', {
      phase,
      matchNumber: this.matchNumber,
      index,
      total,
      id: question.id,
      category: question.category,
      difficulty: question.difficulty,
      text: question.text,
      answers: question.answers,
      timeLimitMs: QUESTION_TIME_MS,
      startTs: Date.now(),
      eligibleIds: [...eligibleIds], // lista esplicita, mai null: riflette anche chi ha abbandonato la partita
    });

    await this.waitForAnswers(eligibleIds, QUESTION_TIME_MS);
    this.acceptingAnswers = false;

    const result = this.resolveQuestion(scoringMode, question, activeIds);
    io.to(this.code).emit('game:questionResult', {
      phase,
      correctIndex: question.correctIndex,
      correctText: question.answers[question.correctIndex],
      results: result.perPlayer,
      scoreboard: this.scoreboard(),
    });

    this.resetReadyTracking();
    io.to(this.code).emit('game:readyStatus', this.readyStatusPayload());
    await this.emitHostMessages(io, result.hostMessages);
    return result;
  }

  resolveQuestion(scoringMode, question, activeIds) {
    const eligibleIds = activeIds ? [...activeIds] : this.playerList.filter((p) => p.connected && !p.leftMatch).map((p) => p.id);

    // Classifica PRIMA di applicare il punteggio di questa domanda: serve per rilevare un
    // cambio di leader e la "sorpresa" quando l'ultimo in classifica risponde giusto.
    const boardBefore = eligibleIds
      .map((id) => this.players.get(id))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    const answered = eligibleIds.map((id) => ({ id, entry: this.currentAnswers.get(id) }));
    const correctAnswers = answered
      .filter((a) => a.entry && a.entry.answerIndex === question.correctIndex)
      .sort((a, b) => a.entry.elapsedMs - b.entry.elapsedMs);

    const pointsForRank = [3, 2, 1]; // dal 4 posto in poi: 0 punti (comunque risposta corretta)
    const perPlayer = [];
    let fastestCorrectName = null;
    let anyCorrect = correctAnswers.length > 0;
    const wrongActiveIds = [];
    const timedOutIds = [];

    for (const id of eligibleIds) {
      const player = this.players.get(id);
      if (!player) continue;
      const entry = this.currentAnswers.get(id);
      let points = 0;
      let correct = false;
      let answerIndex = entry ? entry.answerIndex : null;

      if (entry && entry.answerIndex === question.correctIndex) {
        correct = true;
        if (scoringMode === 'rush') {
          const rank = correctAnswers.findIndex((c) => c.id === id);
          points = rank >= 0 && rank < pointsForRank.length ? pointsForRank[rank] : 0;
          if (rank === 0) fastestCorrectName = player.nickname;
        } else {
          points = 2; // modalità classica: stesso valore per tutti, entro il limite di tempo
        }
      } else if (entry) {
        points = -1;
        wrongActiveIds.push(id);
      } else {
        points = 0; // nessuna risposta data in tempo
        timedOutIds.push(id);
      }

      player.score += points;
      perPlayer.push({
        id,
        nickname: player.nickname,
        answerIndex,
        correct,
        points,
        elapsedMs: entry ? entry.elapsedMs : null,
      });

      // Accumula le statistiche di sessione per il riepilogo di fine serata.
      const st = this.sessionStats.get(player.nickname) || {
        nickname: player.nickname,
        answered: 0,
        correct: 0,
        wrong: 0,
        timedOut: 0,
        totalMs: 0,
        fastestMs: null,
        pointsGained: 0,
        pointsLost: 0,
      };
      if (entry) {
        st.answered++;
        st.totalMs += entry.elapsedMs;
        if (st.fastestMs === null || entry.elapsedMs < st.fastestMs) st.fastestMs = entry.elapsedMs;
        if (correct) st.correct++; else st.wrong++;
      } else {
        st.timedOut++;
      }
      if (points > 0) st.pointsGained += points;
      if (points < 0) st.pointsLost += -points;
      this.sessionStats.set(player.nickname, st);
    }

    const ctx = { category: question.category, mode: this.hostMode };
    const messages = [];

    if (!anyCorrect) {
      messages.push(host.say('everyoneWrong', {}, ctx));
    } else if (correctAnswers.length === eligibleIds.length) {
      messages.push(host.say('everyoneRight', {}, ctx));
    } else {
      // Risultati misti: prima la lode a chi ha risposto meglio, poi la stoccata mirata a chi
      // ha sbagliato (una battuta specifica sulla sua risposta, non un commento generico).
      if (scoringMode === 'rush' && fastestCorrectName) {
        messages.push(host.say('correctFast', { name: fastestCorrectName }, ctx));
      } else {
        const last = correctAnswers[correctAnswers.length - 1];
        const p = this.players.get(last.id);
        messages.push(host.say('correctSlow', { name: p ? p.nickname : 'qualcuno' }, ctx));
      }
      const roast = this.buildWrongRoast(question, wrongActiveIds, timedOutIds, ctx);
      if (roast) messages.push(roast);
    }

    // Annuncio cambio leader (se qualcuno ha appena scavalcato il primo in classifica):
    // sostituisce la prima battuta (la "lode"), lasciando intatta l'eventuale stoccata.
    const boardAfter = eligibleIds
      .map((id) => this.players.get(id))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    const newLeader = boardAfter[0];
    if (newLeader && this.previousLeaderId && newLeader.id !== this.previousLeaderId) {
      messages[0] = host.say('leaderChange', { name: newLeader.nickname }, ctx);
    }
    if (newLeader) this.previousLeaderId = newLeader.id;

    // Sorpresa: chi era ultimo PRIMA di questa domanda risponde giusto — capita solo a volte,
    // per non essere ripetitiva. Sostituisce la prima battuta.
    let surpriseUsed = false;
    if (eligibleIds.length >= 3 && boardBefore.length >= 2) {
      const lastBefore = boardBefore[boardBefore.length - 1];
      const firstBefore = boardBefore[0];
      if (lastBefore && firstBefore && lastBefore.id !== firstBefore.id) {
        const lastAnsweredCorrectly = correctAnswers.some((c) => c.id === lastBefore.id);
        if (lastAnsweredCorrectly && Math.random() < 0.4) {
          messages[0] = host.say('lastPlaceSurprise', { name: lastBefore.nickname }, ctx);
          surpriseUsed = true;
        }
      }
    }

    // Presa in giro "di classifica" dell'ultimo posto (indipendente da questa domanda),
    // solo se non è già scattata la sorpresa qui sopra (sarebbero contraddittorie insieme).
    if (!surpriseUsed && eligibleIds.length >= 3 && Math.random() < 0.3) {
      const last = boardAfter[boardAfter.length - 1];
      const first = boardAfter[0];
      if (last && first && last.id !== first.id) {
        messages[0] = host.say('lastPlaceRoast', { name: last.nickname }, ctx);
      }
    }

    return { perPlayer, hostMessages: messages };
  }

  async finishPhase1AndStartElimination(io) {
    const standings = this.scoreboard().filter((p) => p.connected);
    const n = standings.length;
    const qualifiersCount = Math.min(n, Math.max(2, Math.ceil(n / 2)));
    const qualifiers = standings.slice(0, qualifiersCount);
    const nonQualified = standings.slice(qualifiersCount);

    for (const p of this.playerList) {
      p.qualified = qualifiers.some((q) => q.id === p.id);
      if (!p.qualified) p.eliminated = true;
    }

    io.to(this.code).emit('phase1:end', {
      standings,
      qualifiers: qualifiers.map((q) => q.id),
    });
    io.to(this.code).emit('host:say', host.say('phase1End', {}, { mode: this.hostMode }));
    await wait(BIG_PAUSE_MS);

    const nonQualifiedIds = nonQualified.map((p) => p.id);

    if (qualifiers.length < 2) {
      // Non ci sono abbastanza giocatori collegati per una fase a eliminazione: dichiariamo vincitore diretto.
      const finalOrder = [...qualifiers.map((q) => q.id), ...nonQualifiedIds];
      await this.finish(io, finalOrder);
      return;
    }

    this.state = 'elimination';
    io.to(this.code).emit('host:say', host.say('tournamentStart', {}, { mode: this.hostMode }));
    io.to(this.code).emit('elimination:start', {
      qualifiers: qualifiers.map((q) => ({ id: q.id, nickname: q.nickname })),
    });
    await wait(2000);

    const eliminationOrder = await this.runElimination(io, qualifiers.map((q) => q.id));
    const finalOrder = [...eliminationOrder, ...nonQualifiedIds];
    await this.finish(io, finalOrder);
  }

  // Pesca una domanda per la fase a eliminazione. Il pool si "ricicla" se esaurito, così la fase
  // può proseguire teoricamente all'infinito finché non resta un solo sopravvissuto.
  pickEliminationQuestion(difficulty) {
    let question = questionBank.pickQuestions({
      count: 1,
      difficulty,
      category: this.categories,
      excludeIds: this.eliminationUsedIds,
    })[0];
    if (!question) {
      this.eliminationUsedIds = new Set();
      question = questionBank.pickQuestions({
        count: 1,
        difficulty,
        category: this.categories,
        excludeIds: this.eliminationUsedIds,
      })[0];
    }
    if (question) this.eliminationUsedIds.add(question.id);
    return question;
  }

  // Fase a eliminazione "ad oltranza": stessa domanda per tutti i sopravvissuti, chi sbaglia è
  // eliminato. Se sbagliano tutti, nessuno viene eliminato e si continua. Dura finché non resta
  // un solo giocatore che non ha mai sbagliato in questa fase.
  async runElimination(io, qualifierIdsOrdered) {
    // NOTA: eliminationUsedIds NON viene azzerato qui apposta, per lo stesso motivo di
    // usedQuestionIds: le domande non devono ripetersi nella stessa sessione, non solo nella
    // singola partita (il riciclo avviene solo se il mazzo si esaurisce davvero, in pickEliminationQuestion).
    let active = qualifierIdsOrdered.slice();
    const eliminatedRounds = []; // array di array di id, un elemento per round in cui è avvenuta un'eliminazione
    let roundIndex = 0;
    let goToBrainfighting = false;
    const SAFETY_MAX_ROUNDS = 500; // rete di sicurezza anti-loop reale, non un limite di gioco

    while (active.length > 1 && roundIndex < SAFETY_MAX_ROUNDS) {
      // Chi ha abbandonato la partita o si è disconnesso prima di questo round viene trattato
      // come eliminato ora: non deve bloccare il gioco né restare "attivo" senza poter rispondere.
      const droppedOut = active.filter((id) => {
        const p = this.players.get(id);
        return !p || !p.connected || p.leftMatch;
      });
      if (droppedOut.length) {
        active = active.filter((id) => !droppedOut.includes(id));
        eliminatedRounds.push(droppedOut);
      }
      if (active.length <= 1) break; // resta un solo giocatore (o zero) dopo aver tolto chi è uscito

      // Dopo un certo numero di round, se restano ancora 2+ superstiti, si passa al brainfighting
      // (calcoli a mente col pulsante buzz) invece di continuare all'infinito con le stesse domande.
      if (roundIndex >= BRAINFIGHT_TRIGGER_ROUNDS) {
        goToBrainfighting = true;
        break;
      }

      const difficulty = roundDifficulty(this.difficulty, roundIndex);
      const question = this.pickEliminationQuestion(difficulty);
      if (!question) break;

      this.currentQuestion = question;
      this.currentAnswers = new Map();
      this.acceptingAnswers = true;
      this.questionStartTs = Date.now();
      this.activeCompetitorIds = new Set(active);

      io.to(this.code).emit('host:say', host.say('eliminationRoundIntro', {}, { category: question.category, mode: this.hostMode }));
      io.to(this.code).emit('game:question', {
        phase: 'elimination',
        index: roundIndex,
        total: null,
        id: question.id,
        category: question.category,
        difficulty: question.difficulty,
        text: question.text,
        answers: question.answers,
        timeLimitMs: QUESTION_TIME_MS,
        startTs: Date.now(),
        eligibleIds: [...active],
        remainingCount: active.length,
      });

      await this.waitForAnswers(active, QUESTION_TIME_MS);
      this.acceptingAnswers = false;

      const correctIds = [];
      const wrongIds = [];
      for (const id of active) {
        const entry = this.currentAnswers.get(id);
        if (entry && entry.answerIndex === question.correctIndex) correctIds.push(id);
        else wrongIds.push(id);
      }

      io.to(this.code).emit('game:questionResult', {
        phase: 'elimination',
        correctIndex: question.correctIndex,
        correctText: question.answers[question.correctIndex],
        results: active.map((id) => {
          const p = this.players.get(id);
          const entry = this.currentAnswers.get(id);
          return {
            id,
            nickname: p ? p.nickname : '???',
            answerIndex: entry ? entry.answerIndex : null,
            correct: entry ? entry.answerIndex === question.correctIndex : false,
            elapsedMs: entry ? entry.elapsedMs : null,
          };
        }),
      });

      const elimMessages = [];
      let eliminatedNow = [];
      const elimCtx = { category: question.category, mode: this.hostMode };
      if (wrongIds.length === 0) {
        // Tutti giusti: nessuna eliminazione, si continua con lo stesso gruppo e domande più difficili.
        elimMessages.push(host.say('eliminationAllRightContinue', {}, elimCtx));
      } else if (wrongIds.length === active.length) {
        // Tutti sbagliano: per regola nessuno viene eliminato, si va avanti comunque.
        elimMessages.push(host.say('eliminationAllWrongContinue', {}, elimCtx));
      } else {
        for (const id of wrongIds) {
          const p = this.players.get(id);
          if (p) {
            p.eliminated = true;
            p.eliminationRound = roundIndex;
          }
        }
        eliminatedRounds.push(wrongIds);
        eliminatedNow = wrongIds;
        const names = wrongIds.map((id) => this.players.get(id)?.nickname || '???').join(', ');
        elimMessages.push(host.say('eliminationSomeOut', { names }, elimCtx));

        // Battuta specifica su UNO degli eliminati e la sua risposta sbagliata.
        const timedOutNow = wrongIds.filter((id) => !this.currentAnswers.get(id));
        const wrongActiveNow = wrongIds.filter((id) => this.currentAnswers.get(id));
        const roast = this.buildWrongRoast(question, wrongActiveNow, timedOutNow, elimCtx);
        if (roast) elimMessages.push(roast);

        active = correctIds;
      }

      io.to(this.code).emit('elimination:status', {
        round: roundIndex + 1,
        difficulty,
        active: active.map((id) => ({ id, nickname: this.players.get(id)?.nickname || '???' })),
        eliminatedNow: eliminatedNow.map((id) => ({ id, nickname: this.players.get(id)?.nickname || '???' })),
      });

      this.resetReadyTracking();
      io.to(this.code).emit('game:readyStatus', this.readyStatusPayload());
      await this.emitHostMessages(io, elimMessages);

      roundIndex++;
      await wait(READY_PRE_DELAY_MS);
      await this.waitForReady(io, READY_TIMEOUT_MS);
    }

    let winnerId = active[0] || null;
    let brainfightScores = null;

    if (goToBrainfighting && active.length > 1) {
      const result = await this.runBrainfighting(io, active);
      winnerId = result.winnerId;
      brainfightScores = result.scores;
    }

    // Ordine finale: vincitore, poi (se si è passati al brainfighting) gli altri partecipanti
    // ordinati per punti fatti lì, poi gli eliminati dal round più recente al più vecchio
    // (pareggio nello stesso round spezzato in base al punteggio di Fase 1).
    const finalOrder = [];
    if (winnerId) finalOrder.push(winnerId);
    if (goToBrainfighting && active.length > 1) {
      const runnersUp = active.filter((id) => id !== winnerId);
      runnersUp.sort((a, b) => {
        const sa = brainfightScores ? brainfightScores.get(a) || 0 : 0;
        const sb = brainfightScores ? brainfightScores.get(b) || 0 : 0;
        if (sb !== sa) return sb - sa;
        return (this.players.get(b)?.score || 0) - (this.players.get(a)?.score || 0);
      });
      finalOrder.push(...runnersUp);
    }
    for (let i = eliminatedRounds.length - 1; i >= 0; i--) {
      const group = eliminatedRounds[i].slice().sort((a, b) => {
        const pa = this.players.get(a)?.score || 0;
        const pb = this.players.get(b)?.score || 0;
        return pb - pa;
      });
      finalOrder.push(...group);
    }
    // In casi limite (rete di sicurezza) potrebbe restare più di un giocatore attivo senza essere
    // passati dal brainfighting: li mettiamo comunque in cima, ordinati per punteggio.
    if (!goToBrainfighting && active.length > 1) {
      finalOrder.length = 0;
      finalOrder.push(...active.sort((a, b) => (this.players.get(b)?.score || 0) - (this.players.get(a)?.score || 0)));
      for (let i = eliminatedRounds.length - 1; i >= 0; i--) finalOrder.push(...eliminatedRounds[i]);
    }

    if (winnerId && !goToBrainfighting) {
      const champion = this.players.get(winnerId);
      io.to(this.code).emit('host:say', host.say('eliminationChampion', { name: champion ? champion.nickname : 'il vincitore' }, { mode: this.hostMode }));
      await wait(2500);
    }

    return finalOrder;
  }

  // Pesca un problema di brainfighting. Se le categorie scelte per la stanza non hanno
  // contenuto brainfighting, si ricade sulle categorie disponibili (gestito da BrainfightingBank).
  // Come per il resto del gioco, non si ripete mai nella stessa sessione finché il mazzo non
  // si esaurisce davvero.
  pickBrainfightingQuestion(difficulty) {
    let question = brainfightingBank.pickQuestion({
      difficulty,
      category: this.categories,
      excludeIds: this.brainfightingUsedIds,
    });
    if (!question) {
      this.brainfightingUsedIds = new Set();
      question = brainfightingBank.pickQuestion({
        difficulty,
        category: this.categories,
        excludeIds: this.brainfightingUsedIds,
      });
    }
    if (question) this.brainfightingUsedIds.add(question.id);
    return question;
  }

  // Aspetta che uno dei giocatori idonei prema il pulsante "buzz", oppure che scada `timeoutMs`.
  waitForBuzz(eligibleIds, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (winnerId) => {
        if (settled) return;
        settled = true;
        this._buzzWatcher = null;
        clearTimeout(timer);
        resolve(winnerId || null);
      };
      this._buzzWatcher = (socketId) => {
        if (eligibleIds.includes(socketId)) finish(socketId);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
    });
  }

  // Chiamato quando un giocatore preme il pulsante "buzz". Vince chi arriva primo: le
  // pressioni successive, o quelle di chi non è idoneo in questo momento, vengono ignorate.
  buzz(socketId) {
    if (this.acceptingBuzz && this._buzzWatcher) this._buzzWatcher(socketId);
  }

  // Aspetta che il giocatore che si è prenotato scelga una risposta, oppure che scada `timeoutMs`.
  waitForBrainfightAnswer(buzzerId, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (answerIndex) => {
        if (settled) return;
        settled = true;
        this._bfAnswerWatcher = null;
        clearTimeout(timer);
        resolve(answerIndex === undefined || answerIndex === null ? null : answerIndex);
      };
      this._bfAnswerWatcher = (socketId, answerIndex) => {
        if (socketId === buzzerId) finish(answerIndex);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
    });
  }

  // Chiamato quando il giocatore prenotato sceglie una delle opzioni mostrate.
  submitBrainfightAnswer(socketId, answerIndex) {
    if (this.buzzedPlayerId === socketId && this._bfAnswerWatcher) this._bfAnswerWatcher(socketId, answerIndex);
  }

  // Gestisce UN problema di brainfighting: prenotazione, rivelazione delle opzioni, esito.
  // Se chi si prenota sbaglia, non può più riprovarci su questo stesso problema (ma potrà sul
  // prossimo) e la sua opzione sparisce per chi si prenota dopo di lui. Se sbagliano in 3, o non
  // resta più nessuno idoneo a riprovarci, si passa a un problema nuovo senza assegnare punti.
  async runBrainfightProblem(io, question, participantIds, scores) {
    let remainingAnswers = [...question.answers];
    const correctText = question.answers[question.correctIndex];
    const failedThisProblem = new Set();
    let wrongCount = 0;
    const ctx = { category: question.category, mode: this.hostMode };

    const scoreList = () =>
      participantIds.map((id) => ({ id, nickname: this.players.get(id)?.nickname || '???', score: scores.get(id) || 0 }));

    while (true) {
      const eligibleToBuzz = participantIds.filter((id) => {
        const p = this.players.get(id);
        return p && p.connected && !p.leftMatch && !failedThisProblem.has(id);
      });

      if (eligibleToBuzz.length === 0 || wrongCount >= BRAINFIGHT_MAX_WRONG_PER_PROBLEM) {
        await this.emitHostMessages(io, [host.say('brainfightAllWrongThisProblem', {}, ctx)]);
        await wait(1500);
        return { winnerId: null };
      }

      this.acceptingBuzz = true;
      this.buzzedPlayerId = null;
      io.to(this.code).emit('brainfight:waitBuzz', {
        category: question.category,
        difficulty: question.difficulty,
        text: question.text,
        optionsRemaining: remainingAnswers.length,
        eligibleIds: eligibleToBuzz,
        timeLimitMs: BUZZ_TIME_MS,
        scores: scoreList(),
        needsCalculator: CALC_CATEGORIES.has(question.category),
      });

      const buzzerId = await this.waitForBuzz(eligibleToBuzz, BUZZ_TIME_MS);
      this.acceptingBuzz = false;

      if (!buzzerId) {
        await this.emitHostMessages(io, [host.say('brainfightNobodyBuzzed', {}, ctx)]);
        await wait(1500);
        return { winnerId: null };
      }

      this.buzzedPlayerId = buzzerId;
      const buzzerNickname = this.players.get(buzzerId)?.nickname || '???';
      io.to(this.code).emit('brainfight:buzzed', {
        playerId: buzzerId,
        nickname: buzzerNickname,
        answers: remainingAnswers,
        text: question.text,
        answerTimeMs: BRAINFIGHT_ANSWER_LOCK_MS,
      });

      const answerIndex = await this.waitForBrainfightAnswer(buzzerId, BRAINFIGHT_ANSWER_LOCK_MS);
      const pickedText = answerIndex !== null ? remainingAnswers[answerIndex] : null;
      const isCorrect = pickedText === correctText;

      if (isCorrect) {
        const newScore = (scores.get(buzzerId) || 0) + 1;
        scores.set(buzzerId, newScore);
        io.to(this.code).emit('brainfight:result', {
          playerId: buzzerId,
          nickname: buzzerNickname,
          correct: true,
          correctText,
          pickedText,
          scores: scoreList(),
        });
        await this.emitHostMessages(io, [host.say('brainfightCorrect', { name: buzzerNickname }, ctx)]);
        if (newScore >= BRAINFIGHT_WINNING_SCORE) return { winnerId: buzzerId };
        return { winnerId: null };
      }

      wrongCount++;
      failedThisProblem.add(buzzerId);
      if (pickedText) remainingAnswers = remainingAnswers.filter((a) => a !== pickedText);
      io.to(this.code).emit('brainfight:result', {
        playerId: buzzerId,
        nickname: buzzerNickname,
        correct: false,
        pickedText,
        optionsRemaining: remainingAnswers.length,
        scores: scoreList(),
      });

      let wrongMessage;
      if (pickedText && question.wrongRoasts && question.wrongRoasts[pickedText]) {
        wrongMessage = { text: question.wrongRoasts[pickedText].split('{name}').join(buzzerNickname), mood: 'evil' };
      } else if (pickedText) {
        wrongMessage = host.say('wrongSpecific', { name: buzzerNickname, answer: pickedText }, ctx);
      } else {
        wrongMessage = host.say('brainfightWrong', { name: buzzerNickname }, ctx);
      }
      await this.emitHostMessages(io, [wrongMessage]);
      // il ciclo continua: si torna al buzz per gli altri idonei, con un'opzione in meno
    }
  }

  // Gestisce UNA sfida a griglia 2x2: nessun buzz, tutti giocano insieme e vince il punto
  // chi completa per primo tutte e 4 le caselle con risposte valide.
  async runGridChallenge(io, grid, participantIds, scores) {
    this.currentGrid = grid;
    this.gridProgress = new Map(participantIds.map((id) => [id, { filled: new Map(), done: false }]));

    const scoreList = () =>
      participantIds.map((id) => ({ id, nickname: this.players.get(id)?.nickname || '???', score: scores.get(id) || 0 }));

    io.to(this.code).emit('grid:start', {
      category: grid.category,
      rows: grid.rows.map((r) => r.label),
      cols: grid.cols.map((c) => c.label),
      // Elenco completo dei nomi noti per l'autocomplete: NON rivela quali siano le soluzioni.
      suggestions: gridGame.allSubjectNames(grid.datasetKey),
      timeLimitMs: GRID_TIME_MS,
      scores: scoreList(),
    });

    const winnerId = await new Promise((resolve) => {
      let settled = false;
      const finish = (id) => {
        if (settled) return;
        settled = true;
        this._gridWatcher = null;
        clearTimeout(timer);
        resolve(id || null);
      };
      this._gridWatcher = (socketId) => {
        const prog = this.gridProgress.get(socketId);
        if (prog && prog.filled.size === 4) finish(socketId);
      };
      const timer = setTimeout(() => finish(null), GRID_TIME_MS);
    });

    this.currentGrid = null;
    const ctx = { category: grid.category, mode: this.hostMode };

    if (!winnerId) {
      io.to(this.code).emit('grid:end', { winnerId: null, nickname: null, scores: scoreList() });
      await this.emitHostMessages(io, [host.say('gridNobodyFinished', {}, ctx)]);
      await wait(1500);
      return { winnerId: null };
    }

    const newScore = (scores.get(winnerId) || 0) + 1;
    scores.set(winnerId, newScore);
    const nickname = this.players.get(winnerId)?.nickname || '???';
    io.to(this.code).emit('grid:end', { winnerId, nickname, scores: scoreList() });
    await this.emitHostMessages(io, [host.say('gridWinner', { name: nickname }, ctx)]);
    if (newScore >= BRAINFIGHT_WINNING_SCORE) return { winnerId };
    return { winnerId: null };
  }

  // Chiamato quando un giocatore prova a riempire una casella della griglia.
  // Restituisce l'esito al singolo giocatore tramite callback.
  submitGridAnswer(socketId, cellIndex, answer, cb) {
    if (!this.currentGrid) return cb && cb({ error: 'Nessuna griglia in corso' });
    const prog = this.gridProgress.get(socketId);
    if (!prog || prog.done) return cb && cb({ error: 'Non stai partecipando a questa griglia' });
    if (typeof cellIndex !== 'number' || cellIndex < 0 || cellIndex > 3) return cb && cb({ error: 'Casella non valida' });
    if (prog.filled.has(cellIndex)) return cb && cb({ error: 'Casella già completata' });

    const cell = this.currentGrid.cells[cellIndex];
    const canonical = gridGame.checkAnswer(this.currentGrid.datasetKey, cell.row, cell.col, answer);

    if (!canonical) {
      // Si può riprovare all'infinito sulla stessa casella: nessuna penalità.
      return cb && cb({ ok: false, cellIndex });
    }

    // Non si può usare lo stesso nome due volte nella stessa griglia.
    if ([...prog.filled.values()].includes(canonical)) {
      return cb && cb({ ok: false, cellIndex, reason: 'duplicato' });
    }

    prog.filled.set(cellIndex, canonical);
    cb && cb({ ok: true, cellIndex, canonical, filled: prog.filled.size });
    if (this._gridWatcher) this._gridWatcher(socketId);
  }

  async runBrainfighting(io, participantIds) {
    const scores = new Map(participantIds.map((id) => [id, 0]));

    io.to(this.code).emit('brainfight:start', {
      participants: participantIds.map((id) => ({ id, nickname: this.players.get(id)?.nickname || '???' })),
      winningScore: BRAINFIGHT_WINNING_SCORE,
    });
    io.to(this.code).emit('host:say', host.say('brainfightingStart', {}, { mode: this.hostMode }));
    await wait(BIG_PAUSE_MS);

    let problemIndex = 0;
    let winnerId = null;
    const SAFETY_MAX_PROBLEMS = 300; // rete di sicurezza anti-loop reale, non un limite di gioco

    while (!winnerId && problemIndex < SAFETY_MAX_PROBLEMS) {
      const connectedParticipants = participantIds.filter((id) => {
        const p = this.players.get(id);
        return p && p.connected && !p.leftMatch;
      });
      if (connectedParticipants.length === 0) break;
      if (connectedParticipants.length === 1) {
        winnerId = connectedParticipants[0];
        break;
      }

      const difficulty = roundDifficulty(this.difficulty, problemIndex);

      // Se la stanza ha scelto categorie che supportano la sfida a griglia (Calcio, F1,
      // Cinema/Serie TV, Geografia), a volte si propone quella invece del problema a buzzer.
      const gridCats = (this.categories.length ? this.categories : gridGame.supportedCategories())
        .filter((c) => gridGame.supportsCategory(c));

      // Le categorie scelte hanno problemi a buzzer nel mazzo brainfighting?
      // Se NON ne hanno (es. una partita di solo Calcio, che ha solo la griglia), la griglia
      // diventa obbligatoria: senza questo, il gioco ripiegherebbe su problemi di tutt'altra
      // categoria (Fisica, Matematica...), tradendo la scelta fatta dai giocatori.
      const bfCats = brainfightingBank.getCategories();
      const hasBuzzProblems = this.categories.length === 0
        ? true
        : this.categories.some((c) => bfCats.includes(c));

      let result = null;
      if (gridCats.length > 0 && (!hasBuzzProblems || Math.random() < GRID_CHANCE)) {
        const cat = gridCats[Math.floor(Math.random() * gridCats.length)];
        const grid = gridGame.generateGrid(cat);
        if (grid) {
          result = await this.runGridChallenge(io, grid, connectedParticipants, scores);
        }
      }

      if (!result) {
        const question = this.pickBrainfightingQuestion(difficulty);
        if (!question) break;
        result = await this.runBrainfightProblem(io, question, connectedParticipants, scores);
      }

      if (result.winnerId) {
        winnerId = result.winnerId;
      } else {
        problemIndex++;
        this.resetReadyTracking();
        io.to(this.code).emit('game:readyStatus', this.readyStatusPayload());
        await wait(READY_PRE_DELAY_MS);
        await this.waitForReady(io, READY_TIMEOUT_MS);
      }
    }

    if (!winnerId) {
      // Rete di sicurezza: se nessuno ha raggiunto il punteggio (es. disconnessioni di massa),
      // vince comunque chi ha il punteggio più alto fatto in questa fase.
      const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
      winnerId = sorted[0] ? sorted[0][0] : participantIds[0] || null;
    }

    if (winnerId) {
      const champion = this.players.get(winnerId);
      io.to(this.code).emit('host:say', host.say('brainfightWinner', { name: champion ? champion.nickname : 'il vincitore' }, { mode: this.hostMode }));
      await wait(2500);
    }

    return { winnerId, scores };
  }

  async finish(io, finalOrder) {
    this.state = 'finished';
    const championId = finalOrder[0] || null;
    const champion = championId ? this.players.get(championId) : null;

    // Assegna il punteggio cumulativo di sessione in base al piazzamento in QUESTA partita.
    finalOrder.forEach((id, idx) => {
      const player = this.players.get(id);
      if (!player) return;
      const awarded = SESSION_POINTS[idx] || 0;
      const prev = this.sessionScores.get(player.nickname) || 0;
      this.sessionScores.set(player.nickname, prev + awarded);
    });

    const sessionBoard = this.sessionScoreboard();

    io.to(this.code).emit('host:say', champion ? host.say('finalWinner', { name: champion.nickname }, { mode: this.hostMode }) : { text: 'Partita conclusa!', mood: 'neutral' });

    io.to(this.code).emit('game:final', {
      matchNumber: this.matchNumber,
      championId,
      championName: champion ? champion.nickname : null,
      standings: finalOrder.map((id, idx) => {
        const p = this.players.get(id);
        return {
          id,
          nickname: p ? p.nickname : '???',
          score: p ? p.score : 0,
          placement: idx + 1,
          sessionPointsAwarded: SESSION_POINTS[idx] || 0,
        };
      }),
      sessionBoard,
      sessionAwards: this.sessionAwards(),
    });
  }

  // Avvia una nuova partita nella stessa stanza, mantenendo la classifica di sessione accumulata.
  // NOTA: usedQuestionIds/eliminationUsedIds NON vengono azzerati qui apposta: le domande non
  // devono ripetersi mai nella stessa sessione, solo tra partite diverse della stessa stanza.
  startNextMatch(io) {
    if (this.state !== 'finished') return false;
    this.matchNumber += 1;
    this.phase1Index = 0;
    this.previousLeaderId = null;
    for (const p of this.playerList) {
      p.score = 0;
      p.eliminated = false;
      p.qualified = false;
      p.eliminationRound = null;
      p.leftMatch = false;
    }
    this.state = 'lobby';
    this.run(io).catch((err) => {
      console.error('Errore durante la partita', this.code, err);
      io.to(this.code).emit('error', { message: 'Si è verificato un errore nella partita.' });
    });
    return true;
  }
}

module.exports = { GameRoom, roundDifficulty };
