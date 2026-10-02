# Quiz Party

Quiz party multiplayer da salotto: risposte a scelta multipla abbinate a 4 tasti colorati (giallo, blu, arancione, verde), un presentatore-pupazzo animato con battute (anche cattive) e una fase a eliminazione che dura finché non resta un solo imbattuto. Il punteggio si accumula anche tra più partite giocate di fila nella stessa sessione.

Quattro modalità: **Rush** e **Classica** (quiz a risposte con fase a eliminazione e sfida finale), **Solo Brainfighting** (dritti alla sfida finale), e **Impostore** (gioco di parole e bluff, vedi sotto).

Stack: **Node.js + Express + Socket.io** sul backend, **HTML/CSS/JS puro** sul frontend (nessun build step, nessun framework). Le domande vivono in un file JSON, niente database esterno da configurare.

## Come funziona il gioco

1. Un giocatore crea una partita scegliendo: visibilità (**chiusa** con codice a 5 caratteri, o **aperta** a chiunque), modalità, livello di difficoltà e categoria.
2. Gli altri entrano con il codice oppure scelgono la partita dalla lista di quelle **aperte**.
3. **Fase 1**: 10 domande a risposta multipla, 10 secondi a testa per rispondere (la domanda si chiude comunque in anticipo, appena tutti hanno risposto).
   - **Modalità Rush**: chi risponde correttamente più veloce prende più punti (1°=3, 2°=2, 3°=1, dal 4° in poi 0), risposta sbagliata = -1.
   - **Modalità Classica**: punti fissi (2) a chiunque risponda giusto entro i 10 secondi, indipendentemente dalla velocità; sbagliare non toglie punti.
   - Dopo ogni domanda il presentatore commenta il risultato — prima una lode a chi ha risposto meglio, poi (se qualcuno ha sbagliato) una battuta mirata su UN giocatore scelto a caso tra chi ha risposto male, che cita la sua risposta reale — e si passa alla domanda successiva solo quando **tutti i giocatori ancora nella partita cliccano "Pronto"** (o dopo 20 secondi di attesa, come rete di sicurezza). Chi ha abbandonato la partita in corso (vedi sotto) non viene più aspettato.
4. Finita la Fase 1, il migliore **50% (arrotondato per eccesso, minimo 2)** dei giocatori collegati accede alla **fase a eliminazione**. Gli altri diventano spettatori e vedono comunque lo show.
5. **Fase a eliminazione (a oltranza)**: stessa domanda per tutti i qualificati, contemporaneamente.
   - Chi risponde male è eliminato.
   - Se **sbagliano tutti**, per regola non viene eliminato nessuno: si va avanti comunque con una nuova domanda.
   - Se **rispondono tutti bene**, nessuna eliminazione: si continua con una domanda più difficile.
   - La difficoltà sale di un livello a ogni round — facile → medio → difficile → super difficile → impossibile 💀 — fino a fermarsi su "impossibile", e le domande vengono pescate senza ripetizioni finché il mazzo non si esaurisce, nel qual caso il mazzo si ricicla: la fase può durare, in teoria, all'infinito.
   - Si va avanti così finché non resta **un solo giocatore che non ha mai risposto male** in questa fase: è lui il vincitore della partita.
   - Anche qui: risultato commentato dal presentatore, poi si aspetta il click "Pronto" di tutti prima del round successivo.
6. **Punteggio di sessione**: alla fine di ogni partita si assegnano punti cumulativi in base al piazzamento finale — **1000 punti al 1° posto, 500 al 2°, 250 al 3°, 0 dal 4° in poi**. Il presentatore può avviare subito una nuova partita nella stessa stanza (stesso gruppo di giocatori): il punteggio di sessione si somma partita dopo partita, per un vero e proprio torneo della serata.
7. Il presentatore virtuale — un pupazzetto animato che parla e cambia espressione — commenta ogni domanda, ogni risposta e l'esito finale. Durante la pausa tra una domanda e l'altra passa in primo piano al centro dello schermo, e la classifica mostra con una piccola animazione (frecce e scorrimento) chi ha appena scavalcato chi.

### Alcune scelte di design (dove le regole non erano specificate nel dettaglio)

Ho dovuto decidere alcuni dettagli che non avevi specificato — sono facilmente modificabili nel codice se non ti piacciono:

- **Punti modalità Classica**: 2 punti per risposta corretta, 0 per sbagliata/nessuna risposta. Modificabile in `server/lib/GameRoom.js`, funzione `resolveQuestion`.
- **Nessuna risposta data (Rush)**: vale 0 punti, non -1 (la penalità si applica solo a una risposta sbagliata data attivamente). Durante la fase a eliminazione, invece, non rispondere in tempo conta come "sbagliare" ai fini dell'eliminazione (coerente con lo spirito "chi non risponge giusto è fuori").
- **Piazzamento oltre il vincitore**: chi viene eliminato più tardi nella fase a eliminazione piazza meglio di chi è uscito prima; a parità di round di eliminazione, si usa come spareggio il punteggio di Fase 1. Chi non si è nemmeno qualificato per la fase a eliminazione piazza sotto tutti i qualificati, ordinato per punteggio di Fase 1.
- **Nessuna domanda ripetuta nella sessione**: torneo ed eliminazione attingono allo stesso registro di domande già uscite, che non viene azzerato tra una partita e l'altra. Una domanda vista nel torneo non può ricomparire all'eliminazione, né in una partita successiva della stessa stanza. Solo se il mazzo si esaurisce davvero (fase a eliminazione lunghissima su una categoria di nicchia) si ricicla, ripartendo comunque dalle domande non ancora viste in quella fase.
- **Classifica di sessione per nickname**: il punteggio cumulativo di sessione è associato al nickname scelto dal giocatore (non al socket/dispositivo), così regge anche se qualcuno si riconnette con una scheda diversa. Di conseguenza, due giocatori con lo stesso identico nickname nella stessa sessione condividerebbero il punteggio cumulativo: è un'ipotesi ragionevole per un gioco tra amici, ma tienilo a mente se il tuo gruppo ama i nomi doppi.
- **Battute "a sorpresa" sulla classifica**: circa una volta ogni tre domande della Fase 1, con più di 2 giocatori in gioco, il presentatore ha una probabilità di prendere in giro chi è ultimo in classifica invece del commento standard. È volutamente casuale, per non essere ripetitivo.
- **Codice partita**: 5 caratteri alfanumerici (senza caratteri ambigui tipo 0/O o 1/I).
- **Categorie di nicchia sempre escluse da "Tutte"**: l'esclusione vale anche nei casi limite in cui il mazzo di domande stesse per esaurirsi durante una partita lunghissima (es. una fase a eliminazione infinita) — il gioco allarga la ricerca ignorando la difficoltà, mai la categoria. Chi vuole giocare solo a Formula 1 o solo a Calcio deve selezionarli esplicitamente dai tasti categoria, e può combinarne quante ne vuole insieme (es. "Formula 1" + "Automobili e Motori").
- **Posizione della risposta corretta**: per ogni categoria e ogni livello di difficoltà, la risposta giusta è distribuita in modo equilibrato tra le 4 posizioni (circa un quarto delle domande per posizione), così non è possibile "indovinare" un pattern (es. rispondere sempre la prima opzione).
- **Pulsante "Pronto" — chi deve cliccarlo**: solo chi è ancora in gara. Gli spettatori — eliminati, chi ha abbandonato la partita, chi non partecipa al brainfighting — vedono la pausa ma non hanno niente da premere: la partita riparte da sola quando i giocatori sono pronti. Se qualcuno si disconnette mentre si aspetta il suo "pronto", non blocca gli altri: viene escluso automaticamente dal conteggio.
- **Chi viene preso in giro sulla risposta specifica**: tra chi ha attivamente sbagliato (non tra chi non ha risposto affatto), a meno che nessuno abbia dato una risposta sbagliata attiva — in quel caso si prende in giro chi non ha risposto in tempo.
- **Bug corretto in questa sessione**: la modalità Rush non assegnava mai punti in base alla velocità (mancava un parametro nella chiamata interna), dando sempre il punteggio fisso della modalità Classica. Ora Rush funziona davvero come descritto: più veloce = più punti.

## Avviare il progetto in locale

Richiede [Node.js](https://nodejs.org) 18 o superiore.

```bash
npm install
npm start
```

L'app sarà disponibile su `http://localhost:3000`. Apri più schede/browser (o dispositivi sulla stessa rete) per simulare più giocatori.

## Come metterlo online

### 1. Carica il codice su GitHub

```bash
git init
git add .
git commit -m "Prima versione di Quiz Party"
git branch -M main
git remote add origin https://github.com/TUO-USERNAME/quiz-party.git
git push -u origin main
```

(Crea prima il repository vuoto su github.com, senza README, poi usa l'URL che ti dà.)

### 2. Metti online il server (necessario per il multiplayer)

⚠️ **GitHub da solo non basta**: GitHub Pages ospita solo file statici, non può far girare un server Node.js con WebSocket. Serve un hosting che esegua codice Node — te ne consiglio uno gratuito e semplice:

**Render.com** (consigliato, supporta WebSocket nel piano gratuito):
1. Vai su [render.com](https://render.com) e crea un account (puoi collegarti con GitHub).
2. "New +" → "Web Service" → seleziona il repository appena creato.
3. Impostazioni:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. Deploy. Dopo un paio di minuti avrai un URL tipo `https://quiz-party.onrender.com` da condividere con i tuoi amici.

Alternative equivalenti: **Railway.app**, **Fly.io**, oppure un piccolo VPS. Evita hosting "solo statici" (Netlify, Vercel senza funzioni serverless dedicate, GitHub Pages) perché non reggono le connessioni WebSocket persistenti di Socket.io.

⚠️ **Nota sulla persistenza delle domande aggiunte in-app**: sui piani gratuiti il filesystem può essere azzerato a ogni nuovo deploy. Le domande di base restano sempre (sono nel repository), ma le domande aggiunte dagli utenti tramite l'app potrebbero non sopravvivere a un redeploy. Per una persistenza solida in futuro, il modo più semplice è collegare un vero database (es. Postgres su Render/Supabase) al posto del file JSON — è un miglioramento possibile ma non necessario per iniziare a giocare.

## Come arrivare a 2000+ domande

Il gioco parte con **1728 domande** scritte a mano nel mazzo principale, divise in 18 categorie e **5 livelli di difficoltà** (facile, medio, difficile, super difficile, impossibile). 14 categorie sono incluse nella modalità "Tutte" (Storia, Geografia, Scienza e Natura, Sport, Cinema e TV, Serie TV, Musica, Cucina, Letteratura, Arte, Tecnologia, Fisica, Matematica, Cultura generale). Altre 4 sono **categorie di nicchia** — Automobili e Motori, Formula 1, Ingegneria del Veicolo, Calcio — pensate per gruppi di appassionati: **non compaiono mai nella modalità "Tutte"**, vanno selezionate esplicitamente (anche più di una insieme) dai tasti categoria quando si crea la partita. Il progetto può comunque continuare a crescere ulteriormente in due modi:

1. **Dall'interno del gioco**: c'è una schermata "Aggiungi una domanda" per inserirne di nuove una alla volta (utile per far contribuire tutto il gruppo di amici).
2. **In blocco via CSV**: usa lo script di importazione.

   Crea un file CSV con questa intestazione (in italiano, esattamente questi nomi colonna):

   ```csv
   categoria,difficolta,domanda,giallo,blu,arancione,verde,corretta
   Storia,facile,"In che anno è nata la Repubblica Italiana?",1946,1861,1918,1948,giallo
   ```

   - `difficolta`: `facile`, `medio`, `difficile`, `superdifficile` o `impossibile`
   - `corretta`: il colore giusto (`giallo`/`blu`/`arancione`/`verde`) oppure l'indice 0-3

   Poi importa con:

   ```bash
   node server/scripts/importCsv.js percorso/al/tuo/file.csv
   ```

   Puoi generare il CSV come preferisci: scrivendolo a mano, esportandolo da un foglio di calcolo, oppure chiedendo a un assistente AI di generartene un lotto in questo formato da incollare in un file — in quel caso ricontrolla sempre le risposte prima di importarle.

## Il presentatore-pupazzo

Il presentatore è un personaggio originale disegnato in SVG (non un'immagine, quindi resta leggero e si anima via CSS/JS: nessun asset grafico esterno da scaricare). Ogni battuta arriva dal server insieme a un "umore" (`neutral`, `happy`, `evil`, `laugh`, `shock`, `hype`, `celebrate`) che il client usa per cambiare bocca/sopracciglia del pupazzo e farlo "parlare" (bocca animata) mentre il fumetto è a schermo. Le frasi sono tutte in `server/lib/Host.js`, organizzate per momento di gioco: aggiungerne di nuove è questione di aggiungere righe agli array esistenti.

**Due modalità del presentatore**, scelte da chi crea la partita:
- **Family friendly** (default): battute pungenti ma senza turpiloquio, adatte a tutti.
- **Sboccato 🔞**: linguaggio diretto, sarcastico, con qualche parolaccia usata con criterio. È pensato per essere genuinamente cattivo — insulti mirati su risposte sbagliate, timeout, ultimo posto, eliminazioni — non solo leggermente più informale della versione family. Le prese in giro restano sempre rivolte alla prestazione nel gioco, mai a caratteristiche personali di chi gioca. La lobby mostra chiaramente ai giocatori quale modalità è attiva prima di iniziare, così nessuno viene colto di sorpresa.

**Battute a tema per categoria**: quando la domanda in corso appartiene a una categoria che si presta a un gioco di parole (per ora: Formula 1, Automobili e Motori, Ingegneria del Veicolo, Calcio), il presentatore ha una probabilità di scegliere una battuta scritta apposta sul tema invece di quella generica (es. "esce di pista con quella risposta" per una risposta sbagliata in Formula 1, "cartellino rosso" per il Calcio). Non è garantito che succeda ad ogni domanda — è voluto, per non essere ripetitivo — ma capita spesso ("quando possibile", come richiesto). Il meccanismo è generico (`CATEGORY_LINES` in `Host.js`): si può estendere ad altre categorie aggiungendo nuove voci nello stesso formato.

**Battuta specifica sulla risposta sbagliata**: quando i risultati di una domanda sono misti (qualcuno giusto, qualcuno sbagliato), il presentatore mostra due battute in sequenza — prima una lode a chi ha risposto meglio, poi una stoccata mirata su UN giocatore scelto a caso tra chi ha sbagliato (se più giocatori sbagliano la stessa domanda, ne viene preso in giro solo uno, non tutti in fila). Questa seconda battuta cita sempre la risposta reale data dal giocatore:
- Se la domanda ha una battuta scritta apposta per quella specifica risposta sbagliata (campo opzionale `wrongRoasts` nel file domande, es. "quello ha 6 zampe, {name}: quella è una formica, non un ragno"), usa quella.
- Altrimenti ricade su un modello generico (`wrongSpecific` in `Host.js`) che cita comunque la risposta esatta data ("Secondo {name} la risposta era 'X'. Imbarazzante.").

Circa 50 domande hanno già una battuta scritta a mano su misura (cercale con `grep -l wrongRoasts server/data/questions.json` o semplicemente aprendo il file); il meccanismo è pensato per crescere nel tempo aggiungendo altre voci `wrongRoasts` alle domande dove il collegamento è naturale, senza dover coprire tutte le domande per forza.

**Sorpresa quando l'ultimo in classifica risponde giusto**: se il giocatore che era ultimo in classifica PRIMA della domanda risponde correttamente, circa il 40% delle volte scatta una battuta di sorpresa dedicata al posto del solito commento (es. "Oh, vedo che {name} si sta riprendendo dalla sbronza"), invece della normale presa in giro dell'ultimo posto. Le due battute non compaiono mai insieme nella stessa domanda.

## Uscire dalla partita o dalla sessione

Una volta entrati in una stanza compare un pulsante 🚪 in alto a sinistra, sempre disponibile, con due opzioni distinte:

- **Esci da questa partita**: abbandoni solo la partita in corso. Non devi più rispondere alle domande né cliccare "Pronto" (quindi non blocchi più gli altri), ma resti nella stanza/sessione: se il presentatore avvia una nuova partita ("Nuova partita, stessa sessione"), rientri normalmente dall'inizio. Se abbandoni durante la fase a eliminazione, vieni trattato come eliminato in quel momento (non resti "in gara" senza poter rispondere).
- **Esci dalla sessione**: esci del tutto dalla stanza, come se chiudessi la scheda. Non puoi rientrare nella stessa stanza con lo stesso codice da questo dispositivo se non ricreando/ri-unendoti da capo.

Entrambe chiedono conferma prima di eseguire l'azione, per evitare click accidentali.

## Struttura del progetto

```
quiz-party/
├── package.json
├── server/
│   ├── server.js            # Express + Socket.io, gestione lobby/matchmaking/sessione
│   ├── lib/
│   │   ├── GameRoom.js      # Stato di gioco: fase 1, eliminazione a oltranza, brainfighting, punteggio di sessione
│   │   ├── QuestionBank.js  # Caricamento/filtro/aggiunta domande del mazzo principale
│   │   ├── BrainfightingBank.js  # Caricamento/filtro dei problemi della fase brainfighting
│   │   ├── GridGame.js      # Generazione e validazione delle sfide a griglia 2x2
│   │   ├── ImpostorGame.js  # Regole pure della modalità impostore (voto, morra, punteggio)
│   │   ├── ImpostorPhase.js # Svolgimento della modalità impostore dentro la stanza
│   │   └── Host.js          # Battute (e "umori") del presentatore virtuale
│   ├── data/questions.json  # Le 1728 domande del mazzo principale (+ quelle aggiunte)
│   ├── data/brainfighting.json  # I 497 problemi della fase brainfighting
│   ├── data/griddata.json   # Archivio soggetti/attributi per le sfide a griglia
│   ├── data/impostorwords.json  # 400 coppie parola-indizio per la modalità impostore
│   ├── data/rosters/        # Rose complete dei 24 club usati nella griglia del calcio
│   └── scripts/             # Import da CSV, parsing delle categorie Wikipedia, merge dei roster, griglia F1
├── public/
│   ├── index.html            # Schermate + markup del pupazzo SVG
│   ├── style.css             # Grafica in stile "show TV colorato" + animazioni
│   └── app.js                # Tutta la logica del client (schermate, socket, pupazzo)
└── test/                     # Test automatici: `npm test`
```

## Test

```
npm test
```

Quattro suite, 145 controlli, nessuna dipendenza da installare oltre a quelle del progetto. Girano sulla logica di gioco senza avviare il server (`io` viene simulato):

- `test_reconnect_ready.js` — chi deve premere "Pronto", e cosa ritrova chi rientra dopo una disconnessione;
- `test_brainfight_rules.js` — traguardo configurabile, resa sulla griglia, pareggi, soluzioni mostrate;
- `test_impostor.js` — regole della modalità impostore: parole, voto, morra, punteggio, imprevedibilità del ruolo;
- `test_impostor_phase.js` — manche intere giocate dall'inizio alla fine, compresa la verifica che la parola segreta non finisca mai in un evento visibile a tutti.

## Fase "brainfighting"

Se dopo 10 round della fase a eliminazione normale restano ancora **2 o più sopravvissuti**, la partita passa a una fase finale speciale: il brainfighting. Da qui in poi:

- **Nessuno viene mai eliminato**: si gioca sempre tra tutti quelli entrati in questa fase.
- Ogni problema è un **calcolo mentale** (2 minuti per prenotarsi) nella categoria scelta per la stanza, se ha contenuto adatto — altrimenti si ricade automaticamente sulle 5 categorie numeriche disponibili: Automobili e Motori, Formula 1, Ingegneria del Veicolo, Matematica, Fisica.
- Compare solo un **pulsante rosso "BUZZER"**: chi lo preme per primo si prenota. Solo lui vede le 4 opzioni diventare cliccabili; agli altri appaiono ma "sfumate" (non cliccabili).
- Una volta premuto il buzzer si hanno **solo 5 secondi** per scegliere: bisogna prenotarsi già sapendo la risposta, non si fa in tempo a risolvere il problema dopo.
- Nei problemi di calcolo compare una **piccola calcolatrice** sotto al buzzer (alcuni conti sono volutamente troppo lunghi da fare del tutto a mente).
- **Risposta giusta**: +1 punto, si passa a un problema completamente nuovo (opzioni fresche, difficoltà che sale di un livello).
- **Risposta sbagliata**: 0 punti, quel giocatore non può più riprenotarsi su **questo stesso problema** (potrà farlo dal prossimo), e la sua opzione sparisce dalle scelte per chi si prenota dopo di lui.
- Se **3 tentativi falliscono** sullo stesso problema, si passa comunque a uno nuovo, senza assegnare punti a nessuno: evita che qualcuno vinca un punto "per esclusione" sull'unica opzione rimasta, senza vero merito.
- **Vince l'intera partita** chi arriva per primo al traguardo, che si sceglie alla creazione della stanza (**1, 2, 3, 5 o 7 punti**; 3 di default). Se due giocatori ci arrivano appaiati — possibile, perché una griglia può premiare più giocatori insieme — si continua a oltranza finché uno non stacca l'altro: nessun campione sorteggiato.

Il mazzo dedicato (`server/data/brainfighting.json`, 497 problemi) non si ripete mai nella stessa sessione, con lo stesso criterio del mazzo principale.

### Modalità "Solo Brainfighting"

Alla creazione della partita si può scegliere **"Solo Brainfighting"** come modalità (accanto a Rush e Classica): si saltano del tutto fase 1 ed eliminazione, e si va dritti ai problemi col pulsante rosso tra tutti i giocatori collegati. Vince chi arriva per primo al traguardo scelto.

### Sfida a griglia 2×2

Per alcune categorie, al posto del problema col buzzer può comparire una **griglia 2×2**: due criteri sulle righe, due sulle colonne, e ogni casella va riempita con un soggetto che soddisfa **entrambi** i criteri incrociati. Qui **non c'è il buzzer**: tutti giocano contemporaneamente per 3 minuti.

- Il punto va a **chi ha completato più caselle**. A parità lo prendono **tutti i pari merito**; se la griglia resta bianca per tutti, non lo prende nessuno.
- Chi completa tutte e quattro le caselle chiude subito la sfida.
- Il pulsante **"Mi arrendo"** permette di ritirarsi: si tengono le caselle già completate, ma non se ne possono aggiungere altre. Se si arrendono tutti si passa subito ai risultati, senza aspettare lo scadere.
- A fine sfida, nelle caselle rimaste vuote compare **una risposta che sarebbe stata valida** (in corsivo, tratteggiata, per distinguerla da quelle indovinate).

- **Calcio**: squadre in cui si è giocato, trofei vinti, nazionalità (es. "Ha giocato nella Juventus" × "Ha giocato nel Real Madrid" → Zidane, Higuaín, Di María, Cannavaro...)
- **Formula 1**: scuderie per cui si è corso, titoli mondiali, nazionalità
- **Cinema e TV / Serie TV**: film e serie in cui si è recitato, registi, premi
- **Geografia**: confini, continente, sbocchi sul mare, dimensione, appartenenza a UE/euro

Regole della griglia: **qualunque** risposta che rispetti entrambi i criteri è valida (non c'è una sola soluzione "giusta"); si può sbagliare e riprovare all'infinito sulla stessa casella; **non si può usare lo stesso nome in due caselle diverse**. Per inserire un nome bisogna **cliccare il suggerimento** che compare digitando (evita ambiguità: scrivendo "Alonso" si conferma "Fernando Alonso"). Il generatore verifica sempre che la griglia sia completabile con 4 nomi distinti e scarta quelle banali risolvibili da un solo nome.

L'archivio dei soggetti è in `server/data/griddata.json`. **È scritto a mano e quindi parziale**: una risposta corretta ma non presente in archivio verrà rifiutata. L'autocomplete mitiga il problema mostrando solo i nomi effettivamente riconosciuti. Ampliare l'archivio è semplice: basta aggiungere voci con i loro attributi.

## Modalità "Impostore"

Un gioco di parole e bluff, senza domande a risposta multipla. **Servono almeno 5 giocatori**: sotto, il voto diventa un lancio di dado.

1. A ogni manche tutti ricevono la stessa **parola segreta**, tranne uno: l'**impostore**, che vede la scritta "Sei l'impostore" e solo un **indizio** della stessa famiglia (es. parola *Pizza*, indizio *Forno*).
2. **Tre giri di parole**: a turno ognuno consegna una parola sola che dimostri di conoscere quella segreta, senza regalarla all'impostore. Il turno passa appena la parola arriva (al massimo 45 secondi). Chi apre cambia a ogni giro, perché parlare per ultimi è un vantaggio enorme. Tutti vedono tutte le parole, divise per giocatore e per giro.
3. **Voto**: ognuno accusa chi pensa sia l'impostore. Vince l'accusa con più voti.
4. **Pareggio**: i pari merito si sfidano a **sasso-carta-forbice**, tutti insieme. Chi tira il simbolo vincente si salva, chi resta per ultimo è l'accusato. I tiri restano nascosti finché non hanno tirato tutti.
5. **Punti**:
   - impostore scoperto → un punto a chi lo ha votato (non a lui, se ha votato se stesso per mimetizzarsi);
   - impostore non scoperto → un punto a lui solo;
   - impostore scoperto che **indovina la parola** → ribalta la manche: punto suo, tutti gli altri a zero.

Chi crea la stanza sceglie il numero di manche (3, 5, 8, o **una a testa**, cioè tante quanti i giocatori). L'impostore viene sorteggiato dando più probabilità a chi lo è stato meno volte, ma mai in modo prevedibile: nemmeno all'ultima manche si può dedurre a chi tocca, e non capita mai due volte di fila alla stessa persona.

Le parole sono in `server/data/impostorwords.json` (**400 coppie parola-indizio su 20 temi**) e **non si ripetono mai nella stessa sessione**. La parola segreta e il ruolo non passano mai per un evento di stanza: vengono mandati solo al diretto interessato, così nemmeno aprendo la console del browser si scopre chi bluffa.

## Riconnessione e statistiche

Si può chiudere il browser a metà partita — per rispondere a un messaggio, per sbaglio, per un aggiornamento — e rientrare. Codice stanza e nickname restano salvati nel browser (per sei ore), e alla riapertura il gioco chiede da solo di rientrare (evento `lobby:reconnect`). Il server riconosce il giocatore dal nickname, gli restituisce **punteggio, qualificazione e stato di eliminazione** esattamente come li aveva lasciati, e gli ridisegna davanti il momento preciso della partita:

- **domanda ancora aperta**: la ritrova con il tempo che resta davvero, e può rispondere;
- **domanda chiusa**: la vede congelata, con la sua risposta se aveva fatto in tempo a darla, e il pulsante "Pronto";
- **griglia**: le caselle già indovinate tornano al loro posto;
- **buzz, classifica finale, modalità impostore**: ritrova la schermata corrente (nell'impostore, il proprio ruolo gli viene rimandato in privato).

Chi era spettatore resta spettatore, a meno che nel frattempo non sia iniziata una nuova partita. Il rientro funziona anche quando il server crede ancora che il vecchio socket sia collegato, caso tipico di chi chiude di colpo e riapre subito. Uscire volontariamente dalla sessione cancella il salvataggio.

**Regola di gioco da sapere**: nella fase a eliminazione chi si disconnette viene trattato come eliminato al round successivo. Se rientra mentre la domanda è ancora aperta torna in gara; se rientra dopo, resta fuori come spettatore.

Dopo ogni domanda, accanto al punteggio totale compaiono i **punti guadagnati o persi in quella domanda** (`+3`, `-1`, `0`), per capire a colpo d'occhio il perché di un sorpasso in classifica.

A fine partita, sotto la classifica di sessione, compaiono le **statistiche della serata**: Dito più veloce, Cecchino (miglior percentuale), Mano pesante (più errori), Mister punti, Il pensatore (più lento a rispondere) e Colto in flagrante (più risposte non date in tempo). Compaiono solo i premi che hanno davvero un vincitore.

## Criteri della griglia: attributi esaustivi e attributi parziali

La griglia accetta una risposta solo se il soggetto ha quell'attributo nel database. Se un tipo di dato è stato compilato solo per una parte dei soggetti, il gioco **rifiuta risposte corrette** — che per chi gioca è indistinguibile da un bug.

Il caso reale che ha fatto emergere il problema: Yannick Carrasco è belga e ha giocato nell'Atlético Madrid, ma nel database ha solo i club (è entrato tramite l'incrocio Atlético + Monaco, e i roster non portano la nazionalità). Una casella "Belgio × Atlético" lo dava per sbagliato.

La distinzione che conta **non** è quanti soggetti hanno l'attributo, ma:

- **Esaustivo** — se un soggetto ha quella proprietà, il database la conosce. "Ha vinto un Oscar" copre il 56% degli attori ed è corretto così: gli altri non l'hanno vinto.
- **Parziale** — il dato è stato compilato solo per alcuni soggetti, altri lo avrebbero. La nazionalità nel calcio è nota per i 342 giocatori originali e ignota per i 2240 arrivati dai roster.

Lo stesso vale **dentro** un tipo: nel database compaiono 81 club, ma di soli 24 abbiamo caricato la rosa completa. Gli altri (Ajax, Benfica, Porto…) ci sono solo perché citati nella scheda di qualche giocatore, quindi una casella "Ajax × Juventus" ricadrebbe nello stesso difetto. L'elenco dei club utilizzabili è in `CLUB_CON_ROSTER_COMPLETO`: caricando la rosa di un nuovo club, va aggiunto lì.

Solo i tipi esaustivi possono fare da intestazione di riga o colonna. L'elenco è in `CRITERIA_TYPES` dentro `server/lib/GridGame.js`. Per il calcio è ristretto ai soli **club** (completi al 100%, vengono dai roster); nazionalità e trofei restano nel database come informazione ma non vengono più proposti come criterio. Se un giorno la nazionalità venisse compilata per tutti, basta rimetterla in quell'elenco.

**Nota sulla categoria Cinema**: i soggetti sono gli **attori**, non i film. Una casella "diretto da Scorsese × diretto da Tarantino" chiede quindi un attore diretto da entrambi (DiCaprio), non un film co-diretto: è un incrocio valido. Le etichette dicono "È stato/a diretto/a da" proprio per evitare l'equivoco.

## Idee per migliorie future

- Persistenza delle domande su un vero database invece del file JSON.
- Voce sintetizzata per il presentatore invece del solo testo.
- Avatar/colori personalizzabili per i giocatori.
- Uno storico delle partite passate della sessione (non solo il totale cumulativo).
- Un pulsante "segnala domanda sbagliata" in partita, per raccogliere gli errori trovati giocando.
- Categoria "Meme italiani" (rimandata: servono riferimenti precisi per evitare imprecisioni).
- Estendere il brainfighting alle altre categorie, con contenuti diversi dal calcolo mentale (es. sagome di nazioni per Geografia).
