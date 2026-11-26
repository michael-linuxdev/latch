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
  "_start:\n"
  "  cli\n"
  "  mov $latch_stack_top, %esp\n"
  "  call latch_start\n"
  "1: hlt\n"
  "  jmp 1b\n"
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

function compile(src, modules) {
  const info = Latch.analyze(src, modules);
  if (info.errors.length) return { errors: info.errors, c: null };
  const errors = [], types = info.types, funcs = info.funcs;
  let curMod = '';
  function no(line, what) { errors.push({ line, module: curMod || undefined, msg: 'Der Compiler kann ' + what + ' noch nicht übersetzen. Der Prüfstand führt es aus.' }); return '0'; }
  const id = name => name.replace(/\./g, '_');
  const cstr = s => '"' + Array.from(Buffer.from(s, 'utf8')).map(b => b === 34 || b === 92 ? '\\' + String.fromCharCode(b) : b >= 32 && b < 127 ? String.fromCharCode(b) : '\\' + b.toString(8).padStart(3, '0')).join('') + '"';
  const ascii = s => cstr(s.replace(/[^\x20-\x7e]/g, '?'));
  function root(t) { let d = 0; while (t && !t.a && types[t.n] && types[t.n].kind === 'refined' && d++ < 25) t = { n: types[t.n].base, a: null }; return t; }
  function ctype(t, line) {
    const r = root(t);
    if (!r) return no(line, 'einen Wert unbekannten Typs'), 'latch_int';
    if (r.n === 'Int') return 'latch_int';
    if (r.n === 'Bool') return 'int';
    if (r.n === 'Text') return 'latch_text';
    if (!r.a && types[r.n] && types[r.n].kind === 'record') return 'struct R_' + id(r.n);
    no(line, 'den Typ ' + r.n + (r.a ? '<...>' : ''));
    return 'latch_int';
  }
  const refT = ref => ({ n: ref.base, a: ref.args.length ? ref.args : null });

  /* Was von main aus erreichbar ist */
  const reach = [], seen = {};
  (function visit(name) {
    if (seen[name] || !funcs[name]) return;
    seen[name] = true;
    const f = funcs[name];
    const walkE = e => { if (!e) return; if (e.k === 'Call') visit(e.name); (kidsOf(e)).forEach(walkE); };
    const walkS = s => {
      ['e', 'cond', 'idx'].forEach(k => walkE(s[k]));
      (s.invariants || []).forEach(c => walkE(c.expr)); if (s.decreases) walkE(s.decreases.expr);
      if (s.other) { if (s.other.k === 'ret') walkE(s.other.e); else s.other.body.forEach(walkS); }
      ['body', 'then', 'els', 'lets'].forEach(k => (s[k] || []).forEach(walkS));
      (s.arms || []).forEach(a => a.body.forEach(walkS));
    };
    f.requires.concat(f.ensures).forEach(c => walkE(c.expr));
    (f.body || []).forEach(walkS);
    reach.push(f);
  })('main');
  function kidsOf(e) {
    switch (e.k) {
      case 'Str': return e.parts.filter(p => p.expr).map(p => p.expr);
      case 'Field': return [e.obj];
      case 'Index': return [e.obj, e.idx];
      case 'Mode': case 'Un': case 'Try': case 'Secret': case 'Reveal': case 'RegionNew': case 'Old': case 'Check': return [e.e];
      case 'Bin': return [e.l, e.r];
      case 'List': return e.items;
      case 'Call': case 'MCall': case 'Variant': return e.args;
      case 'Record': return e.fields.map(f => f.expr);
      case 'With': return [e.obj].concat(e.fields.map(f => f.expr));
    }
    return [];
  }

  /* Ausdrücke */
  let fn = null, tmp = 0, olds = null;
  function lv(name) { return fn.ptr[name] ? '(*v_' + name + ')' : 'v_' + name; }
  function expr(e) {
    switch (e.k) {
      case 'Num': return e.v + 'LL';
      case 'Bool': return e.v ? '1' : '0';
      case 'Str':
        if (e.parts.length !== 1 || e.parts[0].text === undefined) return no(e.line, 'Texte mit eingesetzten Werten ("...{wert}...")');
        return '((latch_text){ (const unsigned char *)' + cstr(e.parts[0].text) + ', ' + Buffer.byteLength(e.parts[0].text, 'utf8') + ' })';
      case 'Var': return lv(e.name);
      case 'Field': {
        const ot = root(e.obj.ty);
        if (e.name === 'length' && ot && ot.n === 'Text') return '((latch_int)' + expr(e.obj) + '.n)';
        if (ot && !ot.a && types[ot.n] && types[ot.n].kind === 'record') return expr(e.obj) + '.f_' + e.name;
        return no(e.line, 'dieses Feld (' + e.name + ')');
      }
      case 'Un': return e.op === 'not' ? '(!' + expr(e.e) + ')' : 'latch_sub(0, ' + expr(e.e) + ', ' + e.line + ')';
      case 'Bin': return bin(e);
      case 'Old': return olds.get(e);
      case 'Variant':
        if (e.isConst) return 'C_' + id(e.name);
        return no(e.line, 'Aufzählungen (' + e.name + ')');
      case 'Record': {
        const td = types[e.type];
        if (!td || td.kind !== 'record') return no(e.line, 'Ressourcen (' + e.type + ')');
        return '((struct R_' + id(e.type) + '){ ' + e.fields.map(f => '.f_' + f.name + ' = ' + expr(f.expr)).join(', ') + ' })';
      }
      case 'With': {
        const t = '_w' + (tmp++);
        return '({ ' + ctype(e.ty, e.line) + ' ' + t + ' = ' + expr(e.obj) + '; ' + e.fields.map(f => t + '.f_' + f.name + ' = ' + expr(f.expr) + '; ').join('') + t + '; })';
      }
      case 'Call': {
        const f = funcs[e.name];
        if (f.assembly || f.foreign) return no(e.line, (f.assembly ? 'assembly' : 'foreign') + '-Funktionen (' + e.name + ')');
        const args = e.args.map((a, i) => {
          const inner = a.k === 'Mode' ? a.e : a;
          if (f.params[i].mode === 'change') return fn.ptr[inner.name] ? 'v_' + inner.name : '&v_' + inner.name;
          return expr(inner);
        });
        return 'F_' + id(e.name) + '(' + args.join(', ') + ')';
      }
      case 'MCall': return lib(e);
    }
    return no(e.line, 'diesen Ausdruck (' + e.k + ')');
  }
  function range(x, r, line) {
    if (r.k !== 'Bin' || r.op !== '..') return no(line, '"in" mit einer Liste');
    const t = '_x' + (tmp++);
    return '({ latch_int ' + t + ' = ' + x + '; ' + t + ' >= ' + expr(r.l) + ' && ' + t + ' <= ' + expr(r.r) + '; })';
  }
  function bin(e) {
    const op = e.op, L = e.line;
    if (op === 'in') return range(expr(e.l), e.r, L);
    if (op === '..') return no(L, 'einen Bereich als eigenen Wert');
    const l = expr(e.l), r = expr(e.r);
    const lt = root(e.l.ty);
    switch (op) {
      case 'and': return '(' + l + ' && ' + r + ')';
      case 'or': return '(' + l + ' || ' + r + ')';
      case '+': if (lt && lt.n === 'Text') return no(L, 'das Verbinden von Texten mit +'); return 'latch_add(' + l + ', ' + r + ', ' + L + ')';
      case '-': return 'latch_sub(' + l + ', ' + r + ', ' + L + ')';
      case '*': return 'latch_mul(' + l + ', ' + r + ', ' + L + ')';
      case '/': return 'latch_div(' + l + ', ' + r + ', ' + L + ')';
      case '%': return 'latch_mod(' + l + ', ' + r + ', ' + L + ')';
      case '==': case '!=':
        if (lt && lt.n !== 'Int' && lt.n !== 'Bool') return no(L, 'den Vergleich von ' + lt.n);
        return '(' + l + ' ' + op + ' ' + r + ')';
      default: return '(' + l + ' ' + op + ' ' + r + ')';
    }
  }
  /* Eine berechnete Adresse muss wie im Prüfstand in den Rechten der Funktion liegen. */
  function guard(kind, addrExpr, a, line) {
    if (info.fold(addrExpr) !== null) return a;
    const rs = fn.f.rights.filter(r => r.name === kind && r.lo !== null && r.lo !== undefined);
    const t = '_a' + (tmp++);
    return '({ latch_int ' + t + ' = ' + a + '; latch_require(' + (rs.map(r => '(' + t + ' >= ' + r.lo + 'LL && ' + t + ' <= ' + r.hi + 'LL)').join(' || ') || '0') + ', ' + ascii(kind + '-Zugriff ausserhalb der Rechte von ' + fn.f.name) + ', ' + line + '); ' + t + '; })';
  }
  function lib(e) {
    const q = e.mod + '.' + e.fn, a = e.args.map(x => q === 'Text.bytes' ? null : expr(x)), L = e.line;
    switch (q) {
      case 'Memory.write': return 'latch_mem_write(' + guard('Memory', e.args[0], a[0], L) + ', ' + a[1] + ', ' + L + ')';
      case 'Memory.read': return 'latch_mem_read(' + guard('Memory', e.args[0], a[0], L) + ')';
      case 'Port.write': return 'latch_outb((unsigned short)' + guard('Port', e.args[0], a[0], L) + ', latch_byte(' + a[1] + ', ' + L + '))';
      case 'Bits.and': return '(' + a[0] + ' & ' + a[1] + ')';
      case 'Bits.or': return '(' + a[0] + ' | ' + a[1] + ')';
      case 'Bits.xor': return '(' + a[0] + ' ^ ' + a[1] + ')';
      case 'Bits.test': return '((' + a[0] + ' >> ' + a[1] + ') & 1)';
    }
    return no(L, q);
  }

  /* Anweisungen */
  let out = [];
  const emit = (ind, s) => out.push('  '.repeat(ind) + s);
  function block(stmts, ind) { stmts.forEach(s => stmt(s, ind)); }
  function stmt(s, ind) {
    if (s.other) return void no(s.line, 'otherwise');
    switch (s.k) {
      case 'Let': emit(ind, ctype(s.ty, s.line) + ' v_' + s.name + ' = ' + expr(s.e) + ';'); break;
      case 'Assign': emit(ind, lv(s.name) + ' = ' + expr(s.e) + ';'); break;
      case 'FieldAssign': emit(ind, lv(s.name) + '.f_' + s.field + ' = ' + expr(s.e) + ';'); break;
      case 'Expr': emit(ind, '(void)' + expr(s.e) + ';'); break;
      case 'Return':
        if (s.e && fn.ret !== 'void') emit(ind, '_result = ' + expr(s.e) + ';');
        emit(ind, 'goto done;');
        break;
      case 'If':
        emit(ind, 'if (' + expr(s.cond) + ') {'); block(s.then, ind + 1);
        if (s.els) { emit(ind, '} else {'); block(s.els, ind + 1); }
        emit(ind, '}');
        break;
      case 'While': {
        const d = s.decreases ? '_d' + (tmp++) : null;
        if (d) emit(ind, 'latch_int ' + d + ' = -1;');
        emit(ind, 'for (;;) {');
        s.invariants.forEach(c => emit(ind + 1, 'latch_require(' + expr(c.expr) + ', ' + ascii('invariant verletzt: ' + c.text) + ', ' + c.line + ');'));
        emit(ind + 1, 'if (!' + expr(s.cond) + ') break;');
        if (d) {
          const n = '_n' + (tmp++);
          emit(ind + 1, 'latch_int ' + n + ' = ' + expr(s.decreases.expr) + ';');
          emit(ind + 1, 'latch_require(' + n + ' >= 0 && (' + d + ' < 0 || ' + n + ' < ' + d + '), ' + ascii('decreases wird nicht kleiner: ' + s.decreases.text) + ', ' + s.decreases.line + ');');
          emit(ind + 1, d + ' = ' + n + ';');
        }
        block(s.body, ind + 1);
        emit(ind, '}');
        break;
      }
      case 'For': {
        const e = s.e;
        if (e.k === 'Bin' && e.op === '..') {
          const hi = '_h' + (tmp++);
          emit(ind, 'for (latch_int v_' + s.name + ' = ' + expr(e.l) + ', ' + hi + ' = ' + expr(e.r) + '; v_' + s.name + ' <= ' + hi + '; v_' + s.name + '++) {');
        } else if (e.k === 'MCall' && e.mod === 'Text' && e.fn === 'bytes') {
          const t = '_t' + (tmp++), i = '_i' + (tmp++);
          emit(ind, 'latch_text ' + t + ' = ' + expr(e.args[0]) + ';');
          emit(ind, 'for (int ' + i + ' = 0; ' + i + ' < ' + t + '.n; ' + i + '++) {');
          emit(ind + 1, 'latch_int v_' + s.name + ' = ' + t + '.p[' + i + '];');
        } else return void no(s.line, 'for über eine Liste oder Tabelle');
        block(s.body, ind + 1);
        emit(ind, '}');
        break;
      }
      case 'Forever':
        emit(ind, 'for (;;) {'); block(s.body, ind + 1);
        if (!s.body.length) emit(ind + 1, '__asm__ volatile ("hlt");');
        emit(ind, '}');
        break;
      default: no(s.line, ({ Match: 'match', Region: 'region', Destroy: 'destroy', Store: 'Tabellen', Together: 'together' })[s.k] || s.k);
    }
  }

  const head = [], protos = [], bodies = [];
  const recs = {};
  function needRec(t, line) {
    const r = root(t);
    if (!r || r.a || !types[r.n] || types[r.n].kind !== 'record' || recs[r.n]) return;
    recs[r.n] = true;
    types[r.n].fields.forEach(f => needRec(refT(f.type), line));
    head.push('struct R_' + id(r.n) + ' { ' + types[r.n].fields.map(f => ctype(refT(f.type), line) + ' f_' + f.name + ';').join(' ') + ' };');
  }
  Object.keys(types).forEach(n => { curMod = types[n].module || ''; if (types[n].kind === 'record') needRec({ n, a: null }, types[n].line); });

  /* Konstanten: feste Zahlen und Wahrheitswerte */
  const constC = [];
  const usedConst = {};
  (function findConsts() {
    const walkE = e => { if (!e) return; if (e.k === 'Variant' && e.isConst) usedConst[e.name] = true; kidsOf(e).forEach(walkE); };
    const walkS = s => {
      ['e', 'cond', 'idx'].forEach(k => walkE(s[k]));
      (s.invariants || []).forEach(c => walkE(c.expr)); if (s.decreases) walkE(s.decreases.expr);
      ['body', 'then', 'els'].forEach(k => (s[k] || []).forEach(walkS));
    };
    reach.forEach(f => { f.requires.concat(f.ensures).forEach(c => walkE(c.expr)); (f.body || []).forEach(walkS); });
    let grew = true;
    while (grew) { grew = false; info.consts.forEach(c => { if (usedConst[c.name]) { const n = Object.keys(usedConst).length; walkE(c.e); if (Object.keys(usedConst).length > n) grew = true; } }); }
  })();
  info.consts.forEach(c => {
    if (!usedConst[c.name]) return;
    curMod = c.module || '';
    const v = info.fold(c.e);
    if (v !== null) constC.push('enum { C_' + id(c.name) + '_ = 0 }; static const latch_int C_' + id(c.name) + ' = ' + v + 'LL;');
    else if (c.e.k === 'Bool') constC.push('static const int C_' + id(c.name) + ' = ' + (c.e.v ? 1 : 0) + ';');
    else no(c.line, 'diese Konstante (' + c.name + ')');
  });

  reach.forEach(f => {
    curMod = f.module || '';
    if (f.handles) return void no(f.line, 'Funktionen mit handles');
    if (f.errType) return void no(f.line, 'Funktionen mit fails');
    if (f.assembly || f.foreign) return;
    const ret = f.ret && f.ret !== 'Done' ? ctype(f.retT, f.line) : 'void';
    fn = { f, ptr: {}, ret };
    olds = new Map();
    out = [];
    const params = f.params.map((p, i) => {
      if (p.mode === 'take') no(p.line, 'take-Parameter');
      if (p.mode === 'change') fn.ptr[p.name] = true;
      return ctype(f.paramT[i], p.line) + (p.mode === 'change' ? ' *' : ' ') + 'v_' + p.name;
    });
    const sig = (f.name === 'main' ? '' : 'static ') + ret + ' ' + (f.name === 'main' ? 'latch_main' : 'F_' + id(f.name)) + '(' + (params.join(', ') || 'void') + ')';
    protos.push(sig + ';');
    emit(0, '/* ' + (f.module ? f.module + ', ' : '') + 'Zeile ' + f.line + ' */');
    emit(0, sig + ' {');
    f.requires.forEach(c => emit(1, 'latch_require(' + expr(c.expr) + ', ' + ascii(f.name + ' verlangt: ' + c.text) + ', ' + c.line + ');'));
    (f.olds || []).forEach((o, i) => { olds.set(o, '_old' + i); emit(1, ctype(o.e.ty, o.line) + ' _old' + i + ' = ' + expr(o.e) + ';'); });
    if (ret !== 'void') emit(1, ret + ' _result' + (ret.indexOf('struct') === 0 || ret === 'latch_text' ? ' = {0}' : ' = 0') + ';');
    block(f.body, 1);
    emit(1, 'goto done;');
    emit(0, 'done:;');
    if (f.ensures.length) {
      if (ret !== 'void') emit(1, ret + ' v_result = _result;');
      f.ensures.forEach(c => emit(1, 'latch_require(' + expr(c.expr) + ', ' + ascii(f.name + ' sichert zu: ' + c.text) + ', ' + c.line + ');'));
    }
    emit(1, ret !== 'void' ? 'return _result;' : 'return;');
    emit(0, '}');
    bodies.push(out.join('\n'));
  });
  curMod = '';
  if (!funcs.main) errors.push({ line: 1, msg: 'Es fehlt der Einstieg: function main() { ... }' });
  if (errors.length) return { errors, c: null };
  const c = [RUNTIME, head.join('\n'), constC.join('\n'), protos.join('\n'), '', bodies.join('\n\n'), '',
    'void latch_start(void) { latch_main(); latch_serial("main ist zu Ende\\n"); latch_outb(0xF4, 0); }', BOOT].join('\n');
  return { errors: [], c, linker: LINKER, functions: reach.map(f => f.name) };
}

module.exports = { compile, LINKER };
