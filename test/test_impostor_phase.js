// Gioca manche intere della modalità impostore con un `io` finto: nessun server, nessun
// socket, ma il vero svolgimento della fase. Serve soprattutto a verificare due cose che a
// occhio non si vedono: che la parola segreta non finisca mai in un evento di stanza, e che
// le manche non ripetano mai una parola.
const { GameRoom } = require('../server/lib/GameRoom');
const imp = require('../server/lib/ImpostorGame');

let failed = 0;
const check = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) failed++;
};

// `io` finto: registra ogni invio, distinguendo quelli di stanza da quelli a un singolo socket.
function fakeIo(roomCode) {
  const room = [];
  const direct = new Map();
  return {
    room,
    direct,
    to(target) {
      return {
        emit: (name, payload) => {
          if (target === roomCode) room.push({ name, payload });
          else {
            if (!direct.has(target)) direct.set(target, []);
            direct.get(target).push({ name, payload });
          }
        },
      };
    },
  };
}

function makeRoom(nicks, settings = {}) {
  const r = new GameRoom('TEST', 'sock-' + nicks[0], { mode: 'impostor', ...settings });
  nicks.forEach((n) => r.addPlayer('sock-' + n, n));
  // Tempi ridotti al minimo: una manche vera durerebbe minuti, e qui ne giochiamo dodici.
  r.impostorTimings = { word: 400, vote: 400, rps: 300, guess: 400, reveal: 5, intro: 5 };
  return r;
}

const NICKS = ['ada', 'bruno', 'clara', 'dino', 'elsa'];
const IDS = NICKS.map((n) => 'sock-' + n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Guida una manche dall'esterno: sorveglia la fase in corso e risponde come farebbero i
// giocatori. `strategy` decide chi accusano tutti; `guess` se l'impostore, una volta scoperto,
// azzecca la parola.
async function playManche(room, io, { strategy = 'accusaImpostore', guess = null } = {}) {
  let finita = null;
  const done = room.runImpostorManche(io, 1, 3).then((r) => { finita = r; return r; });

  let parolaN = 0;
  let votato = false;
  for (let tick = 0; tick < 4000 && !finita; tick++) {
    const round = room.impostorRound;
    if (round) {
      if (round.phase === 'words' && round.currentPlayerId) {
        room.submitImpostorWord(round.currentPlayerId, 'parola' + (parolaN++), () => {});
      } else if (round.phase === 'vote' && !votato) {
        const innocente = IDS.find((id) => id !== round.impostorId);
        const bersaglio = strategy === 'accusaImpostore' ? round.impostorId : innocente;
        for (const id of IDS) room.submitImpostorVote(id, bersaglio, () => {});
        votato = true;
      } else if (round.phase === 'rps') {
        for (const id of round.tiedPlayers) room.submitImpostorThrow(id, 'sasso', () => {});
      } else if (round.phase === 'guess' && round.guess === null) {
        room.submitImpostorGuess(round.impostorId, guess === 'giusta' ? round.word : 'sbagliatissima', () => {});
      }
    }
    await sleep(2);
  }
  return done;
}

(async () => {
  // ---- 1. Manche completa: impostore scoperto ----------------------------
  {
    const room = makeRoom(NICKS);
    const io = fakeIo('TEST');
    const round = await playManche(room, io, { strategy: 'accusaImpostore' });

    check(Boolean(round), 'la manche arriva in fondo da sola');
    check(round.submissions.length === IDS.length * imp.ROUNDS_PER_MATCH, `sono state consegnate tutte le ${IDS.length * imp.ROUNDS_PER_MATCH} parole (3 giri x 5 giocatori)`);

    const result = io.room.find((e) => e.name === 'impostor:mancheResult');
    check(result.payload.outcome === 'impostorCaught', 'accusando l\'impostore, l\'esito è "scoperto"');
    check(result.payload.accusedId === round.impostorId, 'e l\'accusato è proprio lui');

    const votanti = IDS.filter((id) => id !== round.impostorId);
    check(votanti.every((id) => room.players.get(id).score === 1), 'chi lo ha votato prende un punto');
    check(room.players.get(round.impostorId).score === 0, 'l\'impostore che ha votato se stesso resta a zero');
  }

  // ---- 2. La parola segreta non deve MAI passare per la stanza -----------
  {
    const room = makeRoom(NICKS);
    const io = fakeIo('TEST');
    const round = await playManche(room, io, { strategy: 'accusaInnocente' });

    // Tutto quello che la stanza ha ricevuto PRIMA dell'esito finale.
    const fineManche = io.room.findIndex((e) => e.name === 'impostor:mancheResult');
    const primaDellEsito = JSON.stringify(io.room.slice(0, fineManche));
    check(!primaDellEsito.includes(round.word), 'la parola segreta non compare in nessun evento di stanza prima dell\'esito');
    check(!primaDellEsito.includes('"impostorId"'), 'e nemmeno l\'identità dell\'impostore');

    // Il ruolo, invece, deve essere arrivato a ciascuno sul proprio socket.
    const ruoli = IDS.map((id) => (io.direct.get(id) || []).find((e) => e.name === 'impostor:role'));
    check(ruoli.every(Boolean), 'ogni giocatore riceve il proprio ruolo sul suo socket');
    const impostori = ruoli.filter((r) => r.payload.isImpostor);
    check(impostori.length === 1, 'e uno solo risulta impostore');
    check(impostori[0].payload.word === null && Boolean(impostori[0].payload.clue), 'l\'impostore riceve l\'indizio, non la parola');
    check(ruoli.filter((r) => !r.payload.isImpostor).every((r) => r.payload.word === round.word), 'gli altri ricevono la parola vera');

    const result = io.room.find((e) => e.name === 'impostor:mancheResult');
    check(result.payload.outcome === 'impostorEscaped', 'accusando un innocente, l\'impostore la scampa');
    check(room.players.get(round.impostorId).score === 1, 'e il punto è solo suo');
  }

  // ---- 3. Impostore scoperto che indovina la parola ----------------------
  {
    const room = makeRoom(NICKS);
    const io = fakeIo('TEST');
    const round = await playManche(room, io, { strategy: 'accusaImpostore', guess: 'giusta' });
    const result = io.room.find((e) => e.name === 'impostor:mancheResult');

    check(result.payload.outcome === 'impostorGuessed', 'indovinando la parola ribalta la manche');
    check(room.players.get(round.impostorId).score === 1, 'il punto va a lui');
    check(IDS.filter((id) => id !== round.impostorId).every((id) => room.players.get(id).score === 0), 'e tutti gli altri restano a zero');
  }

  // ---- 4. Niente parole ripetute nella sessione --------------------------
  {
    const room = makeRoom(NICKS);
    const uscite = [];
    for (let manche = 0; manche < 12; manche++) {
      const io = fakeIo('TEST');
      const round = await playManche(room, io, { strategy: 'accusaInnocente' });
      uscite.push(round.word);
    }
    check(new Set(uscite).size === uscite.length, `${uscite.length} manche di seguito senza mai ripetere una parola`);
    check(room.impostorUsedWords.size === uscite.length, 'la stanza tiene memoria di tutte quelle già uscite');

    // E il ruolo gira, senza però diventare prevedibile: in 12 manche su 5 giocatori nessuno
    // deve essere rimasto a zero, e nessuno deve averlo fatto troppe volte.
    const volte = IDS.map((id) => room.impostorTimesAsImpostor.get(id) || 0);
    check(volte.every((v) => v > 0), 'in dodici manche il ruolo tocca a tutti almeno una volta');
    check(Math.max(...volte) <= 5, `e a nessuno più di ${Math.max(...volte)} volte`);
  }

  // ---- 4b. Il turno passa appena la parola arriva ------------------------
  {
    const room = makeRoom(NICKS);
    // Tetto di 5 secondi per turno: se il gioco aspettasse la scadenza invece di reagire alla
    // consegna, i 15 turni ci metterebbero oltre un minuto e questo test lo scoprirebbe.
    room.impostorTimings = { word: 5000, vote: 200, rps: 200, guess: 200, reveal: 5, intro: 5 };
    const io = fakeIo('TEST');

    const inizio = Date.now();
    await playManche(room, io, { strategy: 'accusaInnocente' });
    const durata = Date.now() - inizio;

    const turni = IDS.length * imp.ROUNDS_PER_MATCH;
    check(durata < turni * 500, `i ${turni} turni si sono chiusi in ${durata}ms invece dei ${turni * 5000}ms di tetto: il turno passa alla consegna, non alla scadenza`);
  }

  // ---- 5. Sotto i cinque giocatori la modalità non parte -----------------
  {
    const room = makeRoom(['ada', 'bruno', 'clara']);
    const io = fakeIo('TEST');
    await room.runImpostorMode(io);
    check(io.room.some((e) => e.name === 'impostor:tooFew'), 'con tre giocatori la modalità avvisa invece di partire');
    check(room.state === 'finished', 'e la partita si chiude subito');
  }

  console.log(failed ? `\n${failed} test falliti` : '\nTutti i test verdi');
  process.exit(failed ? 1 : 0);
})();
