#!/usr/bin/env node
/* Bericht als eigenes Dokument.
   node tools/report.js kernel/main.latch "Latch OS" > kernel/REPORT.md
   Weitere Dateien im selben Ordner sind die Module, der Dateiname ist der Modulname. */
const fs = require('fs'), path = require('path');
const { Latch } = require('../src/latch.js');

function load(file) {
  const dir = path.dirname(file), modules = {};
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.latch') && path.join(dir, f) !== path.normalize(file)) modules[f.replace(/\.latch$/, '')] = fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return { src: fs.readFileSync(file, 'utf8'), modules };
}
function report(file, title) {
  const { src, modules } = load(file);
  /* Tests sind rein, ihr Ergebnis hängt nicht von der Außenwelt ab. main läuft hier nicht mit. */
  const r = Latch.run(src.replace(/\r/g, ''), 'forever = 0', modules);
  return Latch.reportDocument(r, title || path.basename(file));
}
module.exports = { report, load };
if (require.main === module) {
  if (process.argv.length < 3) { console.error('Aufruf: node tools/report.js datei.latch ["Titel"]'); process.exit(2); }
  process.stdout.write(report(process.argv[2], process.argv[3]));
}
