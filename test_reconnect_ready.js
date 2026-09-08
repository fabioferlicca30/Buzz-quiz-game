// Test di GameRoom senza avviare il server: `io` è finto e registra ciò che verrebbe inviato.
// Copre le due correzioni: chi deve premere "Pronto" e cosa succede a chi rientra.
const { GameRoom } = require('./server/lib/GameRoom');

function fakeIo() {
  const sent = [];
  return {
    sent,
    to(target) {
      return { emit: (name, payload) => sent.push({ target, name, payload }) };
    },
    for(target) {
      return sent.filter((e) => e.target === target);
    },
  };
}

function room(nicks) {
  const r = new GameRoom('TEST', 'sock-' + nicks[0], {});
  nicks.forEach((n, i) => r.addPlayer('sock-' + n, n));
  return r;
}

let failed = 0;
const check = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) failed++;
};

// ---- 1. Il "Pronto" riguarda solo chi è in gara ---------------------------
{
  const r = room(['ada', 'bruno', 'clara']);
  check(r.requiredReadyIds.length === 3, 'in fase 1 devono premere Pronto tutti e tre');

  // Clara viene eliminata: da qui in poi è spettatrice.
  r.activeCompetitorIds = new Set(['sock-ada', 'sock-bruno']);
  check(r.requiredReadyIds.length === 2, 'dopo un\'eliminazione si aspettano solo i due superstiti');
  check(r.isSpectator(r.players.get('sock-clara')), 'chi è fuori risulta spettatore');

  r.markReady('sock-clara');
  check(r.readyPlayers.size === 0, 'il clic di uno spettatore non viene conteggiato');

  r.markReady('sock-ada');
  r.markReady('sock-bruno');
  const st = r.readyStatusPayload();
  check(st.ready === 2 && st.total === 2, 'con i due superstiti pronti il conteggio è 2/2');
  check(!st.requiredIds.includes('sock-clara'), 'il client non riceve lo spettatore tra chi deve premere');

  // Chi abbandona la partita non blocca comunque nessuno.
  const r2 = room(['ada', 'bruno']);
  r2.players.get('sock-bruno').leftMatch = true;
  check(r2.requiredReadyIds.length === 1, 'chi ha abbandonato la partita non viene atteso');
}

// ---- 2. Il rientro sposta OGNI riferimento al vecchio socket --------------
{
  const r = room(['ada', 'bruno']);
  const eligible = ['sock-ada', 'sock-bruno']; // riferimento vivo, come lo tiene la fase in corso
  r.currentEligibleIds = eligible;
  r.activeCompetitorIds = new Set(['sock-ada', 'sock-bruno']);
  r.bfParticipantIds = ['sock-ada', 'sock-bruno'];
  r.bfScores = new Map([['sock-ada', 2], ['sock-bruno', 1]]);
  r.readyPlayers.add('sock-ada');
  r.currentAnswers.set('sock-ada', { answerIndex: 2, elapsedMs: 900 });
  r.gridProgress.set('sock-ada', { filled: new Map([[0, 'Zidane']]), done: false });
  r.buzzedPlayerId = 'sock-ada';
  r.rememberStep('game:question', { eligibleIds: ['sock-ada', 'sock-bruno'] }, 10000);

  r.players.get('sock-ada').connected = false; // caduta di connessione
  const back = r.reconnectPlayer('sock-NUOVA', 'ada');

  check(Boolean(back), 'il posto viene recuperato dal nickname');
  check(r.players.has('sock-NUOVA') && !r.players.has('sock-ada'), 'la scheda è sul socket nuovo');
  check(eligible.includes('sock-NUOVA'), 'l\'elenco di chi è atteso sulla domanda è aggiornato SUL POSTO');
  check(!eligible.includes('sock-ada'), 'il socket morto non resta tra chi è atteso');
  check(r.activeCompetitorIds.has('sock-NUOVA'), 'resta tra i concorrenti attivi');
  check(r.bfParticipantIds.includes('sock-NUOVA'), 'resta tra i partecipanti al brainfighting');
  check(r.bfScores.get('sock-NUOVA') === 2, 'i punti del brainfighting lo seguono');
  check(r.readyPlayers.has('sock-NUOVA'), 'il "Pronto" già dato non va perso');
  check(r.currentAnswers.get('sock-NUOVA').answerIndex === 2, 'la risposta già data non va persa');
  check(r.gridProgress.get('sock-NUOVA').filled.get(0) === 'Zidane', 'le caselle di griglia lo seguono');
  check(r.buzzedPlayerId === 'sock-NUOVA', 'la prenotazione al buzz lo segue');
  check(r.resumeStep[0].payload.eligibleIds.includes('sock-NUOVA'), 'l\'evento conservato è riscritto col nuovo id');
  check(r.hostSocketId === 'sock-NUOVA', 'il ruolo di presentatore lo segue');
}

// ---- 3. Browser chiuso di colpo: il posto risulta ancora "collegato" ------
{
  const r = room(['ada', 'bruno']);
  // La disconnessione non è ancora arrivata: per il server ada è ancora online.
  check(r.players.get('sock-ada').connected === true, 'premessa: il posto risulta ancora occupato');
  const senza = r.reconnectPlayer('sock-X', 'ada');
  check(senza === null, 'senza sapere quali socket sono vivi il posto non si tocca');

  const isLive = (id) => id !== 'sock-ada'; // il vecchio socket in realtà è morto
  const con = r.reconnectPlayer('sock-X', 'ada', isLive);
  check(Boolean(con), 'sapendo che il socket è morto, il posto viene recuperato');
  check(r.players.get('sock-X').nickname === 'ada', 'ed è la scheda giusta');
}

// ---- 4. Ripristino della schermata --------------------------------------
{
  const r = room(['ada', 'bruno']);
  r.state = 'phase1';
  r.acceptingAnswers = true;
  r.currentEligibleIds = ['sock-ada', 'sock-bruno'];
  r.rememberStep('game:question', { text: 'Domanda?', answers: ['a', 'b', 'c', 'd'], timeLimitMs: 10000 }, 10000);
  r.resumeStep[0].ts = Date.now() - 4000; // sono passati 4 secondi
  r.currentAnswers.set('sock-ada', { answerIndex: 1, elapsedMs: 500 });

  const io = fakeIo();
  r.resumeFor(io, 'sock-ada');
  const mine = io.for('sock-ada');
  const q = mine.find((e) => e.name === 'game:question');

  check(mine[0].name === 'game:resume', 'il rientro comincia con game:resume');
  check(Boolean(q), 'la domanda in corso viene rimandata a chi rientra');
  check(q.payload.timeLimitMs > 5000 && q.payload.timeLimitMs <= 6000, 'il timer riparte dal tempo che resta davvero, non da capo');
  check(q.payload.frozen === false, 'con la domanda ancora aperta si può rispondere');
  check(q.payload.yourAnswerIndex === 1, 'la risposta già data torna evidenziata');
  check(mine[mine.length - 1].name === 'game:readyStatus', 'e si chiude con lo stato della pausa');

  // Stessa scena, ma la domanda si è chiusa nel frattempo.
  r.acceptingAnswers = false;
  r.appendStep('game:questionResult', { correctIndex: 0 });
  const io2 = fakeIo();
  r.resumeFor(io2, 'sock-ada');
  const q2 = io2.for('sock-ada').find((e) => e.name === 'game:question');
  check(q2.payload.frozen === true && q2.payload.timeLimitMs === 0, 'a domanda chiusa la si vede congelata, senza timer');
  check(io2.for('sock-ada').some((e) => e.name === 'game:questionResult'), 'e si vede anche l\'esito, con il pulsante Pronto');
}

// ---- 5. Lo spettatore che rientra non trova niente da premere ------------
{
  const r = room(['ada', 'bruno']);
  r.state = 'elimination';
  r.activeCompetitorIds = new Set(['sock-bruno']); // ada è stata eliminata
  const io = fakeIo();
  r.resumeFor(io, 'sock-ada');
  const resume = io.for('sock-ada').find((e) => e.name === 'game:resume');
  const ready = io.for('sock-ada').find((e) => e.name === 'game:readyStatus');
  check(resume.payload.spectator === true, 'chi rientra da eliminato viene marcato spettatore');
  check(!ready.payload.requiredIds.includes('sock-ada'), 'e non compare tra chi deve premere Pronto');

  // Ma se nel frattempo parte una partita nuova, torna giocatore.
  r.state = 'finished';
  r.startNextMatch({ to: () => ({ emit: () => {} }) });
  check(r.activeCompetitorIds === null, 'con la partita nuova nessuno è più spettatore');
  check(r.requiredReadyIds.length === 2, 'e tutti tornano a dover premere Pronto');
}

console.log(failed ? `\n${failed} test falliti` : '\nTutti i test verdi');
process.exit(failed ? 1 : 0);
