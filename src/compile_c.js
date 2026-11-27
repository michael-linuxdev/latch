/* Latch -> freistehendes C. Erster Schritt des Compilers (Aufgabe 4).
   Übersetzt wird, was von main aus erreichbar ist. Was der Compiler noch nicht kann, lehnt er mit Zeile ab.
   Verträge und Hardware-Grenzen werden wie im Prüfstand zur Laufzeit geprüft, nicht bewiesen. */
'use strict';
const { Latch } = require('./latch.js');

const RUNTIME = String.raw`/* Erzeugt vom Latch-Compiler. Nicht von Hand ändern. */
typedef long long latch_int;
typedef struct { const unsigned char *p; int n; } latch_text;

static inline void latch_outb(unsigned short port, unsigned char v) { __asm__ volatile ("outb %0, %1" : : "a"(v), "Nd"(port)); }
static inline unsigned char latch_inb(unsigned short port) { unsigned char v; __asm__ volatile ("inb %1, %0" : "=a"(v) : "Nd"(port)); return v; }

static void latch_serial(const char *s) { while (*s) latch_outb(0x3F8, (unsigned char)*s++); }
static void latch_serial_num(int n) {
  char buf[12]; int i = 11; buf[i] = 0;
  if (n == 0) buf[--i] = '0';
  while (n > 0) { buf[--i] = (char)('0' + n % 10); n /= 10; }
  latch_serial(buf + i);
}
/* Ein verletzter Vertrag hält den Kern an. Die Meldung geht auf COM1, QEMU beendet sich über isa-debug-exit. */
__attribute__((noreturn)) static void latch_panic(const char *msg, int line) {
  latch_serial("PANIC Zeile "); latch_serial_num(line); latch_serial(": "); latch_serial(msg); latch_serial("\n");
  latch_outb(0xF4, 1);
  for (;;) __asm__ volatile ("cli; hlt");
}
static inline latch_int latch_add(latch_int a, latch_int b, int line) { latch_int r; if (__builtin_add_overflow(a, b, &r)) latch_panic("Zahlenueberlauf", line); return r; }
static inline latch_int latch_sub(latch_int a, latch_int b, int line) { latch_int r; if (__builtin_sub_overflow(a, b, &r)) latch_panic("Zahlenueberlauf", line); return r; }
/* 64-Bit-Division von Hand: Ohne Betriebssystem gibt es keine Bibliothek, die sie liefert. */
static unsigned long long latch_udivmod(unsigned long long n, unsigned long long d, unsigned long long *rem) {
  unsigned long long q = 0, r = 0;
  for (int i = 63; i >= 0; i--) {
    r = (r << 1) | ((n >> i) & 1);
    if (r >= d) { r -= d; q |= 1ULL << i; }
  }
  if (rem) *rem = r;
  return q;
}
static latch_int latch_div(latch_int a, latch_int b, int line) {
  if (b == 0) latch_panic("Division durch null", line);
  if (a == (-9223372036854775807LL - 1) && b == -1) latch_panic("Zahlenueberlauf", line);
  unsigned long long ua = a < 0 ? 0ULL - (unsigned long long)a : (unsigned long long)a, ub = b < 0 ? 0ULL - (unsigned long long)b : (unsigned long long)b;
  unsigned long long q = latch_udivmod(ua, ub, 0);
  return (a < 0) != (b < 0) ? -(latch_int)q : (latch_int)q;
}
static latch_int latch_mod(latch_int a, latch_int b, int line) {
  if (b == 0) latch_panic("Division durch null", line);
  if (b == -1) return 0;
  unsigned long long ua = a < 0 ? 0ULL - (unsigned long long)a : (unsigned long long)a, ub = b < 0 ? 0ULL - (unsigned long long)b : (unsigned long long)b, r;
  latch_udivmod(ua, ub, &r);
  return a < 0 ? -(latch_int)r : (latch_int)r;
}
static latch_int latch_mul(latch_int a, latch_int b, int line) {
  if (a == 0 || b == 0) return 0;
  unsigned long long ua = a < 0 ? 0ULL - (unsigned long long)a : (unsigned long long)a, ub = b < 0 ? 0ULL - (unsigned long long)b : (unsigned long long)b;
  int neg = (a < 0) != (b < 0);
  unsigned long long limit = neg ? 9223372036854775808ULL : 9223372036854775807ULL;
  if (ua > latch_udivmod(limit, ub, 0)) latch_panic("Zahlenueberlauf", line);
  unsigned long long p = ua * ub;
  return neg ? (latch_int)(0ULL - p) : (latch_int)p;
}
static inline int latch_index(latch_int i, int n, int line) { if (i < 0 || i >= n) latch_panic("Stelle ausserhalb der Tabelle", line); return (int)i; }
static inline latch_int latch_bits(latch_int v, int line) { if (v < 0) latch_panic("Bits rechnet nur mit Zahlen ab 0", line); return v; }
static inline int latch_shift(latch_int n, int line) { if (n < 0 || n > 62) latch_panic("Verschoben wird um 0 bis 62 Stellen", line); return (int)n; }
static inline latch_int latch_shl(latch_int a, latch_int n, int line) { int s = latch_shift(n, line); latch_bits(a, line); if (s && (a >> (63 - s))) latch_panic("Zahlenueberlauf", line); return a << s; }
static inline latch_int latch_shr(latch_int a, latch_int n, int line) { return latch_bits(a, line) >> latch_shift(n, line); }
static inline int latch_bit(latch_int a, latch_int n, int line) { return (int)((latch_bits(a, line) >> latch_shift(n, line)) & 1); }
#define LATCH_TEXT_MAX 256
static void latch_fmt_text(unsigned char *buf, int *n, latch_text t, int line) {
  if (*n + t.n > LATCH_TEXT_MAX) latch_panic("Ein eingesetzter Text ist laenger als 256 Bytes", line);
  for (int i = 0; i < t.n; i++) buf[(*n)++] = t.p[i];
}
static void latch_fmt_int(unsigned char *buf, int *n, latch_int v, int line) {
  unsigned char d[20]; int k = 0;
  unsigned long long u = v < 0 ? 0ULL - (unsigned long long)v : (unsigned long long)v, r;
  do { u = latch_udivmod(u, 10, &r); d[k++] = (unsigned char)('0' + (int)r); } while (u);
  if (*n + k + 1 > LATCH_TEXT_MAX) latch_panic("Ein eingesetzter Text ist laenger als 256 Bytes", line);
  if (v < 0) buf[(*n)++] = '-';
  while (k) buf[(*n)++] = d[--k];
}
static inline void latch_require(int ok, const char *msg, int line) { if (!ok) latch_panic(msg, line); }
static inline unsigned char latch_byte(latch_int v, int line) { if (v < 0 || v > 255) latch_panic("Ein Byte liegt zwischen 0 und 255", line); return (unsigned char)v; }
static inline void latch_mem_write(latch_int addr, latch_int v, int line) { *(volatile unsigned char *)(unsigned long)addr = latch_byte(v, line); }
static inline latch_int latch_mem_read(latch_int addr) { return *(volatile unsigned char *)(unsigned long)addr; }
`;

const BOOT = String.raw`
/* Start: Multiboot-1-Kopf, Stapel, dann main. */
__asm__(
  ".section .multiboot, \"a\"\n"
  ".align 4\n"
  ".long 0x1BADB002\n"
  ".long 0\n"
  ".long -(0x1BADB002)\n"
  ".section .bss\n"
  ".align 16\n"
  "latch_stack_bottom: .skip 65536\n"
  "latch_stack_top:\n"
  ".section .text\n"
  ".global _start\n"
  "latch_gdt:\n"
  "  .quad 0\n"
  "  .quad 0x00CF9A000000FFFF\n"
  "  .quad 0x00CF92000000FFFF\n"
  "latch_gdtr:\n"
  "  .word 23\n"
  "  .long latch_gdt\n"
  "_start:\n"
  "  cli\n"
  "  mov $latch_stack_top, %esp\n"
  "  lgdt latch_gdtr\n"
  "  ljmp $0x08, $1f\n"
  "1: mov $0x10, %ax\n"
  "  mov %ax, %ds\n"
  "  mov %ax, %es\n"
  "  mov %ax, %fs\n"
  "  mov %ax, %gs\n"
  "  mov %ax, %ss\n"
  "  call latch_start\n"
  "2: hlt\n"
  "  jmp 2b\n"
);
`;

const LINKER = `ENTRY(_start)
SECTIONS {
  . = 1M;
  .text : { KEEP(*(.multiboot)) *(.text*) }
  .rodata : { *(.rodata*) }
  .data : { *(.data*) }
  .bss : { *(.bss*) *(COMMON) }
  /DISCARD/ : { *(.note*) *(.comment*) *(.eh_frame*) }
}
`;

const EVENTS = String.raw`
/* Ereignisse: Funktionen mit handles melden sie, main holt sie ab. Die Warteschlange fasst 64. */
static EVENT latch_evq[64];
static volatile int latch_ev_head, latch_ev_count;
static volatile latch_int latch_ev_lostn;
static void latch_ev_push(EVENT e) {
  if (latch_ev_count >= 64) { latch_ev_lostn++; return; }
  latch_evq[(latch_ev_head + latch_ev_count) % 64] = e;
  latch_ev_count++;
}
static int latch_ev_take(EVENT *e) {
  if (!latch_ev_count) return 0;
  *e = latch_evq[latch_ev_head];
  latch_ev_head = (latch_ev_head + 1) % 64;
  latch_ev_count--;
  return 1;
}
static int latch_ev_next(EVENT *e) { __asm__ volatile ("cli"); int ok = latch_ev_take(e); __asm__ volatile ("sti"); return ok; }
/* Schläft, bis ein Ereignis da ist. "sti; hlt" lässt keine Lücke, in der eine Unterbrechung verloren ginge. */
static EVENT latch_ev_wait(void) {
  EVENT e;
  for (;;) {
    __asm__ volatile ("cli");
    if (latch_ev_take(&e)) { __asm__ volatile ("sti"); return e; }
    __asm__ volatile ("sti; hlt");
  }
}
static latch_int latch_ev_lost(void) { return latch_ev_lostn; }

struct latch_idt_entry { unsigned short lo, sel; unsigned char zero, flags; unsigned short hi; } __attribute__((packed));
static struct latch_idt_entry latch_idt[256];
static void latch_idt_set(int n, void (*handler)(void)) {
  unsigned long a = (unsigned long)handler;
  latch_idt[n].lo = (unsigned short)(a & 0xFFFF); latch_idt[n].sel = 0x08; latch_idt[n].zero = 0; latch_idt[n].flags = 0x8E; latch_idt[n].hi = (unsigned short)(a >> 16);
}
void latch_fault(void);
__attribute__((used)) void latch_fault_c(void) { latch_panic("CPU-Ausnahme oder unerwartete Unterbrechung", 0); }
__asm__(".text\n.global latch_fault\nlatch_fault:\n  cli\n  call latch_fault_c\n");
`;

function compile(src, modules) {
  const info = Latch.analyze(src, modules);
  if (info.errors.length) return { errors: info.errors, c: null };
  const errors = [], types = info.types, funcs = info.funcs, variants = info.variants, handlers = info.handlers || {};
  const enumOf = {};
  Object.keys(variants).forEach(vn => { (enumOf[variants[vn].enumName] = enumOf[variants[vn].enumName] || []).push(vn); });
  const constOf = {};
  info.consts.forEach(c => { constOf[c.name] = c; });
  let curMod = '';
  function no(line, what) {
    const msg = 'Der Compiler kann ' + what + ' noch nicht übersetzen. Der Prüfstand führt es aus.';
    if (!errors.some(e => e.line === line && e.msg === msg && (e.module || '') === curMod)) errors.push({ line, module: curMod || undefined, msg });
    return '0';
  }
  const id = name => name.replace(/\./g, '_');
  const cstr = s => '"' + Array.from(Buffer.from(s, 'utf8')).map(b => b === 34 || b === 92 ? '\\' + String.fromCharCode(b) : b >= 32 && b < 127 ? String.fromCharCode(b) : '\\' + b.toString(8).padStart(3, '0')).join('') + '"';
  const ascii = s => cstr(s.replace(/[^\x20-\x7e]/g, '?'));
  const textLit = s => '((latch_text){ (const unsigned char *)' + cstr(s) + ', ' + Buffer.byteLength(s, 'utf8') + ' })';
  function root(t) { let d = 0; while (t && !t.a && types[t.n] && types[t.n].kind === 'refined' && d++ < 25) t = { n: types[t.n].base, a: null }; return t; }
  const refT = ref => ({ n: ref.base, a: ref.args.length ? ref.args.map(x => typeof x === 'number' ? x : refT(x)) : null });
  const isStruct = n => !!(types[n] && (types[n].kind === 'record' || types[n].kind === 'resource'));
  const isVoid = t => { const r = root(t); return !r || (!r.a && r.n === 'Done'); };
  const isTable = r => !!(r && r.a && r.n === 'Table' && typeof r.a[1] === 'number' && r.a[0]);

  /* Typen: C-Erklärungen entstehen, sobald ein Typ gebraucht wird, in der Reihenfolge ihrer Abhängigkeiten. */
  const head = [], defined = {};
  function cname(t) {
    const r = root(t);
    if (!r) return 'int';
    if (r.a) return 'T_' + cname(r.a[0]) + '_' + r.a[1];
    if (r.n === 'Int') return 'int';
    if (r.n === 'Bool') return 'bool';
    if (r.n === 'Text') return 'text';
    return (isStruct(r.n) ? 'R_' : 'E_') + id(r.n);
  }
  function ctype(t, line) {
    const r = root(t);
    if (!r) { no(line, 'einen Wert unbekannten Typs'); return 'latch_int'; }
    if (!r.a) {
      if (r.n === 'Int') return 'latch_int';
      if (r.n === 'Bool' || r.n === 'Done') return 'int';
      if (r.n === 'Text') return 'latch_text';
      if (isStruct(r.n)) {
        const name = 'R_' + id(r.n);
        if (!defined[name]) {
          defined[name] = true;
          const saved = curMod;
          curMod = types[r.n].module || '';
          const fields = types[r.n].fields.map(f => ctype(refT(f.type), types[r.n].line) + ' f_' + f.name + ';');
          curMod = saved;
          head.push('struct ' + name + ' { ' + fields.join(' ') + ' };');
        }
        return 'struct ' + name;
      }
      if (enumOf[r.n]) {
        const name = 'E_' + id(r.n);
        if (!defined[name]) {
          defined[name] = true;
          const parts = enumOf[r.n].filter(vn => variants[vn].fields.length).map(vn =>
            'struct { ' + variants[vn].fields.map((fname, i) => ctype(variants[vn].ftypesT[i], line) + ' f_' + fname + ';').join(' ') + ' } v_' + id(vn) + ';');
          head.push('struct ' + name + ' { int tag; ' + parts.join(' ') + ' };');
        }
        return 'struct ' + name;
      }
    } else if (isTable(r)) {
      const elem = ctype(r.a[0], line), name = cname(r);
      if (!defined[name]) { defined[name] = true; head.push('struct ' + name + ' { ' + elem + ' a[' + Math.max(r.a[1], 1) + ']; };'); }
      return 'struct ' + name;
    }
    no(line, 'den Typ ' + r.n + (r.a ? '<...>' : ''));
    return 'latch_int';
  }
  /* Ergebnis einer Funktion, die scheitern kann: entweder der Wert oder der Fehler */
  function resType(okT, errName, line) {
    const name = 'X_' + (isVoid(okT) ? 'void' : cname(okT)) + '_' + id(errName);
    if (!defined[name]) {
      defined[name] = true;
      const ok = isVoid(okT) ? '' : ctype(okT, line) + ' ok; ', err = ctype({ n: errName, a: null }, line);
      head.push('struct ' + name + ' { int failed; ' + ok + err + ' err; };');
    }
    return 'struct ' + name;
  }
  const tag = vn => enumOf[variants[vn].enumName].indexOf(vn);
  const plainEnum = n => enumOf[n] && enumOf[n].every(vn => !variants[vn].fields.length);

  /* Einschränkungen (where) als Funktionen: gilt der Wert als T? */
  const wheres = [];
  function whereFn(typeName, line) {
    const t = types[typeName];
    if (!t || t.kind !== 'refined') return null;
    const name = 'W_' + id(typeName);
    if (defined[name]) return name;
    defined[name] = true;
    const base = whereFn(t.base, line), ct = ctype({ n: typeName, a: null }, line);
    const saved = { fn, out, curMod };
    curMod = t.module || '';
    fn = { f: { name: typeName, rights: [] }, ptr: {}, bufs: 0 };
    const cond = t.where ? expr(t.where) : '1';
    ({ fn, out, curMod } = saved);
    wheres.push('static int ' + name + '(' + ct + ' v_it) { return ' + (base ? base + '(v_it) && ' : '') + cond + '; }');
    return name;
  }

  /* Funktionen und Konstanten entstehen, sobald etwas sie braucht. Unerreichbares wird nicht übersetzt. */
  const queue = [], wanted = {}, usedConst = {}, asmNeeded = [];
  function want(name) { if (!wanted[name] && funcs[name]) { wanted[name] = true; queue.push(funcs[name]); } }
  function sigOf(f) {
    const ret = f.errType ? resType(f.retT, f.errType, f.line) : isVoid(f.retT) ? 'void' : ctype(f.retT, f.line);
    const params = f.params.map((p, i) => ctype(f.paramT[i], p.line) + (p.mode === 'change' ? ' *' : ' ') + 'v_' + p.name);
    const cn = f.assembly ? 'A_' + id(f.name) : f.name === 'main' ? 'latch_main' : 'F_' + id(f.name);
    return { ret, cn, text: ret + ' ' + cn + '(' + (params.join(', ') || 'void') + ')' };
  }

  let fn = null, tmp = 0, olds = null, out = [];
  const T = p => '_' + p + (tmp++);
  const emit = (ind, s) => out.push('  '.repeat(ind) + s);
  function capture(run) { const saved = out; out = []; run(); const got = out; out = saved; return got.map(l => l.trim()).join(' '); }
  function lv(name) { return fn.ptr[name] ? '(*v_' + name + ')' : 'v_' + name; }

  /* Etwas, das scheitern kann: vorbereitende Anweisungen, Bedingung, Wert und Fehlerwert */
  function isFallible(e) {
    if (e.k === 'Call') return !!(funcs[e.name] && funcs[e.name].errType);
    if (e.k === 'Check') return true;
    return e.k === 'MCall' && (e.mod + '.' + e.fn === 'List.at' || e.mod + '.' + e.fn === 'Interrupt.next');
  }
  function fall(e) {
    const L = e.line;
    if (e.k === 'Call') {
      const f = funcs[e.name], r = T('r');
      return { pre: resType(f.retT, f.errType, L) + ' ' + r + ' = ' + call(e) + ';', failed: r + '.failed', ok: isVoid(f.retT) ? '0' : r + '.ok', err: r + '.err', errName: f.errType };
    }
    if (e.k === 'Check') {
      const st = root(e.e.ty), tt = root({ n: e.type, a: null }), c = T('c');
      const errC = '((' + ctype({ n: 'CheckFailed', a: null }, L) + '){ 0 })';
      if (!st || !tt || st.n !== tt.n || (st.n !== 'Int' && st.n !== 'Bool' && st.n !== 'Text')) { no(L, 'check von ' + (st ? st.n : '?') + ' nach ' + e.type + ' (Umwandeln von Text in Zahl fehlt)'); return { pre: '', failed: '0', ok: '0', err: errC, errName: 'CheckFailed' }; }
      const w = whereFn(e.type, L);
      return { pre: ctype(tt, L) + ' ' + c + ' = ' + expr(e.e) + ';', failed: w ? '!' + w + '(' + c + ')' : '0', ok: c, err: errC, errName: 'CheckFailed' };
    }
    const q = e.mod + '.' + e.fn;
    if (q === 'Interrupt.next') {
      const v = T('e'), f = T('f');
      return { pre: 'EVENT ' + v + '; int ' + f + ' = !latch_ev_next(&' + v + ');', failed: f, ok: v, err: '((' + ctype({ n: 'Missing', a: null }, L) + '){ 0 })', errName: 'Missing' };
    }
    const a0 = e.args[0], errM = '((' + ctype({ n: 'Missing', a: null }, L) + '){ 0 })', i = T('i');
    if (a0.k === 'MCall' && a0.mod === 'Text' && a0.fn === 'bytes') {
      const t = T('t');
      return { pre: 'latch_text ' + t + ' = ' + expr(a0.args[0]) + '; latch_int ' + i + ' = ' + expr(e.args[1]) + ';', failed: '(' + i + ' < 0 || ' + i + ' >= ' + t + '.n)', ok: '((latch_int)' + t + '.p[' + i + '])', err: errM, errName: 'Missing' };
    }
    const lt = root(a0.ty);
    if (isTable(lt)) {
      const t = T('t');
      return { pre: ctype(lt, L) + ' ' + t + ' = ' + expr(a0) + '; latch_int ' + i + ' = ' + expr(e.args[1]) + ';', failed: '(' + i + ' < 0 || ' + i + ' >= ' + lt.a[1] + ')', ok: t + '.a[' + i + ']', err: errM, errName: 'Missing' };
    }
    no(L, 'List.at auf einer Liste ohne feste Größe');
    return { pre: '', failed: '0', ok: '0', err: errM, errName: 'Missing' };
  }
  /* Was "return wert" mit dem Ergebnis der laufenden Funktion tut */
  function retStmts(e) {
    const f = fn.f;
    if (!e) return f.errType ? '_result.failed = 0;' : '';
    if (f.errType) {
      const et = root(e.ty);
      if (et && !et.a && et.n === f.errType) return '_result.failed = 1; _result.err = ' + expr(e) + ';';
      if (isFallible(e)) {
        const x = fall(e);
        return x.pre + ' if (' + x.failed + ') { _result.failed = 1; _result.err = ' + x.err + '; } else { _result.failed = 0; ' + (fn.okVoid ? '' : '_result.ok = ' + x.ok + '; ') + '}';
      }
      return fn.okVoid ? '(void)' + expr(e) + '; _result.failed = 0;' : '_result.failed = 0; _result.ok = ' + expr(e) + ';';
    }
    return fn.retVoid ? '(void)' + expr(e) + ';' : '_result = ' + expr(e) + ';';
  }
  function withOther(e, other) {
    const x = fall(e);
    let onFail;
    if (other.k === 'ret') onFail = retStmts(other.e) + ' goto done;';
    else onFail = ctype({ n: x.errName, a: null }, other.line) + ' v_' + other.name + ' = ' + x.err + '; (void)v_' + other.name + '; ' + capture(() => block(other.body, 0)) + ' goto done;';
    return '({ ' + x.pre + ' if (' + x.failed + ') { ' + onFail + ' } ' + x.ok + '; })';
  }
  function tryExpr(e) {
    const x = fall(e.e);
    return '({ ' + x.pre + ' if (' + x.failed + ') { _result.failed = 1; _result.err = ' + x.err + '; goto done; } ' + x.ok + '; })';
  }
  const value = s => s.other ? withOther(s.e, s.other) : expr(s.e);

  /* Eingesetzte Texte: Der Speicher dafür liegt in der aufrufenden Funktion und lebt nur während des Aufrufs. */
  function fmt(e) {
    const buf = '_buf' + (fn.bufs++), n = T('n');
    const parts = e.parts.map(p => {
      if (p.text !== undefined) return 'latch_fmt_text(' + buf + ', &' + n + ', ' + textLit(p.text) + ', ' + e.line + ');';
      const r = root(p.expr.ty);
      if (r && r.n === 'Int') return 'latch_fmt_int(' + buf + ', &' + n + ', ' + expr(p.expr) + ', ' + e.line + ');';
      if (r && r.n === 'Text') return 'latch_fmt_text(' + buf + ', &' + n + ', ' + expr(p.expr) + ', ' + e.line + ');';
      if (r && r.n === 'Bool') return 'latch_fmt_text(' + buf + ', &' + n + ', ' + expr(p.expr) + ' ? ' + textLit('true') + ' : ' + textLit('false') + ', ' + e.line + ');';
      return no(e.line, 'das Einsetzen dieses Werts in einen Text') + ';';
    });
    return '({ int ' + n + ' = 0; ' + parts.join(' ') + ' (latch_text){ ' + buf + ', ' + n + ' }; })';
  }
  const isFmt = e => e.k === 'Str' && !(e.parts.length === 1 && e.parts[0].text !== undefined);
  function call(e) {
    const f = funcs[e.name];
    if (f.foreign) return no(e.line, 'foreign-Funktionen (' + e.name + ')');
    if (f.assembly) { if (asmNeeded.indexOf(f) < 0) asmNeeded.push(f); } else want(e.name);
    const rr = root(f.retT), keeps = f.params.some(p => p.mode === 'change') || !(isVoid(f.retT) || (rr && !rr.a && (rr.n === 'Int' || rr.n === 'Bool')));
    const args = e.args.map((a, i) => {
      const inner = a.k === 'Mode' ? a.e : a;
      if (f.params[i].mode === 'change') return fn.ptr[inner.name] ? 'v_' + inner.name : '&v_' + inner.name;
      if (isFmt(inner)) {
        if (keeps) return no(inner.line, 'einen eingesetzten Text an ' + e.name + ' (die Funktion könnte ihn behalten, und Speicher dafür gibt es erst mit Regionen)');
        return fmt(inner);
      }
      return expr(inner);
    });
    return sigOf(f).cn + '(' + args.join(', ') + ')';
  }

  function expr(e) {
    switch (e.k) {
      case 'Num': return e.v + 'LL';
      case 'Bool': return e.v ? '1' : '0';
      case 'Str':
        if (isFmt(e)) return no(e.line, 'eingesetzte Texte außerhalb eines Aufrufs');
        return textLit(e.parts[0].text);
      case 'Var': return lv(e.name);
      case 'Field': {
        const ot = root(e.obj.ty);
        if (ot && !ot.a && isStruct(ot.n)) return expr(e.obj) + '.f_' + e.name;
        if (e.name === 'length' && ot && ot.n === 'Text') return '((latch_int)' + expr(e.obj) + '.n)';
        if (e.name === 'length' && isTable(ot)) return ot.a[1] + 'LL';
        return no(e.line, 'dieses Feld (' + e.name + ')');
      }
      case 'Index': {
        const ot = root(e.obj.ty);
        if (!isTable(ot)) return no(e.line, 'Stellen einer Liste ohne feste Größe');
        return expr(e.obj) + '.a[latch_index(' + expr(e.idx) + ', ' + ot.a[1] + ', ' + e.line + ')]';
      }
      case 'List': {
        const lt = root(e.ty);
        if (!isTable(lt) || !e.items.length) return no(e.line, 'diese Liste');
        return '((' + ctype(lt, e.line) + '){ { ' + e.items.map(expr).join(', ') + ' } })';
      }
      case 'Un': return e.op === 'not' ? '(!' + expr(e.e) + ')' : 'latch_sub(0, ' + expr(e.e) + ', ' + e.line + ')';
      case 'Bin': return bin(e);
      case 'Old': return olds.get(e);
      case 'Try': return tryExpr(e);
      case 'Secret': case 'Reveal': return no(e.line, 'Geheimnisse');
      case 'Variant': {
        if (e.isConst) { usedConst[e.name] = true; const c = constOf[e.name]; (function mark(x) { if (x.k === 'Variant' && x.isConst) { usedConst[x.name] = true; mark(constOf[x.name].e); } kidsOf(x).forEach(mark); })(c.e); return 'C_' + id(e.name); }
        if (e.name === 'Done') return '0';
        const vd = variants[e.name], ct = ctype({ n: vd.enumName, a: null }, e.line);
        const fields = vd.fields.length ? ', .v_' + id(e.name) + ' = { ' + vd.fields.map((fname, i) => '.f_' + fname + ' = ' + expr(e.args[i])).join(', ') + ' }' : '';
        return '((' + ct + '){ .tag = ' + tag(e.name) + fields + ' })';
      }
      case 'Record':
        if (!isStruct(e.type)) return no(e.line, 'diesen Datensatz');
        return '((' + ctype({ n: e.type, a: null }, e.line) + '){ ' + e.fields.map(f => '.f_' + f.name + ' = ' + expr(f.expr)).join(', ') + ' })';
      case 'With': {
        const t = T('w');
        return '({ ' + ctype(e.ty, e.line) + ' ' + t + ' = ' + expr(e.obj) + '; ' + e.fields.map(f => t + '.f_' + f.name + ' = ' + expr(f.expr) + '; ').join('') + t + '; })';
      }
      case 'Call': return call(e);
      case 'MCall': return lib(e);
      case 'Check': return no(e.line, 'check ohne otherwise oder try');
    }
    return no(e.line, 'diesen Ausdruck (' + e.k + ')');
  }
  function kidsOf(e) {
    switch (e.k) {
      case 'Un': case 'Old': return [e.e];
      case 'Bin': return [e.l, e.r];
      case 'Call': case 'MCall': case 'Variant': return e.args;
    }
    return [];
  }
  function bin(e) {
    const op = e.op, L = e.line;
    if (op === 'in') {
      if (e.r.k !== 'Bin' || e.r.op !== '..') return no(L, '"in" mit einer Liste');
      const t = T('x');
      return '({ latch_int ' + t + ' = ' + expr(e.l) + '; ' + t + ' >= ' + expr(e.r.l) + ' && ' + t + ' <= ' + expr(e.r.r) + '; })';
    }
    if (op === '..') return no(L, 'einen Bereich als eigenen Wert');
    const l = expr(e.l), r = expr(e.r), lt = root(e.l.ty);
    switch (op) {
      case 'and': return '(' + l + ' && ' + r + ')';
      case 'or': return '(' + l + ' || ' + r + ')';
      case '+': if (lt && lt.n === 'Text') return no(L, 'das Verbinden von Texten mit +'); return 'latch_add(' + l + ', ' + r + ', ' + L + ')';
      case '-': return 'latch_sub(' + l + ', ' + r + ', ' + L + ')';
      case '*': return 'latch_mul(' + l + ', ' + r + ', ' + L + ')';
      case '/': return 'latch_div(' + l + ', ' + r + ', ' + L + ')';
      case '%': return 'latch_mod(' + l + ', ' + r + ', ' + L + ')';
      case '==': case '!=':
        if (lt && !lt.a && plainEnum(lt.n)) return '(' + l + '.tag ' + op + ' ' + r + '.tag)';
        if (lt && (lt.a || (lt.n !== 'Int' && lt.n !== 'Bool'))) return no(L, 'diesen Vergleich (' + (lt.a ? 'Tabelle' : lt.n) + ')');
        return '(' + l + ' ' + op + ' ' + r + ')';
      default: return '(' + l + ' ' + op + ' ' + r + ')';
    }
  }
  /* Eine berechnete Adresse muss wie im Prüfstand in den Rechten der Funktion liegen. */
  function guard(kind, addrExpr, a, line) {
    if (info.fold(addrExpr) !== null) return a;
    const rs = fn.f.rights.filter(r => r.name === kind && r.lo !== null && r.lo !== undefined);
    const t = T('a');
    return '({ latch_int ' + t + ' = ' + a + '; latch_require(' + (rs.map(r => '(' + t + ' >= ' + r.lo + 'LL && ' + t + ' <= ' + r.hi + 'LL)').join(' || ') || '0') + ', ' + ascii(kind + '-Zugriff ausserhalb der Rechte von ' + fn.f.name) + ', ' + line + '); ' + t + '; })';
  }
  function lib(e) {
    const q = e.mod + '.' + e.fn, L = e.line;
    if (q === 'Text.bytes') return no(L, 'Text.bytes außerhalb von for und List.at');
    if (q === 'List.at' || q === 'Interrupt.next') return no(L, q + ' ohne otherwise oder try');
    const a = e.args.map(expr);
    switch (q) {
      case 'Memory.write': return 'latch_mem_write(' + guard('Memory', e.args[0], a[0], L) + ', ' + a[1] + ', ' + L + ')';
      case 'Memory.read': return 'latch_mem_read(' + guard('Memory', e.args[0], a[0], L) + ')';
      case 'Port.write': return 'latch_outb((unsigned short)' + guard('Port', e.args[0], a[0], L) + ', latch_byte(' + a[1] + ', ' + L + '))';
      case 'Port.read': return '((latch_int)latch_inb((unsigned short)' + guard('Port', e.args[0], a[0], L) + '))';
      case 'Interrupt.wait': return 'latch_ev_wait()';
      case 'Interrupt.lost': return 'latch_ev_lost()';
      case 'Bits.and': return '(' + a[0] + ' & ' + a[1] + ')';
      case 'Bits.or': return '(' + a[0] + ' | ' + a[1] + ')';
      case 'Bits.xor': return '(' + a[0] + ' ^ ' + a[1] + ')';
      case 'Bits.shift_left': return 'latch_shl(' + a[0] + ', ' + a[1] + ', ' + L + ')';
      case 'Bits.shift_right': return 'latch_shr(' + a[0] + ', ' + a[1] + ', ' + L + ')';
      case 'Bits.test': return 'latch_bit(' + a[0] + ', ' + a[1] + ', ' + L + ')';
      case 'Table.fill': {
        const tt = root(e.ty);
        if (!isTable(tt)) return no(L, 'Table.fill ohne feste Größe');
        const t = T('t'), v = T('v'), i = T('i');
        return '({ ' + ctype(tt, L) + ' ' + t + '; ' + ctype(tt.a[0], L) + ' ' + v + ' = ' + a[1] + '; for (int ' + i + ' = 0; ' + i + ' < ' + tt.a[1] + '; ' + i + '++) ' + t + '.a[' + i + '] = ' + v + '; ' + t + '; })';
      }
    }
    return no(L, q);
  }

  /* Anweisungen */
  function block(stmts, ind) { stmts.forEach(s => stmt(s, ind)); }
  function stmt(s, ind) {
    switch (s.k) {
      case 'Let': {
        const v = value(s);
        if (isVoid(s.ty)) emit(ind, '(void)' + v + '; int v_' + s.name + ' = 0; (void)v_' + s.name + ';');
        else emit(ind, ctype(s.ty, s.line) + ' v_' + s.name + ' = ' + v + '; (void)v_' + s.name + ';');
        break;
      }
      case 'Assign': emit(ind, lv(s.name) + ' = ' + expr(s.e) + ';'); break;
      case 'FieldAssign': emit(ind, lv(s.name) + '.f_' + s.field + ' = ' + expr(s.e) + ';'); break;
      case 'Store': {
        const tt = root(fn.varT[s.name]);
        if (!isTable(tt)) return void no(s.line, 'das Schreiben in eine Liste ohne feste Größe');
        emit(ind, lv(s.name) + '.a[latch_index(' + expr(s.idx) + ', ' + tt.a[1] + ', ' + s.line + ')]' + (s.field ? '.f_' + s.field : '') + ' = ' + expr(s.e) + ';');
        break;
      }
      case 'Expr': emit(ind, '(void)' + value(s) + ';'); break;
      case 'Destroy': emit(ind, '(void)' + lv(s.name) + '; /* destroy */'); break;
      case 'Return':
        if (s.other) { const t = T('v'); emit(ind, (fn.okVoid ? '(void)' + withOther(s.e, s.other) + '; _result.failed = 0;' : ctype(s.e.ty, s.line) + ' ' + t + ' = ' + withOther(s.e, s.other) + '; ' + (fn.f.errType ? '_result.failed = 0; _result.ok = ' : '_result = ') + t + ';')); }
        else emit(ind, retStmts(s.e));
        emit(ind, 'goto done;');
        break;
      case 'If':
        emit(ind, 'if (' + expr(s.cond) + ') {'); block(s.then, ind + 1);
        if (s.els) { emit(ind, '} else {'); block(s.els, ind + 1); }
        emit(ind, '}');
        break;
      case 'While': {
        const d = s.decreases ? T('d') : null;
        if (d) emit(ind, 'latch_int ' + d + ' = -1;');
        emit(ind, 'for (;;) {');
        s.invariants.forEach(c => emit(ind + 1, 'latch_require(' + expr(c.expr) + ', ' + ascii('invariant verletzt: ' + c.text) + ', ' + c.line + ');'));
        emit(ind + 1, 'if (!' + expr(s.cond) + ') break;');
        if (d) {
          const n = T('n');
          emit(ind + 1, 'latch_int ' + n + ' = ' + expr(s.decreases.expr) + ';');
          emit(ind + 1, 'latch_require(' + n + ' >= 0 && (' + d + ' < 0 || ' + n + ' < ' + d + '), ' + ascii('decreases wird nicht kleiner: ' + s.decreases.text) + ', ' + s.decreases.line + ');');
          emit(ind + 1, d + ' = ' + n + ';');
        }
        block(s.body, ind + 1);
        emit(ind, '}');
        break;
      }
      case 'For': {
        const e = s.e, et = root(e.ty);
        if (e.k === 'Bin' && e.op === '..') {
          const hi = T('h');
          emit(ind, 'for (latch_int v_' + s.name + ' = ' + expr(e.l) + ', ' + hi + ' = ' + expr(e.r) + '; v_' + s.name + ' <= ' + hi + '; v_' + s.name + '++) {');
        } else if (e.k === 'MCall' && e.mod === 'Text' && e.fn === 'bytes') {
          const t = T('t'), i = T('i');
          emit(ind, 'latch_text ' + t + ' = ' + expr(e.args[0]) + ';');
          emit(ind, 'for (int ' + i + ' = 0; ' + i + ' < ' + t + '.n; ' + i + '++) {');
          emit(ind + 1, 'latch_int v_' + s.name + ' = ' + t + '.p[' + i + '];');
        } else if (isTable(et)) {
          const t = T('t'), i = T('i');
          emit(ind, ctype(et, s.line) + ' ' + t + ' = ' + expr(e) + ';');
          emit(ind, 'for (int ' + i + ' = 0; ' + i + ' < ' + et.a[1] + '; ' + i + '++) {');
          emit(ind + 1, ctype(et.a[0], s.line) + ' v_' + s.name + ' = ' + t + '.a[' + i + '];');
        } else return void no(s.line, 'for über eine Liste ohne feste Größe');
        block(s.body, ind + 1);
        emit(ind, '}');
        break;
      }
      case 'Forever':
        emit(ind, 'for (;;) {'); block(s.body, ind + 1);
        if (!s.body.length) emit(ind + 1, '__asm__ volatile ("hlt");');
        emit(ind, '}');
        break;
      case 'Match': {
        const mt = root(s.e.ty), m = T('m');
        if (!mt || mt.a || !enumOf[mt.n]) return void no(s.line, 'dieses match');
        emit(ind, '{ ' + ctype(mt, s.line) + ' ' + m + ' = ' + expr(s.e) + ';');
        emit(ind, 'switch (' + m + '.tag) {');
        s.arms.forEach(arm => {
          const vd = variants[arm.name];
          emit(ind + 1, 'case ' + tag(arm.name) + ': {');
          arm.binds.forEach((b, i) => emit(ind + 2, ctype(vd.ftypesT[i], arm.line) + ' v_' + b + ' = ' + m + '.v_' + id(arm.name) + '.f_' + vd.fields[i] + '; (void)v_' + b + ';'));
          block(arm.body, ind + 2);
          emit(ind + 2, 'break; }');
        });
        emit(ind, '} }');
        break;
      }
      default: no(s.line, ({ Region: 'region', Together: 'together' })[s.k] || s.k);
    }
  }
  /* Typen der Variablen einer Funktion, für das Schreiben in Tabellen */
  function varTypes(f) {
    const m = {};
    f.params.forEach((p, i) => { m[p.name] = f.paramT[i]; });
    (function walk(stmts) {
      stmts.forEach(s => {
        if (s.k === 'Let') m[s.name] = s.ty;
        ['body', 'then', 'els', 'lets'].forEach(k => { if (s[k]) walk(s[k]); });
        (s.arms || []).forEach(a => walk(a.body));
        if (s.other && s.other.body) walk(s.other.body);
      });
    })(f.body || []);
    return m;
  }

  const protos = [], bodies = [];
  function compileFn(f) {
    curMod = f.module || '';
    if (f.foreign) return;
    const sig = sigOf(f);
    fn = { f, ptr: {}, bufs: 0, retVoid: sig.ret === 'void', okVoid: !!f.errType && isVoid(f.retT), varT: varTypes(f) };
    olds = new Map();
    out = [];
    f.params.forEach(p => { if (p.mode === 'change') fn.ptr[p.name] = true; });
    const text = (f.name === 'main' ? '' : 'static ') + sig.text;
    protos.push(text + ';');
    emit(0, '/* ' + (f.module ? f.module + ', ' : '') + 'Zeile ' + f.line + ' */');
    emit(0, text + ' {');
    emit(0, '/*BUFS*/');
    f.requires.forEach(c => emit(1, 'latch_require(' + expr(c.expr) + ', ' + ascii(f.name + ' verlangt: ' + c.text) + ', ' + c.line + ');'));
    (f.olds || []).forEach((o, i) => { olds.set(o, '_old' + i); emit(1, ctype(o.e.ty, o.line) + ' _old' + i + ' = ' + expr(o.e) + ';'); });
    if (!fn.retVoid) emit(1, sig.ret + ' _result' + (sig.ret.indexOf('struct') === 0 || sig.ret === 'latch_text' ? ' = { 0 }' : ' = 0') + ';');
    block(f.body, 1);
    if (f.errType) emit(1, '_result.failed = 0;');
    emit(1, 'goto done;');
    emit(0, 'done:;');
    if (f.ensures.length) {
      const checks = capture(() => f.ensures.forEach(c => emit(1, 'latch_require(' + expr(c.expr) + ', ' + ascii(f.name + ' sichert zu: ' + c.text) + ', ' + c.line + ');')));
      if (f.errType) emit(1, 'if (!_result.failed) { ' + (fn.okVoid ? '' : ctype(f.retT, f.line) + ' v_result = _result.ok; (void)v_result; ') + checks + ' }');
      else emit(1, '{ ' + (fn.retVoid ? '' : sig.ret + ' v_result = _result; (void)v_result; ') + checks + ' }');
    }
    emit(1, fn.retVoid ? 'return;' : 'return _result;');
    emit(0, '}');
    let bufs = '';
    for (let i = 0; i < fn.bufs; i++) bufs += '  unsigned char _buf' + i + '[LATCH_TEXT_MAX];\n';
    bodies.push(out.join('\n').replace('/*BUFS*/\n', bufs));
  }

  if (!funcs.main) return { errors: [{ line: 1, msg: 'Es fehlt der Einstieg: function main() { ... }' }], c: null };
  const hs = Object.keys(handlers).map(Number).sort((a, b) => a - b);
  let eventC = null;
  if (hs.length) eventC = ctype(handlers[hs[0]].retT, handlers[hs[0]].line);
  want('main');
  hs.forEach(n => want(handlers[n].name));
  while (queue.length) compileFn(queue.shift());
  curMod = '';

  const constC = [];
  info.consts.forEach(c => {
    if (!usedConst[c.name]) return;
    curMod = c.module || '';
    const v = info.fold(c.e);
    if (v !== null) constC.push('static const latch_int C_' + id(c.name) + ' = ' + v + 'LL;');
    else if (c.e.k === 'Bool') constC.push('static const int C_' + id(c.name) + ' = ' + (c.e.v ? 1 : 0) + ';');
    else if (c.e.k === 'Str' && c.e.parts.length === 1 && c.e.parts[0].text !== undefined) constC.push('#define C_' + id(c.name) + ' ' + textLit(c.e.parts[0].text));
    else no(c.line, 'diese Konstante (' + c.name + ')');
  });
  curMod = '';
  if (errors.length) return { errors, c: null };

  /* Unterbrechungen: je Funktion mit handles ein Einsprung, der das Ereignis in die Warteschlange legt */
  let irq = '', isr = '', init = '';
  if (hs.length) {
    irq = EVENTS.replace(/EVENT/g, eventC);
    hs.forEach(n => {
      isr += 'void latch_isr_stub_' + n + '(void);\n__attribute__((used)) void latch_isr_' + n + '(void) { latch_ev_push(' + sigOf(handlers[n]).cn + '()); ' +
        (n >= 32 && n <= 47 ? (n >= 40 ? 'latch_outb(0xA0, 0x20); ' : '') + 'latch_outb(0x20, 0x20); ' : '') + '}\n' +
        '__asm__(".text\\n.global latch_isr_stub_' + n + '\\nlatch_isr_stub_' + n + ':\\n  pusha\\n  cld\\n  call latch_isr_' + n + '\\n  popa\\n  iret\\n");\n';
    });
    let m1 = 0xFF, m2 = 0xFF;
    hs.forEach(n => { if (n >= 32 && n <= 39) m1 &= ~(1 << (n - 32)); if (n >= 40 && n <= 47) { m2 &= ~(1 << (n - 40)); m1 &= ~4; } });
    init = 'static void latch_interrupts(void) {\n  for (int i = 0; i < 256; i++) latch_idt_set(i, latch_fault);\n' +
      hs.map(n => '  latch_idt_set(' + n + ', latch_isr_stub_' + n + ');\n').join('') +
      '  /* Die beiden PIC-Bausteine auf 32..47 legen, damit sie nicht mit den CPU-Ausnahmen 0..31 zusammenfallen */\n' +
      '  latch_outb(0x20, 0x11); latch_outb(0xA0, 0x11); latch_outb(0x21, 32); latch_outb(0xA1, 40); latch_outb(0x21, 4); latch_outb(0xA1, 2); latch_outb(0x21, 1); latch_outb(0xA1, 1);\n' +
      '  latch_outb(0x21, ' + (m1 & 0xFF) + '); latch_outb(0xA1, ' + (m2 & 0xFF) + ');\n' +
      '  struct { unsigned short limit; unsigned long base; } __attribute__((packed)) idtr = { sizeof(latch_idt) - 1, (unsigned long)latch_idt };\n' +
      '  __asm__ volatile ("lidt %0; sti" : : "m"(idtr));\n}\n';
  }
  const asmProtos = asmNeeded.map(f => 'extern ' + sigOf(f).text + ';');
  const c = [RUNTIME, head.join('\n'), constC.join('\n'), irq, asmProtos.join('\n'), protos.join('\n'), '', isr, wheres.join('\n'), '', bodies.join('\n\n'), '', init,
    'void latch_start(void) { ' + (hs.length ? 'latch_interrupts(); ' : '') + 'latch_main(); latch_serial("main ist zu Ende\\n"); latch_outb(0xF4, 0); }', BOOT].join('\n');
  return { errors: [], c, linker: LINKER, functions: Object.keys(wanted), assembly: asmNeeded.map(f => ({ name: f.name, symbol: sigOf(f).cn, file: f.name + '.S' })) };
}

module.exports = { compile, LINKER };
