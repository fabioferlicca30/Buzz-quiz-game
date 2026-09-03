#!/usr/bin/env node
/**
 * Estrae i nomi dei giocatori dal testo grezzo di una pagina-categoria di Wikipedia
 * (quella che si ottiene selezionando e copiando la pagina "Categoria:Calciatori del ...").
 *
 * USO
 *   node server/scripts/parseWikiCategory.js <file-grezzo.txt> <slug-club>
 *   es: node server/scripts/parseWikiCategory.js /tmp/inter_raw.txt inter
 *
 * Scrive server/data/rosters/<slug-club>.txt con un nome per riga, pulito.
 * Poi basta lanciare mergeRosters.js per integrarlo nel gioco.
 */

const fs = require('fs');
const path = require('path');

// Righe di "rumore" tipiche della pagina-categoria: intestazioni, menu, piè di pagina.
const NOISE_PATTERNS = [
  /^wikipedia$/i,
  /^ricerca$/i,
  /^menu utente$/i,
  /^categoria:/i,
  /^lingua$/i,
  /^segui$/i,
  /^modifica$/i,
  /^questa categoria raccoglie/i,
  /^questa è una categoria aggiunta/i,
  /^collabora a wikimedia/i,
  /wikimedia commons contiene/i,
  /^indice/i,
  /^pagine nella categoria/i,
  /^questa categoria contiene/i,
  /^\(pagina precedente\)/i,
  /^ultima modifica/i,
  /^wikimedia foundation$/i,
  /^powered by mediawiki$/i,
  /^la pagina è stata renderizzata/i,
  /^il contenuto è disponibile/i,
  /^informativa sulla privacy/i,
  /^contatti legali/i,
  /^codice di condotta$/i,
  /^sviluppatori$/i,
  /^statistiche$/i,
  /^dichiarazione sui cookie$/i,
  /^condizioni d'uso$/i,
  /^vista desktop$/i,
  /^voce a caso$/i,
  /^inizio\s/i,
  /^calciatori del/i,
  /^calciatori dell/i,
  /e nazionali di calcio$/i,
  /^\d+$/,
];

// Righe che sono solo la lettera di sezione (A, B, C...) o l'indice alfabetico
function isSectionLetter(line) {
  return /^[A-Z0-9]$/.test(line) || /^0-9$/.test(line) || /^[A-Z]( [A-Z])+$/.test(line);
}

function isNoise(line) {
  if (!line) return true;
  if (isSectionLetter(line)) return true;
  return NOISE_PATTERNS.some((re) => re.test(line));
}

// "Giuseppe Albani (calciatore)" -> "Giuseppe Albani"
// "Alessandro Bianchi (calciatore 1966)" -> "Alessandro Bianchi"
// "Luca Ceccarelli (20 marzo 1983)" -> "Luca Ceccarelli"
function stripDisambiguation(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// Ripulisce i formati di copia-incolla: elenchi puntati ("• Nome", "* Nome", "- Nome")
// e link markdown ("[Nome](url)").
function stripListMarkup(line) {
  let s = line;
  // link markdown: [Testo](url) -> Testo
  s = s.replace(/^\s*[*\-•]\s*/, '');
  const md = s.match(/^\[([^\]]+)\]\([^)]*\)\s*$/);
  if (md) s = md[1];
  return s.trim();
}

function main() {
  const [, , inputPath, slug] = process.argv;
  if (!inputPath || !slug) {
    console.error('Uso: node parseWikiCategory.js <file-grezzo.txt> <slug-club>');
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf-8');
  const lines = raw.split('\n').map((l) => l.replace(/\u00a0/g, ' ').trim());

  const seen = new Set();
  const names = [];
  let skipped = 0;

  for (const line of lines) {
    const cleaned = stripListMarkup(line);
    if (isNoise(cleaned)) { skipped++; continue; }

    const name = stripDisambiguation(cleaned);
    if (!name || name.length < 3) { skipped++; continue; }
    // Un nome di persona ha almeno una lettera; scarta righe con troppa punteggiatura strana
    if (!/[a-zàèéìòùáéíóúäöüñçšžćčđ]/i.test(name)) { skipped++; continue; }
    // Scarta righe troppo lunghe (frasi, non nomi)
    if (name.split(/\s+/).length > 6) { skipped++; continue; }

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  const outPath = path.join(__dirname, '..', 'data', 'rosters', slug + '.txt');
  fs.writeFileSync(outPath, names.join('\n') + '\n', 'utf-8');

  console.log(`Righe lette      : ${lines.length}`);
  console.log(`Righe scartate   : ${skipped}`);
  console.log(`Nomi estratti    : ${names.length}`);
  console.log(`Scritto in       : ${outPath}`);
  console.log('');
  console.log('Primi 5 :', names.slice(0, 5).join(' | '));
  console.log('Ultimi 5:', names.slice(-5).join(' | '));
}

main();
