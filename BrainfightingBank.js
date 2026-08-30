const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'brainfighting.json');

// Mazzo dei problemi della fase "brainfighting" (calcoli a mente). Oggi disponibile solo
// per le categorie numeriche: Automobili e Motori, Formula 1, Ingegneria del Veicolo,
// Matematica, Fisica. Se la stanza ha scelto altre categorie (o "tutte"), si ricade
// automaticamente su queste 5, dato che il brainfighting è una fase a sé con contenuti suoi.
class BrainfightingBank {
  constructor() {
    this.problems = [];
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(DATA_PATH, 'utf-8');
      this.problems = JSON.parse(raw);
    } catch (err) {
      console.error('Impossibile leggere brainfighting.json, parto da un elenco vuoto.', err);
      this.problems = [];
    }
  }

  getAll() {
    return this.problems;
  }

  getCategories() {
    return [...new Set(this.problems.map((p) => p.category))].sort();
  }

  // category: stringa singola, array di categorie, o assente/vuoto (= tutte quelle disponibili
  // per il brainfighting). Se le categorie richieste non hanno contenuto brainfighting,
  // si ricade automaticamente su tutte quelle disponibili.
  pickQuestion({ difficulty, category, excludeIds = new Set() }) {
    const available = this.getCategories();
    let categoryList = null;
    if (Array.isArray(category)) {
      categoryList = category.filter((c) => available.includes(c));
      if (categoryList.length === 0) categoryList = null;
    } else if (category && available.includes(category)) {
      categoryList = [category];
    }

    let pool = this.problems.filter((p) => !excludeIds.has(p.id) && (!categoryList || categoryList.includes(p.category)));

    if (difficulty && difficulty !== 'misto') {
      const byDiff = pool.filter((p) => p.difficulty === difficulty);
      if (byDiff.length > 0) pool = byDiff;
    }

    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

module.exports = new BrainfightingBank();
