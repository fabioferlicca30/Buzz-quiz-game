# Quiz Party — clone di Buzz!

Quiz party multiplayer ispirato a *Buzz!* per PS2: risposte a scelta multipla abbinate a 4 tasti colorati (giallo, blu, arancione, verde), un presentatore-pupazzo animato con battute (anche cattive) e una fase a eliminazione che dura finché non resta un solo imbattuto. Il punteggio si accumula anche tra più partite giocate di fila nella stessa sessione.

Stack: **Node.js + Express + Socket.io** sul backend, **HTML/CSS/JS puro** sul frontend (nessun build step, nessun framework). Le domande vivono in un file JSON, niente database esterno da configurare.

## Come funziona il gioco

1. Un giocatore crea una partita scegliendo: visibilità (**chiusa** con codice a 5 caratteri, o **aperta** a chiunque), modalità, livello di difficoltà e categoria.
2. Gli altri entrano con il codice oppure scelgono la partita dalla lista di quelle **aperte**.
3. **Fase 1**: 10 domande a risposta multipla, 10 secondi a testa per rispondere.
   - **Modalità Rush**: chi risponde correttamente più veloce prende più punti (1°=3, 2°=2, 3°=1, dal 4° in poi 0), risposta sbagliata = -1.
   - **Modalità Classica**: punti fissi (2) a chiunque risponda giusto entro i 10 secondi, indipendentemente dalla velocità; sbagliare non toglie punti.
4. Finita la Fase 1, il migliore **50% (arrotondato per eccesso, minimo 2)** dei giocatori collegati accede alla **fase a eliminazione**. Gli altri diventano spettatori e vedono comunque lo show.
5. **Fase a eliminazione (a oltranza)**: stessa domanda per tutti i qualificati, contemporaneamente.
   - Chi risponde male è eliminato.
   - Se **sbagliano tutti**, per regola non viene eliminato nessuno: si va avanti comunque con una nuova domanda.
   - Se **rispondono tutti bene**, nessuna eliminazione: si continua con una domanda più difficile.
   - La difficoltà sale di un livello a ogni round (fino a fermarsi su "difficile") e le domande vengono pescate senza ripetizioni finché il mazzo non si esaurisce, nel qual caso il mazzo si ricicla: la fase può durare, in teoria, all'infinito.
   - Si va avanti così finché non resta **un solo giocatore che non ha mai risposto male** in questa fase: è lui il vincitore della partita.
6. **Punteggio di sessione**: alla fine di ogni partita si assegnano punti cumulativi in base al piazzamento finale — **1000 punti al 1° posto, 500 al 2°, 250 al 3°, 0 dal 4° in poi**. Il presentatore può avviare subito una nuova partita nella stessa stanza (stesso gruppo di giocatori): il punteggio di sessione si somma partita dopo partita, per un vero e proprio torneo della serata.
7. Il presentatore virtuale — un pupazzetto animato che parla e cambia espressione — commenta ogni domanda, ogni risposta e l'esito finale con frasi scelte a caso da un elenco (alcune scherzose, altre più pungenti, incluse battute mirate su chi è ultimo in classifica o su chi domina/arranca nella classifica cumulativa di sessione).

### Alcune scelte di design (dove le regole non erano specificate nel dettaglio)

Ho dovuto decidere alcuni dettagli che non avevi specificato — sono facilmente modificabili nel codice se non ti piacciono:

- **Punti modalità Classica**: 2 punti per risposta corretta, 0 per sbagliata/nessuna risposta. Modificabile in `server/lib/GameRoom.js`, funzione `resolveQuestion`.
- **Nessuna risposta data (Rush)**: vale 0 punti, non -1 (la penalità si applica solo a una risposta sbagliata data attivamente). Durante la fase a eliminazione, invece, non rispondere in tempo conta come "sbagliare" ai fini dell'eliminazione (coerente con lo spirito "chi non risponge giusto è fuori").
- **Piazzamento oltre il vincitore**: chi viene eliminato più tardi nella fase a eliminazione piazza meglio di chi è uscito prima; a parità di round di eliminazione, si usa come spareggio il punteggio di Fase 1. Chi non si è nemmeno qualificato per la fase a eliminazione piazza sotto tutti i qualificati, ordinato per punteggio di Fase 1.
- **Riciclo delle domande in eliminazione**: per garantire che la fase possa davvero durare "all'infinito" anche con un mazzo di domande finito, una volta esaurite le domande disponibili per la difficoltà/categoria scelta il mazzo si ricicla (possono ripresentarsi domande già viste in quella fase). Fase 1 invece non ripete mai domande all'interno della stessa partita.
- **Classifica di sessione per nickname**: il punteggio cumulativo di sessione è associato al nickname scelto dal giocatore (non al socket/dispositivo), così regge anche se qualcuno si riconnette con una scheda diversa. Di conseguenza, due giocatori con lo stesso identico nickname nella stessa sessione condividerebbero il punteggio cumulativo: è un'ipotesi ragionevole per un gioco tra amici, ma tienilo a mente se il tuo gruppo ama i nomi doppi.
- **Battute "a sorpresa" sulla classifica**: circa una volta ogni tre domande della Fase 1, con più di 2 giocatori in gioco, il presentatore ha una probabilità di prendere in giro chi è ultimo in classifica invece del commento standard. È volutamente casuale, per non essere ripetitivo.
- **Codice partita**: 5 caratteri alfanumerici (senza caratteri ambigui tipo 0/O o 1/I).

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

Il gioco parte con **312 domande** scritte a mano, divise in 13 categorie (Storia, Geografia, Scienza e Natura, Sport, Cinema e TV, Musica, Cucina, Letteratura, Arte, Tecnologia, Fisica, Matematica, Cultura generale) e 3 livelli di difficoltà. Scriverne 2000 di qualità a mano non era realistico in un'unica sessione, quindi il progetto è pensato per crescere in due modi:

1. **Dall'interno del gioco**: c'è una schermata "Aggiungi una domanda" per inserirne di nuove una alla volta (utile per far contribuire tutto il gruppo di amici).
2. **In blocco via CSV**: usa lo script di importazione.

   Crea un file CSV con questa intestazione (in italiano, esattamente questi nomi colonna):

   ```csv
   categoria,difficolta,domanda,giallo,blu,arancione,verde,corretta
   Storia,facile,"In che anno è nata la Repubblica Italiana?",1946,1861,1918,1948,giallo
   ```

   - `difficolta`: `facile`, `medio` o `difficile`
   - `corretta`: il colore giusto (`giallo`/`blu`/`arancione`/`verde`) oppure l'indice 0-3

   Poi importa con:

   ```bash
   node server/scripts/importCsv.js percorso/al/tuo/file.csv
   ```

   Puoi generare il CSV come preferisci: scrivendolo a mano, esportandolo da un foglio di calcolo, oppure chiedendo a un assistente AI di generartene un lotto in questo formato da incollare in un file — in quel caso ricontrolla sempre le risposte prima di importarle.

## Il presentatore-pupazzo

Il presentatore è un personaggio originale disegnato in SVG (non un'immagine, quindi resta leggero e si anima via CSS/JS: nessun asset grafico esterno da scaricare). Ogni battuta arriva dal server insieme a un "umore" (`neutral`, `happy`, `evil`, `laugh`, `shock`, `hype`, `celebrate`) che il client usa per cambiare bocca/sopracciglia del pupazzo e farlo "parlare" (bocca animata) mentre il fumetto è a schermo. Le frasi sono tutte in `server/lib/Host.js`, organizzate per momento di gioco: aggiungerne di nuove è questione di aggiungere righe agli array esistenti.

## Struttura del progetto

```
buzz-clone/
├── package.json
├── server/
│   ├── server.js            # Express + Socket.io, gestione lobby/matchmaking/sessione
│   ├── lib/
│   │   ├── GameRoom.js      # Stato di gioco: fase 1, eliminazione a oltranza, punteggio di sessione
│   │   ├── QuestionBank.js  # Caricamento/filtro/aggiunta domande
│   │   └── Host.js          # Battute (e "umori") del presentatore virtuale
│   ├── data/questions.json  # Le 312 domande di base (+ quelle aggiunte)
│   └── scripts/importCsv.js # Import in blocco da CSV
└── public/
    ├── index.html            # Schermate + markup del pupazzo SVG
    ├── style.css             # Grafica in stile "show TV colorato" + animazioni
    └── app.js                # Tutta la logica del client (schermate, socket, pupazzo)
```

## Idee per migliorie future

- Persistenza delle domande su un vero database invece del file JSON.
- Riconnessione automatica di un giocatore che perde la connessione a metà partita.
- Voce sintetizzata per il presentatore invece del solo testo.
- Avatar/colori personalizzabili per i giocatori.
- Uno storico delle partite passate della sessione (non solo il totale cumulativo).
