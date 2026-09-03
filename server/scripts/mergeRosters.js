#!/usr/bin/env node
/**
 * Unisce le liste di giocatori (una per club) dentro a griddata.json.
 *
 * COME SI USA
 *   1. Metti un file .txt per club in server/data/rosters/
 *      Il nome del file è lo slug del club (es. juventus.txt, real-madrid.txt).
 *      Dentro: un giocatore per riga. Righe vuote ignorate.
 *   2. Esegui:  node server/scripts/mergeRosters.js
 *
 * COSA FA
 *   - Normalizza i nomi (accenti, maiuscole, spazi) per riconoscere che
 *     "Gonzalo Higuaín" e "Gonzalo Higuain" sono la stessa persona.
 *   - Tiene SOLO i giocatori che compaiono in almeno 2 club tra quelli forniti,
 *     oppure che erano già nel dataset (quelli hanno anche trofei/nazionalità).
 *     Un giocatore con un solo club e nessun altro attributo non serve al gioco.
 *   - Conserva trofei e nazionalità già presenti nel dataset esistente.
 *   - Non cancella mai i giocatori già presenti: al massimo li arricchisce.
 */

const fs = require('fs');
const path = require('path');

const ROSTERS_DIR = path.join(__dirname, '..', 'data', 'rosters');
const GRID_PATH = path.join(__dirname, '..', 'data', 'griddata.json');

// slug del file -> nome del club come appare nel gioco
const SLUG_TO_CLUB = {
  juventus: 'Juventus',
  milan: 'Milan',
  inter: 'Inter',
  napoli: 'Napoli',
  roma: 'Roma',
  'real-madrid': 'Real Madrid',
  barcellona: 'Barcellona',
  'atletico-madrid': 'Atletico Madrid',
  valencia: 'Valencia',
  siviglia: 'Sevilla',
  sevilla: 'Sevilla',
  'manchester-united': 'Manchester United',
  liverpool: 'Liverpool',
  arsenal: 'Arsenal',
  chelsea: 'Chelsea',
  'manchester-city': 'Manchester City',
  tottenham: 'Tottenham',
  'bayern-monaco': 'Bayern Monaco',
  'borussia-dortmund': 'Borussia Dortmund',
  'bayer-leverkusen': 'Bayer Leverkusen',
  psg: 'Paris Saint-Germain',
  'paris-saint-germain': 'Paris Saint-Germain',
  marsiglia: 'Marsiglia',
  lione: 'Lione',
  monaco: 'Monaco',
};

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function main() {
  if (!fs.existsSync(ROSTERS_DIR)) {
    console.error('Cartella non trovata:', ROSTERS_DIR);
    process.exit(1);
  }

  const grid = JSON.parse(fs.readFileSync(GRID_PATH, 'utf-8'));
  const existing = grid.calcio.subjects;

  // indice dei nomi già presenti: forma normalizzata -> nome canonico nel dataset
  const canonicalByNorm = new Map();
  for (const name of Object.keys(existing)) canonicalByNorm.set(normalize(name), name);

  // Legge tutti i roster
  const files = fs.readdirSync(ROSTERS_DIR).filter((f) => f.endsWith('.txt'));
  if (files.length === 0) {
    console.error('Nessun file .txt in', ROSTERS_DIR);
    process.exit(1);
  }

  // norm -> { display, clubs:Set }
  const fromRosters = new Map();

  for (const file of files) {
    const slug = path.basename(file, '.txt');
    const club = SLUG_TO_CLUB[slug];
    if (!club) {
      console.warn(`  ! ignoro "${file}": slug sconosciuto. Slug validi: ${Object.keys(SLUG_TO_CLUB).join(', ')}`);
      continue;
    }
    const lines = fs
      .readFileSync(path.join(ROSTERS_DIR, file), 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    let added = 0;
    for (const raw of lines) {
      const norm = normalize(raw);
      if (!norm) continue;
      if (!fromRosters.has(norm)) fromRosters.set(norm, { display: raw, clubs: new Set() });
      fromRosters.get(norm).clubs.add(club);
      added++;
    }
    console.log(`  ${club.padEnd(22)} ${added} nomi letti da ${file}`);
  }

  // Applica al dataset
  let arricchiti = 0;
  let nuovi = 0;
  let scartati = 0;

  for (const [norm, info] of fromRosters.entries()) {
    const canonical = canonicalByNorm.get(norm);

    if (canonical) {
      // Giocatore già nel dataset: aggiungo i club mancanti, mantengo tutto il resto.
      const attrs = new Set(existing[canonical]);
      let changed = false;
      for (const club of info.clubs) {
        if (!attrs.has('club:' + club)) { attrs.add('club:' + club); changed = true; }
      }
      if (changed) { existing[canonical] = [...attrs].sort(); arricchiti++; }
      continue;
    }

    // Non presente: lo aggiungo solo se ha almeno 2 club (altrimenti è inutile al gioco)
    if (info.clubs.size >= 2) {
      existing[info.display] = [...info.clubs].map((c) => 'club:' + c).sort();
      canonicalByNorm.set(norm, info.display);
      nuovi++;
    } else {
      scartati++;
    }
  }

  fs.writeFileSync(GRID_PATH, JSON.stringify(grid, null, 2) + '\n', 'utf-8');

  console.log('');
  console.log(`Giocatori già presenti arricchiti con nuovi club : ${arricchiti}`);
  console.log(`Giocatori nuovi aggiunti (2+ club)               : ${nuovi}`);
  console.log(`Scartati (1 solo club, nessun altro attributo)   : ${scartati}`);
  console.log(`TOTALE giocatori nel dataset                     : ${Object.keys(existing).length}`);
}

main();
