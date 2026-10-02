// Modalità "Impostore".
//
// Tutti ricevono la stessa parola segreta tranne uno, che riceve solo un indizio della stessa
// famiglia. Per tre giri ognuno, a turno, consegna una parola che deve dimostrare di conoscere
// quella segreta senza rivelarla. Poi si vota. Se la maggioranza indovina chi è l'impostore,
// chi ha votato giusto prende un punto; altrimenti il punto è dell'impostore. Se scoperto,
// l'impostore ha un'ultima possibilità: indovinare la parola e ribaltare la manche.
//
// Qui stanno SOLO le regole, senza socket e senza stato di stanza: sono funzioni pure, quindi
// verificabili senza far girare una partita.

const fs = require('fs');
const path = require('path');

const ROUNDS_PER_MATCH = 3; // giri di parole prima del voto
const MIN_PLAYERS = 5; // sotto questa soglia il voto è un lancio di dado

class ImpostorWords {
  constructor() {
    const file = path.join(__dirname, '..', 'data', 'impostorwords.json');
    this.pairs = JSON.parse(fs.readFileSync(file, 'utf8')).pairs || [];
  }

  themes() {
    return [...new Set(this.pairs.map((p) => p.theme))];
  }

  // Pesca una coppia parola/indizio mai uscita nella sessione. Con 400 coppie il caso non si
  // presenta quasi mai, ma se davvero finiscono si ricomincia da capo: meglio una ripetizione
  // dopo centinaia di manche che una partita che si pianta.
  pick(usedWords = new Set(), themes = []) {
    const pool = themes.length ? this.pairs.filter((p) => themes.includes(p.theme)) : this.pairs;
    const source = pool.length ? pool : this.pairs;
    const fresh = source.filter((p) => !usedWords.has(p.word));
    const from = fresh.length ? fresh : source;
    return { pair: from[Math.floor(Math.random() * from.length)] || null, recycled: fresh.length === 0 };
  }
}

// ---- Normalizzazione -------------------------------------------------------

// Minuscolo, senza accenti, senza punteggiatura. È la forma su cui si confrontano le parole.
function normalize(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

// Confronto tollerante per il tentativo finale dell'impostore: chi ha capito che la parola è
// "leone" non deve perdere la manche per aver scritto "Leoni". Si tronca la vocale finale, ma
// solo su parole abbastanza lunghe, altrimenti "pizzo" e "pizza" diventerebbero la stessa cosa.
function looseStem(s) {
  const n = normalize(s);
  return n.length >= 5 ? n.replace(/[aeio]$/, '') : n;
}

function sameWord(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return looseStem(a) === looseStem(b) && looseStem(a).length >= 4;
}

// ---- Parole consegnate -----------------------------------------------------

// Controlla la parola che un giocatore vuole consegnare. Non si può dire la parola segreta,
// né ripetere una già detta da chiunque, né consegnare una frase.
// NOTA: le forme derivate ("cucina" -> "cucinare") non sono bloccabili in modo affidabile.
// Dal vivo le arbitrano le persone, e qui resta così.
function validateSubmission(input, { secretWord, usedWords = [] }) {
  const raw = String(input || '').trim();
  if (!raw) return { error: 'Scrivi una parola' };
  if (raw.length > 24) return { error: 'Troppo lunga: una parola sola' };
  if (/\s/.test(raw.trim())) return { error: 'Una parola sola, senza spazi' };

  const n = normalize(raw);
  if (!n) return { error: 'Scrivi una parola vera' };
  if (sameWord(raw, secretWord)) return { error: 'Non puoi dire la parola segreta!' };
  if (usedWords.some((w) => normalize(w) === n)) return { error: 'Parola già detta: trovane un\'altra' };

  return { ok: true, word: raw.trim() };
}

// ---- Ruoli e ordine di gioco ----------------------------------------------

// Sceglie l'impostore. Il ruolo deve girare — se tocca sempre agli stessi la modalità muore —
// ma la scelta non può MAI diventare prevedibile: pescando ogni volta tra chi lo è stato meno
// volte, all'ultima manche resterebbe un solo nome e lo saprebbero tutti prima di cominciare.
// Lo stesso ragionamento, più debole, funziona anche nelle manche di mezzo.
//
// Quindi: sorteggio pesato. Chi lo è stato meno volte è più probabile, ma nessuno è mai certo
// e nessuno è mai escluso. L'unico vincolo secco è non farlo capitare due volte di fila.
function pickImpostor(playerIds, timesAsImpostor = new Map(), previousImpostorId = null, random = Math.random) {
  if (!playerIds.length) return null;
  if (playerIds.length === 1) return playerIds[0];

  let pool = playerIds.filter((id) => id !== previousImpostorId);
  if (!pool.length) pool = playerIds;

  const times = (id) => timesAsImpostor.get(id) || 0;
  const max = Math.max(...pool.map(times));
  // Peso quadratico sulla distanza dal più "usato": chi non lo è mai stato è nettamente
  // favorito, ma chi lo è già stato conserva sempre una possibilità reale.
  const weights = pool.map((id) => Math.pow(max + 1 - times(id), 2));
  const total = weights.reduce((a, b) => a + b, 0);

  let roll = random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// Chi apre cambia a ogni giro: parlare per ultimi, avendo già sentito tutti, è un vantaggio
// enorme, e a rotazione tocca a tutti.
function turnOrder(playerIds, roundIndex) {
  if (!playerIds.length) return [];
  const shift = roundIndex % playerIds.length;
  return [...playerIds.slice(shift), ...playerIds.slice(0, shift)];
}

// ---- Voto ------------------------------------------------------------------

// Conta i voti. Vince chi ne ha di più (maggioranza relativa). Se due o più sono appaiati in
// testa non si decide nulla: serve lo spareggio.
function tallyVotes(votes) {
  const counts = new Map();
  for (const target of votes.values()) {
    if (!target) continue; // astenuto o tempo scaduto
    counts.set(target, (counts.get(target) || 0) + 1);
  }
  if (counts.size === 0) return { accusedId: null, tied: [], counts, noVotes: true };

  const best = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, n]) => n === best).map(([id]) => id);
  return {
    accusedId: tied.length === 1 ? tied[0] : null,
    tied: tied.length > 1 ? tied : [],
    counts,
    noVotes: false,
  };
}

// ---- Spareggio a sasso-carta-forbice ---------------------------------------
//
// A parità di voti decidono i sospettati, non i votanti: i pari merito si sfidano davanti a
// tutti. Si tira tutti insieme; chi tira il simbolo vincente SI SALVA, gli altri restano
// dentro. Si continua finché ne resta uno: quello è l'accusato. Perdere significa finire sotto
// accusa, che è il verso giusto per la scena.

const RPS_SYMBOLS = ['sasso', 'carta', 'forbice'];
const RPS_MAX_ROUNDS = 8; // tetto anti-stallo: senza, in teoria si pareggia all'infinito

// sasso spacca forbice, forbice taglia carta, carta avvolge sasso.
function rpsBeats(a, b) {
  return (a === 'sasso' && b === 'forbice')
    || (a === 'forbice' && b === 'carta')
    || (a === 'carta' && b === 'sasso');
}

function randomSymbol(random = Math.random) {
  return RPS_SYMBOLS[Math.floor(random() * RPS_SYMBOLS.length)];
}

// Un singolo giro di morra tra i giocatori ancora dentro.
// - due simboli diversi -> chi ha il vincente si salva, gli altri proseguono
// - un solo simbolo, o tutti e tre -> nessuno si salva, si ritira
function resolveRpsRound(throws) {
  const entries = [...throws.entries()].filter(([, sym]) => RPS_SYMBOLS.includes(sym));
  if (entries.length < 2) return { decided: false, safeIds: [], stillIn: entries.map(([id]) => id) };

  const symbols = [...new Set(entries.map(([, sym]) => sym))];
  if (symbols.length !== 2) {
    // Tutti lo stesso simbolo, oppure tutti e tre in campo: nessuno prevale.
    return { decided: false, safeIds: [], stillIn: entries.map(([id]) => id) };
  }

  const [x, y] = symbols;
  const winning = rpsBeats(x, y) ? x : y;
  return {
    decided: true,
    winningSymbol: winning,
    safeIds: entries.filter(([, sym]) => sym === winning).map(([id]) => id),
    stillIn: entries.filter(([, sym]) => sym !== winning).map(([id]) => id),
  };
}

// Chi non tira entro il tempo (o si è disconnesso) tira a caso: meglio di una sconfitta a
// tavolino, e non blocca gli altri.
function fillMissingThrows(playerIds, throws, random = Math.random) {
  const filled = new Map();
  for (const id of playerIds) {
    const sym = throws.get(id);
    filled.set(id, RPS_SYMBOLS.includes(sym) ? sym : randomSymbol(random));
  }
  return filled;
}

// Chi resta in gioco dopo un giro. Se ne resta uno solo, è l'accusato.
function nextTieBreakStep(stillIn, roundIndex, random = Math.random) {
  if (stillIn.length === 1) return { accusedId: stillIn[0], playAgain: false };
  if (roundIndex >= RPS_MAX_ROUNDS) {
    // Non capiterà, ma senza questa via d'uscita la partita potrebbe restare appesa.
    return { accusedId: stillIn[Math.floor(random() * stillIn.length)], playAgain: false, byLot: true };
  }
  return { accusedId: null, playAgain: true };
}

// ---- Punteggio della manche ------------------------------------------------

// Chi prende il punto:
// - impostore scoperto  -> lo prende chi lo ha votato (non lui, se ha votato se stesso)
// - impostore non scoperto -> lo prende solo lui
// - impostore scoperto ma che indovina la parola -> ribalta tutto: il punto è solo suo
function scoreRound({ impostorId, accusedId, votes, guessCorrect = false }) {
  const points = new Map();
  const caught = accusedId === impostorId;

  if (caught && guessCorrect) {
    points.set(impostorId, 1); // colpo di coda: gli altri restano a zero
    return { points, outcome: 'impostorGuessed' };
  }
  if (caught) {
    for (const [voterId, target] of votes.entries()) {
      if (target === impostorId && voterId !== impostorId) points.set(voterId, 1);
    }
    return { points, outcome: 'impostorCaught' };
  }
  points.set(impostorId, 1);
  return { points, outcome: 'impostorEscaped' };
}

module.exports = {
  words: new ImpostorWords(),
  ROUNDS_PER_MATCH,
  MIN_PLAYERS,
  normalize,
  sameWord,
  validateSubmission,
  pickImpostor,
  turnOrder,
  tallyVotes,
  RPS_SYMBOLS,
  RPS_MAX_ROUNDS,
  rpsBeats,
  randomSymbol,
  resolveRpsRound,
  fillMissingThrows,
  nextTieBreakStep,
  scoreRound,
};
