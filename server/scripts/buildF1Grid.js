#!/usr/bin/env node
/**
 * Genera gli attributi della griglia di Formula 1 a partire da server/data/f1stints.js
 * (chi ha corso per quale scuderia e in quali anni).
 *
 * COSA PRODUCE
 *   - team:<Scuderia>          -> "Ha corso per <Scuderia>"
 *   - compagno:<Nome Pilota>   -> "È stato compagno di squadra di <Nome Pilota>"
 *     (calcolato: due piloti nello stesso team con anni sovrapposti)
 *
 * Non tocca gli attributi già presenti (nazionalità, titolo mondiale): li conserva.
 *
 * USO: node server/scripts/buildF1Grid.js
 */

const fs = require('fs');
const path = require('path');

const STINTS = require('../data/f1stints');
const GRID_PATH = path.join(__dirname, '..', 'data', 'griddata.json');

// Un pilota diventa un criterio "compagno di squadra" solo se è abbastanza noto,
// cioè se ha avuto almeno questo numero di compagni nel dataset. Evita criteri
// basati su piloti oscuri che renderebbero la casella indovinabile solo per fortuna.
const MIN_MATES_TO_BE_CRITERION = 4;

function overlaps(a, b) {
  // a e b sono [team, annoInizio, annoFine]
  return a[0] === b[0] && a[1] <= b[2] && b[1] <= a[2];
}

function main() {
  const grid = JSON.parse(fs.readFileSync(GRID_PATH, 'utf-8'));
  const subjects = grid.formula1.subjects;
  const drivers = Object.keys(STINTS);

  // 1) Calcola le coppie di compagni di squadra
  const mates = {};
  for (let i = 0; i < drivers.length; i++) {
    for (let j = i + 1; j < drivers.length; j++) {
      const a = drivers[i];
      const b = drivers[j];
      const together = STINTS[a].some((sa) => STINTS[b].some((sb) => overlaps(sa, sb)));
      if (together) {
        (mates[a] = mates[a] || new Set()).add(b);
        (mates[b] = mates[b] || new Set()).add(a);
      }
    }
  }

  // 2) Applica gli attributi
  let addedTeams = 0;
  let addedMates = 0;
  let newDrivers = 0;

  for (const driver of drivers) {
    if (!subjects[driver]) { subjects[driver] = []; newDrivers++; }
    const attrs = new Set(subjects[driver]);

    // squadre (dalle stint, così restano allineate agli anni)
    for (const [team] of STINTS[driver]) {
      if (!attrs.has('team:' + team)) { attrs.add('team:' + team); addedTeams++; }
    }

    // compagni di squadra: si aggiunge l'attributo solo verso piloti "abbastanza noti"
    for (const mate of mates[driver] || []) {
      const mateIsCriterion = (mates[mate] || new Set()).size >= MIN_MATES_TO_BE_CRITERION;
      if (!mateIsCriterion) continue;
      if (!attrs.has('compagno:' + mate)) { attrs.add('compagno:' + mate); addedMates++; }
    }

    subjects[driver] = [...attrs].sort();
  }

  // 3) Registra la nuova etichetta di criterio
  grid.formula1.criteria.compagno = 'È stato compagno di squadra di';

  fs.writeFileSync(GRID_PATH, JSON.stringify(grid, null, 2) + '\n', 'utf-8');

  console.log('Piloti con stint elaborati :', drivers.length);
  console.log('Nuovi piloti aggiunti      :', newDrivers);
  console.log('Attributi squadra aggiunti :', addedTeams);
  console.log('Attributi compagno aggiunti:', addedMates);
  console.log('Totale piloti nel dataset  :', Object.keys(subjects).length);
}

main();
