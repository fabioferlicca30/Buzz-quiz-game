# Quiz Party — brief per la prossima chat

Incolla questo file (o il suo contenuto) all'inizio di una chat nuova, insieme allo zip
`Quiz-Party.zip`. Serve a ripartire senza rileggere mesi di conversazione.

---

## Cos'è

Gioco quiz party multiplayer da salotto, in italiano. Risposte a scelta multipla su quattro
tasti colorati, presentatore-pupazzo che commenta, fase a eliminazione, e una sfida finale
("brainfighting") con problemi a buzzer e griglie 2×2 tipo Immaculate Grid. In più, una
modalità a sé: **Impostore**, gioco di parole e bluff (minimo 5 giocatori).

**Stack:** Node.js + Express + Socket.io (backend), HTML/CSS/JS puro (frontend). Nessun framework.

**Avvio:** `npm install` poi `npm start`, apre sulla porta 3000.

---

## Stato attuale

| Cosa | Numeri |
|---|---|
| Domande | 1728 (18 categorie × 96) |
| Problemi brainfighting | 497 (7 categorie) |
| Coppie parola-indizio (Impostore) | 400 (20 temi) |
| Calciatori nella griglia | 2582, da **24 club** con roster completo |
| Piloti F1 | 164, con anni e compagni di squadra calcolati |
| Cinema / Serie TV / Geografia | 36 / 36 / 32 soggetti |

**Test**: `npm test`, quattro suite in `test/`, 145 controlli tutti verdi. Girano sulla logica
di gioco con un `io` simulato: non avviano il server. Il giro completo con socket veri va
provato a mano, soprattutto riconnessione e modalità Impostore.

---

## Il lavoro sui roster (è il flusso che stavamo usando)

Le liste si copiano dalle pagine "Categoria:Calciatori del …" di Wikipedia italiana.

1. L'utente incolla i nomi **come testo nel messaggio** (gli allegati si sono rivelati
   inaffidabili: sono arrivati vuoti quattro volte di fila). Se la lista è lunga, va spezzata
   in blocchi da ~200 nomi.
2. Salvare il testo grezzo in un file, poi:
   ```
   node server/scripts/parseWikiCategory.js <file-grezzo.txt> <slug-club>
   node server/scripts/mergeRosters.js
   ```
3. `parseWikiCategory.js` ripulisce da solo: elenchi puntati, link markdown, intestazioni di
   lettera, marcatori di paginazione, disambiguazioni tipo "(calciatore 1966)".
4. `mergeRosters.js` normalizza i nomi (accenti inclusi) e tiene **solo chi compare in almeno
   2 club**: chi ne ha uno solo non serve alla griglia.
5. **PASSO CHE SI DIMENTICA**: aggiungere il nuovo club a `CLUB_CON_ROSTER_COMPLETO` in
   `server/lib/GridGame.js`, altrimenti i nomi entrano nel database ma il club non viene mai
   proposto come criterio di riga/colonna.

### Regola imparata a caro prezzo

**Verificare sempre i nomi trascritti prima del merge.** In una sessione ho generato centinaia
di nomi inventati invece di trascrivere la lista vera (erano tutti "Alessandro/Antonio/Bruno/
Marco" + cognome). Se ne è accorto l'utente. Da allora: dopo aver salvato il file, controllare
il conteggio e cercare 5-8 nomi celebri del club per confermare che siano davvero lì.

---

## Fatto di recente (ottobre 2026)

- Nessuna domanda ripetuta nella sessione, nemmeno tra torneo ed eliminazione (prima erano
  due registri separati).
- Spettatori esclusi dal "Pronto"; il server manda `requiredIds` e il client mostra il
  pulsante solo a chi deve premerlo.
- Riconnessione completa: sessione salvata in `localStorage`, recupero del posto anche con
  socket fantasma, ridisegno della schermata (`resumeFor` in `GameRoom.js`).
- Brainfighting: traguardo configurabile (1/2/3/5/7), fine fase decisa dai punti in un punto
  solo, spareggio a oltranza se due arrivano appaiati.
- Griglia: resa, punto a chi completa più caselle (pareggi premiati), soluzioni mostrate.
- Modalità Impostore completa (`ImpostorGame.js` regole pure, `ImpostorPhase.js` svolgimento).
- `escapeHtml` su tutti i nickname e le parole che finiscono in `innerHTML`.

## Trappole da non reintrodurre (nuove)

- **Riconnessione**: tutto è indicizzato per socket id. Ogni nuova struttura che contiene id
  di giocatori (Set, Map, array di una fase in corso) va aggiunta a `remapPlayerId`,
  altrimenti chi rientra viene ignorato in silenzio. Gli array vivi vanno modificati sul
  posto, non riassegnati.
- **Impostore**: la parola segreta e il ruolo NON vanno mai in un evento di stanza né negli
  eventi conservati per il ripristino. Solo `io.to(socketId)`. C'è un test che lo verifica.
- **Morra**: durante lo spareggio si comunica quanti hanno tirato, mai cosa.
- **Scelta dell'impostore**: deve restare un sorteggio pesato. Pescare "tra chi lo è stato
  meno volte" rende l'ultima manche deducibile da tutti.

## Domanda aperta

Nella fase a eliminazione chi si disconnette è dato per eliminato al round successivo. Se si
vuole che chi esce un attimo non perda la partita, serve una finestra di tolleranza (es.
saltare un round senza essere eliminato). Non ancora deciso.

## Da fare

- **Portogallo**: Benfica, Porto, Sporting CP
- **Turchia**: Galatasaray, Fenerbahçe, Beşiktaş
- **Saudi Pro League**: Al-Hilal, Al-Nassr, Al-Ittihad
  *(aspettativa realistica: pochi incroci nuovi, perché i loro nomi noti hanno spesso un solo
  club europeo alle spalle)*
- Verificare le 1728 domande: sono state scritte da Claude e alcuni errori sono già emersi
  giocando. Utile un pulsante "segnala domanda sbagliata" in partita.
- Categoria musica e arte: rimandate, servono contenuti che Claude non può generare in modo
  affidabile (testi protetti da copyright, immagini).

---

## Trappola nella logica delle griglie (già corretta, ma da non reintrodurre)

Una griglia accetta una risposta solo se il soggetto ha quell'attributo nel database. Quindi un
attributo può fare da criterio **solo se il dato è stato compilato per tutti i soggetti**.

La distinzione non è "quanti ce l'hanno" ma:

- **Esaustivo** — se un soggetto ha la proprietà, il database la conosce. "Ha vinto un Oscar"
  copre il 56% degli attori ed è corretto: gli altri non l'hanno vinto.
- **Parziale** — il dato esiste solo per alcuni. La nazionalità nel calcio è nota per i 342
  giocatori originali e ignota per i 2240 arrivati dai roster.

Il caso che l'ha fatto emergere: Yannick Carrasco è belga e ha giocato nell'Atlético, ma nel
database ha solo i club. La casella "Belgio × Atlético" lo dava per sbagliato.

Per questo nel calcio i criteri sono **solo i club**, e solo quelli con roster completo.
Nazionalità e trofei restano come informazione ma non compaiono più come intestazioni.
La configurazione è in `CRITERIA_TYPES` e `CLUB_CON_ROSTER_COMPLETO` dentro `GridGame.js`.
`test_grid_logic.js` verifica tutto questo.

**Nota sul Cinema**: i soggetti sono gli **attori**, non i film. "Diretto da Scorsese × diretto
da Tarantino" chiede un attore diretto da entrambi (DiCaprio) — è valido, non è un bug.

---

## Consiglio pratico sui consumi

Questo progetto è stato sviluppato in conversazioni molto lunghe, e ogni nuovo messaggio fa
rileggere l'intera cronologia: è il motivo per cui il limite di utilizzo si esauriva in fretta.

- **Aprire una chat nuova** quando si cambia argomento, ricaricando lo zip.
- Per il lavoro sui roster, che è meccanico, **Sonnet basta e consuma molto meno di Opus**.
- Tenere Opus per debug difficili o decisioni di architettura.

---

## File chiave

```
server/lib/GameRoom.js          logica di gioco (fasi, punteggi, brainfighting, riconnessione)
server/lib/GridGame.js          motore griglia 2×2 + configurazione dei criteri
server/lib/QuestionBank.js      domande principali
server/lib/BrainfightingBank.js problemi a buzzer
server/lib/Host.js              battute del presentatore
server/lib/ImpostorGame.js      regole pure della modalità Impostore
server/lib/ImpostorPhase.js     svolgimento della modalità Impostore (innestato su GameRoom)
server/data/impostorwords.json  400 coppie parola-indizio
test/                           le quattro suite di `npm test`
server/data/questions.json      1728 domande
server/data/griddata.json       soggetti e attributi delle griglie
server/data/f1stints.js         piloti F1 con scuderie e anni (da qui si calcolano i compagni)
server/data/rosters/*.txt       i 24 roster grezzi
server/scripts/                 parseWikiCategory.js, mergeRosters.js, buildF1Grid.js
public/                         index.html, app.js, style.css
```
