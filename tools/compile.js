#!/usr/bin/env node
/* Latch -> C -> Multiboot-Kern.
   node tools/compile.js kernel/main.latch kernel build
   Schreibt build/kernel.c und build/link.ld und baut daraus mit gcc und ld build/kernel.elf.
   Der Inhalt von assembly-Funktionen liegt in <modulordner>/arch/x86/<Modul>.<name>.S. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { compile } = require('../src/compile_c.js');

const CFLAGS = ['-m32', '-ffreestanding', '-fno-pic', '-fno-stack-protector', '-fno-asynchronous-unwind-tables', '-mgeneral-regs-only', '-nostdlib', '-O1',
  '-Wall', '-Werror', '-Wno-unused-function', '-Wno-unused-label', '-Wno-unused-variable', '-Wno-unused-but-set-variable'];

function modulesOf(moduleDir) {
  const modules = {};
  for (const f of fs.readdirSync(moduleDir)) if (f.endsWith('.latch') && f !== 'main.latch') modules[f.replace(/\.latch$/, '')] = fs.readFileSync(path.join(moduleDir, f), 'utf8');
  return modules;
}
/* r ist das Ergebnis von compile(). Baut name.elf im Ordner outDir. */
function link(r, moduleDir, outDir, name) {
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, name), objects = [base + '.o'];
  fs.writeFileSync(base + '.c', r.c);
  fs.writeFileSync(base + '.ld', r.linker);
  cp.execFileSync('gcc', CFLAGS.concat(['-c', base + '.c', '-o', base + '.o']), { stdio: 'inherit' });
  for (const a of r.assembly) {
    const src = path.join(moduleDir, 'arch', 'x86', a.file);
    if (!fs.existsSync(src)) return { errors: [{ line: 0, msg: 'Für die assembly-Funktion ' + a.name + ' fehlt der Inhalt. Erwartet wird die Datei ' + src + ' mit dem Einsprung ' + a.symbol + '.' }] };
    const o = base + '.' + a.symbol + '.o';
    cp.execFileSync('gcc', ['-m32', '-c', src, '-o', o], { stdio: 'inherit' });
    objects.push(o);
  }
  cp.execFileSync('ld', ['-m', 'elf_i386', '-T', base + '.ld', '-o', base + '.elf'].concat(objects), { stdio: ['ignore', 'ignore', 'ignore'] });
  return { errors: [], c: base + '.c', elf: base + '.elf', functions: r.functions };
}
function build(file, moduleDir, outDir) {
  const r = compile(fs.readFileSync(file, 'utf8'), modulesOf(moduleDir));
  if (r.errors.length) return { errors: r.errors };
  return link(r, moduleDir, outDir, 'kernel');
}
module.exports = { build, link, modulesOf };
if (require.main === module) {
  const [file, moduleDir, outDir] = process.argv.slice(2);
  if (!file) { console.error('Aufruf: node tools/compile.js datei.latch modulordner ausgabeordner'); process.exit(2); }
  const r = build(file, moduleDir || path.dirname(file), outDir || 'build');
  if (r.errors.length) { r.errors.forEach(e => console.error((e.module ? 'Modul ' + e.module + ', ' : '') + (e.line ? 'Zeile ' + e.line + ': ' : '') + e.msg)); process.exit(1); }
  console.log('geschrieben:', r.elf, '| Funktionen:', r.functions.join(', '));
}
