const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'griddata.json');

// Mappa categoria del gioco -> dataset della griglia
const CATEGORY_TO_DATASET = {
  Calcio: 'calcio',
  'Formula 1': 'formula1',
  'Cinema e TV': 'cinema',
  'Serie TV': 'cinema',
  Geografia: 'geografia',
};

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // toglie gli accenti
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class GridGame {
  constructor() {
    this.data = {};
    this.load();
  }

  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    } catch (err) {
      console.error('Impossibile leggere griddata.json.', err);
      this.data = {};
    }
  }

  // Le categorie di gioco che supportano la sfida a griglia.
  supportsCategory(category) {
    const key = CATEGORY_TO_DATASET[category];
    return Boolean(key && this.data[key] && Object.keys(this.data[key].subjects || {}).length > 0);
  }

  supportedCategories() {
    return Object.keys(CATEGORY_TO_DATASET).filter((c) => this.supportsCategory(c));
  }

  // Etichetta leggibile di un attributo: "club:Juventus" -> "Ha giocato nel/nella Juventus"
  labelFor(datasetKey, attr) {
    const [type, value] = attr.split(':');
    const prefix = (this.data[datasetKey].criteria || {})[type];
    if (!prefix) return value;
    return prefix ? `${prefix} ${value}` : value;
  }

  // Tutti i soggetti che hanno ENTRAMBI gli attributi indicati.
  solutionsFor(datasetKey, attrA, attrB) {
    const subjects = this.data[datasetKey].subjects || {};
    return Object.keys(subjects).filter((name) => subjects[name].includes(attrA) && subjects[name].includes(attrB));
  }

  // Genera una griglia 2x2: 2 criteri per le righe, 2 per le colonne, con la garanzia che
  // OGNI casella abbia almeno una risposta valida. Restituisce null se non ci riesce.
  generateGrid(category) {
    const datasetKey = CATEGORY_TO_DATASET[category];
    if (!datasetKey || !this.data[datasetKey]) return null;
    const subjects = this.data[datasetKey].subjects || {};

    // Raccoglie tutti gli attributi che compaiono almeno 2 volte (altrimenti è troppo difficile).
    const counts = {};
    for (const attrs of Object.values(subjects)) {
      for (const a of attrs) counts[a] = (counts[a] || 0) + 1;
    }
    const usable = Object.keys(counts).filter((a) => counts[a] >= 2);
    if (usable.length < 4) return null;

    // Prova più volte una combinazione casuale valida.
    for (let attempt = 0; attempt < 400; attempt++) {
      const shuffled = [...usable].sort(() => Math.random() - 0.5);
      const rows = shuffled.slice(0, 2);
      const cols = shuffled.slice(2, 4);

      // Righe e colonne non devono essere dello stesso "tipo" incrociato in modo assurdo
      // (es. due volte lo stesso attributo), e le 4 celle devono avere soluzioni.
      const all = [...rows, ...cols];
      if (new Set(all).size !== 4) continue;

      // Evita che riga e colonna siano lo stesso tipo con valori che si escludono a vicenda
      // (es. "Nazionalità Italia" x "Nazionalità Francia" non ha soluzioni possibili).
      let ok = true;
      const cells = [];
      for (const r of rows) {
        for (const c of cols) {
          const sols = this.solutionsFor(datasetKey, r, c);
          if (sols.length === 0) { ok = false; break; }
          cells.push({ row: r, col: c, solutions: sols });
        }
        if (!ok) break;
      }
      if (!ok) continue;

      // Scarta le griglie banali: se esiste un unico soggetto che risolve da solo tutte e 4 le
      // caselle, il gioco perde interesse (basta scriverlo quattro volte).
      const commonToAll = cells[0].solutions.filter((name) => cells.every((cell) => cell.solutions.includes(name)));
      if (commonToAll.length > 0) continue;

      // Verifica che la griglia sia DAVVERO completabile: servono 4 nomi DISTINTI, uno per
      // casella (non si può riusare lo stesso nome). Senza questo controllo si generano griglie
      // impossibili, in cui una casella ha come unica soluzione un nome già necessario altrove.
      if (!this.hasPerfectMatching(cells)) continue;

      return {
        category,
        datasetKey,
        rows: rows.map((r) => ({ attr: r, label: this.labelFor(datasetKey, r) })),
        cols: cols.map((c) => ({ attr: c, label: this.labelFor(datasetKey, c) })),
        // Le soluzioni NON vengono mai inviate al client: restano solo lato server.
        cells,
      };
    }
    return null;
  }

  // Verifica (con backtracking, sono solo 4 caselle) che si possa assegnare a ciascuna casella
  // un nome DIVERSO: garantisce che la griglia sia completabile secondo le regole del gioco.
  hasPerfectMatching(cells) {
    const used = new Set();
    const assign = (i) => {
      if (i === cells.length) return true;
      for (const name of cells[i].solutions) {
        if (used.has(name)) continue;
        used.add(name);
        if (assign(i + 1)) return true;
        used.delete(name);
      }
      return false;
    };
    return assign(0);
  }

  // Elenco di nomi per l'autocomplete lato client (non rivela le soluzioni: è l'intero archivio).
  allSubjectNames(datasetKey) {
    return Object.keys(this.data[datasetKey].subjects || {}).sort();
  }

  // Verifica se `answer` è valida per la casella (riga, colonna) indicata.
  // Restituisce il nome canonico se valida, altrimenti null.
  checkAnswer(datasetKey, rowAttr, colAttr, answer) {
    if (!answer || !answer.trim()) return null;
    const target = normalize(answer);
    const subjects = this.data[datasetKey].subjects || {};
    for (const name of Object.keys(subjects)) {
      if (normalize(name) === target) {
        const attrs = subjects[name];
        if (attrs.includes(rowAttr) && attrs.includes(colAttr)) return name;
        return null; // nome riconosciuto ma non soddisfa i criteri di questa casella
      }
    }
    return null; // nome non presente nell'archivio
  }
}

module.exports = new GridGame();
