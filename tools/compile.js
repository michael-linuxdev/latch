#!/usr/bin/env node
/* Latch -> C -> Multiboot-Kern.
   node tools/compile.js boot/main.latch kernel build
   Schreibt build/kernel.c und build/link.ld. Mit gcc und ld entsteht daraus build/kernel.elf. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { compile } = require('../src/compile_c.js');

function build(file, moduleDir, outDir) {
  const modules = {};
  for (const f of fs.readdirSync(moduleDir)) if (f.endsWith('.latch') && f !== 'main.latch') modules[f.replace(/\.latch$/, '')] = fs.readFileSync(path.join(moduleDir, f), 'utf8');
  const r = compile(fs.readFileSync(file, 'utf8'), modules);
  if (r.errors.length) return { errors: r.errors };
  fs.mkdirSync(outDir, { recursive: true });
  const c = path.join(outDir, 'kernel.c'), ld = path.join(outDir, 'link.ld'), o = path.join(outDir, 'kernel.o'), elf = path.join(outDir, 'kernel.elf');
  fs.writeFileSync(c, r.c);
  fs.writeFileSync(ld, r.linker);
  cp.execFileSync('gcc', ['-m32', '-ffreestanding', '-fno-pic', '-fno-stack-protector', '-fno-asynchronous-unwind-tables', '-nostdlib', '-O1', '-Wall', '-Wno-unused-function', '-Wno-unused-label', '-Wno-unused-variable', '-c', c, '-o', o], { stdio: 'inherit' });
  cp.execFileSync('ld', ['-m', 'elf_i386', '-T', ld, '-o', elf, o], { stdio: 'inherit' });
  return { errors: [], c, elf, functions: r.functions };
}
module.exports = { build };
if (require.main === module) {
  const [file, moduleDir, outDir] = process.argv.slice(2);
  if (!file) { console.error('Aufruf: node tools/compile.js datei.latch modulordner ausgabeordner'); process.exit(2); }
  const r = build(file, moduleDir || path.dirname(file), outDir || 'build');
  if (r.errors.length) { r.errors.forEach(e => console.error((e.module ? 'Modul ' + e.module + ', ' : '') + 'Zeile ' + e.line + ': ' + e.msg)); process.exit(1); }
  console.log('geschrieben:', r.elf, '| Funktionen:', r.functions.join(', '));
}
