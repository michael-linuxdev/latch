const { Latch } = require('../src/latch.js');
const cases = [];
function t(name, src, world, expect) { cases.push({ name, src, world, expect }); }

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
    uses Input
{
    let name = check Input.read("name") as Name
        otherwise return BadInput("name")
    let email = check Input.read("email") as Email
        otherwise return BadInput("email")
    let age = check Input.read("age") as Age
        otherwise return BadInput("age")
    return Signup { name, email, age }
}

function store(s: Signup)
    -> Int fails SignupError
    uses Db("accounts")
    ensures result >= 1
{
    if Db.exists("accounts", "email", s.email) {
        return Taken
    }
    return Db.insert("accounts", s)
        otherwise return Unavailable
}

function main()
    -> Int fails SignupError
    uses Input, Db("accounts"), Net("smtp.x.com"), Console
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
t('signup db down', SIGNUP, W + 'db accounts = down', r => r.mainFailed && r.mainResult === 'Unavailable');
t('signup mail down', SIGNUP, W + 'mail = down', r => r.mainFailed && r.mainResult === 'Unavailable');
t('missing right', SIGNUP.replace('uses Input, Db("accounts"), Net("smtp.x.com"), Console', 'uses Input, Db("accounts"), Console'),
  W, r => r.errors.length === 1 && /Net\("smtp.x.com"\)/.test(r.errors[0].msg));
t('wrong host', SIGNUP.replace('Mail.send("smtp.x.com"', 'Mail.send("evil.example"'), W, r => r.errors.some(e => /evil.example/.test(e.msg)) && r.warnings.length === 1);
t('unchecked to db', TYPES + `
function main() uses Input, Db("accounts") {
    let raw = Input.read("age")
    Db.insert("accounts", raw) otherwise return Done
}`, W, r => r.errors.some(e => /Ungeprüfter Wert darf nicht an Db.insert/.test(e.msg)));
t('unchecked in if', TYPES + `
function main() uses Input, Console {
    let raw = Input.read("age")
    if raw == "36" { Console.print("x") }
}`, W, r => r.errors.length >= 1 && /Ungeprüft/.test(r.errors[0].msg));
t('unhandled check', TYPES + `
function main() uses Input {
    let age = check Input.read("age") as Age
}`, W, r => r.errors.length === 1 && /Fehlerfall nicht behandelt/.test(r.errors[0].msg));
t('else instead of otherwise', TYPES + `
function main() uses Input {
    let age = check Input.read("age") as Age
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
function f() -> Text uses Input { return Input.read("a") }
function main() uses Input { let x = f() }`, '', r => r.errors.length === 1 && /ungeprüften Wert zurück/.test(r.errors[0].msg));
t('try mismatch', `latch 1
enum E { A }
function main() -> Int fails E uses Input {
    let n = try check Input.read("n") as Int
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
function main() { together { } }`, '', r => /noch nicht unterstützt/.test(r.errors[0].msg));
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
function parse() -> Age fails SignupError uses Input {
    let age = check Input.read("age") as Age otherwise return BadInput("age")
    return age
}
function main() -> Int fails SignupError uses Input, Console {
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
function main() uses Input, Console {
    let age = check Input.read("age") as Age otherwise as e {
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
function main() uses Input, Console {
    let xs = [1, 2]
    let raw = Input.read("i")
    Console.print(xs[raw])
    let k = secret 1
    Console.print(xs[k])
}`, '', r => r.errors.length === 2 && /Ungeprüfter Wert als Stelle/.test(r.errors[0].msg) && /Geheimnis darf nicht als Stelle/.test(r.errors[1].msg));

t('reserved new words', `latch 1
function main() { let old = 1 }`, '', r => r.errors.length === 1 && /Schlüsselwort/.test(r.errors[0].msg));
t('forever not yet', `latch 1
function main() { forever { } }`, '', r => r.errors.length === 1 && /noch nicht unterstützt/.test(r.errors[0].msg));

let failed = 0;
for (const c of cases) {
  let r, ok = false, ex = null;
  try { r = Latch.run(c.src, c.world); ok = !!c.expect(r); } catch (e) { ex = e; }
  if (!ok) {
    failed++;
    console.log('FAIL', c.name);
    if (ex) console.log('  exception', ex);
    else console.log(JSON.stringify({ errors: r.errors, warnings: r.warnings, output: r.output, rt: r.runtimeError, main: r.mainResult, failed: r.mainFailed }, null, 1));
  } else console.log('ok  ', c.name);
}
console.log(failed ? failed + ' FAILED' : 'ALL PASSED', cases.length);
