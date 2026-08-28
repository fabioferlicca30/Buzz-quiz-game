const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'questions.json');

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
  pickQuestions({ count, difficulty, category, excludeIds = new Set() }) {
    let pool = this.questions.filter((q) => !excludeIds.has(q.id));
    if (category && category !== 'tutte') pool = pool.filter((q) => q.category === category);
    if (difficulty && difficulty !== 'misto') pool = pool.filter((q) => q.difficulty === difficulty);

    // Se il pool filtrato non basta, allarga gradualmente i criteri per non bloccare la partita.
    if (pool.length < count && difficulty && difficulty !== 'misto') {
      const fallback = this.questions.filter((q) => !excludeIds.has(q.id) && (!category || category === 'tutte' || q.category === category));
      pool = fallback;
    }
    if (pool.length < count) {
      pool = this.questions.filter((q) => !excludeIds.has(q.id));
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
