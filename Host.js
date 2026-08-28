// Il "presentatore" virtuale: un pupazzetto sfacciato che commenta ogni momento della partita.
// Le frasi sono organizzate per momento di gioco; ad ogni gruppo è associato un "mood" (umore)
// usato dal client per far muovere ed esprimere il pupazzo (bocca, occhi, colore).

const LINES = {
  welcome: [
    'Bentornati al vostro quiz preferito, io sono il vostro presentatore virtuale e oggi ho voglia di mettervi in difficoltà!',
    'Ok gente, sistemate i cervelli in modalità competizione: si comincia!',
    'Niente scuse, niente aiuti da internet: solo voi, io e qualche domanda cattiva.',
    'Bentornati! Ho passato la notte a scegliere le domande più insidiose apposta per voi.',
    'Si comincia! Ricordatevi: qui non vince chi è simpatico, vince chi risponde giusto.',
  ],
  questionIntro: [
    'Ecco a voi la prossima domanda, fatemi vedere quanto siete svegli.',
    'Occhi aperti, cervello acceso: si parte!',
    'Questa qui sembra facile... o forse no.',
    'Attenzione, tra poco qualcuno di voi si pentirà di aver risposto di fretta.',
    'Pronti? Tre, due, uno... soffrite.',
    'Questa domanda separa i campioni dai turisti. Vediamo chi è chi.',
    'Ne ho scelta apposta una cattiva, tanto per gradire.',
  ],
  correctFast: [
    '{name} risponde alla velocità della luce, e pure giusto! Impressionante.',
    'Wow {name}, hai risposto prima ancora che finissi di leggere la domanda.',
    '{name} in testa: velocità e cervello, che combinazione pericolosa.',
    '{name} ha premuto il pulsante così in fretta che ho sentito il fumo.',
    'Occhio a {name}, oggi sembra avere Google nel cervello.',
  ],
  correctSlow: [
    '{name} ce l\'ha fatta, con calma ma ce l\'ha fatta.',
    'Meglio tardi che mai, {name}!',
    '{name} risponde giusto, anche se sembrava stesse consultando un\'enciclopedia mentale.',
    '{name} ha risposto giusto all\'ultimo secondo utile: complimenti ai riflessi cardiaci.',
    'Lento come una lumaca ma preciso come un cecchino, bravo {name}.',
  ],
  wrong: [
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
  timeout: [
    '{name} è rimasto in silenzio, forse ha perso la connessione con il proprio cervello.',
    'Il tempo è scaduto e {name} non ha detto nulla: strategia o panico?',
    '{name} si è bloccato come Windows Vista.',
    'Dieci secondi non bastavano a {name}? Forse gli serviva una settimana.',
  ],
  everyoneWrong: [
    'Nessuno ha risposto bene?! Questa domanda era davvero cattiva, lo ammetto.',
    'Un disastro collettivo. Complimenti a tutti, in negativo.',
    'Zero su tutti. Siete sicuri di essere venuti qui per giocare e non per riposarvi il cervello?',
    'Che spettacolo di ignoranza generale, mi commuovo quasi.',
  ],
  everyoneRight: [
    'Ma bravi tutti quanti, oggi siete in forma!',
    'Domanda troppo facile a quanto pare, la prossima sarà più cattiva.',
    'Tutti giusti? Ok, basta buonismo, alzo il livello.',
  ],
  leaderChange: [
    '{name} scavalca tutti e prende la testa della classifica!',
    'Colpo di scena: {name} è il nuovo leader!',
    '{name} sale in vetta. Godetevi il panorama finché dura.',
  ],
  lastPlaceRoast: [
    '{name} è saldamente ultimo in classifica. Saldamente, con una certa dedizione.',
    'Diamo un applauso a {name}, che sta difendendo l\'ultimo posto con tenacia ammirevole.',
    'Occhio a {name}: se questa fosse una gara di velocità al contrario, staremmo festeggiando.',
    '{name} è talmente ultimo che sta iniziando a fare amicizia con lo zero.',
    'Consiglio spassionato per {name}: la prossima domanda potrebbe essere l\'occasione per non essere più ultimo. Potrebbe.',
    'Non voglio essere cattivo con {name}, ma la classifica invece sì.',
  ],
  phase1End: [
    'Fine della prima fase! Solo i migliori andranno avanti, gli altri... beh, potranno guardare.',
    'Le domande di riscaldamento sono finite, ora si fa sul serio.',
    'Fase 1 archiviata. Qualcuno può festeggiare, qualcun altro può solo riflettere sulle proprie scelte di vita.',
  ],
  tournamentStart: [
    'È il momento della fase a eliminazione: da qui in poi le domande si fanno più difficili e non c\'è pietà.',
    'Si comincia con l\'eliminazione diretta: un errore e siete fuori. Semplice, spietato, bellissimo.',
    'Da adesso si gioca tutti insieme, stessa domanda per tutti: chi sbaglia è fuori, chi resta va avanti. All\'infinito, finché non resta un solo sopravvissuto.',
  ],
  eliminationRoundIntro: [
    'Tutti sulla stessa domanda: chi sbaglia saluta la compagnia.',
    'Nessuna scappatoia questa volta: stessa domanda, stesso destino.',
    'Chi risponde male stavolta è fuori dai giochi. Fatevi coraggio.',
  ],
  eliminationSomeOut: [
    '{names} eliminati con onore, o forse no. Chi resta, continui a tremare.',
    'Diciamo addio a {names}. La classifica è già più corta, e più cattiva.',
    '{names} escono di scena. Il pubblico (io) applaude comunque.',
  ],
  eliminationAllWrongContinue: [
    'Avete sbagliato tutti quanti, quindi tecnicamente nessuno è eliminato: siete tutti ugualmente scarsi, si va avanti!',
    'Un disastro corale: nessuno passa il turno ma nessuno viene eliminato. Prossima domanda, ancora più cattiva.',
    'Se sbagliano tutti, non elimino nessuno: sennò resto senza pubblico. Si continua!',
  ],
  eliminationAllRightContinue: [
    'Tutti giusti, nessuna eliminazione. Alzo ancora la difficoltà, non ve la caverete così facilmente.',
    'Bravi tutti, ma io non demordo: prossima domanda, più cattiva.',
  ],
  eliminationChampion: [
    '{name} è l\'unico sopravvissuto rimasto in piedi: che nervi d\'acciaio!',
    'Non ha mai sbagliato una volta: {name} porta a casa la fase a eliminazione!',
  ],
  matchWin: [
    '{name} vince lo scontro e passa al turno successivo!',
    '{name} avanza, complimenti!',
  ],
  finalWinner: [
    '{name} è il campione assoluto di questa partita! Applausi virtuali per lui!',
    'Signore e signori, abbiamo un vincitore: {name}!',
    '{name} vince e si guadagna il diritto di prendere in giro tutti gli altri per il resto della serata.',
  ],
  sessionLeaderRoast: [
    'Occhio a {name}: comanda la classifica generale della serata e già si sente un fenomeno.',
    '{name} sta dominando la classifica di sessione. Gli altri, un applauso di circostanza.',
    'La classifica generale dice {name} in testa. Vediamo se riesce a restarci.',
  ],
  sessionLastRoast: [
    '{name} è ultimo nella classifica generale della sessione. Spero almeno vi stiate divertendo, {name}.',
    'Nella classifica di tutta la serata {name} è fanalino di coda. Coraggio, si può solo migliorare.',
    'Un pensiero per {name}, ultimo nella classifica generale: la serata è ancora lunga, per fortuna.',
  ],
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

function say(key, vars = {}) {
  const pool = LINES[key] || ['...'];
  let line = pick(pool);
  for (const [k, v] of Object.entries(vars)) {
    line = line.split(`{${k}}`).join(v);
  }
  return { text: line, mood: MOODS[key] || 'neutral' };
}

module.exports = { say };
