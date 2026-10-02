// Regole della modalità impostore: parole consegnate, rotazione dei turni, voto con spareggio
// e assegnazione del punto. Tutte funzioni pure: nessun socket, nessuna partita da avviare.
const imp = require('../server/lib/ImpostorGame');

let failed = 0;
const check = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) failed++;
};

// ---- 1. Il mazzo di parole ------------------------------------------------
{
  const all = imp.words.pairs;
  check(all.length >= 100, `il mazzo ha ${all.length} coppie parola-indizio`);
  check(imp.words.themes().length >= 8, `divise in ${imp.words.themes().length} temi`);
  check(all.every((p) => p.word && p.clue), 'ogni coppia ha parola e indizio');
  check(all.every((p) => !imp.sameWord(p.word, p.clue)), 'nessun indizio coincide con la sua parola');

  const used = new Set(all.map((p) => p.word));
  const esaurito = imp.words.pick(used);
  check(Boolean(esaurito.pair) && esaurito.recycled === true, 'a mazzo esaurito si ricomincia, e lo si sa');

  // Il divieto di ripetizione in sessione deve reggere fino all'ultima coppia.
  const viste = new Set();
  let ripetizioni = 0;
  for (let i = 0; i < all.length; i++) {
    const { pair, recycled } = imp.words.pick(viste);
    if (recycled) break;
    if (viste.has(pair.word)) ripetizioni++;
    viste.add(pair.word);
  }
  check(ripetizioni === 0, `${viste.size} manche di fila senza mai ripetere una parola`);
  check(viste.size === all.length, 'e si arriva a usarle tutte prima di ricominciare');
}

// ---- 2. Parole consegnate -------------------------------------------------
{
  const ctx = { secretWord: 'Pizza', usedWords: ['Forno'] };
  check(imp.validateSubmission('Margherita', ctx).ok, 'una parola normale passa');
  check(Boolean(imp.validateSubmission('pizza', ctx).error), 'non si può dire la parola segreta');
  check(Boolean(imp.validateSubmission('PIZZE', ctx).error), 'né una sua forma evidente');
  check(Boolean(imp.validateSubmission('forno', ctx).error), 'non si può ripetere una parola già detta');
  check(Boolean(imp.validateSubmission('con il forno', ctx).error), 'niente frasi: una parola sola');
  check(Boolean(imp.validateSubmission('   ', ctx).error), 'niente risposte vuote');
  check(imp.validateSubmission('Forchétta', ctx).ok, 'gli accenti non danno fastidio');
}

// ---- 3. Chi fa l'impostore e in che ordine si gioca ------------------------
{
  const ids = ['a', 'b', 'c', 'd', 'e'];

  // Il ruolo deve girare, ma senza mai diventare prevedibile.
  const conteggi = new Map(ids.map((id) => [id, 0]));
  let precedente = null;
  let dueDiFila = 0;
  for (let manche = 0; manche < 3000; manche++) {
    const scelto = imp.pickImpostor(ids, conteggi, precedente);
    if (scelto === precedente) dueDiFila++;
    conteggi.set(scelto, conteggi.get(scelto) + 1);
    precedente = scelto;
  }
  const valori = [...conteggi.values()];
  check(dueDiFila === 0, 'non capita mai due manche di fila alla stessa persona');
  check(Math.max(...valori) - Math.min(...valori) < 3000 * 0.06, `il ruolo si distribuisce in modo equo (scarto ${Math.max(...valori) - Math.min(...valori)} su 3000)`);
  check(valori.every((v) => v > 0), 'e tocca davvero a tutti');

  // Il punto della questione: all'ultima manche di un giro completo NON si deve poter dedurre
  // chi sarà l'impostore. Quattro su cinque lo sono già stati una volta: se la scelta fosse
  // deterministica toccherebbe di sicuro al quinto.
  const quasiFinito = new Map([['a', 1], ['b', 1], ['c', 1], ['d', 1], ['e', 0]]);
  const scelte = new Set();
  for (let i = 0; i < 400; i++) scelte.add(imp.pickImpostor(ids, quasiFinito, 'a'));
  check(scelte.size > 1, `nell'ultima manche l'impostore non è deducibile (${scelte.size} nomi possibili invece di 1)`);
  check(scelte.has('e'), 'chi non lo è ancora stato resta comunque il più probabile');

  // Con un solo giocatore non c'è niente da sorteggiare.
  check(imp.pickImpostor(['solo'], new Map(), 'solo') === 'solo', 'con un solo giocatore tocca a lui');

  check(imp.turnOrder(ids, 0)[0] === 'a', 'al primo giro apre il primo');
  check(imp.turnOrder(ids, 1)[0] === 'b', 'al secondo apre il successivo');
  check(imp.turnOrder(ids, 2)[0] === 'c', 'e al terzo quello dopo ancora');
  check(imp.turnOrder(ids, 1).length === 5, 'l\'ordine contiene sempre tutti');
}

// ---- 4. Voto e spareggio --------------------------------------------------
{
  // Maggioranza netta.
  const netto = imp.tallyVotes(new Map([['a', 'c'], ['b', 'c'], ['c', 'a'], ['d', 'c'], ['e', 'b']]));
  check(netto.accusedId === 'c' && netto.tied.length === 0, 'con un accusato in testa si procede');

  // Pareggio: serve lo spareggio.
  const pari = imp.tallyVotes(new Map([['a', 'c'], ['b', 'c'], ['c', 'a'], ['d', 'a'], ['e', 'b']]));
  check(pari.accusedId === null, 'a parità non si accusa nessuno');
  check(pari.tied.sort().join() === 'a,c', 'e si sa chi sono i pari merito');

  check(imp.tallyVotes(new Map([['a', null], ['b', null]])).noVotes === true, 'se non vota nessuno lo si sa');
}

// ---- 4b. Spareggio a sasso-carta-forbice ---------------------------------
{
  check(imp.rpsBeats('sasso', 'forbice') && imp.rpsBeats('forbice', 'carta') && imp.rpsBeats('carta', 'sasso'), 'la gerarchia dei simboli è quella giusta');
  check(!imp.rpsBeats('sasso', 'carta'), 'e non è simmetrica');

  // Due sospettati: chi tira il simbolo vincente si salva, l'altro finisce accusato.
  const duello = imp.resolveRpsRound(new Map([['a', 'sasso'], ['b', 'forbice']]));
  check(duello.decided && duello.safeIds.join() === 'a', 'chi tira sasso contro forbice si salva');
  check(duello.stillIn.join() === 'b', 'e chi perde resta sotto accusa');
  check(imp.nextTieBreakStep(duello.stillIn, 0).accusedId === 'b', 'restando in uno solo, quello è l\'accusato');

  // Stesso simbolo per tutti: si ritira.
  const pari = imp.resolveRpsRound(new Map([['a', 'carta'], ['b', 'carta']]));
  check(!pari.decided && pari.stillIn.length === 2, 'con lo stesso simbolo non si salva nessuno');
  check(imp.nextTieBreakStep(pari.stillIn, 0).playAgain === true, 'e si ritira');

  // Tre sospettati con tutti e tre i simboli: nessuno prevale.
  const triplo = imp.resolveRpsRound(new Map([['a', 'sasso'], ['b', 'carta'], ['c', 'forbice']]));
  check(!triplo.decided && triplo.stillIn.length === 3, 'con tutti e tre i simboli in campo non prevale nessuno');

  // Tre sospettati, due simboli: si va a eliminazione.
  const tre = imp.resolveRpsRound(new Map([['a', 'sasso'], ['b', 'sasso'], ['c', 'forbice']]));
  check(tre.decided && tre.safeIds.sort().join() === 'a,b', 'i due che tirano sasso si salvano');
  check(tre.stillIn.join() === 'c', 'e resta dentro chi ha tirato forbice');

  // Chi non tira in tempo tira a caso, invece di perdere a tavolino.
  const riempiti = imp.fillMissingThrows(['a', 'b', 'c'], new Map([['a', 'carta']]), () => 0);
  check(riempiti.size === 3, 'chi non tira entro il tempo viene comunque considerato');
  check(riempiti.get('a') === 'carta', 'e chi ha tirato mantiene il suo simbolo');
  check(imp.RPS_SYMBOLS.includes(riempiti.get('b')), 'agli altri tocca un simbolo a caso');

  // Lo spareggio deve finire SEMPRE. Una singola simulazione non prova niente (spesso si
  // chiude al primo giro), quindi se ne fanno molte, con 2, 3, 4 e 5 pari merito.
  let peggiore = 0;
  let sempreChiuso = true;
  let sorteggiati = 0;
  for (let prova = 0; prova < 2000; prova++) {
    let stillIn = ['a', 'b', 'c', 'd', 'e'].slice(0, 2 + (prova % 4));
    let giri = 0;
    let accusato = null;
    while (!accusato && giri < 100) {
      const throws = imp.fillMissingThrows(stillIn, new Map(), Math.random);
      const round = imp.resolveRpsRound(throws);
      if (round.decided && round.stillIn.length) stillIn = round.stillIn;
      const step = imp.nextTieBreakStep(stillIn, giri);
      if (step.byLot) sorteggiati++;
      accusato = step.accusedId;
      giri++;
    }
    if (!accusato || stillIn.length === 0) sempreChiuso = false;
    peggiore = Math.max(peggiore, giri);
  }
  check(sempreChiuso, 'su 2000 spareggi simulati esce sempre un accusato, e uno solo');
  check(peggiore <= imp.RPS_MAX_ROUNDS + 1, `il caso peggiore incontrato è di ${peggiore} giri, entro il tetto`);
  check(sorteggiati < 40, `il sorteggio d'emergenza è scattato ${sorteggiati} volte su 2000: resta un caso di bordo`);
  check(imp.nextTieBreakStep(['a', 'b'], imp.RPS_MAX_ROUNDS, () => 0).byLot === true, 'raggiunto il tetto si sorteggia, invece di restare appesi');
}

// ---- 5. Il punto della manche --------------------------------------------
{
  const votes = new Map([['a', 'imp'], ['b', 'imp'], ['c', 'a'], ['imp', 'imp'], ['e', 'imp']]);

  const preso = imp.scoreRound({ impostorId: 'imp', accusedId: 'imp', votes });
  check(preso.outcome === 'impostorCaught', 'impostore scoperto');
  check(preso.points.get('a') === 1 && preso.points.get('b') === 1 && preso.points.get('e') === 1, 'chi lo ha votato prende il punto');
  check(!preso.points.has('c'), 'chi ha votato un innocente resta a zero');
  check(!preso.points.has('imp'), 'e l\'impostore che vota se stesso per mimetizzarsi non prende niente');

  const scappato = imp.scoreRound({ impostorId: 'imp', accusedId: 'a', votes });
  check(scappato.outcome === 'impostorEscaped' && scappato.points.get('imp') === 1, 'se accusano un innocente il punto è dell\'impostore');
  check(scappato.points.size === 1, 'e solo suo');

  const ribaltata = imp.scoreRound({ impostorId: 'imp', accusedId: 'imp', votes, guessCorrect: true });
  check(ribaltata.outcome === 'impostorGuessed', 'impostore scoperto che però indovina la parola');
  check(ribaltata.points.get('imp') === 1 && ribaltata.points.size === 1, 'ribalta la manche: punto suo, tutti gli altri a zero');
}

// ---- 6. Il tentativo finale è tollerante sulle forme ----------------------
{
  check(imp.sameWord('Leoni', 'leone'), '"Leoni" vale come "leone"');
  check(imp.sameWord('  PIZZE ', 'Pizza'), 'maiuscole e spazi non contano');
  check(imp.sameWord('Caffe', 'Caffè'), 'né gli accenti mancanti');
  check(!imp.sameWord('leone', 'leopardo'), 'ma due parole diverse restano diverse');
  check(!imp.sameWord('cane', 'pane'), 'e le parole corte non vengono confuse tra loro');
}

console.log(failed ? `\n${failed} test falliti` : '\nTutti i test verdi');
process.exit(failed ? 1 : 0);
