// Il "presentatore" virtuale: un pupazzetto sfacciato che commenta ogni momento della partita.
//
// Ogni voce di LINES è { family: [...], unfiltered: [...] }. "family" è sempre la base
// (usata di default e come ripiego se manca una variante). "unfiltered" viene usata solo
// quando la stanza ha scelto il presentatore "non family friendly": frasi più dirette,
// meno educate, senza filtri — ma sempre rivolte alla prestazione nel gioco, mai a
// caratteristiche personali reali di chi gioca.
//
// CATEGORY_LINES aggiunge battute a tema per alcune categorie (quando la domanda in corso
// appartiene a una di esse, il presentatore ha una probabilità di usare la battuta a tema
// invece di quella generica).

const LINES = {
  welcome: {
    family: [
      'Bentornati al vostro quiz preferito, io sono il vostro presentatore virtuale e oggi ho voglia di mettervi in difficoltà!',
      'Ok gente, sistemate i cervelli in modalità competizione: si comincia!',
      'Niente scuse, niente aiuti da internet: solo voi, io e qualche domanda cattiva.',
      'Bentornati! Ho passato la notte a scegliere le domande più insidiose apposta per voi.',
      'Si comincia! Ricordatevi: qui non vince chi è simpatico, vince chi risponde giusto.',
    ],
    unfiltered: [],
  },
  questionIntro: {
    family: [
      'Ecco a voi la prossima domanda, fatemi vedere quanto siete svegli.',
      'Occhi aperti, cervello acceso: si parte!',
      'Questa qui sembra facile... o forse no.',
      'Attenzione, tra poco qualcuno di voi si pentirà di aver risposto di fretta.',
      'Pronti? Tre, due, uno... soffrite.',
      'Questa domanda separa i campioni dai turisti. Vediamo chi è chi.',
      'Ne ho scelta apposta una cattiva, tanto per gradire.',
    ],
    unfiltered: [
      'Questa ve la faccio pagare cara, pronti a fare scena muta di nuovo?',
      'Vediamo chi si dimostra all\'altezza stavolta. Ne dubito fortemente.',
    ],
  },
  correctFast: {
    family: [
      '{name} risponde alla velocità della luce, e pure giusto! Impressionante.',
      'Wow {name}, hai risposto prima ancora che finissi di leggere la domanda.',
      '{name} in testa: velocità e cervello, che combinazione pericolosa.',
      '{name} ha premuto il pulsante così in fretta che ho sentito il fumo.',
      'Occhio a {name}, oggi sembra avere Google nel cervello.',
    ],
    unfiltered: [],
  },
  correctSlow: {
    family: [
      '{name} ce l\'ha fatta, con calma ma ce l\'ha fatta.',
      'Meglio tardi che mai, {name}!',
      '{name} risponde giusto, anche se sembrava stesse consultando un\'enciclopedia mentale.',
      '{name} ha risposto giusto all\'ultimo secondo utile: complimenti ai riflessi cardiaci.',
      'Lento come una lumaca ma preciso come un cecchino, bravo {name}.',
    ],
    unfiltered: [],
  },
  wrong: {
    family: [
      '{name}... no. Proprio no. Ma va bene, ridiamoci su.',
      'Ahi ahi {name}, quella risposta era una trappola e ci sei cascato in pieno.',
      '{name} tenta il colpo di fortuna e fallisce miseramente.',
      'Coraggiosa risposta di {name}. Sbagliata, ma coraggiosa.',
      '{name}, complimenti: hai trovato l\'unica risposta sbagliata su quattro con incredibile precisione.',
      'Con tutto il rispetto {name}, ma dove l\'hai presa quella risposta, al mercato?',
      '{name} risponde e sbaglia. Il pubblico a casa (cioè nessuno) piange.',
      'Un applauso a {name}, per aver sbagliato con tanta sicurezza.',
      '{name}, io un dubbio ce l\'avrei avuto. Tu a quanto pare no.',
      'Sbagliato, {name}. Ma tranquillo, nessuno si aspettava di meglio da te oggi.',
    ],
    unfiltered: [
      '{name}, ma sei serio? Hai risposto con i piedi, letteralmente.',
      'Ma cosa cazzo hai risposto, {name}? Dai, seriamente.',
      'Madonna {name}, quella risposta fa male solo a sentirla.',
      '{name}, il tuo cervello oggi è ufficialmente in sciopero.',
      '{name} spara a caso e sbaglia pure quello, complimenti vivissimi.',
      'Che pena {name}, davvero, che pena.',
      '{name}, lo sapevi che potevi anche non rispondere invece di fare quella figura?',
    ],
  },
  timeout: {
    family: [
      '{name} è rimasto in silenzio, forse ha perso la connessione con il proprio cervello.',
      'Il tempo è scaduto e {name} non ha detto nulla: strategia o panico?',
      '{name} si è bloccato come Windows Vista.',
      'Dieci secondi non bastavano a {name}? Forse gli serviva una settimana.',
    ],
    unfiltered: [
      '{name} non ha detto niente. Onestamente, meglio così viste le premesse.',
      '{name}, il tempo è scaduto e pure la pazienza del pubblico.',
    ],
  },
  everyoneWrong: {
    family: [
      'Nessuno ha risposto bene?! Questa domanda era davvero cattiva, lo ammetto.',
      'Un disastro collettivo. Complimenti a tutti, in negativo.',
      'Zero su tutti. Siete sicuri di essere venuti qui per giocare e non per riposarvi il cervello?',
      'Che spettacolo di ignoranza generale, mi commuovo quasi.',
    ],
    unfiltered: [
      'Ma cosa avete studiato fino ad oggi, di grazia? Un disastro totale.',
      'Siete un manipolo di incompetenti raccolti per caso in questa stanza, con affetto.',
      'Zero su tutti. Vergognatevi, ma con affetto.',
    ],
  },
  everyoneRight: {
    family: [
      'Ma bravi tutti quanti, oggi siete in forma!',
      'Domanda troppo facile a quanto pare, la prossima sarà più cattiva.',
      'Tutti giusti? Ok, basta buonismo, alzo il livello.',
    ],
    unfiltered: [],
  },
  leaderChange: {
    family: [
      '{name} scavalca tutti e prende la testa della classifica!',
      'Colpo di scena: {name} è il nuovo leader!',
      '{name} sale in vetta. Godetevi il panorama finché dura.',
    ],
    unfiltered: [],
  },
  lastPlaceRoast: {
    family: [
      '{name} è saldamente ultimo in classifica. Saldamente, con una certa dedizione.',
      'Diamo un applauso a {name}, che sta difendendo l\'ultimo posto con tenacia ammirevole.',
      'Occhio a {name}: se questa fosse una gara di velocità al contrario, staremmo festeggiando.',
      '{name} è talmente ultimo che sta iniziando a fare amicizia con lo zero.',
      'Consiglio spassionato per {name}: la prossima domanda potrebbe essere l\'occasione per non essere più ultimo. Potrebbe.',
      'Non voglio essere cattivo con {name}, ma la classifica invece sì.',
    ],
    unfiltered: [
      '{name} è ultimo con merito, non è mica sfortuna: è proprio scarso stasera.',
      '{name}, ti sei mai chiesto se il quiz sia proprio lo sport giusto per te?',
      'Diciamocelo chiaro: {name} sta facendo pena da inizio partita.',
      '{name} è talmente ultimo che gli altri lo salutano con un certo imbarazzo.',
    ],
  },
  phase1End: {
    family: [
      'Fine della prima fase! Solo i migliori andranno avanti, gli altri... beh, potranno guardare.',
      'Le domande di riscaldamento sono finite, ora si fa sul serio.',
      'Fase 1 archiviata. Qualcuno può festeggiare, qualcun altro può solo riflettere sulle proprie scelte di vita.',
    ],
    unfiltered: [],
  },
  tournamentStart: {
    family: [
      'È il momento della fase a eliminazione: da qui in poi le domande si fanno più difficili e non c\'è pietà.',
      'Si comincia con l\'eliminazione diretta: un errore e siete fuori. Semplice, spietato, bellissimo.',
      'Da adesso si gioca tutti insieme, stessa domanda per tutti: chi sbaglia è fuori, chi resta va avanti. All\'infinito, finché non resta un solo sopravvissuto.',
    ],
    unfiltered: [],
  },
  eliminationRoundIntro: {
    family: [
      'Tutti sulla stessa domanda: chi sbaglia saluta la compagnia.',
      'Nessuna scappatoia questa volta: stessa domanda, stesso destino.',
      'Chi risponde male stavolta è fuori dai giochi. Fatevi coraggio.',
    ],
    unfiltered: [],
  },
  eliminationSomeOut: {
    family: [
      '{names} eliminati con onore, o forse no. Chi resta, continui a tremare.',
      'Diciamo addio a {names}. La classifica è già più corta, e più cattiva.',
      '{names} escono di scena. Il pubblico (io) applaude comunque.',
    ],
    unfiltered: [
      '{names} fuori, e sinceramente non mi dispiace affatto.',
      'Ciao ciao {names}, non fatevi vedere troppo in giro dopo quella prestazione.',
      '{names} eliminati. Non erano pronti, diciamocelo con franchezza.',
    ],
  },
  eliminationAllWrongContinue: {
    family: [
      'Avete sbagliato tutti quanti, quindi tecnicamente nessuno è eliminato: siete tutti ugualmente scarsi, si va avanti!',
      'Un disastro corale: nessuno passa il turno ma nessuno viene eliminato. Prossima domanda, ancora più cattiva.',
      'Se sbagliano tutti, non elimino nessuno: sennò resto senza pubblico. Si continua!',
    ],
    unfiltered: [
      'Siete tutti terribili in egual misura, quindi pari merito nell\'incompetenza. Si va avanti.',
      'Un disastro corale che definire imbarazzante è un eufemismo. Prossima domanda.',
    ],
  },
  eliminationAllRightContinue: {
    family: [
      'Tutti giusti, nessuna eliminazione. Alzo ancora la difficoltà, non ve la caverete così facilmente.',
      'Bravi tutti, ma io non demordo: prossima domanda, più cattiva.',
    ],
    unfiltered: [],
  },
  eliminationChampion: {
    family: [
      '{name} è l\'unico sopravvissuto rimasto in piedi: che nervi d\'acciaio!',
      'Non ha mai sbagliato una volta: {name} porta a casa la fase a eliminazione!',
    ],
    unfiltered: [],
  },
  matchWin: {
    family: [
      '{name} vince lo scontro e passa al turno successivo!',
      '{name} avanza, complimenti!',
    ],
    unfiltered: [],
  },
  finalWinner: {
    family: [
      '{name} è il campione assoluto di questa partita! Applausi virtuali per lui!',
      'Signore e signori, abbiamo un vincitore: {name}!',
      '{name} vince e si guadagna il diritto di prendere in giro tutti gli altri per il resto della serata.',
    ],
    unfiltered: [],
  },
  sessionLeaderRoast: {
    family: [
      'Occhio a {name}: comanda la classifica generale della serata e già si sente un fenomeno.',
      '{name} sta dominando la classifica di sessione. Gli altri, un applauso di circostanza.',
      'La classifica generale dice {name} in testa. Vediamo se riesce a restarci.',
    ],
    unfiltered: [
      '{name} comanda la classifica e gli è già salita la puzza sotto il naso, si vede lontano un chilometro.',
    ],
  },
  sessionLastRoast: {
    family: [
      '{name} è ultimo nella classifica generale della sessione. Spero almeno vi stiate divertendo, {name}.',
      'Nella classifica di tutta la serata {name} è fanalino di coda. Coraggio, si può solo migliorare.',
      'Un pensiero per {name}, ultimo nella classifica generale: la serata è ancora lunga, per fortuna.',
    ],
    unfiltered: [
      '{name} è ultimo nella classifica generale. Onestamente, meritato.',
      '{name}, la classifica di stasera parla chiaro: sei il fanalino di coda, con merito.',
    ],
  },
};

// Battute a tema legate al contenuto della categoria della domanda in corso. Usate solo
// quando la domanda appartiene a una di queste categorie, con una certa probabilità.
const CATEGORY_LINES = {
  'Formula 1': {
    wrong: {
      family: [
        '{name} esce di pista con quella risposta, altro che aerodinamica.',
        '{name} fa un testacoda clamoroso su questa domanda.',
        'Bandiera nera per {name}: squalificato per manifesta incompetenza.',
        '{name} rallenta come sotto safety car, ma qui non serviva affatto.',
      ],
      unfiltered: [
        '{name} si è schiantato contro il muro con quella risposta, altro che Formula 1.',
        '{name}, quella risposta è da ultimo classificato doppiato due volte.',
      ],
    },
    timeout: { family: ['{name} è rimasto fermo ai box mentre il tempo scorreva.'], unfiltered: [] },
    correctFast: { family: ['{name} risponde più veloce di un pit stop, roba da record!', '{name} scatta dalla pole e vince questa manche.'], unfiltered: [] },
    everyoneWrong: { family: ['Tutti fuori pista su questa domanda, che disastro da gran premio bagnato.'], unfiltered: [] },
    eliminationSomeOut: { family: ['{names} vanno a sbattere e sono fuori gara.'], unfiltered: [] },
  },
  'Automobili e Motori': {
    wrong: {
      family: [
        '{name} ha grippato il motore su questa risposta.',
        '{name}, quella risposta è andata in fumo come una marmitta bucata.',
        '{name} ha sbagliato marcia clamorosamente.',
      ],
      unfiltered: ['{name} ha le idee ingranate come un cambio arrugginito, complimenti.'],
    },
    timeout: { family: ['{name} è rimasto in panne prima ancora di rispondere.'], unfiltered: [] },
    correctFast: { family: ['{name} accelera e risponde a tutto gas!'], unfiltered: [] },
    everyoneWrong: { family: ['Tutti in panne su questa domanda, che disastro meccanico collettivo.'], unfiltered: [] },
    eliminationSomeOut: { family: ['{names} restano a piedi e sono fuori gara.'], unfiltered: [] },
  },
  'Ingegneria del Veicolo': {
    wrong: {
      family: [
        '{name}, quella risposta si è deformata peggio di una zona d\'urto.',
        '{name} ha uno shimmy clamoroso nel ragionamento.',
        'Quella risposta di {name} non regge la dinamica del veicolo, altro che baricentro basso.',
      ],
      unfiltered: [],
    },
    timeout: { family: ['{name} è rimasto bloccato come un differenziale grippato.'], unfiltered: [] },
    correctFast: { family: ['{name} risponde con la precisione di una sospensione ben calibrata!'], unfiltered: [] },
    everyoneWrong: { family: ['Struttura collassata su tutta la linea: nessuno ha retto l\'urto di questa domanda.'], unfiltered: [] },
    eliminationSomeOut: { family: ['{names} si deformano sotto la pressione e sono fuori.'], unfiltered: [] },
  },
  Calcio: {
    wrong: {
      family: [
        '{name} manda la risposta clamorosamente fuori, sopra la traversa.',
        'Cartellino rosso per {name}: espulso da questa domanda.',
        '{name} sbaglia un rigore a porta vuota con quella risposta.',
      ],
      unfiltered: ['{name}, quella risposta è da retrocessione diretta.'],
    },
    timeout: { family: ['{name} resta fermo in fuorigioco mentre il tempo scorre.'], unfiltered: [] },
    correctFast: { family: ['{name} la mette all\'incrocio dei pali, gol clamoroso!'], unfiltered: [] },
    everyoneWrong: { family: ['Partita finita 0 a 0: nessuno ha segnato su questa domanda.'], unfiltered: [] },
    eliminationSomeOut: { family: ['{names} vengono espulsi ed escono anzitempo dal campo.'], unfiltered: [] },
  },
};

// Umore associato a ciascun gruppo di frasi: guida l'espressione del pupazzo lato client.
const MOODS = {
  welcome: 'happy',
  questionIntro: 'neutral',
  correctFast: 'happy',
  correctSlow: 'happy',
  wrong: 'evil',
  timeout: 'evil',
  everyoneWrong: 'laugh',
  everyoneRight: 'happy',
  leaderChange: 'hype',
  lastPlaceRoast: 'evil',
  phase1End: 'neutral',
  tournamentStart: 'evil',
  eliminationRoundIntro: 'evil',
  eliminationSomeOut: 'shock',
  eliminationAllWrongContinue: 'laugh',
  eliminationAllRightContinue: 'neutral',
  eliminationChampion: 'celebrate',
  matchWin: 'hype',
  finalWinner: 'celebrate',
  sessionLeaderRoast: 'hype',
  sessionLastRoast: 'evil',
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Sceglie il pool giusto da una voce { family, unfiltered }, tornando null se non applicabile.
function poolFrom(entry, mode) {
  if (!entry) return null;
  if (mode === 'unfiltered' && entry.unfiltered && entry.unfiltered.length) return entry.unfiltered;
  return entry.family && entry.family.length ? entry.family : null;
}

// ctx: { category, mode } — category è la categoria della domanda in corso (se pertinente),
// mode è 'family' (default) o 'unfiltered' (presentatore non family friendly).
function say(key, vars = {}, ctx = {}) {
  const { category = null, mode = 'family' } = ctx;
  let pool = null;

  if (category && CATEGORY_LINES[category] && CATEGORY_LINES[category][key] && Math.random() < 0.6) {
    pool = poolFrom(CATEGORY_LINES[category][key], mode);
  }
  if (!pool) {
    pool = poolFrom(LINES[key], mode);
  }
  if (!pool) pool = ['...'];

  let line = pick(pool);
  for (const [k, v] of Object.entries(vars)) {
    line = line.split(`{${k}}`).join(v);
  }
  return { text: line, mood: MOODS[key] || 'neutral' };
}

module.exports = { say };
