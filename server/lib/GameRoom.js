const questionBank = require('./QuestionBank');
const host = require('./Host');

const PHASE1_QUESTIONS = 10;
const QUESTION_TIME_MS = 10000;
const RESULT_PAUSE_MS = 4500;
const BIG_PAUSE_MS = 6000;
const DIFFICULTY_ORDER = ['facile', 'medio', 'difficile'];
const SESSION_POINTS = [1000, 500, 250]; // 1°, 2°, 3° posto di ogni partita; dal 4° in poi: 0 punti sessione

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
    this.mode = settings.mode === 'classic' ? 'classic' : 'rush'; // 'rush' | 'classic'
    this.difficulty = settings.difficulty || 'misto'; // facile|medio|difficile|misto
    this.category = settings.category || 'tutte';
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
    });
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
      category: this.category,
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

  submitAnswer(socketId, answerIndex) {
    if (!this.acceptingAnswers) return;
    if (this.currentAnswers.has(socketId)) return;
    const player = this.players.get(socketId);
    if (!player || !player.connected) return;
    // Durante la fase a eliminazione rispondono solo i giocatori ancora in vita.
    if (this.state === 'elimination' && this.activeCompetitorIds && !this.activeCompetitorIds.has(socketId)) return;
    const elapsedMs = Date.now() - this.questionStartTs;
    this.currentAnswers.set(socketId, { answerIndex, elapsedMs: Math.max(0, elapsedMs) });
  }

  // ---- Ciclo principale di UNA partita -----------------------------------
  async run(io) {
    this.state = 'phase1';
    io.to(this.code).emit('host:say', host.say('welcome'));
    await wait(1200);

    // Da seconda partita in poi, il presentatore prende in giro chi comanda/è ultimo in classifica di sessione.
    if (this.matchNumber > 1) {
      const board = this.sessionScoreboard();
      if (board.length >= 2 && board[0].sessionScore !== board[board.length - 1].sessionScore) {
        const leader = board[0];
        const last = board[board.length - 1];
        const line = Math.random() < 0.5
          ? host.say('sessionLeaderRoast', { name: leader.nickname })
          : host.say('sessionLastRoast', { name: last.nickname });
        io.to(this.code).emit('host:say', line);
        await wait(2500);
      }
    }

    for (let i = 0; i < PHASE1_QUESTIONS; i++) {
      this.phase1Index = i;
      await this.askQuestion(io, {
        index: i,
        total: PHASE1_QUESTIONS,
        difficulty: this.difficulty,
        category: this.category,
        scoringMode: this.mode,
        phase: 'phase1',
      });
      await wait(RESULT_PAUSE_MS);
    }

    await this.finishPhase1AndStartElimination(io);
  }

  async askQuestion(io, { index, total, difficulty, category, scoringMode, phase, activeIds = null }) {
    const question = questionBank.pickQuestions({
      count: 1,
      difficulty,
      category,
      excludeIds: this.usedQuestionIds,
    })[0];
    if (!question) return null; // non dovrebbe succedere con >300 domande disponibili
    this.usedQuestionIds.add(question.id);
    this.currentQuestion = question;
    this.currentAnswers = new Map();
    this.acceptingAnswers = true;
    this.questionStartTs = Date.now();
    this.activeCompetitorIds = activeIds; // null = tutti i giocatori collegati possono rispondere

    io.to(this.code).emit('host:say', host.say('questionIntro'));
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
      eligibleIds: activeIds ? [...activeIds] : null,
    });

    await wait(QUESTION_TIME_MS);
    this.acceptingAnswers = false;

    const result = this.resolveQuestion(scoringMode, question, activeIds);
    io.to(this.code).emit('game:questionResult', {
      phase,
      correctIndex: question.correctIndex,
      correctText: question.answers[question.correctIndex],
      results: result.perPlayer,
      scoreboard: this.scoreboard(),
    });
    io.to(this.code).emit('host:say', result.hostMessage);
    return result;
  }

  resolveQuestion(scoringMode, question, activeIds) {
    const eligibleIds = activeIds ? [...activeIds] : this.playerList.filter((p) => p.connected).map((p) => p.id);
    const answered = eligibleIds.map((id) => ({ id, entry: this.currentAnswers.get(id) }));

    const correctAnswers = answered
      .filter((a) => a.entry && a.entry.answerIndex === question.correctIndex)
      .sort((a, b) => a.entry.elapsedMs - b.entry.elapsedMs);

    const pointsForRank = [3, 2, 1]; // dal 4 posto in poi: 0 punti (comunque risposta corretta)
    const perPlayer = [];
    let fastestCorrectName = null;
    let anyCorrect = correctAnswers.length > 0;
    let anyWrong = false;

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
        anyWrong = true;
      } else {
        points = 0; // nessuna risposta data in tempo
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
    }

    let hostMessage;
    if (!anyCorrect) {
      hostMessage = host.say('everyoneWrong');
    } else if (!anyWrong && correctAnswers.length === eligibleIds.length) {
      hostMessage = host.say('everyoneRight');
    } else if (scoringMode === 'rush' && fastestCorrectName) {
      hostMessage = host.say('correctFast', { name: fastestCorrectName });
    } else if (correctAnswers.length > 0) {
      const last = correctAnswers[correctAnswers.length - 1];
      const p = this.players.get(last.id);
      hostMessage = host.say('correctSlow', { name: p ? p.nickname : 'qualcuno' });
    } else {
      hostMessage = host.say('wrong', { name: 'tutti' });
    }

    // Annuncio cambio leader (se qualcuno ha appena scavalcato il primo in classifica).
    const board = eligibleIds
      .map((id) => this.players.get(id))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    const newLeader = board[0];
    if (newLeader && this.previousLeaderId && newLeader.id !== this.previousLeaderId) {
      hostMessage = host.say('leaderChange', { name: newLeader.nickname });
    }
    if (newLeader) this.previousLeaderId = newLeader.id;

    // Ogni tanto il presentatore si diverte a prendere in giro chi è ultimo in classifica.
    if (eligibleIds.length >= 3 && Math.random() < 0.3) {
      const last = board[board.length - 1];
      const first = board[0];
      if (last && first && last.id !== first.id) {
        hostMessage = host.say('lastPlaceRoast', { name: last.nickname });
      }
    }

    return { perPlayer, hostMessage };
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
    io.to(this.code).emit('host:say', host.say('phase1End'));
    await wait(BIG_PAUSE_MS);

    const nonQualifiedIds = nonQualified.map((p) => p.id);

    if (qualifiers.length < 2) {
      // Non ci sono abbastanza giocatori collegati per una fase a eliminazione: dichiariamo vincitore diretto.
      const finalOrder = [...qualifiers.map((q) => q.id), ...nonQualifiedIds];
      await this.finish(io, finalOrder);
      return;
    }

    this.state = 'elimination';
    io.to(this.code).emit('host:say', host.say('tournamentStart'));
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
      category: this.category,
      excludeIds: this.eliminationUsedIds,
    })[0];
    if (!question) {
      this.eliminationUsedIds = new Set();
      question = questionBank.pickQuestions({
        count: 1,
        difficulty,
        category: this.category,
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
    this.eliminationUsedIds = new Set();
    let active = qualifierIdsOrdered.slice();
    const eliminatedRounds = []; // array di array di id, un elemento per round in cui è avvenuta un'eliminazione
    let roundIndex = 0;
    const SAFETY_MAX_ROUNDS = 500; // rete di sicurezza anti-loop reale, non un limite di gioco

    while (active.length > 1 && roundIndex < SAFETY_MAX_ROUNDS) {
      const difficulty = roundDifficulty(this.difficulty, roundIndex);
      const question = this.pickEliminationQuestion(difficulty);
      if (!question) break;

      this.currentQuestion = question;
      this.currentAnswers = new Map();
      this.acceptingAnswers = true;
      this.questionStartTs = Date.now();
      this.activeCompetitorIds = new Set(active);

      io.to(this.code).emit('host:say', host.say('eliminationRoundIntro'));
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

      await wait(QUESTION_TIME_MS);
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

      let hostMessage;
      let eliminatedNow = [];
      if (wrongIds.length === 0) {
        // Tutti giusti: nessuna eliminazione, si continua con lo stesso gruppo e domande più difficili.
        hostMessage = host.say('eliminationAllRightContinue');
      } else if (wrongIds.length === active.length) {
        // Tutti sbagliano: per regola nessuno viene eliminato, si va avanti comunque.
        hostMessage = host.say('eliminationAllWrongContinue');
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
        hostMessage = host.say('eliminationSomeOut', { names });
        active = correctIds;
      }

      io.to(this.code).emit('host:say', hostMessage);
      io.to(this.code).emit('elimination:status', {
        round: roundIndex + 1,
        difficulty,
        active: active.map((id) => ({ id, nickname: this.players.get(id)?.nickname || '???' })),
        eliminatedNow: eliminatedNow.map((id) => ({ id, nickname: this.players.get(id)?.nickname || '???' })),
      });

      roundIndex++;
      await wait(RESULT_PAUSE_MS);
    }

    const winnerId = active[0] || null;

    // Ordine finale: vincitore, poi gli eliminati dal round più recente al più vecchio
    // (pareggio nello stesso round spezzato in base al punteggio di Fase 1).
    const finalOrder = [];
    if (winnerId) finalOrder.push(winnerId);
    for (let i = eliminatedRounds.length - 1; i >= 0; i--) {
      const group = eliminatedRounds[i].slice().sort((a, b) => {
        const pa = this.players.get(a)?.score || 0;
        const pb = this.players.get(b)?.score || 0;
        return pb - pa;
      });
      finalOrder.push(...group);
    }
    // In casi limite (rete di sicurezza) potrebbe restare più di un giocatore attivo: li mettiamo
    // comunque in cima, ordinati per punteggio.
    if (active.length > 1) {
      finalOrder.length = 0;
      finalOrder.push(...active.sort((a, b) => (this.players.get(b)?.score || 0) - (this.players.get(a)?.score || 0)));
      for (let i = eliminatedRounds.length - 1; i >= 0; i--) finalOrder.push(...eliminatedRounds[i]);
    }

    if (winnerId) {
      const champion = this.players.get(winnerId);
      io.to(this.code).emit('host:say', host.say('eliminationChampion', { name: champion ? champion.nickname : 'il vincitore' }));
      await wait(2500);
    }

    return finalOrder;
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

    io.to(this.code).emit('host:say', champion ? host.say('finalWinner', { name: champion.nickname }) : { text: 'Partita conclusa!', mood: 'neutral' });

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
    });
  }

  // Avvia una nuova partita nella stessa stanza, mantenendo la classifica di sessione accumulata.
  startNextMatch(io) {
    if (this.state !== 'finished') return false;
    this.matchNumber += 1;
    this.usedQuestionIds = new Set();
    this.eliminationUsedIds = new Set();
    this.phase1Index = 0;
    this.previousLeaderId = null;
    for (const p of this.playerList) {
      p.score = 0;
      p.eliminated = false;
      p.qualified = false;
      p.eliminationRound = null;
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
