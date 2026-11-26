const { Latch } = require('../src/latch.js');
const cases = [];
function t(name, src, world, expect, mods) { cases.push({ name, src, world, expect, mods }); }

const TYPES = `latch 1

type Name  = Text where it.length in 1..80
type Email = Text where Text.contains(it, "@")
type Age   = Int  where it in 0..150

type Signup = {
    name:  Name,
    email: Email,
    age:   Age,
}

enum SignupError {
    BadInput(field: Text),
    Taken,
    Unavailable,
}
`;
const SIGNUP = TYPES + `
function parse()
    -> Signup fails SignupError
    uses Console
{
    let name = check Console.read("name") as Name
        otherwise return BadInput("name")
    let email = check Console.read("email") as Email
        otherwise return BadInput("email")
    let age = check Console.read("age") as Age
        otherwise return BadInput("age")
    return Signup { name, email, age }
}

function store(s: Signup)
    -> Int fails SignupError
    uses File("accounts.db")
    ensures result >= 1
{
    if File.find("accounts.db", "email", s.email) {
        return Taken
    }
    return File.append("accounts.db", s)
        otherwise return Unavailable
}

function main()
    -> Int fails SignupError
    uses File("accounts.db"), Net("smtp.x.com"), Console
{
    let s  = try parse()
    let id = try store(s)
    Mail.send("smtp.x.com", s.email, "Welcome", "Hello {s.name}")
        otherwise return Unavailable
    Console.print("Konto {id} für {s.name} angelegt")
    return id
}
`;
const W = 'input name = Ada\ninput email = ada@example.org\ninput age = 36\n';
t('signup ok', SIGNUP, W, r => r.errors.length === 0 && !r.runtimeError && r.mainResult === '1' && r.output.length === 3);
t('signup bad age', SIGNUP, W.replace('36', '900'), r => r.mainFailed && r.mainResult === 'BadInput(field: "age")');
t('signup db down', SIGNUP, W + 'file accounts.db = down', r => r.mainFailed && r.mainResult === 'Unavailable');
t('signup mail down', SIGNUP, W + 'mail = down', r => r.mainFailed && r.mainResult === 'Unavailable');
t('missing right', SIGNUP.replace('uses File("accounts.db"), Net("smtp.x.com"), Console', 'uses File("accounts.db"), Console'),
  W, r => r.errors.length === 1 && /Net\("smtp.x.com"\)/.test(r.errors[0].msg));
t('wrong host', SIGNUP.replace('Mail.send("smtp.x.com"', 'Mail.send("evil.example"'), W, r => r.errors.some(e => /evil.example/.test(e.msg)) && r.warnings.length === 1);
t('unchecked to db', TYPES + `
function main() uses Console, File("accounts.db") {
    let raw = Console.read("age")
    File.append("accounts.db", raw) otherwise return Done
}`, W, r => r.errors.some(e => /Ungeprüfter Wert darf nicht an File.append/.test(e.msg)));
t('unchecked in if', TYPES + `
function main() uses Console {
    let raw = Console.read("age")
    if raw == "36" { Console.print("x") }
}`, W, r => r.errors.length >= 1 && /Ungeprüft/.test(r.errors[0].msg));
t('unhandled check', TYPES + `
function main() uses Console {
    let age = check Console.read("age") as Age
}`, W, r => r.errors.length === 1 && /Fehlerfall nicht behandelt/.test(r.errors[0].msg));
t('else instead of otherwise', TYPES + `
function main() uses Console {
    let age = check Console.read("age") as Age
        else return Done
}`, W, r => r.errors.length === 1 && /otherwise/.test(r.errors[0].msg));
t('secret print', `latch 1
function main() uses Console {
    let key = Kem.generate()
    Console.print(key)
}`, '', r => r.errors.length === 1 && /Geheimnis darf nicht an Console.print/.test(r.errors[0].msg));
t('secret compare + interpolate', `latch 1
function main() uses Console {
    let key = Kem.generate()
    if key == "abc" { Console.print("x") }
    Console.print("key {key}")
}`, '', r => r.errors.length === 2);
t('secret ok', `latch 1
function main() uses Console {
    let key = Kem.generate()
    let box = Crypto.encrypt(key, "hello")
    Console.print(box)
    Console.print(Crypto.public_key(key))
    let pin = secret 4711
    Console.print(reveal pin because "user must type it")
}`, '', r => r.errors.length === 0 && r.output.length === 3 && r.output[2].text === '4711' && r.report.functions[0].reveals.length === 1);
t('pure function cannot print', `latch 1
function add(a: Int, b: Int) -> Int {
    Console.print("leak")
    return a + b
}
function main() uses Console { Console.print(add(1, 2)) }`, '', r => r.errors.length === 1 && /add braucht das Recht Console/.test(r.errors[0].msg));
t('rights sum up', `latch 1
function log(m: Text) uses Console { Console.print(m) }
function work() { log("hi") }
function main() uses Console { work() }`, '', r => r.errors.length === 1 && /work braucht das Recht Console/.test(r.errors[0].msg));
t('contract violation', `latch 1
function withdraw(balance: Int, amount: Int) -> Int
    requires amount <= balance
    ensures result >= 0
{
    return balance - amount
}
function main() uses Console {
    Console.print(withdraw(100, 30))
    Console.print(withdraw(100, 300))
}`, '', r => r.errors.length === 0 && r.output.length === 1 && r.output[0].text === '70' && /Vertrag verletzt/.test(r.runtimeError.msg));
t('weather', `latch 1
type Celsius = Int where it in -90..60
enum WeatherError { NoData }
function weather(city: Text) -> unchecked Text uses Net("api.weather.com") {
    return Net.get("api.weather.com", "/v1/" + city)
}
function main() -> Done fails WeatherError uses Net("api.weather.com"), Console {
    let raw = weather("dresden")
    let temp = check raw as Celsius otherwise return NoData
    if temp < 5 { Console.print("Kalt: {temp} Grad") } else { Console.print("Mild: {temp} Grad") }
    return Done
}`, 'net api.weather.com/v1/dresden = 3', r => r.errors.length === 0 && r.output[1].text === 'Kalt: 3 Grad' && !r.mainFailed);
t('weather missing data', `latch 1
type Celsius = Int where it in -90..60
enum WeatherError { NoData }
function main() -> Done fails WeatherError uses Net("api.weather.com") {
    let temp = check Net.get("api.weather.com", "/v1/x") as Celsius otherwise return NoData
    return Done
}`, '', r => r.mainFailed && r.mainResult === 'NoData');
t('return unchecked undeclared', `latch 1
function f() -> Text uses Console { return Console.read("a") }
function main() uses Console { let x = f() }`, '', r => r.errors.length === 1 && /ungeprüften Wert zurück/.test(r.errors[0].msg));
t('try mismatch', `latch 1
enum E { A }
function main() -> Int fails E uses Console {
    let n = try check Console.read("n") as Int
    return n
}`, 'input n = 5', r => r.errors.length === 1 && /CheckFailed/.test(r.errors[0].msg));
t('loops', `latch 1
function sum(n: Int) -> Int requires n >= 0 ensures result >= 0 {
    var total = 0
    for i in 1..n { total = total + i }
    var k = 0
    while k < 3 { k = k + 1 }
    return total + k
}
function main() uses Console {
    Console.print(sum(10))
    let xs = [1, 2, 3]
    for x in xs { Console.print("x={x} len={xs.length}") }
    let y = 7
    y = 8
}`, '', r => r.errors.length === 1 && /unveränderlich/.test(r.errors[0].msg));
t('loops ok', `latch 1
function sum(n: Int) -> Int requires n >= 0 ensures result >= 0 {
    var total = 0
    for i in 1..n { total = total + i }
    return total
}
function main() uses Console {
    Console.print(sum(10))
    if 3 in [1, 2, 3] and not (2 > 5) { Console.print("ok") }
}`, '', r => r.errors.length === 0 && r.output[0].text === '55' && r.output[1].text === 'ok');
t('infinite loop', `latch 1
function main() { while true { } }`, '', r => /200.000 Schritten/.test(r.runtimeError.msg));
t('no main / bad header', `function main() {}`, '', r => r.errors.length === 1 && /latch 1/.test(r.errors[0].msg));
t('not yet', `latch 1
function main() { break }`, '', r => /noch nicht unterstützt/.test(r.errors[0].msg));
t('unused right warning', `latch 1
function main() uses Clock, Console { Console.print("hi") }`, '', r => r.errors.length === 0 && r.warnings.length === 1 && /Clock/.test(r.warnings[0].msg));
t('header order', `latch 1
function f(a: Int) -> Int ensures result > 0 requires a > 0 { return a }
function main() {}`, '', r => /Reihenfolge/.test(r.errors[0].msg));
t('assumes + report', `latch 1
function read_sector(n: Int) -> Int
    uses Clock
    requires n >= 0
    assumes "disk returns 512 bytes"
{
    return Clock.now() - Clock.now() + n
}
function main() uses Clock, Console { Console.print(read_sector(4)) }`, '', r => r.errors.length === 0 && r.report.functions[0].assumes[0] === 'disk returns 512 bytes' && r.report.program.join() === 'Clock,Console' && r.output[0].text === '4');
t('unicode outside string', `latch 1
function main() { let ä = 1 }`, '', r => /ASCII/.test(r.errors[0].msg));

const MEM = `latch 1
resource Page { frame: Int }
type Pool = { next: Int, free: Int }
enum MemError { OutOfMemory }

function alloc(change pool: Pool)
    -> Page fails MemError
    ensures pool.free >= 0
{
    if pool.free == 0 { return OutOfMemory }
    let frame = pool.next
    pool.next = pool.next + 1
    pool.free = pool.free - 1
    return Page { frame }
}

function free(change pool: Pool, take page: Page)
    ensures pool.free >= 1
{
    pool.free = pool.free + 1
    destroy page
}
`;
const mem = (body, ret) => MEM + `
function main() -> Done fails MemError uses Console {
    var pool = Pool { next: 0, free: 2 }
${body}
    return Done
}`;
const has = (r, re) => r.errors.some(e => re.test(e.msg));
t('mem ok', mem(`    let a = try alloc(change pool)
    Console.print("Seite {a.frame}")
    free(change pool, take a)
    let b = try alloc(change pool)
    free(change pool, take b)
    Console.print("frei {pool.free} next {pool.next}")`), '', r => r.errors.length === 0 && !r.runtimeError && r.output[1].text === 'frei 2 next 2');
t('mem out of memory', MEM + `
function main() -> Done fails MemError uses Console {
    var pool = Pool { next: 0, free: 0 }
    let a = try alloc(change pool)
    free(change pool, take a)
    return Done
}`, '', r => r.errors.length === 0 && r.mainFailed && r.mainResult === 'OutOfMemory');
t('mem use after take', mem(`    let a = try alloc(change pool)
    free(change pool, take a)
    Console.print("Seite {a.frame}")`), '', r => r.errors.length === 1 && has(r, /a wurde in Zeile \d+ abgegeben/));
t('mem double free', mem(`    let a = try alloc(change pool)
    free(change pool, take a)
    free(change pool, take a)`), '', r => r.errors.length === 1 && has(r, /abgegeben/));
t('mem leak', mem(`    let a = try alloc(change pool)
    Console.print("x")`), '', r => has(r, /return würde a \(Page\) unverbraucht/));
t('mem leak via try', mem(`    let a = try alloc(change pool)
    let b = try alloc(change pool)
    free(change pool, take a)
    free(change pool, take b)`), '', r => r.errors.length === 1 && has(r, /try würde a \(Page\) unverbraucht/));
t('mem missing marker', mem(`    let a = try alloc(pool)
    free(change pool, a)`), '', r => r.errors.length === 2 && has(r, /erwartet beim Aufruf "change/) && has(r, /erwartet beim Aufruf "take/));
t('mem change needs var', MEM + `
function main() -> Done fails MemError {
    let pool = Pool { next: 0, free: 2 }
    let a = try alloc(change pool)
    free(change pool, take a)
    return Done
}`, '', r => r.errors.length === 2 && has(r, /pool darf hier nicht verändert werden/));
t('mem branch mismatch', mem(`    let a = try alloc(change pool)
    if pool.free > 0 {
        free(change pool, take a)
    }`), '', r => has(r, /nicht in jedem Zweig verbraucht/));
t('mem branch ok', mem(`    let a = try alloc(change pool)
    if pool.free > 0 {
        free(change pool, take a)
    } else {
        free(change pool, take a)
    }`), '', r => r.errors.length === 0 && !r.runtimeError);
t('mem loop consume', mem(`    let a = try alloc(change pool)
    for i in 1..3 {
        free(change pool, take a)
    }`), '', r => has(r, /Schleife mehrfach verbraucht/));
t('mem discard result', mem(`    alloc(change pool) otherwise return OutOfMemory`), '', r => has(r, /Der Wert vom Typ Page wird nie verbraucht/));
t('mem borrowed cannot be taken', MEM + `
function peek(change pool: Pool, page: Page) { free(change pool, take page) }
function main() {}`, '', r => has(r, /page ist nur geliehen/));
t('mem move by let', mem(`    let a = try alloc(change pool)
    let b = a
    free(change pool, take b)
    Console.print("{a.frame}")`), '', r => r.errors.length === 1 && has(r, /a wurde in Zeile/));
t('mem return resource', MEM + `
function two(change pool: Pool) -> Page fails MemError {
    let a = try alloc(change pool)
    return a
}
function main() -> Done fails MemError {
    var pool = Pool { next: 5, free: 1 }
    let p = try two(change pool)
    free(change pool, take p)
    return Done
}`, '', r => r.errors.length === 0 && !r.runtimeError && !r.mainFailed);
t('value copy semantics', `latch 1
type P = { n: Int }
function bump(change p: P) { p.n = p.n + 1 }
function main() uses Console {
    var a = P { n: 1 }
    var b = a
    bump(change b)
    Console.print("{a.n} {b.n}")
}`, '', r => r.errors.length === 0 && r.output[0].text === '1 2');
t('region ok', `latch 1
type Buffer = { size: Int, used: Int }
function fill(change b: Buffer) { b.used = b.size }
function main() uses Console {
    var total = 0
    region scratch {
        var buf = scratch.new(Buffer { size: 4096, used: 0 })
        fill(change buf)
        total = buf.used
    }
    Console.print(total)
}`, '', r => r.errors.length === 0 && r.output[0].text === '4096');
t('region escape', `latch 1
type Buffer = { size: Int }
function leak() -> Buffer {
    var keep = Buffer { size: 1 }
    region scratch {
        let buf = scratch.new(Buffer { size: 4096 })
        keep = buf
        return buf
    }
    return keep
}
function main() {}`, '', r => r.errors.length === 2 && has(r, /darf nicht in keep landen/) && has(r, /darf den Block nicht verlassen/));
t('region closed', `latch 1
function main() {
    let x = scratch.new(1)
}`, '', r => has(r, /Region scratch ist hier nicht offen/));
t('match ok', `latch 1
enum Shape { Circle(r: Int), Square(side: Int), Dot }
function area(s: Shape) -> Int {
    match s {
        Circle(r) -> return 3 * r * r,
        Square(side) -> { return side * side }
        Dot -> return 0
    }
}
function main() uses Console {
    Console.print(area(Circle(2)))
    Console.print(area(Square(3)))
    Console.print(area(Dot))
}`, '', r => r.errors.length === 0 && r.output.map(o => o.text).join() === '12,9,0');
t('match not exhaustive', `latch 1
enum Shape { Circle(r: Int), Square(side: Int), Dot }
function main() uses Console {
    let s = Dot
    match s {
        Circle(r) -> Console.print(r)
        Dot -> Console.print("dot")
    }
}`, '', r => r.errors.length === 1 && has(r, /Es fehlt: Square/));
t('destroy non resource', `latch 1
function main() { let x = 1
 destroy x }`, '', r => has(r, /destroy ist nur für Ressourcen/));
t('take param must be consumed', MEM + `
function lose(take page: Page) { }
function main() {}`, '', r => has(r, /page \(Page\) wird nie verbraucht/));

t('old or in signature', `latch 1
enum E { A }
function main() -> Int or E { return 1 }`, '', r => r.errors.length === 1 && /fails/.test(r.errors[0].msg));
t('otherwise as', TYPES + `
function parse() -> Age fails SignupError uses Console {
    let age = check Console.read("age") as Age otherwise return BadInput("age")
    return age
}
function main() -> Int fails SignupError uses Console {
    let age = parse() otherwise as e {
        match e {
            BadInput(field) -> { Console.print("Feld {field}") }
            Taken -> Console.print("t")
            Unavailable -> Console.print("u")
        }
        return e
    }
    return age
}`, 'input age = 999', r => r.errors.length === 0 && r.output[0].text === 'Feld age' && r.mainFailed && r.mainResult === 'BadInput(field: "age")');
t('otherwise as must return', TYPES + `
function main() uses Console {
    let age = check Console.read("age") as Age otherwise as e {
        Console.print("x")
    }
}`, '', r => r.errors.length === 1 && /muss mit return enden/.test(r.errors[0].msg));
t('logic or', `latch 1
function main() uses Console { if 1 > 2 or 2 > 1 { Console.print("ok") } }`, '', r => r.errors.length === 0 && r.output[0].text === 'ok');

const KERN = `latch 1
type Cursor = { row: Int, col: Int }

function put(change cur: Cursor, ch: Int)
    uses Memory(0xB8000..0xB8F9F)
    requires ch in 0..255
    requires cur.row in 0..24
    requires cur.col in 0..79
    assumes "VGA text buffer at 0xB8000"
{
    let at = 0xB8000
        + (cur.row * 80 + cur.col) * 2
    Memory.write(at, ch)
    Memory.write(at + 1, 0x0F)
    cur.col = cur.col + 1
    if cur.col == 80 {
        cur.col = 0
        cur.row = cur.row + 1
    }
    if cur.row == 25 { cur.row = 0 }
}

function print(change cur: Cursor, msg: Text)
    uses Memory(0xB8000..0xB8F9F)
{
    for b in Text.bytes(msg) { put(change cur, b) }
}

function newline(change cur: Cursor) {
    cur.col = 0
    cur.row = cur.row + 1
    if cur.row == 25 { cur.row = 0 }
}

function log(msg: Text)
    uses Port(0x3F8)
    assumes "serial port COM1 at 0x3F8"
{
    for b in Text.bytes(msg) { Port.write(0x3F8, b) }
}
`;
t('kernel screen', KERN + `
function main() uses Memory(0xB8000..0xB8F9F), Port(0x3F8) {
    var cur = Cursor { row: 0, col: 0 }
    print(change cur, "Latch OS 0.0.1")
    newline(change cur)
    print(change cur, "Kern laeuft.")
    log("boot ok")
}`, '', r => r.errors.length === 0 && !r.runtimeError && r.screen.length === 2 && r.screen[0] === 'Latch OS 0.0.1' && r.screen[1] === 'Kern laeuft.'
   && r.output.some(o => o.kind === 'serial' && o.text === 'boot ok') && r.report.program.join() === 'Memory(0xB8000..0xB8F9F),Port(0x3F8)');
t('kernel caller range too narrow', KERN + `
function main() uses Memory(0xB8000..0xB80FF), Port(0x3F8) {
    var cur = Cursor { row: 0, col: 0 }
    print(change cur, "x")
    log("y")
}`, '', r => r.errors.length === 1 && /liegt außerhalb dessen, was main darf/.test(r.errors[0].msg));
t('kernel missing memory right', KERN + `
function main() uses Port(0x3F8) {
    var cur = Cursor { row: 0, col: 0 }
    print(change cur, "x")
    log("y")
}`, '', r => r.errors.length === 1 && /main braucht das Recht Memory\(0xB8000..0xB8F9F\)/.test(r.errors[0].msg));
t('hw static out of range', `latch 1
function poke() uses Memory(0xB8000..0xB8F9F) { Memory.write(0xB8FA0, 65) }
function main() uses Memory(0xB8000..0xB8F9F) { poke() }`, '', r => r.errors.length === 1 && /Memory\(0xB8FA0\).*liegt außerhalb/.test(r.errors[0].msg));
t('hw dynamic out of range', `latch 1
function poke(off: Int) uses Memory(0xB8000..0xB8F9F) { Memory.write(0xB8000 + off, 65) }
function main() uses Memory(0xB8000..0xB8F9F) { poke(0)
 poke(5000) }`, '', r => r.errors.length === 0 && /außerhalb der Rechte von poke/.test(r.runtimeError.msg) && r.screen[0] === 'A');
t('hw no right at all', `latch 1
function main() { Port.write(0x3F8, 65) }`, '', r => r.errors.length === 1 && /main braucht das Recht Port\(0x3F8\)/.test(r.errors[0].msg));
t('port read unchecked', `latch 1
type Scan = Int where it in 0..255
function main() uses Port(0x60), Console {
    let raw = Port.read(0x60)
    let code = check raw as Scan otherwise return Done
    Console.print("Taste {code}")
}`, 'port 0x60 = 30', r => r.errors.length === 0 && r.output[0].text === 'Taste 30');
t('port read unchecked misuse', `latch 1
function main() uses Port(0x60), Console { Console.print(Port.read(0x60)) }`, '', r => r.errors.length === 1 && /Ungeprüfter Wert/.test(r.errors[0].msg));
t('byte range', `latch 1
function main() uses Port(0x3F8) { Port.write(0x3F8, 300) }`, '', r => /Byte liegt zwischen/.test(r.runtimeError.msg));

const KBD = require('fs').readFileSync(__dirname + '/kbd.latch', 'utf8');
t('keyboard types text', KBD, 'keys = hallo latch', r => r.errors.length === 0 && !r.runtimeError && !r.mainFailed && r.screen[0] === 'hallo latch');
t('keyboard no keys', KBD, 'keys = ', r => r.errors.length === 0 && !r.runtimeError && r.screen === null);
t('keyboard bad device', KBD, 'port 0x64 = kaputt', r => r.mainFailed && r.mainResult === 'BadDevice');
t('list at', `latch 1
function main() uses Console {
    let xs = [10, 20, 30]
    let a = List.at(xs, 1) otherwise return Done
    Console.print(a)
    let b = List.at(xs, 7) otherwise as e {
        Console.print("fehlt")
        return Done
    }
    Console.print(b)
}`, '', r => r.errors.length === 0 && r.output.map(o => o.text).join() === '20,fehlt');

const SCHED = require('fs').readFileSync(__dirname + '/sched.latch', 'utf8');
t('scheduler round robin', SCHED, '', r => r.errors.length === 0 && !r.runtimeError &&
  r.output.filter(o => o.kind === 'serial').map(o => o.text.split(' ')[0]).join() === 'editor,backup,uhr,editor,backup,backup,alle' &&
  r.output.filter(o => o.kind === 'asm').map(o => o.text).join() === 'switch_to(0),switch_to(1),switch_to(2),switch_to(0),switch_to(1),switch_to(1)' &&
  r.report.functions.find(f => f.name === 'switch_to').assembly === true);
t('assembly needs Cpu and assumes', `latch 1
assembly function halt()
function main() { }`, '', r => r.errors.length === 2 && /uses Cpu/.test(r.errors[0].msg) && /Annahme/.test(r.errors[1].msg));
t('assembly has no body', `latch 1
assembly function halt() uses Cpu assumes "x" { }
function main() { }`, '', r => r.errors.length === 1 && /keinen Latch-Rumpf/.test(r.errors[0].msg));
t('assembly caller needs Cpu', `latch 1
assembly function halt() uses Cpu assumes "stops the cpu"
function main() { halt() }`, '', r => r.errors.length === 1 && /main braucht das Recht Cpu/.test(r.errors[0].msg));
t('table index and store', `latch 1
type P = { n: Int }
function main() uses Console {
    var xs = Table.fill(3, P { n: 0 })
    xs[1].n = 5
    xs[2] = P { n: 9 }
    let a = xs[1]
    Console.print("{a.n} {xs[0].n} {xs[2].n} {xs.length}")
    Console.print(xs[3].n)
}`, '', r => r.errors.length === 0 && r.output[0].text === '5 0 9 3' && /Stelle 3 liegt außerhalb/.test(r.runtimeError.msg));
t('table store needs var', `latch 1
function main() { let xs = [1, 2]
 xs[0] = 5 }`, '', r => r.errors.length === 1 && /xs darf hier nicht verändert werden/.test(r.errors[0].msg));
t('table index taint', `latch 1
function main() uses Console {
    let xs = [1, 2]
    let raw = Console.read("i")
    Console.print(xs[raw])
    let k = secret 1
    Console.print(xs[k])
}`, '', r => r.errors.length === 2 && /Ungeprüfter Wert als Stelle/.test(r.errors[0].msg) && /Geheimnis darf nicht als Stelle/.test(r.errors[1].msg));

t('reserved new words', `latch 1
function main() { let old = 1 }`, '', r => r.errors.length === 1 && /Schlüsselwort/.test(r.errors[0].msg));
t('hardened not yet', `latch 1
hardened type X = Int
function main() { }`, '', r => r.errors.length === 1 && /noch nicht unterstützt/.test(r.errors[0].msg));

/* ---------- Typprüfung ---------- */
const one = (r, re) => r.errors.length === 1 && re.test(r.errors[0].msg);
const clean = r => r.errors.length === 0 && !r.runtimeError;
const AGE = `latch 1
type Age = Int where it in 0..150
type Name = Text where it.length in 1..80
type Email = Text where Text.contains(it, "@")
`;
t('type: argument', `latch 1
function add(a: Int, b: Int) -> Int { return a + b }
function main() uses Console { Console.print(add("1", 2)) }`, '', r => one(r, /add\(a\) erwartet Int, vorhanden ist Text/) && r.errors[0].line === 3);
t('type: return', `latch 1
function f() -> Int { return "x" }
function main() { let x = f() }`, '', r => one(r, /Die Rückgabe von f erwartet Int, vorhanden ist Text/));
t('type: missing return', `latch 1
function f(n: Int) -> Int { if n > 0 { return 1 } }
function main() { let x = f(1) }`, '', r => one(r, /f verspricht Int, der Rumpf kann aber ohne return enden/));
t('type: bare return needs value', `latch 1
function f() -> Int { return }
function main() { let x = f() }`, '', r => one(r, /return braucht hier einen Wert vom Typ Int/));
t('type: value from function without result', `latch 1
function f() { return 5 }
function main() { f() }`, '', r => one(r, /f gibt laut Kopf nichts zurück.*-> Int/));
t('type: record fields', `latch 1
type P = { n: Int, name: Text }
function main() uses Console {
    var p = P { n: "x", name: "a" }
    p.name = 5
    Console.print(p.zz)
}`, '', r => r.errors.length === 3 && /Das Feld n von P erwartet Int, vorhanden ist Text/.test(r.errors[0].msg)
  && /Das Feld name von p erwartet Text, vorhanden ist Int/.test(r.errors[1].msg) && /P hat kein Feld zz. Vorhanden: n, name/.test(r.errors[2].msg));
t('type: variant fields', `latch 1
enum Shape { Circle(r: Int), Dot }
function main() {
    let a = Circle("gross")
    let b = Circle(2)
}`, '', r => one(r, /Die Angabe r von Circle erwartet Int, vorhanden ist Text/));
t('type: match binds carry field types', `latch 1
enum Shape { Circle(r: Int), Label(text: Text) }
function size(s: Shape) -> Int {
    match s {
        Circle(r) -> return r * 2
        Label(text) -> return text * 2
    }
}
function main() { let x = size(Circle(1)) }`, '', r => one(r, /Links von \* erwartet Int, vorhanden ist Text/) && r.errors[0].line === 6);
t('type: match needs enum, arms of that enum', `latch 1
enum A { X, Y }
enum B { Z }
function main() {
    match 5 { X -> { } Y -> { } }
    let a = X
    match a { X -> { } Z -> { } }
}`, '', r => has(r, /match erwartet einen Wert einer Aufzählung, vorhanden ist Int/) && has(r, /Z gehört zu B, verglichen wird aber ein Wert vom Typ A/) && has(r, /Es fehlt: Y/));
t('type: wrong error enum returned', `latch 1
enum E { Bad }
enum F { Worse }
function f() -> Int fails E { return Worse }
function main() { let x = f() otherwise return Done }`, '', r => one(r, /Die Rückgabe von f erwartet Int, vorhanden ist F/));
t('type: otherwise as binds the error type', AGE + `
enum E { Bad }
function f() -> Int fails E uses Console {
    let a = check Console.read("a") as Age otherwise as e {
        return e
    }
    return a
}
function main() uses Console { let x = f() otherwise return Done }`, '', r => one(r, /Die Rückgabe von f erwartet Int, vorhanden ist CheckFailed/));
t('refined: only check or a constant makes one', AGE + `
function show(a: Age) uses Console { Console.print("Alter {a}") }
function main() uses Console {
    let n = 30 + Clock.now() * 0
    show(n)
}`, '', r => r.errors.some(e => /show\(a\) erwartet Age, vorhanden ist Int\. Ein Wert vom Typ Age entsteht nur durch Prüfen: check wert as Age/.test(e.msg)));
t('refined: checked value and constant pass', AGE + `
function show(a: Age) uses Console { Console.print("Alter {a}") }
function main() uses Console {
    let a = check Console.read("age") as Age otherwise return Done
    show(a)
    show(36)
    let b: Age = 100 + 50
    show(b)
}`, 'input age = 7', r => clean(r) && r.output.map(o => o.text).join() === 'Alter 7,Alter 36,Alter 150');
t('refined: constant outside the range', AGE + `
function show(a: Age) uses Console { Console.print("Alter {a}") }
function main() uses Console { show(200) }`, '', r => one(r, /200 erfüllt die Einschränkung von Age nicht \(it in 0\.\.150\)/) && r.errors[0].line === 7 && !r.ran);
t('refined: widens to its base, never back', AGE + `
function twice(n: Int) -> Int { return n * 2 }
function main() uses Console {
    var a = check Console.read("age") as Age otherwise return Done
    Console.print(twice(a))
    a = a + 1
}`, 'input age = 7', r => one(r, /Die Variable a erwartet Age, vorhanden ist Int/));
t('refined: two types over Text are not interchangeable', AGE + `
function mail(to: Email) uses Console { Console.print(to) }
function main() uses Console {
    let n = check Console.read("name") as Name otherwise return Done
    mail(n)
}`, '', r => one(r, /mail\(to\) erwartet Email, vorhanden ist Name\. Ein Wert vom Typ Email entsteht nur durch Prüfen/));
t('refined: constant text is proven too', AGE + `
type Signup = { name: Name, email: Email, age: Age }
function main() uses Console {
    let s = Signup { name: "Ada", email: "ada@x.org", age: 36 }
    Console.print(s.name)
    let bad = Signup { name: "Ada", email: "kein-at", age: 36 }
}`, '', r => one(r, /"kein-at" erfüllt die Einschränkung von Email nicht/));
t('refined: where may call a pure function', `latch 1
function is_even(n: Int) -> Bool { return n % 2 == 0 }
type Even = Int where is_even(it)
function main() uses Console {
    let a: Even = 4
    Console.print(a)
    let b: Even = 3
}`, '', r => one(r, /3 erfüllt die Einschränkung von Even nicht/));
t('refined: list of constants', AGE + `
function oldest(xs: List<Age>) -> Int { return xs.length }
function main() uses Console {
    Console.print(oldest([1, 2, 3]))
    let ys: List<Age> = [5, 999]
}`, '', r => one(r, /999 erfüllt die Einschränkung von Age nicht/));
t('refined: where and contracts are Bool', `latch 1
type A = Int where it + 1
function f(n: Int) -> Int requires n ensures result { return n }
function main() { let x = f(1) }`, '', r => r.errors.length === 3 && /Die Einschränkung von A erwartet Bool, vorhanden ist Int/.test(r.errors[0].msg)
  && /requires erwartet Bool/.test(r.errors[1].msg) && /ensures erwartet Bool/.test(r.errors[2].msg));
t('type: check only takes simple values', AGE + `
type P = { n: Int }
function main() {
    let p = P { n: 1 }
    let a = check p as Age otherwise return Done
}`, '', r => one(r, /check prüft nur einfache Werte \(Int, Text, Bool\), vorhanden ist P/));
t('type: operators', `latch 1
function main() uses Console {
    let a = 1 + "x"
    let b = "x" < 2
    let c = 1 == "x"
    let d = not 1
    let e = -"x"
    let f = 1 in 5
    let g = "a" + "b"
    Console.print(g)
}`, '', r => r.errors.length === 6 && /Mit \+ lassen sich Int und Text nicht verbinden/.test(r.errors[0].msg) && /Links von < erwartet Int, vorhanden ist Text/.test(r.errors[1].msg)
  && /Verglichen werden Int und Text/.test(r.errors[2].msg) && /not erwartet Bool/.test(r.errors[3].msg) && /Vorzeichen/.test(r.errors[4].msg) && /Rechts von in steht ein Bereich/.test(r.errors[5].msg));
t('type: conditions are Bool', `latch 1
function main() {
    if 1 { }
    while "ja" { }
}`, '', r => r.errors.length === 2 && r.errors.every(e => /Die Bedingung erwartet Bool/.test(e.msg)));
t('type: let annotation and assignment', `latch 1
function main() {
    let x: Text = 5
    var n = 1
    n = "zwei"
    var names: List<Text> = ["a"]
    names = ["b", "c"]
}`, '', r => r.errors.length === 2 && /Die Variable x erwartet Text, vorhanden ist Int/.test(r.errors[0].msg) && /Die Variable n erwartet Int, vorhanden ist Text/.test(r.errors[1].msg));
t('type: lists hold one type, for and index', `latch 1
function main() uses Console {
    let xs = [1, "a"]
    for x in 5 { Console.print(x) }
    let n = 7
    Console.print(n[0])
    var ys = [1, 2]
    Console.print(ys["0"])
    for y in ys { Console.print(y + 1) }
    ys.length = 3
}`, '', r => r.errors.length === 5 && /Eine Liste enthält nur Werte eines Typs, hier stehen Int und Text/.test(r.errors[0].msg) && /for läuft über einen Bereich/.test(r.errors[1].msg)
  && /Eine Stelle \[\.\.\] gibt es nur an Tabellen und Listen, vorhanden ist Int/.test(r.errors[2].msg) && /Die Stelle einer Tabelle erwartet Int, vorhanden ist Text/.test(r.errors[3].msg)
  && /hat kein Feld length/.test(r.errors[4].msg));
t('type: table size and element', `latch 1
type P = { n: Int }
function sum(ps: Table<P, 3>) -> Int { return ps[0].n }
function reset(change ps: Table<P, 3>) { ps[0] = 5 }
function main() uses Console {
    var two = [P { n: 1 }, P { n: 2 }]
    Console.print(sum(two))
    reset(change two)
    var three = Table.fill(3, P { n: 0 })
    reset(change three)
    three[1].n = "x"
}`, '', r => r.errors.length === 4 && /Die Stelle von ps erwartet P, vorhanden ist Int/.test(r.errors[0].msg) && /sum\(ps\) erwartet Table<P, 3>, vorhanden ist Table<P, 2>/.test(r.errors[1].msg)
  && /reset\(change ps\) erwartet genau Table<P, 3>/.test(r.errors[2].msg) && /Das Feld n erwartet Int, vorhanden ist Text/.test(r.errors[3].msg));
t('type: variant fields only through match', `latch 1
enum Shape { Circle(r: Int), Dot }
function main() uses Console {
    let s = Circle(2)
    Console.print(s.r)
}`, '', r => one(r, /Die Angaben einer Variante von Shape erreicht man über match/));
t('type: library arguments', `latch 1
function main() uses Console {
    Console.print(Text.contains(1, "a"))
    for b in Text.bytes(5) { Console.print(b) }
    let x = List.at(7, 0) otherwise return Done
}`, '', r => r.errors.length === 3 && /Text\.contains \(Argument 1\) erwartet Text, vorhanden ist Int/.test(r.errors[0].msg) && /List\.at \(Argument 1\) erwartet List<\?>/.test(r.errors[2].msg));
t('type: unknown and malformed types', `latch 1
type P = { n: Zahl }
function f(a: int, b: List<Int, Int>, c: P<Int>, d: Table<Int>) { }
function main() { }`, '', r => r.errors.length === 5 && /Der Typ Zahl ist nicht bekannt/.test(r.errors[0].msg) && has(r, /Der Typ int ist nicht bekannt\. Typen beginnen groß: Int/)
  && has(r, /List braucht genau einen Typ/) && has(r, /P hat keine Angaben in spitzen Klammern/) && has(r, /Table braucht Typ und Größe/));
t('type: no marker inside angle brackets', `latch 1
function f(a: List<unchecked Text>) { }
function main() { }`, '', r => one(r, /unchecked und secret stehen ganz vorn am Typ/));
t('names: types and variants upper case', `latch 1
type age = Int where it in 0..150
enum color { red, Green }
function main() { }`, '', r => r.errors.length === 3 && /Typnamen beginnen mit einem Großbuchstaben: Age statt age/.test(r.errors[0].msg)
  && /Typnamen beginnen mit einem Großbuchstaben: Color statt color/.test(r.errors[1].msg) && /Varianten beginnen mit einem Großbuchstaben: Red statt red/.test(r.errors[2].msg));
t('names: functions, variables, fields lower case', `latch 1
type P = { Name: Text }
enum E { Bad(Why: Text) }
function Helper(Count: Int) -> Int {
    let Total = 1
    for I in 1..2 { }
    return 0
}
function main() { }`, '', r => r.errors.length === 6 && has(r, /Feldnamen beginnen mit einem Kleinbuchstaben: name statt Name/) && has(r, /Feldnamen beginnen mit einem Kleinbuchstaben: why statt Why/)
  && has(r, /Funktionsnamen beginnen mit einem Kleinbuchstaben: helper statt Helper/) && has(r, /Parameter beginnen mit einem Kleinbuchstaben: count statt Count/)
  && has(r, /Variablen beginnen mit einem Kleinbuchstaben: total statt Total/) && has(r, /Variablen beginnen mit einem Kleinbuchstaben: i statt I/));
t('names: builtin type names are taken', `latch 1
type List = { n: Int }
enum Done { Fertig }
function main() { }`, '', r => r.errors.length === 2 && /Der Typ List ist schon vergeben/.test(r.errors[0].msg) && /Der Name Done ist schon vergeben/.test(r.errors[1].msg));
t('type: unchecked keeps its declared type', `latch 1
function raw() -> unchecked Int uses Console { return Console.read("n") }
function main() uses Console { let x = raw() }`, '', r => one(r, /Die Rückgabe von raw erwartet Int, vorhanden ist Text/));
t('type: secret keeps its type', `latch 1
function f(k: secret Text) -> Text { return Crypto.encrypt(k, "x") }
function main() uses Console {
    let pin = secret 4711
    Console.print(f(pin))
}`, '', r => one(r, /f\(k\) erwartet Text, vorhanden ist Int/));

/* ---------- Aufgabe 2: entschiedene Sprachteile ---------- */
const texts = r => r.output.map(o => o.text).join();
t('rights: fixed catalog', `latch 1
function f() uses Db("accounts") { }
function main() uses Input { }`, '', r => r.errors.length === 2 && r.errors.every(e => /gibt es nicht\. Der Katalog ist fest: Net, File, Clock/.test(e.msg)));
t('rights: env and file', `latch 1
type Port = Int where it in 1..65535
function main() uses Env, File("log.txt"), Console {
    let port = check Env.get("PORT") as Port otherwise return Done
    let n = File.append("log.txt", "port {port}") otherwise return Done
    Console.print("{n} {File.count("log.txt")}")
}`, 'env PORT = 8080', r => clean(r) && r.output[1].text === '1 1' && r.output[0].kind === 'file');
t('result and error type must differ', `latch 1
enum E { A, B }
function f() -> E fails E { return A }
function main() { }`, '', r => one(r, /Ergebnis und Fehlertyp von f sind derselbe Typ \(E\)/));

t('forever: halts in the test bench, listed in report', `latch 1
function main() uses Console {
    var n = 0
    forever {
        n = n + 1
        Console.print("Runde {n}")
    }
}`, 'forever = 3', r => clean(r) && r.output.length === 4 && r.output[2].text === 'Runde 3' && /nach 3 Durchläufen/.test(r.halted)
  && r.report.forever.length === 1 && r.report.forever[0].name === 'main' && r.report.functions[0].forever[0] === 4);
t('forever: return leaves it, no return needed after it', `latch 1
function wait(limit: Int) -> Int {
    var n = 0
    forever {
        n = n + 1
        if n == limit { return n }
    }
}
function main() uses Console { Console.print(wait(7)) }`, '', r => clean(r) && r.output[0].text === '7' && r.halted === null);
t('forever: code behind it is never reached', `latch 1
function main() uses Console {
    forever { }
    Console.print("nie")
}`, '', r => r.errors.length === 0 && r.warnings.some(w => /wird nie erreicht/.test(w.msg) && w.line === 4));

t('while: invariant and decreases hold', `latch 1
function sum(n: Int) -> Int requires n >= 0 {
    var i = 0
    var total = 0
    while i < n
        invariant total >= 0
        invariant i <= n
        decreases n - i
    {
        i = i + 1
        total = total + i
    }
    return total
}
function main() uses Console { Console.print(sum(4)) }`, '', r => clean(r) && r.warnings.length === 0 && r.output[0].text === '10');
t('while: decreases must shrink', `latch 1
function main() {
    var i = 0
    while i < 3 decreases 3 - i { i = i + 0 }
}`, '', r => r.errors.length === 0 && /decreases "3 - i" ist nicht kleiner geworden \(erst 3, dann 3\)/.test(r.runtimeError.msg));
t('while: invariant is checked every round', `latch 1
function main() {
    var i = 0
    while i < 5 invariant i < 3 decreases 5 - i { i = i + 1 }
}`, '', r => r.errors.length === 0 && /invariant verletzt: "i < 3"/.test(r.runtimeError.msg));
t('while: missing decreases is a warning', `latch 1
function main() {
    var i = 0
    while i < 3 { i = i + 1 }
}`, '', r => clean(r) && r.warnings.length === 1 && /kein decreases/.test(r.warnings[0].msg));
t('while: clause types, order and purity', `latch 1
function main() uses Clock {
    var i = 0
    while i < 3 invariant i decreases i < 3 { i = i + 1 }
    while i < 9 invariant Clock.now() > 0 decreases 9 - i { i = i + 1 }
}`, '', r => r.errors.length === 3 && /invariant erwartet Bool/.test(r.errors[0].msg) && /decreases erwartet Int/.test(r.errors[1].msg) && /invariant und decreases dürfen nichts nach außen tun/.test(r.errors[2].msg));
t('while: decreases before invariant', `latch 1
function main() { var i = 0
 while i < 3 decreases 3 - i invariant i >= 0 { i = i + 1 } }`, '', r => one(r, /erst invariant, dann decreases/));

const OLD = `latch 1
type Pool = { next: Int, free: Int }
function take_one(change pool: Pool)
    requires pool.free > 0
    ensures pool.free == old(pool.free) - 1
    ensures pool.next == old(pool.next) + 1
{
    pool.free = pool.free - 1
    pool.next = pool.next + STEP
}
`;
t('old: value before the call', 'latch 1\nconst STEP = 1' + OLD.slice(7) + `function main() uses Console {
    var pool = Pool { next: 0, free: 2 }
    take_one(change pool)
    take_one(change pool)
    Console.print("{pool.next} {pool.free}")
}`, '', r => clean(r) && r.output[0].text === '2 0' && /old\(pool\.free\) - 1/.test(r.report.functions[0].ensures[0]));
t('old: broken promise is caught', 'latch 1\nconst STEP = 2' + OLD.slice(7) + `function main() {
    var pool = Pool { next: 0, free: 2 }
    take_one(change pool)
}`, '', r => r.errors.length === 0 && /sichert "pool\.next == old\(pool\.next\) \+ 1" zu/.test(r.runtimeError.msg));
t('old: only in ensures', `latch 1
function f(n: Int) -> Int requires old(n) > 0 { return old(n) }
function main() { let x = f(1) }`, '', r => one(r, /old\(\.\.\.\) steht nur in ensures/));

t('const: fixed values, usable in hardware addresses', `latch 1
const VGA = 0xB8000
const LAST = VGA + 0xF9F
const GREETING = "Latch"
function main() uses Memory(0xB8000..0xB8F9F), Console {
    Memory.write(VGA, 76)
    Memory.write(LAST, 33)
    Console.print("{GREETING} {LAST - VGA}")
}`, '', r => clean(r) && r.output[0].text === 'Latch 3999' && r.screen[0].charAt(0) === 'L');
t('const: address outside the right is found before running', `latch 1
const VGA = 0xB8000
const LAST = VGA + 0xF9F
function main() uses Memory(0xB8000..0xB8F9F) { Memory.write(LAST + 1, 65) }`, '', r => one(r, /Memory\(0xB8FA0\).*liegt außerhalb/));
t('const: rules', AGE + `
const max_age = 150
const OLDEST: Age = 200
const RAW = Console.read("x")
const KEY = Kem.generate()
const OLDEST = 3
function main() { let x = LATER }
const LATER = 1`, '', r => r.errors.length === 6 && has(r, /Konstanten beginnen mit einem Großbuchstaben: Max_age statt max_age/) && has(r, /200 erfüllt die Einschränkung von Age nicht/)
  && has(r, /Konstanten dürfen nichts nach außen tun/) && has(r, /Ungeprüfte Werte und Geheimnisse gehören nicht hinein/) && has(r, /Der Name OLDEST ist schon vergeben/));
t('const: typed and used as proof', AGE + `
const ADULT: Age = 18
function show(a: Age) uses Console { Console.print("ab {a}") }
function main() uses Console { show(ADULT) }`, '', r => clean(r) && r.output[0].text === 'ab 18');

t('test: blocks run and report', `latch 1
function double(n: Int) -> Int { return n * 2 }
test "double works" { return double(4) == 8 }
test "double is wrong on purpose" { return double(4) == 9 }
test "contract breaks" {
    let xs = [1, 2]
    return xs[5] == 0
}
function main() uses Console { Console.print("main") }`, '', r => clean(r) && r.output[0].text === 'main' && r.tests.length === 3 && r.tests[0].ok && !r.tests[1].ok && /false/.test(r.tests[1].msg)
  && !r.tests[2].ok && /Stelle 5/.test(r.tests[2].msg) && r.report.tests.length === 3);
t('test: pure, ends with a Bool', `latch 1
test "prints" {
    Console.print("x")
    return true
}
test "no result" { let a = 1 }
test "wrong type" { return 5 }
test "prints" { return true }
function main() { }`, '', r => r.errors.length === 4 && has(r, /Tests sind rein und haben keine Rechte\. Console\.print braucht Console/) && has(r, /Der Test "no result" endet nicht mit return/)
  && has(r, /Die Rückgabe von test "wrong type" erwartet Bool, vorhanden ist Int/) && has(r, /Den Test "prints" gibt es schon/));

t('with: changed copy', `latch 1
type Cursor = { row: Int, col: Int }
function main() uses Console {
    let a = Cursor { row: 1, col: 2 }
    let b = a with { col: 9 }
    let c = (b with { row: a.row + 1 }).row
    Console.print("{a.col} {b.row} {b.col} {c}")
}`, '', r => clean(r) && r.output[0].text === '2 1 9 2');
t('with: rules', `latch 1
type Cursor = { row: Int, col: Int }
resource Page { frame: Int }
function main() {
    let a = Cursor { row: 1, col: 2 }
    let b = a with { col: "x" }
    let c = a with { depth: 1 }
    let d = 5 with { col: 1 }
    let p = Page { frame: 1 }
    let q = p with { frame: 2 }
    destroy p
    destroy q
}`, '', r => has(r, /Das Feld col von Cursor erwartet Int, vorhanden ist Text/) && has(r, /Cursor hat kein Feld depth/) && has(r, /with braucht einen Datensatz, vorhanden ist Int/)
  && has(r, /Eine Ressource gibt es genau einmal/));

t('foreign: no body, assumed, in the report', `latch 1
type Len = Int where it in 0..4096
foreign function c_strlen(s: Text) -> Len
    uses Process
    requires s.length > 0
    assumes "strlen from libc, text is NUL-terminated"
foreign function c_beep() uses Process assumes "beeps"
function main() uses Process, Console {
    c_beep()
    Console.print(c_strlen("hallo") + 1)
}`, 'foreign c_strlen = 5', r => clean(r) && r.output.map(o => o.kind + ':' + o.text).join('|') === 'foreign:c_beep()|foreign:c_strlen("hallo")|out:6'
  && r.report.functions[0].foreign === true && r.report.functions[0].assumes.length === 1);
t('foreign: the bench needs a value, and it must fit', `latch 1
type Len = Int where it in 0..4096
foreign function c_strlen(s: Text) -> Len assumes "strlen from libc"
function main() uses Console { Console.print(c_strlen("hallo")) }`, 'foreign c_strlen = 99999', r => r.errors.length === 0 && /"99999", das ist kein Len/.test(r.runtimeError.msg));
t('foreign: missing value', `latch 1
foreign function c_time() -> Int assumes "time from libc"
function main() uses Console { Console.print(c_time()) }`, '', r => /foreign c_time = wert/.test(r.runtimeError.msg));
t('foreign: rules', `latch 1
foreign function a() uses Process
foreign function b() assumes "x" { }
function main() { }`, '', r => one(r, /keinen Latch-Rumpf/));
t('foreign: needs assumes, caller needs its rights', `latch 1
foreign function a() uses Process
function main() { a() }`, '', r => r.errors.length === 2 && has(r, /Die foreign-Funktion a braucht mindestens eine Annahme/) && has(r, /main braucht das Recht Process/));

const IRQ = `latch 1
type Byte = Int where it in 0..255
enum Event { Key(code: Byte), Released, Tick, Fault }
function on_key() -> Event
    handles Interrupt(33)
    uses Port(0x60)
{
    let code = check Port.read(0x60) as Byte otherwise return Fault
    if Bits.test(code, 7) { return Released }
    return Key(code)
}
function on_tick() -> Event handles Interrupt(32) { return Tick }
`;
t('interrupt: handlers report events, main fetches them', IRQ + `
function main() uses Port(0x60), Interrupt, Console {
    var keys = 0
    forever {
        let ev = Interrupt.wait()
        match ev {
            Key(code) -> { keys = keys + 1
                Console.print("Taste {code}") }
            Released -> { }
            Tick -> Console.print("tick")
            Fault -> Console.print("kaputt")
        }
    }
}`, 'keys = ab\nticks = 1', r => clean(r) && texts(r).indexOf('Taste 30,tick,Taste 48') === 0 && /Interrupt\.wait\(\) in Zeile \d+: Die Außenwelt liefert keine Unterbrechung mehr/.test(r.halted)
  && r.warnings.length === 0 && r.report.interrupts.length === 2 && r.report.interrupts[0].event === 'Event' && r.report.functions[0].handles === 33);
t('interrupt: next does not wait', IRQ + `
function poll() -> Event uses Interrupt { return Interrupt.next() otherwise return Tick }
function main() uses Port(0x60), Interrupt, Console {
    match poll() {
        Key(code) -> Console.print("zu frueh")
        Released -> { }
        Tick -> Console.print("nichts da")
        Fault -> { }
    }
    var n = 0
    forever {
        n = n + 1
        if n == 3 {
            let ev = Interrupt.next() otherwise return Done
            match ev {
                Key(code) -> Console.print("Taste {code}")
                Released -> { }
                Tick -> { }
                Fault -> { }
            }
            return Done
        }
    }
}`, 'keys = a', r => clean(r) && texts(r) === 'nichts da,Taste 30' && r.halted === null);
t('interrupt: a full queue loses events and says so', IRQ + `
function main() uses Port(0x60), Interrupt, Console {
    var n = 0
    forever {
        n = n + 1
        if n == 90 {
            Console.print(Interrupt.lost())
            return Done
        }
    }
}`, 'ticks = 70', r => clean(r) && r.output[0].text === '6' && /6 Ereignisse verloren: Die Warteschlange fasst 64/.test(r.output[1].text));
t('interrupt: main is the ceiling', IRQ + `
function main() uses Interrupt { forever { let ev = Interrupt.wait() } }`, '', r => one(r, /on_key behandelt Interrupt\(33\) und braucht Port\(0x60\)\. main nennt dieses Recht nicht/));
t('interrupt: nothing fired when the program ends first', IRQ + `
function main() uses Port(0x60) { }`, 'interrupts = 7 33', r => clean(r) && /2 Unterbrechungen nicht ausgelöst/.test(r.output[0].text));
t('interrupt: fetching needs the right and a handler', `latch 1
function main() { let ev = Interrupt.wait() }`, '', r => r.errors.length === 2 && has(r, /main braucht das Recht Interrupt/) && has(r, /Es fehlt eine Funktion mit handles Interrupt\(n\)/));
t('interrupt: no handler', `latch 1
function main() { forever { } }`, 'interrupts = 7', r => clean(r) && /Unterbrechung 7: keine Funktion behandelt sie/.test(r.output[0].text));
t('interrupt: rules', `latch 1
enum Event { Tick }
enum Other { Tock }
function a(n: Int) -> Event handles Interrupt(32) { return Tick }
function b() -> Event handles Interrupt(32) { return Tick }
function c() -> Event handles Interrupt(300) { return Tick }
function d() handles Interrupt(40) { }
function e() -> Other handles Interrupt(41) { return Tock }
function f() -> Int handles Interrupt(42) { return 1 }
function g() -> Event fails Other handles Interrupt(43) { return Tick }
function h() -> Event handles Interrupt(44) uses Interrupt { return Interrupt.wait() }
function main() uses Interrupt { }`, '', r => r.errors.length === 8 && has(r, /hat deshalb keine Parameter/) && has(r, /Interrupt\(32\) wird schon von a behandelt/) && has(r, /Nummern 0 bis 255/)
  && has(r, /Im Kopf fehlt der Ergebnistyp/) && has(r, /melden denselben Ereignistyp\. a meldet Event, e meldet Other/) && has(r, /ist eine Aufzählung \(enum\), vorhanden ist Int/)
  && has(r, /kann nicht scheitern/) && has(r, /holt selbst keine Ereignisse ab/));
t('interrupt: handles comes before uses', `latch 1
function a() -> Done uses Cpu handles Interrupt(32) { }
function main() { }`, '', r => one(r, /Reihenfolge im Funktionskopf ist fest: handles, uses/));

const TOG = `latch 1
type Celsius = Int where it in -90..60
function weather(city: Text) -> unchecked Text uses Net("api.weather.com") {
    return Net.get("api.weather.com", "/v1/" + city)
}
`;
t('together: needs Tasks, names live on afterwards', TOG + `
function main() uses Net("api.weather.com"), Tasks, Console {
    together {
        let a = weather("berlin")
        let b = weather("dresden")
    }
    let ta = check a as Celsius otherwise return Done
    let tb = check b as Celsius otherwise return Done
    Console.print(ta + tb)
}`, 'net api.weather.com/v1/berlin = 3\nnet api.weather.com/v1/dresden = 4', r => clean(r) && r.output[2].text === '7');
t('together: missing right', TOG + `
function main() uses Net("api.weather.com") {
    together { let a = weather("berlin") }
}`, '', r => one(r, /main braucht das Recht Tasks \(wegen together\)/));
t('together: lines do not see or disturb each other', `latch 1
type Pool = { free: Int }
function grab(change pool: Pool) -> Int { pool.free = pool.free - 1
 return pool.free }
function main() uses Tasks {
    var pool = Pool { free: 2 }
    together {
        let a = grab(change pool)
        let b = grab(change pool)
    }
    together {
        let c = 1
        let d = c + 1
    }
}`, '', r => r.errors.length === 2 && /pool wird in einer Zeile von together verändert/.test(r.errors[0].msg) && /Der Name c ist hier nicht bekannt/.test(r.errors[1].msg));
t('together: only let lines', `latch 1
function main() uses Tasks { together { var a = 1 } }`, '', r => one(r, /In together steht in jeder Zeile ein let/));

t('bits: library', `latch 1
function main() uses Console {
    Console.print("{Bits.and(12, 10)} {Bits.or(12, 10)} {Bits.xor(12, 10)}")
    Console.print("{Bits.shift_left(1, 10)} {Bits.shift_right(1024, 3)}")
    Console.print("{Bits.test(5, 0)} {Bits.test(5, 1)} {Bits.and(0xFFFFFFFFFF, 0xFF00000000)}")
    Console.print(Bits.shift_left(1, 60))
}`, '', r => r.errors.length === 0 && texts(r) === '8 14 6,1024 128,true false 1095216660480' && /Zahlenüberlauf/.test(r.runtimeError.msg));
t('bits: no negative numbers, typed', `latch 1
function main() uses Console {
    if Bits.test(1, 0) { Console.print(Bits.and(0 - 1, 1)) }
}`, '', r => r.errors.length === 0 && /Bits rechnet nur mit Zahlen ab 0/.test(r.runtimeError.msg));
t('bits: arguments are Int', `latch 1
function main() { let a = Bits.and("x", 1) + 1
 let b = not Bits.test(1, 1) }`, '', r => one(r, /Bits\.and \(Argument 1\) erwartet Int/));

/* ---------- Module ---------- */
const SCREEN = `latch 1
public type Cursor = { row: Int, col: Int }
public enum Color { White, Red(level: Int) }
public const WIDTH = 80
const HEIGHT = 25
public resource Lock { id: Int }

public function start() -> Cursor
    ensures result.row == 0
{
    return Cursor { row: 0, col: 0 }
}
public function put(change cur: Cursor, ch: Int)
    uses Memory(0xB8000..0xB8F9F)
    requires cur.col < WIDTH
    requires cur.row < HEIGHT
{
    Memory.write(cell(cur), ch)
    cur.col = cur.col + 1
}
function cell(cur: Cursor) -> Int { return 0xB8000 + (cur.row * WIDTH + cur.col) * 2 }
public function lock() -> Lock ensures result.id == 1 { return Lock { id: 1 } }
public function unlock(take l: Lock) requires l.id == 1 { destroy l }
public function attr(c: Color) -> Int ensures result > 0 {
    match c {
        White -> return 15
        Red(level) -> return 4 + level
    }
}
test "cell of the origin" { return cell(Cursor { row: 0, col: 0 }) == 0xB8000 }
`;
t('module: import, public function, type, const, enum', `latch 1
import Screen
function main() uses Memory(0xB8000..0xB8F9F), Console {
    var cur = Screen.start()
    Screen.put(change cur, 72)
    Screen.put(change cur, 105)
    let next: Screen.Cursor = Screen.Cursor { row: 1, col: Screen.WIDTH - 1 }
    Console.print("{cur.col} {next.col} {Screen.attr(Screen.Red(2))}")
    let c = Screen.White
    match c {
        Screen.White -> Console.print("weiss")
        Screen.Red(level) -> Console.print(level)
    }
    let l = Screen.lock()
    Screen.unlock(take l)
}`, '', r => clean(r) && r.screen[0] === 'Hi' && texts(r) === '2 79 6,weiss' && r.tests.length === 1 && r.tests[0].ok && r.tests[0].module === 'Screen'
  && r.report.modules.join() === 'Screen' && r.report.functions.some(f => f.name === 'Screen.put' && f.module === 'Screen'), { Screen: SCREEN });
t('module: private things stay inside', `latch 1
import Screen
function main() uses Console {
    let cur = Screen.start()
    Console.print(Screen.cell(cur))
    Console.print(Screen.HEIGHT)
    Console.print(Screen.nothing())
}`, '', r => r.errors.length === 3 && /cell ist in Screen nicht public/.test(r.errors[0].msg) && /HEIGHT ist in Screen nicht public/.test(r.errors[1].msg)
  && /Das Modul Screen hat nichts mit dem Namen nothing/.test(r.errors[2].msg), { Screen: SCREEN });
t('module: must be imported and exist', `latch 1
import Disk
function main() { let cur = Screen.start() }`, '', r => r.errors.length === 2 && /Das Modul Disk ist nicht vorhanden/.test(r.errors[0].msg) && /Screen ist hier nicht importiert/.test(r.errors[1].msg), { Screen: SCREEN });
t('module: use without import', `latch 1
function main() { let cur = Screen.start() }`, '', r => one(r, /Das Modul Screen ist hier nicht importiert\. Am Dateianfang ergänzen: import Screen/), { Screen: SCREEN });
t('module: rights travel across the border', `latch 1
import Screen
function main() {
    var cur = Screen.start()
    Screen.put(change cur, 72)
}`, '', r => one(r, /main braucht das Recht Memory\(0xB8000\.\.0xB8F9F\) \(wegen Aufruf von Screen\.put\)/), { Screen: SCREEN });
t('module: destroy only at home', `latch 1
import Screen
function main() {
    let l = Screen.lock()
    destroy l
}`, '', r => one(r, /destroy geht nur in dem Modul, das die Ressource definiert\. Screen\.Lock gehört zu Screen/), { Screen: SCREEN });
t('module: public function needs a contract, errors name the module', `latch 1
import Util
function main() uses Console { Console.print(Util.twice(2)) }`, '', r => r.errors.length === 2 && r.errors.every(e => e.module === 'Util')
  && /Die öffentliche Funktion Util\.twice braucht einen Vertrag/.test(r.errors[0].msg) && /Die Rückgabe von Util\.broken erwartet Int, vorhanden ist Text/.test(r.errors[1].msg) && r.errors[1].line === 3,
  { Util: 'latch 1\npublic function twice(n: Int) -> Int { return n * 2 }\nfunction broken() -> Int { return "x" }' });
t('module: runtime errors name the module they happen in', `latch 1
import Util
function main() uses Console {
    Console.print(Util.third([1, 2, 3]))
    Console.print(Util.third([1, 2]))
}`, '', r => r.errors.length === 0 && r.output[0].text === '3' && /Stelle 2 liegt außerhalb/.test(r.runtimeError.msg) && r.runtimeError.module === 'Util' && r.runtimeError.line === 2,
  { Util: 'latch 1\npublic function third(xs: List<Int>) -> Int requires xs.length >= 0 { return xs[2] }' });
t('module: syntax error inside a module', `latch 1
import Util
function main() { }`, '', r => r.errors.length === 1 && r.errors[0].module === 'Util' && r.errors[0].line === 2, { Util: 'latch 1\nfunction (' });
t('module: modules import each other, same names do not clash', `latch 1
import Kbd
function put() -> Int { return 1 }
function main() uses Console { Console.print("{put()} {Kbd.decode(30)}") }`, '', r => clean(r) && r.output[0].text === '1 31', {
  Kbd: 'latch 1\nimport Table2\npublic function decode(code: Int) -> Int requires code >= 0 { return put(code) }\nfunction put(n: Int) -> Int { return Table2.next(n) }',
  Table2: 'latch 1\npublic function next(n: Int) -> Int ensures result == n + 1 { return n + 1 }' });
t('module: import rules', `latch 1
import screen
import Console
function main() { }
import Late`, '', r => r.errors.length === 1 && /import steht am Dateianfang/.test(r.errors[0].msg));
t('module: lower case and library names', `latch 1
import screen
import Console
function main() { }`, '', r => r.errors.length === 2 && /Modulnamen beginnen mit einem Großbuchstaben: import Screen/.test(r.errors[0].msg) && /Console gehört zur Bibliothek/.test(r.errors[1].msg));
t('public: only before declarations', `latch 1
public test "x" { return true }
function main() { }`, '', r => one(r, /Nach public folgt type, enum, resource, const oder function/));

/* ---------- Aufgabe 3: der Kern aus kernel/ ---------- */
const KDIR = __dirname + '/../kernel/';
const KMODS = {};
for (const f of require('fs').readdirSync(KDIR)) if (f !== 'main.latch') KMODS[f.replace('.latch', '')] = require('fs').readFileSync(KDIR + f, 'utf8');
const KMAIN = require('fs').readFileSync(KDIR + 'main.latch', 'utf8');
const serial = r => r.output.filter(o => o.kind === 'serial').map(o => o.text.split(' ')[0]).join();
t('kernel: screen, keyboard, pages and scheduler in one loop', KMAIN, 'keys = hallo latch\nticks = 7', r => clean(r) && r.warnings.length === 0
  && r.screen.join('|') === 'Latch OS 0.1|hallo latch' && serial(r) === 'Kern,editor,backup,uhr,editor,backup,backup'
  && r.output.filter(o => o.kind === 'asm').length === 6 && /Interrupt\.wait/.test(r.halted) && r.tests.length === 9 && r.tests.every(x => x.ok)
  && r.report.modules.join() === 'Screen,Keyboard,Pages,Sched' && r.report.forever.length === 1 && r.report.interrupts.length === 2
  && r.report.program.join(' ') === 'Memory(0xB8000..0xB8F9F) Port(0x60) Port(0x3F8) Cpu Interrupt', KMODS);
t('kernel: ticks only, pages come back', KMAIN, 'ticks = 3', r => clean(r) && r.screen.length === 1 && serial(r) === 'Kern,editor,backup,uhr' && r.output.some(o => /uhr auf Seite 2/.test(o.text)), KMODS);
t('kernel: broken keyboard is an event, not a crash', KMAIN, 'interrupts = 33 32\nport 0x60 = kaputt', r => clean(r) && serial(r) === 'Kern,Tastatur,editor', KMODS);
t('kernel: lines fit a phone', KMAIN, '', r => Object.values(KMODS).concat([KMAIN]).join('\n').split('\n').every(l => l.length <= 44), KMODS);
t('kernel: a module without its right is rejected', KMAIN.replace('Port(0x60), Port(0x3F8),', 'Port(0x3F8),'), '', r => one(r, /on_key behandelt Interrupt\(33\) und braucht Port\(0x60\)/), KMODS);

let failed = 0;
for (const c of cases) {
  let r, ok = false, ex = null;
  try { r = Latch.run(c.src, c.world, c.mods); ok = !!c.expect(r); } catch (e) { ex = e; }
  if (!ok) {
    failed++;
    console.log('FAIL', c.name);
    if (ex) console.log('  exception', ex);
    else console.log(JSON.stringify({ errors: r.errors, warnings: r.warnings, output: r.output, rt: r.runtimeError, main: r.mainResult, failed: r.mainFailed }, null, 1));
  } else console.log('ok  ', c.name);
}
console.log(failed ? failed + ' FAILED' : 'ALL PASSED', cases.length);
