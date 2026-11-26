const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../site/index.html', 'utf8');
const { Latch } = require('../src/latch.js');
const a = html.indexOf('var TYPES = ['), b = html.indexOf('var $ = function');
const EXAMPLES = new Function(html.slice(a, b) + '; return EXAMPLES;')();
for (const ex of EXAMPLES) {
  const r = Latch.run(ex.code, ex.world, ex.modules);
  const all = [ex.code].concat(Object.values(ex.modules || {})).join('\n');
  const maxLen = Math.max(...all.split('\n').map(l => l.length));
  console.log('==', ex.title, '| longest line', maxLen);
  console.log('  errors:', r.errors.map(e => (e.module ? e.module + ' ' : '') + e.line + ': ' + e.msg));
  console.log('  tests:', r.tests.map(t => (t.ok ? 'ok ' : 'FAIL ') + t.name + (t.ok ? '' : ' ' + t.msg)));
  console.log('  warnings:', r.warnings.map(w => w.line + ': ' + w.msg), '| halted:', r.halted, '| ran:', r.ran, '| rt:', r.runtimeError && r.runtimeError.msg, '| main:', r.mainResult, r.mainFailed);
  console.log('  output:', r.output.map(o => o.kind + ':' + o.text));
}
// the inlined copy must behave like the tested file
const w = {}; new Function('window', html.slice(html.indexOf('/* Latch 0.1'), html.indexOf('</script>', html.indexOf('/* Latch 0.1'))))(w);
console.log('inlined ok:', typeof w.Latch.run === 'function' && w.Latch.run(EXAMPLES[1].code, EXAMPLES[1].world).output.length === 2);
{
  const k = EXAMPLES.find(e => /Kern: Bild/.test(e.title));
  const r = Latch.run(k.code, k.world, k.modules);
  console.log('SCREEN:', JSON.stringify(r.screen), '| report:', r.report.program.join(' '));
}
