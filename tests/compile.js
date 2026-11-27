/* Compiler: Latch -> C -> Multiboot-Kern in QEMU. Vergleicht die echte Ausgabe mit dem Prüfstand.
   Braucht gcc (mit -m32), ld und qemu-system-i386. Fehlt eines davon, wird nur das Übersetzen nach C geprüft. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { Latch } = require('../src/latch.js');
const { compile } = require('../src/compile_c.js');
const root = path.join(__dirname, '..'), out = path.join(root, 'build', 'test');
const has = cmd => { try { cp.execSync('command -v ' + cmd, { stdio: 'ignore' }); return true; } catch (e) { return false; } };
const tools = has('gcc') && has('ld') && has('qemu-system-i386');
const mods = require('../tools/compile.js').modulesOf(path.join(root, 'kernel'));

const { link } = require('../tools/compile.js');
/* keys: Tasten, die QEMU nach dem Start drückt (Namen wie beim Befehl sendkey) */
function boot(name, compiled, keys) {
  const built = link(compiled, path.join(root, 'kernel'), out, name);
  if (built.errors.length) throw new Error(built.errors[0].msg);
  const base = path.join(out, name);
  for (const f of ['.vga', '.serial']) if (fs.existsSync(base + f)) fs.unlinkSync(base + f);
  let code = 0;
  try {
    const typing = (keys || []).map(k => 'echo "sendkey ' + k + '"; sleep 0.15; ').join('');
    cp.execSync('(sleep 2; ' + typing + (keys ? 'sleep 1; ' : '') + 'echo \'pmemsave 0xb8000 4000 "' + base + '.vga"\'; sleep 1; echo quit) | timeout 30 qemu-system-i386 -kernel ' + base + '.elf -display none -serial file:' + base +
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
function same(name, src, modules, world, keys) {
  const c = compile(src, modules);
  ok(name + ': übersetzt', c.errors.length === 0, c.errors);
  if (c.errors.length) return;
  const sim = Latch.run(src, world || 'forever = 0', modules);
  ok(name + ': Prüfstand läuft', sim.errors.length === 0 && !sim.runtimeError, sim.errors.concat(sim.runtimeError || []));
  if (!tools) return;
  const real = boot(name.replace(/\W+/g, '_'), c, keys);
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
  const r = boot('vertrag', p);
  ok('Vertrag: ein verletztes requires hält den Kern an', r.code === 3 && /^PANIC Zeile \d+: Screen\.put verlangt: ch in 0\.\.255$/.test(r.serial[0]), r);
  const q = compile(`latch 1
function poke(off: Int) uses Memory(0xB8000..0xB8F9F) { Memory.write(0xB8000 + off, 65) }
function main() uses Memory(0xB8000..0xB8F9F) {
    poke(0)
    poke(5000)
}`, {});
  const r2 = boot('grenze', q);
  ok('Hardware: eine berechnete Adresse außerhalb der Rechte hält den Kern an', r2.code === 3 && /Memory-Zugriff ausserhalb der Rechte von poke/.test(r2.serial[0]), r2);
  const o = compile(`latch 1
function main() uses Port(0x3F8) {
    var n = 3000000000
    n = n * n
    n = n + n
    Port.write(0x3F8, 65)
}`, {});
  const r3 = boot('ueberlauf', o);
  ok('Zahlen: ein Überlauf hält den Kern an, statt still weiterzurechnen', r3.code === 3 && /Zahlenueberlauf/.test(r3.serial[0]), r3);
} else console.log('übersprungen: gcc, ld oder qemu-system-i386 fehlen, QEMU-Tests laufen nicht');

/* Der volle Kern: echte Uhr (Interrupt 32) und echte Tastendrücke (Interrupt 33) */
const KMAIN = fs.readFileSync(path.join(root, 'kernel', 'main.latch'), 'utf8');
const k = same('Kern', KMAIN, mods, 'keys = hallo latch\nticks = 7', ['h', 'a', 'l', 'l', 'o', 'spc', 'l', 'a', 't', 'c', 'h']);
if (k) ok('Kern: Uhr und Tastatur kommen als Unterbrechungen an', k.screen.join('|') === 'Latch OS 0.1|hallo latch' && k.serial.length === 7 && k.serial[6] === 'backup auf Seite 5', k);

same('Fehlerwerte und Tabellen', `latch 1
type Small = Int where it in 0..9
enum E { TooBig(n: Int), Odd }
enum Color { Red, Green }
type Item = { id: Int, color: Color }
` + NUM + `
function half(n: Int) -> Small fails E {
    if n % 2 == 1 { return Odd }
    let h = check (n / 2) as Small otherwise return TooBig(n)
    return h
}
function twice(n: Int) -> Int fails E {
    let h = try half(n)
    return h * 4
}
function code(n: Int) -> Int {
    let v = twice(n) otherwise as e {
        match e {
            TooBig(m) -> return 0 - m
            Odd -> return 0 - 1
        }
    }
    return v
}
function bump(change items: Table<Item, 3>, i: Int)
    requires i in 0..2
    ensures items[i].id == old(items[i].id) + 10
{
    items[i].id = items[i].id + 10
}
function main() uses Port(0x3F8) {
    show(code(6))
    show(code(7))
    show(code(40))
    var items = [Item { id: 1, color: Red }, Item { id: 2, color: Green }, Item { id: 3, color: Red }]
    bump(change items, 1)
    var reds = 0
    for it in items { if it.color == Red { reds = reds + it.id } }
    show(reds + items[1].id + items.length)
    let fill = Table.fill(4, 7)
    show(fill[3] + Bits.shift_left(1, 10))
    let hit = List.at(fill, 2) otherwise return Done
    show(hit)
    let miss = List.at(fill, 9) otherwise return Done
    show(miss)
}`, {});

/* Was der Compiler noch nicht kann, lehnt er mit Zeile ab */
const u = compile(`latch 1
foreign function c_time() -> Int assumes "time from libc"
function main() uses Tasks {
    let c = c_time()
    together { let a = 1 }
    region scratch { let b = scratch.new(1) }
}`, {});
ok('Grenze: together, region und foreign werden abgelehnt, mit Zeile und Grund', u.c === null && u.errors.length === 3 && u.errors.every(e => e.line > 0 && /Der Compiler kann .* noch nicht übersetzen/.test(e.msg)), u.errors);
const bad = compile('latch 1\nfunction main() { Console.print("x") }', {});
ok('Fehler des Prüfers kommen zuerst', bad.c === null && /main braucht das Recht Console/.test(bad.errors[0].msg), bad.errors);

console.log(failed ? failed + ' FAILED' : 'ALL PASSED', count);
process.exit(failed ? 1 : 0);
