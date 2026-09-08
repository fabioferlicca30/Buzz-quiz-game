// Regole della sfida finale: resa sulla griglia, punto a chi completa di più, pareggi,
// e fine fase decisa dai punti (non dal numero di problemi giocati).
const { GameRoom } = require('../server/lib/GameRoom');
const gridGame = require('../server/lib/GridGame');

function fakeIo() {
  const sent = [];
  return { sent, to: () => ({ emit: (name, payload) => sent.push({ name, payload }) }) };
}

function room(nicks, settings = {}) {
  const r = new GameRoom('TEST', 'sock-' + nicks[0], settings);
  nicks.forEach((n) => r.addPlayer('sock-' + n, n));
  return r;
}

let failed = 0;
const check = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) failed++;
};

// ---- 1. Punti per la vittoria configurabili ------------------------------
{
  check(room(['a']).winningScore === 3, 'senza scelta si resta a 3 punti');
  check(room(['a'], { winningScore: 7 }).winningScore === 7, 'la stanza può chiedere 7 punti');
  check(room(['a'], { winningScore: 1 }).winningScore === 1, 'e anche una sfida secca a 1 punto');
  check(room(['a'], { winningScore: 99 }).winningScore === 10, 'valori assurdi vengono riportati nel massimo');
  check(room(['a'], { winningScore: 'boh' }).winningScore === 3, 'un valore non numerico ricade sul default');
  check(room(['a'], { winningScore: 4 }).publicSummary().winningScore === 4, 'il valore compare nel riepilogo della stanza');
}

// ---- 2. Resa sulla griglia ----------------------------------------------
{
  const r = room(['ada', 'bruno']);
  const grid = gridGame.generateGrid('Calcio');
  const io = fakeIo();
  const scores = new Map([['sock-ada', 0], ['sock-bruno', 0]]);
  const running = r.runGridChallenge(io, grid, ['sock-ada', 'sock-bruno'], scores);

  // Ada indovina una casella, poi entrambi si arrendono.
  const solutions = gridGame.solutionsFor(grid.datasetKey, grid.cells[0].row, grid.cells[0].col);
  r.submitGridAnswer('sock-ada', 0, solutions[0], () => {});
  check(r.gridProgress.get('sock-ada').filled.size === 1, 'la risposta giusta riempie la casella');

  r.giveUpGrid('sock-ada', () => {});
  check(r.gridGiveUpStatus().gaveUp === 1, 'la resa viene registrata');

  let bloccato = null;
  r.submitGridAnswer('sock-ada', 1, solutions[0], (res) => { bloccato = res; });
  check(Boolean(bloccato && bloccato.error), 'dopo la resa non si possono più riempire caselle');

  r.giveUpGrid('sock-bruno', () => {});
  return running.then((res) => {
    check(res.winnerIds.length === 1 && res.winnerIds[0] === 'sock-ada', 'arresi tutti, il punto va a chi aveva completato di più');
    check(scores.get('sock-ada') === 1 && scores.get('sock-bruno') === 0, 'e il punteggio lo registra');

    const end = io.sent.find((e) => e.name === 'grid:end');
    check(Boolean(end), 'la griglia si chiude senza aspettare il tempo');
    check(end.payload.solutions.length === 4, 'a fine griglia arrivano le soluzioni di tutte e quattro le caselle');
    check(end.payload.solutions.every((s) => Array.isArray(s) && s.length > 0), 'ogni casella ha almeno una risposta valida da mostrare');
    check(end.payload.results.find((x) => x.id === 'sock-ada').gaveUp === true, 'l\'esito dice chi si è arreso');
    return next();
  });
}

function next() {
  // ---- 3. Pareggio: il punto lo prendono tutti ---------------------------
  const r = room(['ada', 'bruno', 'clara']);
  const grid = gridGame.generateGrid('Calcio');
  const io = fakeIo();
  const ids = ['sock-ada', 'sock-bruno', 'sock-clara'];
  const scores = new Map(ids.map((id) => [id, 0]));
  const running = r.runGridChallenge(io, grid, ids, scores);

  const solFor = (i) => gridGame.solutionsFor(grid.datasetKey, grid.cells[i].row, grid.cells[i].col)[0];
  r.submitGridAnswer('sock-ada', 0, solFor(0), () => {});
  r.submitGridAnswer('sock-bruno', 1, solFor(1), () => {});
  // Clara non completa niente.
  ids.forEach((id) => r.giveUpGrid(id, () => {}));

  return running.then((res) => {
    check(res.winnerIds.length === 2, 'a parità di caselle il punto va a tutti i pari merito');
    check(scores.get('sock-ada') === 1 && scores.get('sock-bruno') === 1, 'entrambi guadagnano il punto');
    check(scores.get('sock-clara') === 0, 'chi non ha completato niente resta a zero');
    return nobodyCase();
  });
}

function nobodyCase() {
  // ---- 4. Griglia in bianco: nessun punto -------------------------------
  const r = room(['ada', 'bruno']);
  const grid = gridGame.generateGrid('Calcio');
  const io = fakeIo();
  const ids = ['sock-ada', 'sock-bruno'];
  const scores = new Map(ids.map((id) => [id, 0]));
  const running = r.runGridChallenge(io, grid, ids, scores);
  ids.forEach((id) => r.giveUpGrid(id, () => {}));

  return running.then((res) => {
    check(res.winnerIds.length === 0, 'se nessuno completa una casella il punto non lo prende nessuno');
    check(scores.get('sock-ada') === 0 && scores.get('sock-bruno') === 0, 'i punteggi restano fermi');

    const end = io.sent.find((e) => e.name === 'grid:end');
    check(end.payload.solutions.every((s) => s.length > 0), 'le soluzioni si vedono comunque: è il momento in cui si impara');
    finale();
  });
}

function finale() {
  // ---- 5. La fase finisce sui punti, non sul numero di problemi ---------
  // Riproduco la condizione di fine fase così com'è scritta in runBrainfighting.
  const decided = (scoreMap, target) => {
    let best = -1;
    let leaders = [];
    for (const [id, s] of scoreMap) {
      if (s > best) { best = s; leaders = [id]; } else if (s === best) leaders.push(id);
    }
    return best >= target && leaders.length === 1 ? leaders[0] : null;
  };

  check(decided(new Map([['a', 1], ['b', 1]]), 3) === null, 'dopo due problemi vinti uno a testa non finisce niente');
  check(decided(new Map([['a', 2], ['b', 1]]), 3) === null, 'nemmeno dopo tre problemi, se nessuno è arrivato a 3');
  check(decided(new Map([['a', 3], ['b', 1]]), 3) === 'a', 'finisce quando uno arriva davvero a 3 punti');
  check(decided(new Map([['a', 3], ['b', 3]]), 3) === null, 'a pari punti sul traguardo si continua a oltranza, non si sorteggia');
  check(decided(new Map([['a', 4], ['b', 3]]), 3) === 'a', 'e si chiude appena uno stacca l\'altro');
  check(decided(new Map([['a', 1], ['b', 0]]), 1) === 'a', 'con il traguardo a 1 basta un punto');

  console.log(failed ? `\n${failed} test falliti` : '\nTutti i test verdi');
  process.exit(failed ? 1 : 0);
}
