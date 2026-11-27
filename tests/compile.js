/* Compiler: Latch -> C -> Multiboot-Kern in QEMU. Vergleicht die echte Ausgabe mit dem Prüfstand.
   Braucht gcc (mit -m32), ld und qemu-system-i386. Fehlt eines davon, wird nur das Übersetzen nach C geprüft. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { Latch } = require('../src/latch.js');
const { compile } = require('../src/compile_c.js');
const root = path.join(__dirname, '..'), out = path.join(root, 'build', 'test');
const has = cmd => { try { cp.execSync('command -v ' + cmd, { stdio: 'ignore' }); return true; } catch (e) { return false; } };
const tools = has('gcc') && has('ld') && has('qemu-system-i386');
const mods = {};
for (const f of fs.readdirSync(path.join(root, 'kernel'))) if (f.endsWith('.latch') && f !== 'main.latch') mods[f.replace('.latch', '')] = fs.readFileSync(path.join(root, 'kernel', f), 'utf8');

function boot(name, c, linker) {
  fs.mkdirSync(out, { recursive: true });
  const base = path.join(out, name);
  fs.writeFileSync(base + '.c', c); fs.writeFileSync(base + '.ld', linker);
  cp.execFileSync('gcc', ['-m32', '-ffreestanding', '-fno-pic', '-fno-stack-protector', '-fno-asynchronous-unwind-tables', '-nostdlib', '-O1', '-Wall', '-Werror',
    '-Wno-unused-function', '-Wno-unused-label', '-Wno-unused-variable', '-c', base + '.c', '-o', base + '.o'], { stdio: 'inherit' });
  cp.execFileSync('ld', ['-m', 'elf_i386', '-T', base + '.ld', '-o', base + '.elf', base + '.o'], { stdio: ['ignore', 'ignore', 'ignore'] });
  for (const f of ['.vga', '.serial']) if (fs.existsSync(base + f)) fs.unlinkSync(base + f);
  let code = 0;
  try {
    cp.execSync('(sleep 2; echo \'pmemsave 0xb8000 4000 "' + base + '.vga"\'; sleep 1; echo quit) | timeout 30 qemu-system-i386 -kernel ' + base + '.elf -display none -serial file:' + base +
      '.serial -monitor stdio -device isa-debug-exit,iobase=0xf4,iosize=0x04 -no-reboot', { stdio: 'ignore' });
  } catch (e) { code = e.status; }
  const rows = [];
  if (fs.existsSync(base + '.vga')) {
    const d = fs.readFileSync(base + '.vga');
    for (let r = 0; r < 25; r++) { let s = ''; for (let c2 = 0; c2 < 80; c2++) { const ch = d[(r * 80 + c2) * 2]; s += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : ' '; } rows.push(s.replace(/\s+$/, '')); }
    while (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
  }
  return { code, dumped: rows.length > 0, screen: rows, serial: fs.existsSync(base + '.serial') ? fs.readFileSync(base + '.serial', 'utf8').split('\n').filter(Boolean) : [] };
}

let failed = 0, count = 0;
function ok(name, cond, detail) { count++; if (cond) console.log('ok  ', name); else { failed++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail, null, 1)); } }

/* Vergleich: dasselbe Programm im Prüfstand und übersetzt in QEMU.
   Endet main, beendet sich QEMU sofort, dann gibt es keinen Auszug des Bildschirmspeichers. */
function same(name, src, modules, world) {
  const c = compile(src, modules);
  ok(name + ': übersetzt', c.errors.length === 0, c.errors);
  if (c.errors.length) return;
  const sim = Latch.run(src, world || 'forever = 0', modules);
  ok(name + ': Prüfstand läuft', sim.errors.length === 0 && !sim.runtimeError, sim.errors.concat(sim.runtimeError || []));
  if (!tools) return;
  const real = boot(name.replace(/\W+/g, '_'), c.c, c.linker);
  const simSerial = sim.output.filter(o => o.kind === 'serial').map(o => o.text);
  ok(name + ': Bildschirm wie im Prüfstand', !real.dumped || JSON.stringify(real.screen) === JSON.stringify(sim.screen || ['']), { qemu: real.screen, sim: sim.screen });
  ok(name + ': serielle Ausgabe wie im Prüfstand', JSON.stringify(real.serial.filter(l => l !== 'main ist zu Ende')) === JSON.stringify(simSerial), { qemu: real.serial, sim: simSerial });
  return real;
}

const BOOT = fs.readFileSync(path.join(root, 'boot', 'main.latch'), 'utf8');
const b = same('Startkern', BOOT, mods);
if (b) ok('Startkern: "Latch OS" steht im echten Bildschirmspeicher', b.screen[0] === 'Latch OS' && b.serial[0] === 'Latch OS laeuft', b);

const NUM = `
function digits(n: Int) uses Port(0x3F8) requires n >= 0 {
    if n >= 10 { digits(n / 10) }
    Port.write(0x3F8, 48 + n % 10)
}
function show(n: Int) uses Port(0x3F8) {
    if n < 0 {
        Port.write(0x3F8, 45)
        digits(0 - n)
    } else { digits(n) }
    Port.write(0x3F8, 10)
}
`;
same('Rechnen', `latch 1
const BIG = 3000000000
type Account = { owner: Text, balance: Int }
` + NUM + `
function deposit(change a: Account, amount: Int)
    requires amount > 0
    ensures a.balance == old(a.balance) + amount
{
    a.balance = a.balance + amount
}
function grow(start: Int, years: Int) -> Int
    requires start >= 0
    ensures result >= start
{
    var sum = start
    var left = years
    while left > 0
        invariant sum >= start
        decreases left
    {
        sum = sum + sum * 5 / 100
        left = left - 1
    }
    return sum
}
function main() uses Port(0x3F8) {
    show(BIG * 3)
    show(0 - 7 / 2)
    show((0 - 7) % 3)
    show(BIG * 1000000 / 7)
    show(Bits.and(0xFF0F, 0x0FF0) + Bits.xor(5, 1))
    var a = Account { owner: "Ada", balance: 1000 }
    deposit(change a, 500)
    show(grow(a.balance, 3))
    let b = a with { balance: 7 }
    show(a.balance - b.balance)
    show(a.owner.length)
    if 5 in 1..9 and not (BIG < 0) { show(1) }
}`, {});

if (tools) {
  const p = compile(`latch 1
import Screen
function main() uses Memory(0xB8000..0xB8F9F) {
    var cur = Screen.start()
    Screen.put(change cur, 65)
    Screen.put(change cur, 300)
    Screen.put(change cur, 66)
}`, mods);
  const r = boot('vertrag', p.c, p.linker);
  ok('Vertrag: ein verletztes requires hält den Kern an', r.code === 3 && /^PANIC Zeile \d+: Screen\.put verlangt: ch in 0\.\.255$/.test(r.serial[0]), r);
  const q = compile(`latch 1
function poke(off: Int) uses Memory(0xB8000..0xB8F9F) { Memory.write(0xB8000 + off, 65) }
function main() uses Memory(0xB8000..0xB8F9F) {
    poke(0)
    poke(5000)
}`, {});
  const r2 = boot('grenze', q.c, q.linker);
  ok('Hardware: eine berechnete Adresse außerhalb der Rechte hält den Kern an', r2.code === 3 && /Memory-Zugriff ausserhalb der Rechte von poke/.test(r2.serial[0]), r2);
  const o = compile(`latch 1
function main() uses Port(0x3F8) {
    var n = 3000000000
    n = n * n
    n = n + n
    Port.write(0x3F8, 65)
}`, {});
  const r3 = boot('ueberlauf', o.c, o.linker);
  ok('Zahlen: ein Überlauf hält den Kern an, statt still weiterzurechnen', r3.code === 3 && /Zahlenueberlauf/.test(r3.serial[0]), r3);
} else console.log('übersprungen: gcc, ld oder qemu-system-i386 fehlen, QEMU-Tests laufen nicht');

/* Was der Compiler noch nicht kann, lehnt er mit Zeile ab */
const KMAIN = fs.readFileSync(path.join(root, 'kernel', 'main.latch'), 'utf8');
const k = compile(KMAIN, mods);
ok('Grenze: der volle Kern wird noch abgelehnt, mit Zeile und Grund', k.c === null && k.errors.length > 0 && k.errors.every(e => e.line > 0 && /Der Compiler kann .* noch nicht übersetzen/.test(e.msg)), k.errors.slice(0, 3));
const bad = compile('latch 1\nfunction main() { Console.print("x") }', {});
ok('Fehler des Prüfers kommen zuerst', bad.c === null && /main braucht das Recht Console/.test(bad.errors[0].msg), bad.errors);

console.log(failed ? failed + ' FAILED' : 'ALL PASSED', count);
process.exit(failed ? 1 : 0);
