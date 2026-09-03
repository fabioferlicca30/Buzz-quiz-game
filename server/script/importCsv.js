// Importa domande in blocco da un CSV nel database (server/data/questions.json).
//
// Uso:
//   node server/scripts/importCsv.js percorso/al/file.csv
//
// Colonne attese (con intestazione nella prima riga):
//   categoria,difficolta,domanda,giallo,blu,arancione,verde,corretta
//
// - difficolta: facile | medio | difficile | superdifficile | impossibile
// - corretta: può essere l'indice (0=giallo,1=blu,2=arancione,3=verde)
//   oppure il nome del colore (giallo/blu/arancione/verde)
//
// Esempio di riga:
//   Storia,facile,"In che anno è nata la Repubblica Italiana?",1946,1861,1918,1948,0

const fs = require('fs');
const path = require('path');

const COLOR_TO_INDEX = { giallo: 0, blu: 1, arancione: 2, verde: 3 };

function parseCsv(content) {
  // Parser CSV minimale ma robusto per campi tra virgolette con virgole interne.
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && content[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: node server/scripts/importCsv.js percorso/al/file.csv');
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parseCsv(content);
  const header = rows.shift().map((h) => h.trim().toLowerCase());

  const idx = {
    categoria: header.indexOf('categoria'),
    difficolta: header.indexOf('difficolta'),
    domanda: header.indexOf('domanda'),
    giallo: header.indexOf('giallo'),
    blu: header.indexOf('blu'),
    arancione: header.indexOf('arancione'),
    verde: header.indexOf('verde'),
    corretta: header.indexOf('corretta'),
  };
  for (const [key, i] of Object.entries(idx)) {
    if (i === -1) { console.error(`Colonna mancante nell'intestazione: ${key}`); process.exit(1); }
  }

  const dataPath = path.join(__dirname, '..', 'data', 'questions.json');
  const existing = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  let added = 0;
  let skipped = 0;
  let counter = existing.length + 1;

  for (const r of rows) {
    if (!r[idx.domanda] || !r[idx.domanda].trim()) { skipped++; continue; }
    const category = r[idx.categoria].trim();
    const difficulty = r[idx.difficolta].trim().toLowerCase();
    const text = r[idx.domanda].trim();
    const answers = [r[idx.giallo], r[idx.blu], r[idx.arancione], r[idx.verde]].map((a) => (a || '').trim());
    let correctRaw = (r[idx.corretta] || '').trim().toLowerCase();
    let correctIndex = COLOR_TO_INDEX[correctRaw] !== undefined ? COLOR_TO_INDEX[correctRaw] : parseInt(correctRaw, 10);

    if (!category || !['facile', 'medio', 'difficile', 'superdifficile', 'impossibile'].includes(difficulty) || answers.some((a) => !a) || isNaN(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      console.warn('Riga scartata (dati non validi):', r.join(' | '));
      skipped++;
      continue;
    }

    existing.push({
      id: 'imp' + counter.toString(36) + Date.now().toString(36).slice(-4),
      category,
      difficulty,
      text,
      answers,
      correctIndex,
    });
    counter++;
    added++;
  }

  fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2), 'utf-8');
  console.log(`Importate ${added} domande (${skipped} righe scartate). Totale ora: ${existing.length}`);
}

main();
