const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'questions.json');

// Categorie "di nicchia": non entrano mai nella modalità "Tutte" per default,
// vanno selezionate esplicitamente dal menu categoria.
const NICHE_CATEGORIES = new Set(['Automobili e Motori', 'Formula 1', 'Ingegneria del Veicolo', 'Calcio']);

class QuestionBank {
  constructor() {
    this.questions = [];
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(DATA_PATH, 'utf-8');
      this.questions = JSON.parse(raw);
    } catch (err) {
      console.error('Impossibile leggere questions.json, parto da un elenco vuoto.', err);
      this.questions = [];
    }
  }

  persist() {
    fs.writeFile(DATA_PATH, JSON.stringify(this.questions, null, 2), 'utf-8', (err) => {
      if (err) console.error('Errore salvataggio questions.json:', err);
    });
  }

  getAll() {
    return this.questions;
  }

  getCategories() {
    return [...new Set(this.questions.map((q) => q.category))].sort();
  }

  // Categorie selezionabili solo manualmente (mai incluse di default in "Tutte").
  getNicheCategories() {
    return [...NICHE_CATEGORIES].sort();
  }

  addQuestion({ category, difficulty, text, answers, correctIndex }) {
    if (!category || !difficulty || !text) throw new Error('Campi mancanti');
    if (!Array.isArray(answers) || answers.length !== 4 || answers.some((a) => !a || !a.trim())) {
      throw new Error('Servono esattamente 4 risposte non vuote');
    }
    if (!['facile', 'medio', 'difficile'].includes(difficulty)) {
      throw new Error('Difficoltà non valida');
    }
    if (typeof correctIndex !== 'number' || correctIndex < 0 || correctIndex > 3) {
      throw new Error('Indice risposta corretta non valido');
    }
    const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const question = { id, category, difficulty, text: text.trim(), answers: answers.map((a) => a.trim()), correctIndex };
    this.questions.push(question);
    this.persist();
    return question;
  }

  // Estrae `count` domande casuali che rispettano i filtri, senza ripetere gli id già usati.
  // Se la categoria richiesta è "tutte" (o non specificata), le categorie di nicchia vengono
  // escluse dal pool: entrano in gioco solo se l'utente le seleziona esplicitamente.
  pickQuestions({ count, difficulty, category, excludeIds = new Set() }) {
    const categoryExplicit = category && category !== 'tutte';

    // basePool rispetta SEMPRE la categoria esplicita (se presente) e l'esclusione delle
    // categorie di nicchia quando non richieste esplicitamente. Ogni ulteriore allargamento
    // del pool (sotto) riguarda solo la difficoltà: non fa mai "uscire" né dalla categoria
    // scelta né dal divieto di nicchia in "tutte".
    const basePool = this.questions.filter((q) => {
      if (excludeIds.has(q.id)) return false;
      if (categoryExplicit) return q.category === category;
      return !NICHE_CATEGORIES.has(q.category);
    });

    let pool = basePool;
    if (difficulty && difficulty !== 'misto') pool = pool.filter((q) => q.difficulty === difficulty);

    // Se il pool filtrato per difficoltà non basta, allarghiamo ignorando la difficoltà,
    // ma restando dentro a basePool (categoria/niche corrette).
    if (pool.length < count) {
      pool = basePool;
    }

    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  pickOneByDifficulty(difficulty, excludeIds = new Set()) {
    const list = this.pickQuestions({ count: 1, difficulty, excludeIds });
    return list[0] || null;
  }
}

module.exports = new QuestionBank();
