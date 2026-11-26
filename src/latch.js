/* Latch 0.1 prototype: lexer, parser, static checker (rights, taint, resources, types), interpreter, report. */
(function (root) {
'use strict';

var KEYWORDS = new Set(['latch', 'import', 'uses', 'function', 'return', 'let', 'var', 'type', 'enum',
  'unchecked', 'check', 'as', 'secret', 'or', 'else', 'otherwise', 'try', 'requires', 'ensures', 'assumes',
  'if', 'match', 'for', 'in', 'while', 'together', 'resource', 'take', 'change', 'region', 'where',
  'reveal', 'because', 'with', 'true', 'false', 'and', 'not', 'destroy', 'fails', 'assembly', 'foreign', 'handles', 'old', 'invariant', 'decreases', 'forever',
  'public', 'module', 'test', 'hardened', 'break', 'continue', 'const', 'async']);

var NOT_YET = { together: 1, import: 1, with: 1, foreign: 1, handles: 1, old: 1, invariant: 1, decreases: 1, forever: 1, public: 1, module: 1,
  test: 1, hardened: 1, break: 1, continue: 1, const: 1, async: 1 };

function LatchError(msg, line) { this.message = msg; this.line = line || 0; }

/* ---------- Lexer ---------- */
function lex(src, startLine) {
  var toks = [], i = 0, line = startLine || 1, n = src.length;
  function push(t, v, start, ln, extra) {
    var tok = { t: t, v: v, line: ln, start: start, end: i };
    if (extra) for (var k in extra) tok[k] = extra[k];
    toks.push(tok);
  }
  var two = ['->', '..', '==', '!=', '<=', '>='];
  var one = '{}()[],:=.+-*/<>%';
  while (i < n) {
    var c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    var start = i, ln = line;
    if (/[A-Za-z_]/.test(c)) {
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      var w = src.slice(start, i);
      push(KEYWORDS.has(w) ? 'kw' : 'id', w, start, ln);
      continue;
    }
    if (/[0-9]/.test(c)) {
      var val;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        i += 2;
        while (i < n && /[0-9a-fA-F]/.test(src[i])) i++;
        val = parseInt(src.slice(start, i), 16);
      } else {
        while (i < n && /[0-9]/.test(src[i])) i++;
        val = parseInt(src.slice(start, i), 10);
      }
      if (!Number.isSafeInteger(val)) throw new LatchError('Zahl ist zu groß für den Prototyp.', ln);
      push('num', val, start, ln);
      continue;
    }
    if (c === '"') {
      i++;
      var parts = [], buf = '', closed = false;
      while (i < n) {
        var ch = src[i];
        if (ch === '"') { i++; closed = true; break; }
        if (ch === '\\') {
          var nx = src[i + 1];
          if (nx === 'n') buf += '\n'; else if (nx === 't') buf += '\t'; else buf += (nx === undefined ? '' : nx);
          i += 2; continue;
        }
        if (ch === '{') {
          var j = i + 1, depth = 1;
          while (j < n && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; if (depth > 0) j++; }
          if (j >= n) throw new LatchError('In einem Text fehlt die schließende Klammer }.', line);
          if (buf) parts.push({ text: buf });
          buf = '';
          parts.push({ code: src.slice(i + 1, j), line: line });
          i = j + 1; continue;
        }
        if (ch === '\n') line++;
        buf += ch; i++;
      }
      if (!closed) throw new LatchError('Ein Text wurde nicht mit " geschlossen.', ln);
      if (buf || parts.length === 0) parts.push({ text: buf });
      push('str', null, start, ln, { parts: parts });
      continue;
    }
    var pair = src.substr(i, 2);
    if (two.indexOf(pair) >= 0) { i += 2; push('sym', pair, start, ln); continue; }
    if (one.indexOf(c) >= 0) { i++; push('sym', c, start, ln); continue; }
    if (c.charCodeAt(0) > 126) throw new LatchError('Zeichen "' + c + '" ist außerhalb von Texten nicht erlaubt (nur ASCII).', ln);
    throw new LatchError('Unerwartetes Zeichen "' + c + '".', ln);
  }
  toks.push({ t: 'eof', v: null, line: line, start: n, end: n });
  return toks;
}

/* ---------- Parser ---------- */
function Parser(toks, src) { this.toks = toks; this.p = 0; this.src = src; this.noStruct = false; }
Parser.prototype = {
  peek: function (o) { return this.toks[Math.min(this.p + (o || 0), this.toks.length - 1)]; },
  next: function () { var t = this.toks[this.p]; if (this.p < this.toks.length - 1) this.p++; return t; },
  isSym: function (v, o) { var t = this.peek(o); return t.t === 'sym' && t.v === v; },
  isKw: function (v, o) { var t = this.peek(o); return t.t === 'kw' && t.v === v; },
  describe: function (t) {
    if (t.t === 'eof') return 'das Ende der Datei';
    if (t.t === 'str') return 'ein Text';
    return '"' + t.v + '"';
  },
  fail: function (msg, tok) { throw new LatchError(msg, (tok || this.peek()).line); },
  expectSym: function (v) {
    if (!this.isSym(v)) this.fail('Hier wird "' + v + '" erwartet, gefunden wurde ' + this.describe(this.peek()) + '.');
    return this.next();
  },
  expectKw: function (v) {
    if (!this.isKw(v)) this.fail('Hier wird "' + v + '" erwartet, gefunden wurde ' + this.describe(this.peek()) + '.');
    return this.next();
  },
  expectId: function (what) {
    var t = this.peek();
    if (t.t !== 'id') {
      if (t.t === 'kw') this.fail('"' + t.v + '" ist ein Schlüsselwort und kann kein ' + (what || 'Name') + ' sein.');
      this.fail('Hier wird ein ' + (what || 'Name') + ' erwartet, gefunden wurde ' + this.describe(t) + '.');
    }
    return this.next();
  },
  expectPlainStr: function (what) {
    var t = this.peek();
    if (t.t !== 'str' || t.parts.length !== 1 || t.parts[0].text === undefined) this.fail(what + ' muss ein fester Text in Anführungszeichen sein.');
    this.next();
    return t.parts[0].text;
  },

  parseProgram: function () {
    var prog = { types: [], enums: [], funcs: [] };
    if (!this.isKw('latch')) this.fail('Jede Datei beginnt mit der Versionszeile "latch 1".');
    this.next();
    var v = this.peek();
    if (v.t !== 'num' || v.v !== 1) this.fail('Dieser Prototyp versteht nur "latch 1".');
    this.next();
    while (this.peek().t !== 'eof') {
      var t = this.peek();
      if (this.isKw('type')) prog.types.push(this.parseType());
      else if (this.isKw('enum')) prog.enums.push(this.parseEnum());
      else if (this.isKw('resource')) {
        var rl = this.next().line;
        var rn = this.expectId('Typname').v;
        if (this.isSym('=')) this.fail('Eine Ressource wird ohne "=" geschrieben: resource ' + rn + ' { ... }');
        prog.types.push({ kind: 'resource', name: rn, fields: this.parseFields(), line: rl });
      }
      else if (this.isKw('function')) prog.funcs.push(this.parseFunc(false));
      else if (this.isKw('assembly')) {
        this.next();
        if (!this.isKw('function')) this.fail('Nach assembly folgt function.');
        prog.funcs.push(this.parseFunc(true));
      }
      else if (t.t === 'kw' && NOT_YET[t.v]) this.fail('"' + t.v + '" gehört zu Latch, wird vom Prototyp aber noch nicht unterstützt.');
      else this.fail('Auf oberster Ebene stehen nur type, resource, enum und function. Gefunden wurde ' + this.describe(t) + '.');
    }
    return prog;
  },

  parseTypeRef: function (inner) {
    var taint = 'clean';
    if (this.isKw('unchecked') || this.isKw('secret')) {
      if (inner) this.fail('unchecked und secret stehen ganz vorn am Typ, nicht in spitzen Klammern.');
      taint = this.next().v;
    }
    var nt = this.expectId('Typname'), name = nt.v, args = [];
    if (this.isSym('<')) {
      do {
        this.next();
        args.push(this.peek().t === 'num' ? this.next().v : this.parseTypeRef(true));
      } while (this.isSym(','));
      this.expectSym('>');
      name += '<' + args.map(function (a) { return typeof a === 'number' ? a : a.name; }).join(', ') + '>';
    }
    return { name: name, base: nt.v, args: args, taint: taint, line: nt.line };
  },

  parseFields: function () {
    var fields = [];
    this.expectSym('{');
    while (!this.isSym('}')) {
      var fname = this.expectId('Feldname').v;
      this.expectSym(':');
      var ft = this.parseTypeRef();
      fields.push({ name: fname, type: ft });
      if (this.isSym(',')) this.next(); else break;
    }
    this.expectSym('}');
    return fields;
  },

  parseType: function () {
    var line = this.next().line;
    var name = this.expectId('Typname').v;
    this.expectSym('=');
    if (this.isSym('{')) return { kind: 'record', name: name, fields: this.parseFields(), line: line };
    var base = this.expectId('Typname').v;
    var where = null, whereText = null;
    if (this.isKw('where')) {
      this.next();
      var s = this.peek().start;
      where = this.parseExpr();
      whereText = this.src.slice(s, this.toks[this.p - 1].end);
    } else if (this.peek().t === 'id' && (this.peek().v === 'length' || this.peek().v === 'matching')) {
      this.fail('Einschränkungen beginnen mit where, zum Beispiel: type Name = Text where it.length in 1..80');
    } else if (this.isKw('in')) {
      this.fail('Einschränkungen beginnen mit where, zum Beispiel: type Age = Int where it in 0..150');
    }
    return { kind: 'refined', name: name, base: base, where: where, whereText: whereText, line: line };
  },

  parseEnum: function () {
    var line = this.next().line;
    var name = this.expectId('Name der Aufzählung').v;
    var variants = [];
    this.expectSym('{');
    while (!this.isSym('}')) {
      var vt = this.expectId('Name der Variante');
      var fields = [], ftypes = [];
      if (this.isSym('(')) {
        this.next();
        while (!this.isSym(')')) {
          var fname = this.expectId('Feldname').v;
          this.expectSym(':');
          ftypes.push(this.parseTypeRef());
          fields.push(fname);
          if (this.isSym(',')) this.next(); else break;
        }
        this.expectSym(')');
      }
      variants.push({ name: vt.v, fields: fields, ftypes: ftypes, line: vt.line });
      if (this.isSym(',')) this.next(); else break;
    }
    this.expectSym('}');
    return { name: name, variants: variants, line: line };
  },

  parseFunc: function (asm) {
    var line = this.next().line;
    var name = this.expectId('Funktionsname').v;
    var fn = { name: name, line: line, params: [], ret: null, retTaint: 'clean', errType: null,
      rights: [], requires: [], ensures: [], assumes: [], body: null, assembly: !!asm };
    this.expectSym('(');
    while (!this.isSym(')')) {
      var mode = 'read';
      if (this.isKw('take') || this.isKw('change')) mode = this.next().v;
      var pt = this.expectId('Parametername');
      this.expectSym(':');
      var ty = this.parseTypeRef();
      fn.params.push({ name: pt.v, type: ty.name, tref: ty, taint: ty.taint, mode: mode, line: pt.line });
      if (this.isSym(',')) this.next(); else break;
    }
    this.expectSym(')');
    if (this.isSym('->')) {
      this.next();
      var rt = this.parseTypeRef();
      fn.ret = rt.name; fn.retRef = rt; fn.retTaint = rt.taint;
      if (this.isKw('fails')) { this.next(); fn.errType = this.expectId('Fehlertyp').v; }
      else if (this.isKw('or')) this.fail('Der Fehlertyp wird mit fails geschrieben, zum Beispiel: -> Int fails SignupError');
    }
    var order = ['uses', 'requires', 'ensures', 'assumes'], stage = 0;
    while (this.peek().t === 'kw' && order.indexOf(this.peek().v) >= 0) {
      var kw = this.peek(), idx = order.indexOf(kw.v);
      if (idx < stage) this.fail('Die Reihenfolge im Funktionskopf ist fest: uses, requires, ensures, assumes.');
      stage = idx;
      this.next();
      if (kw.v === 'uses') {
        if (fn.rights.length) this.fail('uses steht nur einmal im Kopf. Mehrere Rechte mit Komma trennen.', kw);
        do {
          if (fn.rights.length) this.next();
          var rtok = this.expectId('Name des Rechts');
          var arg = null, lo = null, hi = null;
          if (this.isSym('(')) {
            this.next();
            if (this.peek().t === 'num') {
              lo = hi = this.next().v;
              if (this.isSym('..')) {
                this.next();
                if (this.peek().t !== 'num') this.fail('Nach .. folgt die obere Grenze als Zahl.');
                hi = this.next().v;
                if (hi < lo) this.fail('Die obere Grenze liegt unter der unteren.');
              }
            } else arg = this.expectPlainStr('Die Angabe eines Rechts');
            this.expectSym(')');
          }
          fn.rights.push({ name: rtok.v, arg: arg, lo: lo, hi: hi, line: rtok.line });
        } while (this.isSym(','));
      } else if (kw.v === 'assumes') {
        fn.assumes.push({ text: this.expectPlainStr('Eine Annahme'), line: kw.line });
      } else {
        var s = this.peek().start;
        this.noStruct = true;
        var ex = this.parseExpr();
        this.noStruct = false;
        var item = { expr: ex, text: this.src.slice(s, this.toks[this.p - 1].end).replace(/\s+/g, ' '), line: kw.line };
        if (kw.v === 'requires') fn.requires.push(item); else fn.ensures.push(item);
      }
    }
    if (this.isSym('->')) this.fail('Der Rückgabetyp (->) steht direkt nach den Parametern, vor uses.');
    if (asm) {
      if (this.isSym('{')) this.fail('Eine assembly-Funktion hat keinen Latch-Rumpf. Ihr Inhalt ist Assembler und steht außerhalb.');
      if (fn.ret) this.fail('assembly-Funktionen mit Rückgabewert kennt der Prototyp noch nicht.', { line: line });
      return fn;
    }
    fn.body = this.parseBlock();
    return fn;
  },

  parseBlock: function () {
    var saved = this.noStruct;
    this.noStruct = false;
    this.expectSym('{');
    var stmts = [];
    while (!this.isSym('}')) {
      if (this.peek().t === 'eof') this.fail('Ein Block wurde nicht mit } geschlossen.');
      stmts.push(this.parseStmt());
    }
    this.expectSym('}');
    this.noStruct = saved;
    return stmts;
  },

  parseOtherwise: function () {
    if (this.isKw('else') && this.isKw('return', 1)) this.fail('Der Fehlerfall heißt otherwise, nicht else: ... otherwise return ...');
    if (!this.isKw('otherwise')) return null;
    var ot = this.next();
    if (this.isKw('as')) {
      this.next();
      var nm = this.expectId('Name für den Fehlerwert').v;
      return { k: 'block', name: nm, body: this.parseBlock(), line: ot.line };
    }
    if (!this.isKw('return')) this.fail('Nach otherwise folgt "return wert" oder "as name { ... }".');
    this.next();
    return { k: 'ret', e: this.parseExpr(), line: ot.line };
  },

  parseCond: function () {
    var saved = this.noStruct;
    this.noStruct = true;
    var e = this.parseExpr();
    this.noStruct = saved;
    return e;
  },

  parseStmt: function () {
    var t = this.peek();
    if (t.t === 'kw') {
      if (t.v === 'let' || t.v === 'var') {
        this.next();
        var name = this.expectId('Variablenname').v, ann = null;
        if (this.isSym(':')) { this.next(); ann = this.parseTypeRef(); }
        this.expectSym('=');
        var e = this.parseExpr();
        return { k: 'Let', name: name, mut: t.v === 'var', type: ann, e: e, other: this.parseOtherwise(), line: t.line };
      }
      if (t.v === 'return') {
        this.next();
        if (this.isSym('}')) return { k: 'Return', e: null, other: null, line: t.line };
        var re = this.parseExpr();
        return { k: 'Return', e: re, other: this.parseOtherwise(), line: t.line };
      }
      if (t.v === 'if') return this.parseIf();
      if (t.v === 'while') {
        this.next();
        var wc = this.parseCond();
        return { k: 'While', cond: wc, body: this.parseBlock(), line: t.line };
      }
      if (t.v === 'for') {
        this.next();
        var v = this.expectId('Variablenname').v;
        this.expectKw('in');
        var it = this.parseCond();
        return { k: 'For', name: v, e: it, body: this.parseBlock(), line: t.line };
      }
      if (t.v === 'region') {
        this.next();
        var rname = this.expectId('Name der Region').v;
        return { k: 'Region', name: rname, body: this.parseBlock(), line: t.line };
      }
      if (t.v === 'destroy') {
        this.next();
        return { k: 'Destroy', name: this.expectId('Variablenname').v, line: t.line };
      }
      if (t.v === 'match') return this.parseMatch();
      if (NOT_YET[t.v]) this.fail('"' + t.v + '" gehört zu Latch, wird vom Prototyp aber noch nicht unterstützt.');
    }
    if (t.t === 'id' && this.isSym('.', 1) && this.peek(2).t === 'id' && this.isSym('=', 3)) {
      this.next(); this.next();
      var fld = this.next().v;
      this.next();
      return { k: 'FieldAssign', name: t.v, field: fld, e: this.parseExpr(), line: t.line };
    }
    if (t.t === 'id' && this.isSym('=', 1)) {
      this.next(); this.next();
      return { k: 'Assign', name: t.v, e: this.parseExpr(), line: t.line };
    }
    var ex = this.parseExpr();
    if (this.isSym('=')) {
      var tgt = ex, field = null;
      if (tgt.k === 'Field' && tgt.obj.k === 'Index') { field = tgt.name; tgt = tgt.obj; }
      if (tgt.k !== 'Index' || tgt.obj.k !== 'Var') this.fail('Links von = steht eine Variable, ein Feld oder eine Stelle einer Tabelle, zum Beispiel tasks[i].state = ...');
      this.next();
      return { k: 'Store', name: tgt.obj.name, idx: tgt.idx, field: field, e: this.parseExpr(), line: t.line };
    }
    return { k: 'Expr', e: ex, other: this.parseOtherwise(), line: t.line };
  },

  parseMatch: function () {
    var t = this.next();
    var subject = this.parseCond();
    var arms = [];
    this.expectSym('{');
    while (!this.isSym('}')) {
      var nt = this.expectId('Name der Variante');
      var binds = [];
      if (this.isSym('(')) {
        this.next();
        while (!this.isSym(')')) { binds.push(this.expectId('Name').v); if (this.isSym(',')) this.next(); else break; }
        this.expectSym(')');
      }
      this.expectSym('->');
      var body = this.isSym('{') ? this.parseBlock() : [this.parseStmt()];
      arms.push({ name: nt.v, binds: binds, body: body, line: nt.line });
      if (this.isSym(',')) this.next();
    }
    this.expectSym('}');
    return { k: 'Match', e: subject, arms: arms, line: t.line };
  },

  parseIf: function () {
    var t = this.next();
    var cond = this.parseCond();
    var then = this.parseBlock(), els = null;
    if (this.isKw('else')) {
      this.next();
      if (this.isKw('if')) els = [this.parseIf()]; else els = this.parseBlock();
    }
    return { k: 'If', cond: cond, then: then, els: els, line: t.line };
  },

  parseExpr: function () { return this.parseOr(); },
  parseOr: function () {
    var l = this.parseAnd();
    while (this.isKw('or')) { var t = this.next(); l = { k: 'Bin', op: 'or', l: l, r: this.parseAnd(), line: t.line }; }
    return l;
  },
  parseAnd: function () {
    var l = this.parseNot();
    while (this.isKw('and')) { var t = this.next(); l = { k: 'Bin', op: 'and', l: l, r: this.parseNot(), line: t.line }; }
    return l;
  },
  parseNot: function () {
    if (this.isKw('not')) { var t = this.next(); return { k: 'Un', op: 'not', e: this.parseNot(), line: t.line }; }
    return this.parseCmp();
  },
  parseCmp: function () {
    var l = this.parseRange();
    var t = this.peek();
    if ((t.t === 'sym' && ['==', '!=', '<', '<=', '>', '>='].indexOf(t.v) >= 0) || (t.t === 'kw' && t.v === 'in')) {
      this.next();
      return { k: 'Bin', op: t.v, l: l, r: this.parseRange(), line: t.line };
    }
    return l;
  },
  parseRange: function () {
    var l = this.parseAdd();
    if (this.isSym('..')) { var t = this.next(); return { k: 'Bin', op: '..', l: l, r: this.parseAdd(), line: t.line }; }
    return l;
  },
  parseAdd: function () {
    var l = this.parseMul();
    while (this.isSym('+') || this.isSym('-')) { var t = this.next(); l = { k: 'Bin', op: t.v, l: l, r: this.parseMul(), line: t.line }; }
    return l;
  },
  parseMul: function () {
    var l = this.parseUnary();
    while (this.isSym('*') || this.isSym('/') || this.isSym('%')) { var t = this.next(); l = { k: 'Bin', op: t.v, l: l, r: this.parseUnary(), line: t.line }; }
    return l;
  },
  parseUnary: function () {
    var t = this.peek();
    if (t.t === 'sym' && t.v === '-') { this.next(); return { k: 'Un', op: '-', e: this.parseUnary(), line: t.line }; }
    if (t.t === 'kw') {
      if (t.v === 'check') {
        this.next();
        var e = this.parseUnary();
        if (!this.isKw('as')) this.fail('Nach check folgt "as" und ein Typ, zum Beispiel: check raw as Age');
        this.next();
        var ty = this.expectId('Typname').v;
        return { k: 'Check', e: e, type: ty, line: t.line };
      }
      if (t.v === 'try') { this.next(); return { k: 'Try', e: this.parseUnary(), line: t.line }; }
      if (t.v === 'secret') { this.next(); return { k: 'Secret', e: this.parseUnary(), line: t.line }; }
      if (t.v === 'reveal') {
        this.next();
        var s = this.peek().start;
        var re = this.parseUnary();
        var text = this.src.slice(s, this.toks[this.p - 1].end);
        if (!this.isKw('because')) this.fail('reveal braucht eine Begründung: reveal wert because "Grund"');
        this.next();
        var reason = this.expectPlainStr('Die Begründung');
        return { k: 'Reveal', e: re, reason: reason, text: text, line: t.line };
      }
      if (t.v === 'take' || t.v === 'change') { this.next(); return { k: 'Mode', mode: t.v, e: this.parseUnary(), line: t.line }; }
    }
    return this.parsePostfix();
  },
  parseArgs: function () {
    var args = [];
    this.expectSym('(');
    var saved = this.noStruct;
    this.noStruct = false;
    while (!this.isSym(')')) {
      if (this.peek().t === 'id' && this.isSym(':', 1)) { this.next(); this.next(); }
      args.push(this.parseExpr());
      if (this.isSym(',')) this.next(); else break;
    }
    this.noStruct = saved;
    this.expectSym(')');
    return args;
  },
  parsePostfix: function () {
    var e = this.parsePrimary();
    while (this.isSym('.') || (this.isSym('[') && this.peek().line === this.toks[this.p - 1].line)) {
      if (this.isSym('[')) {
        var bt = this.next();
        var savedNs = this.noStruct;
        this.noStruct = false;
        var ix = this.parseExpr();
        this.noStruct = savedNs;
        this.expectSym(']');
        e = { k: 'Index', obj: e, idx: ix, line: bt.line };
        continue;
      }
      this.next();
      var f = this.expectId('Feldname');
      if (this.isSym('(') && this.peek().line === f.line) {
        if (f.v === 'new' && e.k === 'Var') {
          var na = this.parseArgs();
          if (na.length !== 1) this.fail(e.name + '.new(...) bekommt genau einen Wert.', f);
          e = { k: 'RegionNew', region: e.name, e: na[0], line: f.line };
          continue;
        }
        this.fail('Methoden wie .' + f.v + '(...) kennt der Prototyp noch nicht. Erlaubt sind Felder, .length und region.new(...).');
      }
      e = { k: 'Field', obj: e, name: f.v, line: f.line };
    }
    return e;
  },
  parsePrimary: function () {
    var t = this.peek(), self = this;
    if (t.t === 'num') { this.next(); return { k: 'Num', v: t.v, line: t.line }; }
    if (t.t === 'str') {
      this.next();
      var parts = t.parts.map(function (p) {
        if (p.text !== undefined) return { text: p.text };
        var sub = new Parser(lex(p.code, p.line), p.code);
        var ex = sub.parseExpr();
        if (sub.peek().t !== 'eof') throw new LatchError('In {…} steht genau ein Ausdruck.', p.line);
        return { expr: ex };
      });
      return { k: 'Str', parts: parts, line: t.line };
    }
    if (t.t === 'kw' && (t.v === 'true' || t.v === 'false')) { this.next(); return { k: 'Bool', v: t.v === 'true', line: t.line }; }
    if (t.t === 'sym' && t.v === '(') {
      this.next();
      var saved = this.noStruct;
      this.noStruct = false;
      var inner = this.parseExpr();
      this.noStruct = saved;
      this.expectSym(')');
      return inner;
    }
    if (t.t === 'sym' && t.v === '[') {
      this.next();
      var items = [];
      while (!this.isSym(']')) { items.push(this.parseExpr()); if (this.isSym(',')) this.next(); else break; }
      this.expectSym(']');
      return { k: 'List', items: items, line: t.line };
    }
    if (t.t === 'id') {
      this.next();
      var upper = /^[A-Z]/.test(t.v);
      if (upper) {
        if (this.isSym('.') && this.peek(1).t === 'id' && this.isSym('(', 2)) {
          this.next();
          var fn = this.next().v;
          return { k: 'MCall', mod: t.v, fn: fn, args: this.parseArgs(), line: t.line };
        }
        if (this.isSym('{') && !this.noStruct) {
          this.next();
          var fields = [];
          while (!this.isSym('}')) {
            var fname = this.expectId('Feldname');
            var fe;
            if (this.isSym(':')) { this.next(); fe = this.parseExpr(); }
            else fe = { k: 'Var', name: fname.v, line: fname.line };
            fields.push({ name: fname.v, expr: fe });
            if (this.isSym(',')) this.next(); else break;
          }
          this.expectSym('}');
          return { k: 'Record', type: t.v, fields: fields, line: t.line };
        }
        if (this.isSym('(') && this.peek().line === t.line) return { k: 'Variant', name: t.v, args: this.parseArgs(), line: t.line };
        return { k: 'Variant', name: t.v, args: [], line: t.line };
      }
      if (this.isSym('(') && this.peek().line === t.line) return { k: 'Call', name: t.v, args: this.parseArgs(), line: t.line };
      return { k: 'Var', name: t.v, line: t.line };
    }
    if (t.t === 'kw' && NOT_YET[t.v]) this.fail('"' + t.v + '" gehört zu Latch, wird vom Prototyp aber noch nicht unterstützt.');
    this.fail('Hier wird ein Wert erwartet, gefunden wurde ' + this.describe(t) + '.');
  }
};

/* ---------- Built-in library (simulated outside world) ---------- */
var BUILTINS = {
  'Console.print': { right: 'Console', n: 1, ret: 'clean', p: ['Any'], r: 'Done' },
  'Input.read': { right: 'Input', n: 1, ret: 'unchecked', p: ['Text'], r: 'Text' },
  'Net.get': { right: 'Net', lit: true, n: 2, ret: 'unchecked', p: ['Text', 'Text'], r: 'Text' },
  'Db.insert': { right: 'Db', lit: true, n: 2, ret: 'clean', fallible: 'DbError', p: ['Text', 'Any'], r: 'Int' },
  'Db.exists': { right: 'Db', lit: true, n: 3, ret: 'clean', p: ['Text', 'Text', 'Any'], r: 'Bool' },
  'Db.count': { right: 'Db', lit: true, n: 1, ret: 'clean', p: ['Text'], r: 'Int' },
  'Mail.send': { right: 'Net', lit: true, n: 4, ret: 'clean', fallible: 'MailError', p: ['Text', 'Text', 'Text', 'Text'], r: 'Done' },
  'Clock.now': { right: 'Clock', n: 0, ret: 'clean', p: [], r: 'Int' },
  'Random.int': { right: 'Random', n: 2, ret: 'clean', p: ['Int', 'Int'], r: 'Int' },
  'Kem.generate': { right: null, n: 0, ret: 'secret', p: [], r: 'Text' },
  'Crypto.encrypt': { right: null, n: 2, ret: 'clean', acceptsSecret: true, p: ['Any', 'Any'], r: 'Text' },
  'Crypto.public_key': { right: null, n: 1, ret: 'clean', acceptsSecret: true, p: ['Any'], r: 'Text' },
  'Text.contains': { right: null, n: 2, ret: 'clean', p: ['Text', 'Text'], r: 'Bool' },
  'Text.bytes': { right: null, n: 1, ret: 'clean', p: ['Text'], r: 'Ints' },
  'List.at': { right: null, n: 2, ret: 'clean', fallible: 'Missing', p: ['List', 'Int'], r: 'Elem' },
  'Table.fill': { right: null, n: 2, ret: 'clean', p: ['Int', 'Any'], r: 'Fill' },
  'Memory.write': { right: 'Memory', hw: true, n: 2, ret: 'clean', p: ['Int', 'Int'], r: 'Done' },
  'Memory.read': { right: 'Memory', hw: true, n: 1, ret: 'clean', p: ['Int'], r: 'Int' },
  'Port.write': { right: 'Port', hw: true, n: 2, ret: 'clean', p: ['Int', 'Int'], r: 'Done' },
  'Port.read': { right: 'Port', hw: true, n: 1, ret: 'unchecked', p: ['Int'], r: 'Int' }
};
var VGA_BASE = 0xB8000, VGA_COLS = 80, VGA_ROWS = 25, VGA_END = VGA_BASE + VGA_COLS * VGA_ROWS * 2 - 1;
function hex(n) { return '0x' + n.toString(16).toUpperCase(); }
function fold(e) {
  if (!e) return null;
  if (e.k === 'Num') return e.v;
  if (e.k === 'Un' && e.op === '-') { var u = fold(e.e); return u === null ? null : -u; }
  if (e.k === 'Bin' && (e.op === '+' || e.op === '-' || e.op === '*')) {
    var l = fold(e.l), r = fold(e.r);
    if (l === null || r === null) return null;
    return e.op === '+' ? l + r : e.op === '-' ? l - r : l * r;
  }
  return null;
}
function covers(d, n) {
  if (d.name !== n.name) return false;
  if (n.lo !== null && n.lo !== undefined) return d.lo !== null && d.lo !== undefined && d.lo <= n.lo && n.hi <= d.hi;
  if (n.arg !== null && n.arg !== undefined) return d.arg === n.arg;
  return true;
}
var BUILTIN_ERRORS = ['CheckFailed', 'DbError', 'MailError', 'Missing'];
var SCAN = (function () {
  var map = { ' ': 0x39, '\n': 0x1C };
  [['qwertyuiop', 0x10], ['asdfghjkl', 0x1E], ['zxcvbnm', 0x2C], ['1234567890', 0x02]].forEach(function (row) {
    row[0].split('').forEach(function (c, i) { map[c] = row[1] + i; });
  });
  return map;
})();
var BASE_TYPES = ['Int', 'Text', 'Bool'];

function fmtRight(r) {
  if (r.lo !== null && r.lo !== undefined) return r.name + '(' + hex(r.lo) + (r.hi !== r.lo ? '..' + hex(r.hi) : '') + ')';
  return r.arg === null || r.arg === undefined ? r.name : r.name + '("' + r.arg + '")';
}

/* ---------- Static checker ---------- */
function checkProgram(prog) {
  var errors = [], warnings = [], seen = {};
  function err(line, msg) { var key = line + '|' + msg; if (!seen[key]) { seen[key] = 1; errors.push({ line: line, msg: msg }); } }
  var types = {}, variants = {}, funcs = {}, enums = {};
  BUILTIN_ERRORS.forEach(function (e) { variants[e] = { enumName: e, fields: [], ftypesT: [] }; enums[e] = [e]; });
  variants.Done = { enumName: 'Done', fields: [], ftypesT: [] };
  enums.Done = ['Done'];

  /* Typen: { n: Name, a: Angaben in spitzen Klammern oder null }. null heisst unbekannt (Folgefehler vermeiden). */
  function T(n, a) { return { n: n, a: a || null }; }
  var T_INT = T('Int'), T_TEXT = T('Text'), T_BOOL = T('Bool'), T_DONE = T('Done'), T_RANGE = T('Range'), T_ANY = T('Any');
  var GENERIC = ['List', 'Map', 'Table'], fieldT = {}, proofs = [];
  function tstr(t) {
    if (!t) return '?';
    if (t.n === 'Range') return 'ein Bereich (a..b)';
    if (!t.a) return t.n;
    return t.n + '<' + t.a.map(function (x) { return typeof x === 'number' ? String(x) : tstr(x); }).join(', ') + '>';
  }
  function upperName(name, what, line) {
    if (/^[A-Z]/.test(name)) return;
    var fix = name.charAt(0).toUpperCase() + name.slice(1);
    err(line, what + ' beginnen mit einem Großbuchstaben' + (fix !== name ? ': ' + fix + ' statt ' + name : ', ' + name + ' tut das nicht') + '.');
  }
  function lowerName(name, what, line) {
    if (!/^[A-Z]/.test(name)) return;
    err(line, what + ' beginnen mit einem Kleinbuchstaben: ' + name.charAt(0).toLowerCase() + name.slice(1) + ' statt ' + name + '.');
  }
  function isRefined(t) { return !!(t && !t.a && types[t.n] && types[t.n].kind === 'refined'); }
  function root(t) {
    var d = 0;
    while (isRefined(t) && d++ < 25) t = T(types[t.n].base);
    return t;
  }
  function sameT(a, b) {
    if (!a || !b) return true;
    if (a.n !== b.n || !a.a !== !b.a) return false;
    if (!a.a) return true;
    if (a.a.length !== b.a.length) return false;
    return a.a.every(function (x, i) {
      var y = b.a[i];
      if (x === null || y === null) return true;
      if (typeof x === 'number' || typeof y === 'number') return x === y;
      return sameT(x, y);
    });
  }
  /* Passt ein Wert vom Typ from dorthin, wo to erwartet wird? Eingeschränkte Typen passen an ihre Grundtypen, nie umgekehrt. */
  function assignable(from, to) {
    if (!from || !to || to.n === 'Any') return true;
    if (to.a) {
      if (!from.a) return false;
      if (to.n === 'List' && (from.n === 'List' || from.n === 'Table')) return assignable(from.a[0], to.a[0]);
      if (from.n !== to.n) return false;
      if (to.n === 'Table') return (from.a[1] === null || to.a[1] === null || from.a[1] === to.a[1]) && assignable(from.a[0], to.a[0]);
      return sameT(from, to);
    }
    if (from.a) return false;
    if (from.n === to.n) return true;
    var d = 0;
    while (isRefined(from) && d++ < 25) { from = T(types[from.n].base); if (from.n === to.n) return true; }
    return false;
  }
  function comparable(a, b) { return !a || !b || assignable(a, b) || assignable(b, a) || sameT(root(a), root(b)); }
  function constOf(e) {
    if (e.k === 'Num' || e.k === 'Bool') return { v: e.v };
    if (e.k === 'Str' && e.parts.length === 1 && e.parts[0].text !== undefined) return { v: e.parts[0].text };
    var n = fold(e);
    return n === null ? null : { v: n };
  }
  /* Der einzige Beweis, den der Prototyp führt: ein fester Wert wird beim Prüfen gegen die Einschränkung gerechnet. */
  function provable(e, from, to, line) {
    if (!e || !to) return false;
    if (to.a) {
      if (e.k !== 'List' || (to.n !== 'List' && to.n !== 'Table')) return false;
      if (to.n === 'Table' && to.a[1] !== null && to.a[1] !== e.items.length) return false;
      return e.items.every(function (it) { return assignable(it.ty, to.a[0]) || provable(it, it.ty, to.a[0], it.line || line); });
    }
    if (!isRefined(to)) return false;
    var c = constOf(e);
    if (!c || !assignable(from, root(to))) return false;
    proofs.push({ v: c.v, type: to.n, line: line });
    return true;
  }
  function fits(e, from, to, line, what) {
    if (assignable(from, to) || provable(e, from, to, line)) return true;
    var hint = '';
    if (isRefined(to) && from && !from.a && sameT(root(from), root(to)))
      hint = ' Ein Wert vom Typ ' + to.n + ' entsteht nur durch Prüfen: check wert as ' + to.n + ' otherwise return ...';
    err(line, what + ' erwartet ' + tstr(to) + ', vorhanden ist ' + tstr(from) + '.' + hint);
    return false;
  }
  /* Operanden: ungeprüfte Werte sind schon gemeldet, ihr Typ zählt erst nach check. */
  function expectT(r, t, line, what) {
    if (!r.type || r.taint === 'unchecked' || assignable(r.type, t)) return true;
    err(line, what + ' erwartet ' + tstr(t) + ', vorhanden ist ' + tstr(r.type) + '.');
    return false;
  }
  function isText(r) { return !!r.type && r.taint !== 'unchecked' && assignable(r.type, T_TEXT); }
  function resolve(ref, line) {
    if (!ref) return null;
    line = ref.line || line;
    var b = ref.base, a = ref.args || [];
    if (GENERIC.indexOf(b) >= 0) {
      var usage = b === 'List' ? 'List braucht genau einen Typ, zum Beispiel List<Int>.'
        : b === 'Table' ? 'Table braucht Typ und Größe, zum Beispiel Table<Task, 8>.' : 'Map braucht zwei Typen, zum Beispiel Map<Text, Int>.';
      var shape = b === 'List' ? a.length === 1 && typeof a[0] !== 'number'
        : b === 'Table' ? a.length === 2 && typeof a[0] !== 'number' && typeof a[1] === 'number'
        : a.length === 2 && typeof a[0] !== 'number' && typeof a[1] !== 'number';
      if (!shape) { err(line, usage); return null; }
      var parts = a.map(function (x) {
        if (typeof x === 'number') return x;
        var r = resolve(x, line);
        if (r && isRes(r.n)) err(line, 'Ressourcen in Listen, Tabellen und Maps kennt der Prototyp noch nicht.');
        return r;
      });
      return T(b, parts);
    }
    if (a.length) { err(line, b + ' hat keine Angaben in spitzen Klammern. Generisch sind nur List, Map und Table.'); return null; }
    if (BASE_TYPES.indexOf(b) >= 0 || types[b] || enums[b]) return T(b);
    var cap = b.charAt(0).toUpperCase() + b.slice(1);
    err(line, 'Der Typ ' + b + ' ist nicht bekannt.' + (cap !== b && (BASE_TYPES.indexOf(cap) >= 0 || types[cap] || enums[cap]) ? ' Typen beginnen groß: ' + cap + '.' : ''));
    return null;
  }
  function fieldType(t, name, line, store) {
    if (!t) return null;
    var td = !t.a && types[t.n];
    if (td && td.kind !== 'refined') {
      if (Object.prototype.hasOwnProperty.call(fieldT[t.n] || {}, name)) return fieldT[t.n][name];
      err(line, t.n + ' hat kein Feld ' + name + '. Vorhanden: ' + td.fields.map(function (f) { return f.name; }).join(', ') + '.');
      return null;
    }
    var rt = root(t);
    if (!store && name === 'length' && (rt.n === 'Text' || rt.n === 'List' || rt.n === 'Table')) return T_INT;
    if (!t.a && enums[t.n]) err(line, 'Die Angaben einer Variante von ' + t.n + ' erreicht man über match, nicht mit .' + name + '.');
    else err(line, 'Ein Wert vom Typ ' + tstr(t) + ' hat kein Feld ' + name + '. Felder haben nur Datensätze und Ressourcen.');
    return null;
  }
  function elemType(t, line) {
    if (!t) return null;
    if (t.a && (t.n === 'List' || t.n === 'Table')) return t.a[0];
    err(line, 'Eine Stelle [..] gibt es nur an Tabellen und Listen, vorhanden ist ' + tstr(t) + '.');
    return null;
  }
  function unify(a, b, line) {
    if (!a) return b;
    if (!b || assignable(b, a)) return a;
    if (assignable(a, b)) return b;
    if (sameT(root(a), root(b))) return root(a);
    err(line, 'Eine Liste enthält nur Werte eines Typs, hier stehen ' + tstr(a) + ' und ' + tstr(b) + '.');
    return a;
  }
  var LIB = { Any: T_ANY, Int: T_INT, Text: T_TEXT, Bool: T_BOOL, Done: T_DONE, Ints: T('List', [T_INT]), List: T('List', [null]) };

  prog.types.forEach(function (t) {
    if (types[t.name] || BASE_TYPES.indexOf(t.name) >= 0 || GENERIC.indexOf(t.name) >= 0 || enums[t.name]) err(t.line, 'Der Typ ' + t.name + ' ist schon vergeben.');
    upperName(t.name, 'Typnamen', t.line);
    types[t.name] = t;
  });
  prog.enums.forEach(function (e) {
    if (enums[e.name] || types[e.name] || BASE_TYPES.indexOf(e.name) >= 0 || GENERIC.indexOf(e.name) >= 0) err(e.line, 'Der Name ' + e.name + ' ist schon vergeben.');
    upperName(e.name, 'Typnamen', e.line);
    enums[e.name] = e.variants.map(function (v) { return v.name; });
    e.variants.forEach(function (v) {
      if (variants[v.name]) err(v.line, 'Die Variante ' + v.name + ' ist schon vergeben.');
      upperName(v.name, 'Varianten', v.line);
      v.fields.forEach(function (fname) { lowerName(fname, 'Feldnamen', v.line); });
      variants[v.name] = { enumName: e.name, fields: v.fields, ftypes: v.ftypes, ftypesT: [], line: v.line };
    });
  });
  function isRes(name) { return !!(name && types[name] && types[name].kind === 'resource'); }
  prog.types.forEach(function (t) {
    if (t.kind === 'record' || t.kind === 'resource') t.fields.forEach(function (f) {
      if (isRes(f.type.name)) err(t.line, 'Das Feld ' + f.name + ' ist selbst eine Ressource. Das kennt der Prototyp noch nicht.');
    });
  });
  prog.funcs.forEach(function (f) {
    if (funcs[f.name]) err(f.line, 'Die Funktion ' + f.name + ' gibt es schon.');
    funcs[f.name] = f;
    if (f.errType && !enums[f.errType]) err(f.line, 'Der Fehlertyp ' + f.errType + ' ist nicht bekannt. Als enum anlegen.');
    lowerName(f.name, 'Funktionsnamen', f.line);
    f.rights.forEach(function (r) { upperName(r.name, 'Rechte', r.line); });
  });
  /* Alle Typangaben auflösen, bevor Rümpfe geprüft werden. */
  prog.types.forEach(function (t) {
    if (t.kind !== 'record' && t.kind !== 'resource') return;
    var ft = {};
    t.fields.forEach(function (f) {
      lowerName(f.name, 'Feldnamen', f.type.line || t.line);
      if (Object.prototype.hasOwnProperty.call(ft, f.name)) err(f.type.line || t.line, 'Das Feld ' + f.name + ' steht doppelt in ' + t.name + '.');
      ft[f.name] = resolve(f.type, t.line);
    });
    if (fieldT[t.name] === undefined) fieldT[t.name] = ft;
  });
  Object.keys(variants).forEach(function (vn) {
    var vd = variants[vn];
    if (vd.ftypes) vd.ftypesT = vd.ftypes.map(function (r) { return resolve(r, vd.line); });
  });
  prog.funcs.forEach(function (f) {
    f.paramT = f.params.map(function (p) { lowerName(p.name, 'Parameter', p.line); return resolve(p.tref, p.line); });
    f.retT = f.ret ? resolve(f.retRef, f.line) : T_DONE;
  });
  function checkable(name, line, depth) {
    if (BASE_TYPES.indexOf(name) >= 0) return true;
    var t = types[name];
    if (!t) { err(line, 'Der Typ ' + name + ' ist nicht bekannt.'); return false; }
    if (t.kind !== 'refined') { err(line, 'check ... as ' + name + ' geht nicht: Nur Int, Text, Bool und Typen mit where lassen sich prüfen.'); return false; }
    if ((depth || 0) > 20) { err(line, 'Der Typ ' + name + ' verweist im Kreis auf sich selbst.'); return false; }
    return checkable(t.base, t.line, (depth || 0) + 1);
  }

  var report = { program: [], functions: [] };

  function join(a, b) { if (a === 'secret' || b === 'secret') return 'secret'; if (a === 'unchecked' || b === 'unchecked') return 'unchecked'; return 'clean'; }
  function R(taint, fallible, lin, region, ref, type) { return { taint: taint || 'clean', fallible: fallible || null, lin: lin || null, region: region || null, ref: ref || null, type: type || null }; }
  function RT(type, taint) { return R(taint, null, null, null, null, type); }
  function mkctx(fn, pure) { return { fn: fn, needed: [], reveals: pure ? null : [], pure: pure || null, lin: [], scopes: [[]], regions: [], loop: 0 }; }

  function declare(env, ctx, name, p) {
    if (Object.prototype.hasOwnProperty.call(env, name)) err(p.line, 'Der Name ' + name + ' ist in diesem Block schon vergeben.');
    var v = { name: name, taint: p.taint || 'clean', mut: !!p.mut, param: !!p.param, lin: p.lin || null, own: !!p.own,
      canChange: !!p.canChange, region: p.region || null, rdepth: ctx.regions.length, loopDepth: ctx.loop,
      state: 'live', movedLine: 0, line: p.line, inScope: true, type: p.type || null };
    env[name] = v;
    ctx.scopes[ctx.scopes.length - 1].push(v);
    if (v.lin) ctx.lin.push(v);
    return v;
  }
  function moveVar(v, line, ctx) {
    if (!v.own) { err(line, v.name + ' ist nur geliehen und kann hier nicht übernommen werden.'); return; }
    if (v.state !== 'live') return;
    if (ctx.loop > v.loopDepth) err(line, v.name + ' würde in einer Schleife mehrfach verbraucht.');
    v.state = 'moved';
    v.movedLine = line;
  }
  function leakCheck(ctx, line, what, except) {
    ctx.lin.forEach(function (v) {
      if (v !== except && v.own && v.inScope && v.state === 'live')
        err(line, what + ' würde ' + v.name + ' (' + v.lin + ') unverbraucht zurücklassen. Vorher mit take übergeben oder mit destroy beenden.');
    });
  }
  function snapshot(ctx) { return ctx.lin.map(function (v) { return { v: v, state: v.state, movedLine: v.movedLine }; }); }
  function restore(st) { st.forEach(function (x) { x.v.state = x.state; x.v.movedLine = x.movedLine; }); }
  function merge(before, branches, line) {
    var live = branches.filter(function (b) { return !b.div; });
    if (!live.length) { restore(branches[0].st.slice(0, before.length)); return; }
    before.forEach(function (x, i) {
      var first = live[0].st[i], same = live.every(function (b) { return b.st[i].state === first.state; });
      if (!same) {
        err(line, x.v.name + ' wird nicht in jedem Zweig verbraucht. Alle Zweige müssen dasselbe tun.');
        x.v.state = 'moved'; x.v.movedLine = line;
      } else { x.v.state = first.state; x.v.movedLine = first.movedLine; }
    });
  }
  function escapes(region, target, ctx) { return target.rdepth <= ctx.regions.indexOf(region); }

  function analyze(e, env, ctx) {
    var r = analyze0(e, env, ctx);
    e.ty = r.type;
    return r;
  }
  function binType(e, l, r) {
    var op = e.op, line = e.line;
    switch (op) {
      case 'and': case 'or':
        expectT(l, T_BOOL, line, 'Links von ' + op); expectT(r, T_BOOL, line, 'Rechts von ' + op);
        return T_BOOL;
      case '+':
        if (isText(l) || isText(r)) {
          if (!isText(l) && l.type && l.taint !== 'unchecked' || !isText(r) && r.type && r.taint !== 'unchecked')
            err(line, 'Mit + lassen sich ' + tstr(l.type) + ' und ' + tstr(r.type) + ' nicht verbinden. Den Wert in den Text einsetzen: "... {wert}"');
          return T_TEXT;
        }
        expectT(l, T_INT, line, 'Links von +'); expectT(r, T_INT, line, 'Rechts von +');
        return T_INT;
      case '-': case '*': case '/': case '%':
        expectT(l, T_INT, line, 'Links von ' + op); expectT(r, T_INT, line, 'Rechts von ' + op);
        return T_INT;
      case '..':
        expectT(l, T_INT, line, 'Die untere Grenze'); expectT(r, T_INT, line, 'Die obere Grenze');
        return T_RANGE;
      case '<': case '<=': case '>': case '>=':
        expectT(l, T_INT, line, 'Links von ' + op); expectT(r, T_INT, line, 'Rechts von ' + op);
        return T_BOOL;
      case '==': case '!=':
        if (l.taint !== 'unchecked' && r.taint !== 'unchecked' && !comparable(l.type, r.type))
          err(line, 'Verglichen werden ' + tstr(l.type) + ' und ' + tstr(r.type) + '. Beide Seiten brauchen denselben Typ.');
        return T_BOOL;
      case 'in':
        if (r.type && r.taint !== 'unchecked') {
          if (r.type.n === 'Range') expectT(l, T_INT, line, 'Links von in');
          else if (r.type.a && (r.type.n === 'List' || r.type.n === 'Table')) {
            if (l.taint !== 'unchecked' && !comparable(l.type, r.type.a[0])) err(line, 'Links von in steht ' + tstr(l.type) + ', die Liste enthält ' + tstr(r.type.a[0]) + '.');
          } else err(line, 'Rechts von in steht ein Bereich (a..b) oder eine Liste, vorhanden ist ' + tstr(r.type) + '.');
        }
        return T_BOOL;
    }
    return null;
  }
  function analyze0(e, env, ctx) {
    switch (e.k) {
      case 'Num': return RT(T_INT);
      case 'Bool': return RT(T_BOOL);
      case 'Str': {
        var taint = 'clean';
        e.parts.forEach(function (p) {
          if (!p.expr) return;
          var r = value(p.expr, env, ctx);
          if (r.taint === 'secret') err(e.line, 'Ein Geheimnis darf nicht in einen Text eingesetzt werden.');
          else taint = join(taint, r.taint);
        });
        return RT(T_TEXT, taint);
      }
      case 'Var': {
        var v = env[e.name];
        if (!v) { err(e.line, 'Der Name ' + e.name + ' ist hier nicht bekannt.'); return R(); }
        if (v.lin && v.state === 'moved') err(e.line, e.name + ' wurde in Zeile ' + v.movedLine + ' abgegeben und ist hier nicht mehr vorhanden.');
        return R(v.taint, null, v.lin, v.region, v, v.type);
      }
      case 'Field': {
        var fo = value(e.obj, env, ctx);
        return RT(fieldType(fo.type, e.name, e.line), fo.taint);
      }
      case 'Index': {
        var io = value(e.obj, env, ctx), ii = value(e.idx, env, ctx);
        if (ii.taint === 'unchecked') err(e.line, 'Ungeprüfter Wert als Stelle einer Tabelle. Erst mit check prüfen.');
        if (ii.taint === 'secret') err(e.line, 'Ein Geheimnis darf nicht als Stelle dienen. Der Speicherzugriff würde es verraten.');
        expectT(ii, T_INT, e.line, 'Die Stelle einer Tabelle');
        return R(io.taint, null, null, io.region, null, elemType(io.type, e.line));
      }
      case 'Mode': err(e.line, e.mode + ' steht nur direkt vor einem Argument beim Aufruf einer eigenen Funktion.'); return analyze(e.e, env, ctx);
      case 'Un': {
        var u = value(e.e, env, ctx);
        if (u.taint === 'unchecked') err(e.line, 'Ungeprüfter Wert in einer Berechnung. Erst mit check prüfen.');
        expectT(u, e.op === 'not' ? T_BOOL : T_INT, e.line, e.op === 'not' ? 'not' : 'Das Vorzeichen -');
        return RT(e.op === 'not' ? T_BOOL : T_INT, u.taint === 'secret' ? 'secret' : 'clean');
      }
      case 'Bin': {
        var l = value(e.l, env, ctx), r2 = value(e.r, env, ctx);
        if (l.taint === 'unchecked' || r2.taint === 'unchecked') err(e.line, 'Ungeprüfter Wert in einer Berechnung oder einem Vergleich. Erst mit check prüfen.');
        var sec = l.taint === 'secret' || r2.taint === 'secret';
        if (sec && ['==', '!=', '<', '<=', '>', '>=', 'in', 'and', 'or'].indexOf(e.op) >= 0) {
          err(e.line, 'Ein Vergleich mit einem Geheimnis verrät es über die Laufzeit.');
          return RT(T_BOOL);
        }
        return RT(binType(e, l, r2), sec ? 'secret' : 'clean');
      }
      case 'List': {
        var lt = 'clean', lr = null, el = null;
        e.items.forEach(function (it) {
          var a = value(it, env, ctx);
          if (a.lin) err(it.line || e.line, 'Ressourcen in Listen kennt der Prototyp noch nicht.');
          lt = join(lt, a.taint); lr = lr || a.region;
          el = unify(el, a.type, it.line || e.line);
        });
        return R(lt, null, null, lr, null, T('Table', [el, e.items.length]));
      }
      case 'Call': {
        var f = funcs[e.name];
        if (!f) { err(e.line, 'Die Funktion ' + e.name + ' gibt es nicht.'); e.args.forEach(function (a) { value(a.k === 'Mode' ? a.e : a, env, ctx); }); return R(); }
        if (e.args.length !== f.params.length) err(e.line, e.name + ' erwartet ' + f.params.length + ' Argumente, übergeben wurden ' + e.args.length + '.');
        e.args.forEach(function (a, i) {
          var marker = a.k === 'Mode' ? a.mode : 'read', inner = a.k === 'Mode' ? a.e : a;
          var at = value(inner, env, ctx), p = f.params[i], ln = inner.line || e.line;
          if (!p) return;
          if (at.taint === 'unchecked' && p.taint !== 'unchecked') err(ln, 'Ungeprüfter Wert an ' + e.name + '(' + p.name + '). Erst mit check prüfen oder den Parameter als unchecked markieren.');
          if (at.taint === 'secret' && p.taint !== 'secret') err(ln, 'Geheimnis an ' + e.name + '(' + p.name + '). Der Parameter ist nicht als secret markiert.');
          if (at.taint !== 'unchecked' || p.taint === 'unchecked') {
            if (p.mode !== 'change') fits(inner, at.type, f.paramT[i], ln, e.name + '(' + p.name + ')');
            else if (!sameT(at.type, f.paramT[i])) err(ln, e.name + '(change ' + p.name + ') erwartet genau ' + tstr(f.paramT[i]) + ', vorhanden ist ' + tstr(at.type) + '. Bei change müssen die Typen übereinstimmen.');
          }
          if (p.mode !== marker) {
            if (p.mode === 'read') err(ln, e.name + ' liest ' + p.name + ' nur. Das Wort ' + marker + ' gehört hier nicht hin.');
            else err(ln, e.name + ' erwartet beim Aufruf "' + p.mode + ' ..." für ' + p.name + ', damit sichtbar ist, was mit dem Wert geschieht.');
            if (p.mode === 'take' && inner.k === 'Var' && at.ref && at.ref.lin && at.ref.own) moveVar(at.ref, ln, ctx);
            return;
          }
          if (marker === 'take') {
            if (at.region) err(ln, 'Ein Wert aus der Region ' + at.region + ' darf nicht abgegeben werden.');
            if (inner.k === 'Var' && at.ref && at.ref.lin) moveVar(at.ref, ln, ctx);
          } else if (marker === 'change') {
            if (inner.k !== 'Var' || !at.ref) err(ln, 'change braucht eine Variable.');
            else if (!at.ref.canChange) err(ln, inner.name + ' darf hier nicht verändert werden. Mit var anlegen oder selbst als change-Parameter erhalten.');
          } else if (at.lin && inner.k !== 'Var') {
            err(ln, 'Der neue Wert vom Typ ' + at.lin + ' wird nur gelesen und danach nie verbraucht.');
          }
        });
        f.rights.forEach(function (r) { need(ctx, r, e.line, 'Aufruf von ' + f.name); });
        return R(f.retTaint, f.errType, isRes(f.ret) ? f.ret : null, null, null, f.retT);
      }
      case 'MCall': {
        var q = e.mod + '.' + e.fn, b = BUILTINS[q];
        if (!b) { err(e.line, q + ' gibt es in der Bibliothek des Prototyps nicht.'); e.args.forEach(function (a) { value(a.k === 'Mode' ? a.e : a, env, ctx); }); return R(); }
        if (e.args.length !== b.n) err(e.line, q + ' erwartet ' + b.n + ' Argumente, übergeben wurden ' + e.args.length + '.');
        var arg = null;
        if (b.lit) {
          var a0 = e.args[0];
          if (!a0 || a0.k !== 'Str' || a0.parts.length !== 1 || a0.parts[0].text === undefined) err(e.line, 'Das erste Argument von ' + q + ' muss im Prototyp ein fester Text sein, damit das Recht prüfbar ist.');
          else arg = a0.parts[0].text;
        }
        var argT = [];
        e.args.forEach(function (a, i) {
          if (a.k === 'Mode') { err(a.line || e.line, 'take und change gibt es nur bei eigenen Funktionen, nicht bei ' + q + '.'); a = a.e; }
          var at = value(a, env, ctx);
          argT.push(at.type);
          if (b.p[i] && at.taint !== 'unchecked') fits(a, at.type, LIB[b.p[i]], a.line || e.line, q + ' (Argument ' + (i + 1) + ')');
          if (at.taint === 'unchecked') err(a.line || e.line, 'Ungeprüfter Wert darf nicht an ' + q + ' gehen. Erst mit check prüfen.');
          if (at.taint === 'secret' && !b.acceptsSecret) err(a.line || e.line, 'Ein Geheimnis darf nicht an ' + q + ' gehen.');
          if (at.lin) err(a.line || e.line, 'Eine Ressource kann nicht an ' + q + ' gehen.');
          if (at.region && q === 'Db.insert') err(a.line || e.line, 'Ein Wert aus der Region ' + at.region + ' darf nicht gespeichert werden, er verschwindet am Blockende.');
        });
        if (b.hw) {
          var addr = fold(e.args[0]);
          need(ctx, addr === null ? { name: b.right } : { name: b.right, lo: addr, hi: addr }, e.line, q);
        } else if (b.right) need(ctx, { name: b.right, arg: b.lit ? arg : null }, e.line, q);
        var bt = b.r === 'Elem' ? (argT[0] && argT[0].a ? argT[0].a[0] : null)
          : b.r === 'Fill' ? T('Table', [argT[1] || null, e.args[0] ? fold(e.args[0]) : null]) : LIB[b.r];
        return R(b.ret, b.fallible || null, null, null, null, bt);
      }
      case 'Variant': {
        var vd = variants[e.name];
        if (!vd) {
          if (types[e.name] && types[e.name].kind !== 'refined') err(e.line, 'Ein Datensatz wird mit geschweiften Klammern gebaut: ' + e.name + ' { ... }');
          else err(e.line, 'Der Name ' + e.name + ' ist nicht bekannt.');
        } else if (e.args.length !== vd.fields.length) err(e.line, e.name + ' erwartet ' + vd.fields.length + ' Angaben, übergeben wurden ' + e.args.length + '.');
        e.args.forEach(function (a, i) {
          var at = value(a, env, ctx);
          if (at.taint !== 'clean') err(a.line || e.line, 'In ' + e.name + '(...) stehen nur geprüfte, nicht geheime Werte.');
          else if (vd && i < vd.fields.length) fits(a, at.type, vd.ftypesT[i], a.line || e.line, 'Die Angabe ' + vd.fields[i] + ' von ' + e.name);
          if (at.lin) err(a.line || e.line, 'Ressourcen in Varianten kennt der Prototyp noch nicht.');
        });
        return RT(vd ? T(vd.enumName) : null);
      }
      case 'Record': {
        var td = types[e.type], rt = 'clean', rr = null;
        if (!td || td.kind === 'refined') err(e.line, 'Der Datensatz-Typ ' + e.type + ' ist nicht bekannt.');
        else {
          var want = td.fields.map(function (x) { return x.name; }), got = e.fields.map(function (x) { return x.name; });
          want.forEach(function (w) { if (got.indexOf(w) < 0) err(e.line, 'In ' + e.type + ' { ... } fehlt das Feld ' + w + '.'); });
          got.forEach(function (g) { if (want.indexOf(g) < 0) err(e.line, e.type + ' hat kein Feld ' + g + '.'); });
        }
        e.fields.forEach(function (fl) {
          var at = value(fl.expr, env, ctx);
          if (at.taint === 'unchecked') err(fl.expr.line || e.line, 'Ungeprüfter Wert im Feld ' + fl.name + '. Erst mit check prüfen.');
          else if (td && td.kind !== 'refined' && Object.prototype.hasOwnProperty.call(fieldT[e.type] || {}, fl.name))
            fits(fl.expr, at.type, fieldT[e.type][fl.name], fl.expr.line || e.line, 'Das Feld ' + fl.name + ' von ' + e.type);
          if (at.lin) err(fl.expr.line || e.line, 'Das Feld ' + fl.name + ' kann im Prototyp keine Ressource aufnehmen.');
          rt = join(rt, at.taint === 'secret' ? 'secret' : 'clean');
          rr = rr || at.region;
        });
        return R(rt, null, td && td.kind === 'resource' ? e.type : null, rr, null, td && td.kind !== 'refined' ? T(e.type) : null);
      }
      case 'Check': {
        var c = value(e.e, env, ctx);
        if (c.taint === 'secret') err(e.line, 'check ist für ungeprüfte Werte gedacht, nicht für Geheimnisse.');
        var cr = root(c.type);
        if (cr && BASE_TYPES.indexOf(cr.n) < 0) err(e.line, 'check prüft nur einfache Werte (Int, Text, Bool), vorhanden ist ' + tstr(c.type) + '.');
        return R('clean', 'CheckFailed', null, null, null, checkable(e.type, e.line) ? T(e.type) : null);
      }
      case 'Try': {
        var inner = analyze(e.e, env, ctx);
        if (!inner.fallible) err(e.line, 'try steht vor etwas, das nicht scheitern kann.');
        else if (!ctx.fn || !ctx.fn.errType) err(e.line, 'try gibt den Fehler weiter. Dafür muss die Funktion selbst scheitern können: -> Typ fails Fehlertyp');
        else if (inner.fallible !== ctx.fn.errType) err(e.line, 'try würde ' + inner.fallible + ' weitergeben, ' + ctx.fn.name + ' verspricht aber ' + ctx.fn.errType + '. Mit otherwise return ... umwandeln.');
        leakCheck(ctx, e.line, 'try');
        return R(inner.taint, null, inner.lin, inner.region, null, inner.type);
      }
      case 'RegionNew': {
        if (ctx.regions.indexOf(e.region) < 0) err(e.line, 'Die Region ' + e.region + ' ist hier nicht offen.');
        var rn = value(e.e, env, ctx);
        if (rn.lin) err(e.line, 'Ressourcen gehören im Prototyp nicht in eine Region.');
        return R(rn.taint, null, null, e.region, null, rn.type);
      }
      case 'Secret': return RT(value(e.e, env, ctx).type, 'secret');
      case 'Reveal': {
        var s = value(e.e, env, ctx);
        if (s.taint !== 'secret') err(e.line, 'reveal braucht ein Geheimnis. Dieser Wert ist keines.');
        if (ctx.reveals) ctx.reveals.push({ text: e.text, reason: e.reason, line: e.line });
        return RT(s.type);
      }
    }
    return R();
  }
  function value(e, env, ctx) {
    var r = analyze(e, env, ctx);
    if (r.fallible) err(e.line, 'Fehlerfall nicht behandelt (' + r.fallible + '). Der Aufruf braucht otherwise return ... oder try.');
    return r;
  }
  function need(ctx, right, line, via) {
    if (ctx.pure) { err(line, ctx.pure + ' dürfen nichts nach außen tun (' + via + ' braucht ' + fmtRight(right) + ').'); return; }
    ctx.needed.push({ name: right.name, arg: right.arg === undefined ? null : right.arg,
      lo: right.lo === undefined ? null : right.lo, hi: right.hi === undefined ? null : right.hi, line: line, via: via });
  }
  function retValue(e, r, ctx, line) {
    var fn = ctx.fn;
    if (r.taint === 'unchecked' && fn.retTaint !== 'unchecked') err(line, fn.name + ' gibt einen ungeprüften Wert zurück. Entweder vorher mit check prüfen oder den Rückgabetyp als unchecked markieren.');
    if (r.taint === 'secret' && fn.retTaint !== 'secret') err(line, fn.name + ' gibt ein Geheimnis zurück, der Rückgabetyp ist aber nicht als secret markiert.');
    if (r.region) err(line, 'Der Wert gehört zur Region ' + r.region + ' und darf den Block nicht verlassen.');
    var isErr = !!(fn.errType && r.type && !r.type.a && r.type.n === fn.errType);
    if (!isErr && !(r.taint === 'unchecked' && fn.retTaint !== 'unchecked')) {
      if (!fn.ret && r.type && !assignable(r.type, T_DONE)) err(line, fn.name + ' gibt laut Kopf nichts zurück, hier steht aber ein Wert vom Typ ' + tstr(r.type) + '. Im Kopf ergänzen: -> ' + tstr(root(r.type)));
      else fits(e, r.type, fn.retT, line, 'Die Rückgabe von ' + fn.name);
    }
    var except = null;
    if (r.lin) {
      if (!isRes(fn.ret)) err(line, fn.name + ' gibt eine Ressource (' + r.lin + ') zurück, der Rückgabetyp ist aber keine.');
      if (e.k === 'Var' && r.ref) { moveVar(r.ref, line, ctx); except = r.ref; }
    }
    leakCheck(ctx, line, 'return', except);
  }
  function checkReturn(e, env, ctx, line) {
    var fn = ctx.fn, r = analyze(e, env, ctx);
    if (r.fallible) {
      if (!fn.errType) err(line, 'Hier wird etwas zurückgegeben, das scheitern kann (' + r.fallible + '), aber ' + fn.name + ' verspricht keinen Fehlertyp.');
      else if (r.fallible !== fn.errType) err(line, 'Zurückgegeben würde der Fehler ' + r.fallible + ', ' + fn.name + ' verspricht aber ' + fn.errType + '. Mit otherwise return ... umwandeln.');
    }
    retValue(e, r, ctx, line);
  }
  function handled(e, other, env, ctx, line) {
    var r = analyze(e, env, ctx);
    if (r.fallible && !other) err(line, 'Fehlerfall nicht behandelt (' + r.fallible + '). Ergänze otherwise return ... oder try.');
    if (!r.fallible && other) err(line, 'otherwise steht hinter etwas, das nicht scheitern kann.');
    if (other) {
      var st = snapshot(ctx);
      if (other.k === 'ret') checkReturn(other.e, env, ctx, line);
      else {
        var od = block(other.body, env, ctx, function (local) { lowerName(other.name, 'Variablen', other.line); declare(local, ctx, other.name, { taint: 'clean', line: other.line, type: r.fallible ? T(r.fallible) : null }); });
        if (!od) err(other.line, 'Der otherwise-Block muss mit return enden, sonst fehlt danach ein Wert.');
      }
      restore(st);
    }
    return r;
  }
  function diverges(stmts) {
    var last = stmts[stmts.length - 1];
    if (!last) return false;
    if (last.k === 'Return') return true;
    if (last.k === 'If') return !!last.els && diverges(last.then) && diverges(last.els);
    if (last.k === 'Match') return last.arms.length > 0 && last.arms.every(function (a) { return diverges(a.body); });
    if (last.k === 'Region') return diverges(last.body);
    return false;
  }
  function closeScope(mine, div) {
    mine.forEach(function (v) {
      if (v.lin && v.own && v.state === 'live' && !div) err(v.line, v.name + ' (' + v.lin + ') wird nie verbraucht. Mit take übergeben, zurückgeben oder mit destroy beenden.');
      v.inScope = false;
    });
  }
  function block(stmts, env, ctx, pre) {
    var local = Object.create(env), mine = [];
    ctx.scopes.push(mine);
    if (pre) pre(local);
    stmts.forEach(function (s) { stmt(s, local, ctx); });
    var div = diverges(stmts);
    ctx.scopes.pop();
    closeScope(mine, div);
    return div;
  }
  function stmt(s, env, ctx) {
    switch (s.k) {
      case 'Let': {
        var r = handled(s.e, s.other, env, ctx, s.line);
        if (r.lin && s.e.k === 'Var' && r.ref) moveVar(r.ref, s.line, ctx);
        lowerName(s.name, 'Variablen', s.line);
        var lty = r.type, ann = s.type ? resolve(s.type, s.line) : null;
        if (ann) { fits(s.e, r.type, ann, s.line, 'Die Variable ' + s.name); lty = ann; }
        declare(env, ctx, s.name, { taint: r.taint, mut: s.mut, lin: r.lin, own: true, canChange: s.mut, region: r.region, line: s.line, type: lty });
        break;
      }
      case 'Assign': {
        var v = env[s.name];
        var a = value(s.e, env, ctx);
        if (!v) { err(s.line, 'Der Name ' + s.name + ' ist hier nicht bekannt. Neue Variablen mit let oder var anlegen.'); break; }
        if (v.param) { err(s.line, 'Ein Parameter wird nicht neu zugewiesen. Bei change die Felder ändern, zum Beispiel ' + s.name + '.feld = ...'); break; }
        if (!v.mut) { err(s.line, s.name + ' wurde mit let angelegt und ist unveränderlich. Mit var anlegen, wenn sich der Wert ändern soll.'); break; }
        if (v.lin && v.state === 'live') err(s.line, s.name + ' enthält noch eine unverbrauchte Ressource und kann nicht überschrieben werden.');
        if (v.type) fits(s.e, a.type, v.type, s.line, 'Die Variable ' + s.name); else v.type = a.type;
        if (a.region) { if (escapes(a.region, v, ctx)) err(s.line, 'Der Wert gehört zur Region ' + a.region + ' und darf nicht in ' + s.name + ' landen, das außerhalb angelegt wurde.'); else v.region = a.region; }
        if (a.lin) {
          if (s.e.k === 'Var' && a.ref) moveVar(a.ref, s.line, ctx);
          v.lin = a.lin; v.state = 'live'; v.own = true; v.loopDepth = Math.max(v.loopDepth, ctx.loop);
          if (ctx.lin.indexOf(v) < 0) ctx.lin.push(v);
        }
        v.taint = join(v.taint, a.taint);
        break;
      }
      case 'FieldAssign': {
        var fv = env[s.name];
        var fa = value(s.e, env, ctx);
        if (!fv) { err(s.line, 'Der Name ' + s.name + ' ist hier nicht bekannt.'); break; }
        if (fv.lin && fv.state === 'moved') err(s.line, s.name + ' wurde in Zeile ' + fv.movedLine + ' abgegeben und ist hier nicht mehr vorhanden.');
        if (!fv.canChange) err(s.line, s.name + ' darf hier nicht verändert werden. Mit var anlegen oder als change-Parameter erhalten.');
        if (fa.taint === 'unchecked') err(s.line, 'Ungeprüfter Wert im Feld ' + s.field + '. Erst mit check prüfen.');
        else fits(s.e, fa.type, fieldType(fv.type, s.field, s.line, true), s.line, 'Das Feld ' + s.field + ' von ' + s.name);
        if (fa.taint === 'secret') fv.taint = 'secret';
        if (fa.lin) err(s.line, 'Das Feld ' + s.field + ' kann im Prototyp keine Ressource aufnehmen.');
        if (fa.region && escapes(fa.region, fv, ctx)) err(s.line, 'Der Wert gehört zur Region ' + fa.region + ' und darf nicht in ' + s.name + ' landen, das außerhalb angelegt wurde.');
        break;
      }
      case 'Store': {
        var sv = env[s.name];
        var si = value(s.idx, env, ctx), sa = value(s.e, env, ctx);
        if (!sv) { err(s.line, 'Der Name ' + s.name + ' ist hier nicht bekannt.'); break; }
        if (!sv.canChange) err(s.line, s.name + ' darf hier nicht verändert werden. Mit var anlegen oder als change-Parameter erhalten.');
        if (si.taint === 'unchecked') err(s.line, 'Ungeprüfter Wert als Stelle einer Tabelle. Erst mit check prüfen.');
        if (si.taint === 'secret') err(s.line, 'Ein Geheimnis darf nicht als Stelle dienen. Der Speicherzugriff würde es verraten.');
        expectT(si, T_INT, s.line, 'Die Stelle einer Tabelle');
        var slotT = elemType(sv.type, s.line);
        if (s.field) slotT = fieldType(slotT, s.field, s.line, true);
        if (sa.taint === 'unchecked') err(s.line, 'Ungeprüfter Wert in einer Tabelle. Erst mit check prüfen.');
        else fits(s.e, sa.type, slotT, s.line, s.field ? 'Das Feld ' + s.field : 'Die Stelle von ' + s.name);
        if (sa.taint === 'secret') sv.taint = 'secret';
        if (sa.lin) err(s.line, 'Ressourcen in Tabellen kennt der Prototyp noch nicht.');
        if (sa.region && escapes(sa.region, sv, ctx)) err(s.line, 'Der Wert gehört zur Region ' + sa.region + ' und darf nicht in ' + s.name + ' landen, das außerhalb angelegt wurde.');
        break;
      }
      case 'Destroy': {
        var dv = env[s.name];
        if (!dv) { err(s.line, 'Der Name ' + s.name + ' ist hier nicht bekannt.'); break; }
        if (!dv.lin) { err(s.line, 'destroy ist nur für Ressourcen gedacht. ' + s.name + ' ist keine.'); break; }
        if (dv.state === 'moved') err(s.line, s.name + ' wurde in Zeile ' + dv.movedLine + ' abgegeben und ist hier nicht mehr vorhanden.');
        else moveVar(dv, s.line, ctx);
        break;
      }
      case 'Return': {
        if (!s.e) {
          if (ctx.fn.ret && ctx.fn.retT && ctx.fn.retT.n !== 'Done') err(s.line, 'return braucht hier einen Wert vom Typ ' + ctx.fn.ret + '.');
          leakCheck(ctx, s.line, 'return'); break;
        }
        if (s.other) retValue(s.e, handled(s.e, s.other, env, ctx, s.line), ctx, s.line);
        else checkReturn(s.e, env, ctx, s.line);
        break;
      }
      case 'If': {
        cond(s.cond, env, ctx);
        var before = snapshot(ctx);
        var d1 = block(s.then, env, ctx), st1 = snapshot(ctx);
        restore(before);
        var d2 = s.els ? block(s.els, env, ctx) : false, st2 = snapshot(ctx);
        merge(before, [{ div: d1, st: st1 }, { div: d2, st: st2 }], s.line);
        break;
      }
      case 'Match': {
        var m = value(s.e, env, ctx);
        if (m.taint === 'unchecked') err(s.line, 'match hängt von einem ungeprüften Wert ab. Erst mit check prüfen.');
        if (m.taint === 'secret') err(s.line, 'Eine Verzweigung darf nicht von einem Geheimnis abhängen.');
        var enumName = null, covered = {}, base = snapshot(ctx), branches = [], known = false;
        if (m.type && m.taint !== 'unchecked') {
          if (!m.type.a && enums[m.type.n]) { enumName = m.type.n; known = true; }
          else err(s.line, 'match erwartet einen Wert einer Aufzählung, vorhanden ist ' + tstr(m.type) + '.');
        }
        s.arms.forEach(function (arm) {
          var vd = variants[arm.name];
          if (!vd) err(arm.line, 'Die Variante ' + arm.name + ' ist nicht bekannt.');
          else {
            if (enumName && vd.enumName !== enumName) err(arm.line, arm.name + ' gehört zu ' + vd.enumName + (known ? ', verglichen wird aber ein Wert vom Typ ' : ', die anderen Zweige zu ') + enumName + '.');
            enumName = enumName || vd.enumName;
            if (covered[arm.name]) err(arm.line, 'Der Zweig ' + arm.name + ' kommt doppelt vor.');
            covered[arm.name] = true;
            if (arm.binds.length !== vd.fields.length) err(arm.line, arm.name + ' hat ' + vd.fields.length + ' Angaben, im Zweig stehen ' + arm.binds.length + '.');
          }
          restore(base);
          var d = block(arm.body, env, ctx, function (local) {
            arm.binds.forEach(function (bn, bi) {
              lowerName(bn, 'Variablen', arm.line);
              declare(local, ctx, bn, { taint: 'clean', line: arm.line, type: vd && vd.enumName === enumName ? vd.ftypesT[bi] : null });
            });
          });
          branches.push({ div: d, st: snapshot(ctx) });
        });
        if (enumName && enums[enumName]) {
          var missing = enums[enumName].filter(function (n) { return !covered[n]; });
          if (missing.length) err(s.line, 'match deckt nicht alle Fälle von ' + enumName + ' ab. Es fehlt: ' + missing.join(', ') + '.');
        }
        if (!s.arms.length) err(s.line, 'match braucht mindestens einen Zweig.');
        else merge(base, branches, s.line);
        break;
      }
      case 'While': cond(s.cond, env, ctx); ctx.loop++; block(s.body, env, ctx); ctx.loop--; break;
      case 'For': {
        var it = value(s.e, env, ctx), itT = null;
        lowerName(s.name, 'Variablen', s.line);
        if (it.type && it.taint !== 'unchecked') {
          if (it.type.n === 'Range') itT = T_INT;
          else if (it.type.a && (it.type.n === 'List' || it.type.n === 'Table')) itT = it.type.a[0];
          else err(s.line, 'for läuft über einen Bereich (a..b) oder eine Liste, vorhanden ist ' + tstr(it.type) + '.');
        }
        ctx.loop++;
        block(s.body, env, ctx, function (local) { declare(local, ctx, s.name, { taint: it.taint, line: s.line, type: itT }); });
        ctx.loop--;
        break;
      }
      case 'Region': {
        if (ctx.regions.indexOf(s.name) >= 0) err(s.line, 'Die Region ' + s.name + ' ist schon offen.');
        if (env[s.name]) err(s.line, 'Der Name ' + s.name + ' ist schon vergeben.');
        lowerName(s.name, 'Regionen', s.line);
        ctx.regions.push(s.name);
        block(s.body, env, ctx);
        ctx.regions.pop();
        break;
      }
      case 'Expr': {
        var er = handled(s.e, s.other, env, ctx, s.line);
        if (er.lin && s.e.k !== 'Var') err(s.line, 'Der Wert vom Typ ' + er.lin + ' wird nie verbraucht. Einer Variablen zuweisen und später mit take übergeben.');
        break;
      }
    }
  }
  function cond(e, env, ctx) {
    var c = value(e, env, ctx);
    if (c.taint === 'unchecked') err(e.line, 'Die Bedingung hängt von einem ungeprüften Wert ab. Erst mit check prüfen.');
    if (c.taint === 'secret') err(e.line, 'Eine Verzweigung darf nicht von einem Geheimnis abhängen.');
    expectT(c, T_BOOL, e.line, 'Die Bedingung');
  }

  prog.types.forEach(function (t) {
    if (t.kind === 'refined') {
      if (BASE_TYPES.indexOf(t.base) < 0) checkable(t.base, t.line);
      if (t.where) {
        var c = value(t.where, { it: { taint: 'clean', state: 'live', type: types[t.base] || BASE_TYPES.indexOf(t.base) >= 0 ? T(t.base) : null } }, mkctx(null, 'Einschränkungen von Typen'));
        if (c.taint !== 'clean') err(t.line, 'Die Einschränkung von ' + t.name + ' muss ein einfacher Wahrheitswert sein.');
        else expectT(c, T_BOOL, t.line, 'Die Einschränkung von ' + t.name);
      }
    }
  });

  prog.funcs.forEach(function (f) {
    var env = {}, ctx = mkctx(f, null);
    f.params.forEach(function (p, i) {
      declare(env, ctx, p.name, { taint: p.taint, param: true, lin: isRes(p.type) ? p.type : null,
        own: p.mode === 'take', canChange: p.mode !== 'read', line: p.line, type: f.paramT[i] });
    });
    var cctx = mkctx(f, 'Verträge');
    f.requires.forEach(function (c) { expectT(value(c.expr, Object.create(env), cctx), T_BOOL, c.line, 'requires'); });
    var eenv = Object.create(env);
    eenv.result = { name: 'result', taint: f.retTaint, state: 'live', rdepth: 0, loopDepth: 0, type: f.retT };
    f.ensures.forEach(function (c) { expectT(value(c.expr, eenv, cctx), T_BOOL, c.line, 'ensures'); });
    if (f.assembly) {
      if (!f.rights.some(function (d) { return d.name === 'Cpu'; })) err(f.line, 'Die assembly-Funktion ' + f.name + ' braucht uses Cpu.');
      if (!f.assumes.length) err(f.line, 'Die assembly-Funktion ' + f.name + ' braucht mindestens eine Annahme (assumes), weil niemand ihren Inhalt prüft.');
      report.functions.push({ name: f.name, line: f.line, assembly: true, rights: f.rights.map(fmtRight), changes: [], takes: [],
        requires: f.requires.map(function (c) { return c.text; }), ensures: [], assumes: f.assumes.map(function (a) { return a.text; }), reveals: [] });
      return;
    }
    var div = block(f.body, env, ctx);
    closeScope(ctx.scopes[0], div);
    if (!div && f.ret && f.retT && f.retT.n !== 'Done') err(f.line, f.name + ' verspricht ' + f.ret + ', der Rumpf kann aber ohne return enden. Am Ende einen Wert zurückgeben.');

    var used = {};
    ctx.needed.forEach(function (n) {
      var ok = false;
      f.rights.forEach(function (d, i) { if (covers(d, n)) { used[i] = true; ok = true; } });
      if (ok) return;
      var sameKind = f.rights.filter(function (d) { return d.name === n.name && d.lo !== null && d.lo !== undefined; });
      if (n.lo !== null && sameKind.length) err(n.line, fmtRight(n) + ' (wegen ' + n.via + ') liegt außerhalb dessen, was ' + f.name + ' darf: ' + sameKind.map(fmtRight).join(', ') + '.');
      else err(n.line, f.name + ' braucht das Recht ' + fmtRight(n) + ' (wegen ' + n.via + '). Es fehlt in der uses-Zeile.');
    });
    f.rights.forEach(function (d, i) {
      if (!used[i]) warnings.push({ line: d.line, msg: f.name + ' verlangt ' + fmtRight(d) + ', nutzt es aber nicht. Rechte so knapp wie möglich halten.' });
    });
    report.functions.push({
      name: f.name, line: f.line, assembly: false, rights: f.rights.map(fmtRight),
      changes: f.params.filter(function (p) { return p.mode === 'change'; }).map(function (p) { return p.name + ': ' + p.type; }),
      takes: f.params.filter(function (p) { return p.mode === 'take'; }).map(function (p) { return p.name + ': ' + p.type; }),
      requires: f.requires.map(function (c) { return c.text; }),
      ensures: f.ensures.map(function (c) { return c.text; }),
      assumes: f.assumes.map(function (a) { return a.text; }),
      reveals: ctx.reveals
    });
  });

  var main = funcs.main;
  if (!main) err(1, 'Es fehlt der Einstieg: function main() { ... }');
  else {
    if (main.params.length) err(main.line, 'main hat im Prototyp keine Parameter.');
    report.program = main.rights.map(fmtRight);
  }
  /* Stehen schon Fehler im Programm, zählt nur ein eindeutiges Nein: Der Rest kann Folge der anderen Fehler sein. */
  if (proofs.length) execute({ types: types, variants: variants, funcs: funcs }, '', proofs, errors.length > 0).forEach(function (x) { err(x.line, x.msg); });
  errors.sort(function (a, b) { return a.line - b.line; });
  return { errors: errors, warnings: warnings, report: report, types: types, variants: variants, funcs: funcs };
}

/* ---------- Interpreter ---------- */
function Err(v) { this.value = v; }
function ReturnSignal(v) { this.value = v; }
function RuntimeFail(msg, line) { this.message = msg; this.line = line || 0; }

function parseWorld(text) {
  var w = { input: {}, net: {}, port: {}, dbDown: {}, mailDown: false, keys: null };
  (text || '').split('\n').forEach(function (raw) {
    var line = raw.trim();
    if (!line || line[0] === '#') return;
    var m;
    if ((m = /^input\s+(\S+)\s*=\s?(.*)$/.exec(line))) w.input[m[1]] = m[2];
    else if ((m = /^net\s+(\S+)\s*=\s?(.*)$/.exec(line))) w.net[m[1]] = m[2];
    else if ((m = /^port\s+(\S+)\s*=\s*(\S+)$/.exec(line))) w.port[Number(m[1])] = m[2];
    else if ((m = /^keys\s*=\s?(.*)$/.exec(line))) {
      w.keys = [];
      m[1].toLowerCase().split('').forEach(function (c) {
        if (SCAN[c] !== undefined) { w.keys.push(SCAN[c]); w.keys.push(SCAN[c] + 0x80); }
      });
    }
    else if ((m = /^db\s+(\S+)\s*=\s*down$/.exec(line))) w.dbDown[m[1]] = true;
    else if (/^mail\s*=\s*down$/.exec(line)) w.mailDown = true;
  });
  return w;
}

function isVariant(v) { return v !== null && typeof v === 'object' && v.variant !== undefined; }
function isRecord(v) { return v !== null && typeof v === 'object' && v.rec !== undefined; }
function mkVariant(name, enumName, names, vals) {
  var f = {};
  (names || []).forEach(function (n, i) { f[n] = vals[i]; });
  return { variant: name, enumName: enumName, order: names || [], f: f };
}
var DONE = mkVariant('Done', 'Done', [], []);
function copyVal(v, types) {
  if (Array.isArray(v)) return v.map(function (x) { return copyVal(x, types); });
  if (isRecord(v)) {
    if (types[v.rec] && types[v.rec].kind === 'resource') return v;
    var f = {};
    v.order.forEach(function (n) { f[n] = copyVal(v.f[n], types); });
    return { rec: v.rec, order: v.order, f: f };
  }
  return v;
}

function show(v, nested) {
  if (v instanceof Err) return show(v.value, nested);
  if (typeof v === 'string') return nested ? JSON.stringify(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map(function (x) { return show(x, true); }).join(', ') + ']';
  if (v && v.range) return v.range[0] + '..' + v.range[1];
  if (isVariant(v)) return v.order.length ? v.variant + '(' + v.order.map(function (n) { return n + ': ' + show(v.f[n], true); }).join(', ') + ')' : v.variant;
  if (isRecord(v)) return v.rec + ' { ' + v.order.map(function (n) { return n + ': ' + show(v.f[n], true); }).join(', ') + ' }';
  return String(v);
}
function deepEq(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every(function (x, i) { return deepEq(x, b[i]); });
  if (isVariant(a) && isVariant(b)) return a.variant === b.variant && a.order.every(function (n) { return deepEq(a.f[n], b.f[n]); });
  if (isRecord(a) && isRecord(b)) return a.rec === b.rec && a.order.every(function (n) { return deepEq(a.f[n], b.f[n]); });
  return false;
}
function hash(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
}

function execute(info, worldText, proofs, lenient) {
  var world = parseWorld(worldText), out = [], tables = {}, steps = 0, depth = 0;
  var mem = {}, serial = '', stack = [], memOther = 0, screenUsed = false;
  function hw(name, addr, line) {
    if (typeof addr !== 'number') fail(name + ' erwartet eine Zahl als Adresse.', line);
    var f = stack[stack.length - 1];
    var ok = f && f.rights.some(function (d) { return d.name === name && d.lo !== null && d.lo !== undefined && d.lo <= addr && addr <= d.hi; });
    if (!ok) fail(name + '-Zugriff auf ' + hex(addr) + ' liegt außerhalb der Rechte von ' + (f ? f.name : '?') + '. Echtes Latch würde das schon beim Übersetzen beweisen.', line);
  }
  function byte(v, line) { if (typeof v !== 'number' || v < 0 || v > 255) fail('Ein Byte liegt zwischen 0 und 255, vorhanden ist ' + show(v, true) + '.', line); return v; }
  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    return Array.from(text).map(function (c) { return c.charCodeAt(0) & 255; });
  }
  var types = info.types, variants = info.variants, funcs = info.funcs;
  function tick(line) { if (++steps > 200000) throw new RuntimeFail('Abgebrochen nach 200.000 Schritten. Vermutlich endet eine Schleife nie.', line); }
  function fail(msg, line) { throw new RuntimeFail(msg, line); }
  function int(v, line) { if (typeof v !== 'number') fail('Hier wird eine Zahl erwartet, vorhanden ist ' + show(v, true) + '.', line); return v; }
  function safe(v, line) { if (!Number.isSafeInteger(v)) fail('Zahlenüberlauf. Ganze Zahlen laufen in Latch nie still über.', line); return v; }
  function bool(v, line) { if (typeof v !== 'boolean') fail('Hier wird ein Wahrheitswert erwartet, vorhanden ist ' + show(v, true) + '.', line); return v; }

  function lookup(env, name, line) {
    for (var e = env; e; e = e.parent) if (Object.prototype.hasOwnProperty.call(e.vars, name)) return e;
    fail('Der Name ' + name + ' ist nicht bekannt.', line);
  }
  function child(env) { return { vars: {}, parent: env }; }

  function convert(v, typeName, line) {
    if (typeName === 'Text') return typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : null;
    if (typeName === 'Int') {
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && /^\s*-?\d{1,15}\s*$/.test(v)) return parseInt(v, 10);
      return null;
    }
    if (typeName === 'Bool') {
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return null;
    }
    var t = types[typeName];
    var base = convert(v, t.base, line);
    if (base === null) return null;
    if (t.where) {
      var env = { vars: { it: base }, parent: null };
      if (!bool(evalE(t.where, env), t.line)) return null;
    }
    return base;
  }

  function builtin(e, args) {
    var q = e.mod + '.' + e.fn, line = e.line;
    switch (q) {
      case 'Console.print': out.push({ kind: 'out', text: show(args[0]) }); return DONE;
      case 'Input.read': { var k = show(args[0]); return Object.prototype.hasOwnProperty.call(world.input, k) ? world.input[k] : ''; }
      case 'Net.get': { var key = show(args[0]) + show(args[1]); out.push({ kind: 'net', text: 'Abruf ' + key }); return Object.prototype.hasOwnProperty.call(world.net, key) ? world.net[key] : ''; }
      case 'Db.insert': {
        var tn = args[0];
        if (world.dbDown[tn]) return new Err(mkVariant('DbError', 'DbError', [], []));
        (tables[tn] = tables[tn] || []).push(args[1]);
        out.push({ kind: 'db', text: 'Tabelle ' + tn + ': gespeichert ' + show(args[1], true) });
        return tables[tn].length;
      }
      case 'Db.exists': return (tables[args[0]] || []).some(function (r) { return isRecord(r) && deepEq(r.f[show(args[1])], args[2]); });
      case 'Db.count': return (tables[args[0]] || []).length;
      case 'Mail.send':
        if (world.mailDown) return new Err(mkVariant('MailError', 'MailError', [], []));
        out.push({ kind: 'mail', text: 'Mail über ' + args[0] + ' an ' + show(args[1]) + ': ' + show(args[2]) + ' / ' + show(args[3]) });
        return DONE;
      case 'Clock.now': return Math.floor(Date.now() / 1000);
      case 'Random.int': { var a = int(args[0], line), b = int(args[1], line); if (b < a) fail('Random.int: Die Obergrenze liegt unter der Untergrenze.', line); return a + Math.floor(Math.random() * (b - a + 1)); }
      case 'Kem.generate': return 'sk-' + hash(String(Math.random())) + hash(String(Date.now()));
      case 'Crypto.encrypt': return 'enc-' + hash(show(args[0]) + '|' + show(args[1])) + hash(show(args[1]));
      case 'Crypto.public_key': return 'pk-' + hash('pub' + show(args[0]));
      case 'Text.contains': return show(args[0]).indexOf(show(args[1])) >= 0;
      case 'Text.bytes': return utf8(show(args[0]));
      case 'Memory.write':
        hw('Memory', args[0], line);
        mem[args[0]] = byte(args[1], line);
        if (args[0] >= VGA_BASE && args[0] <= VGA_END) screenUsed = true; else memOther++;
        return DONE;
      case 'Memory.read': hw('Memory', args[0], line); return mem[args[0]] || 0;
      case 'Port.write':
        hw('Port', args[0], line);
        byte(args[1], line);
        if (args[0] === 0x3F8) {
          if (args[1] === 10) { out.push({ kind: 'serial', text: serial }); serial = ''; }
          else serial += String.fromCharCode(args[1]);
        }
        else out.push({ kind: 'port', text: 'Port ' + hex(args[0]) + ' <- ' + args[1] });
        return DONE;
      case 'Port.read':
        hw('Port', args[0], line);
        if (world.keys && args[0] === 0x64) return world.keys.length ? '1' : '0';
        if (world.keys && args[0] === 0x60) return world.keys.length ? String(world.keys.shift()) : '0';
        return Object.prototype.hasOwnProperty.call(world.port, args[0]) ? world.port[args[0]] : '0';
      case 'Table.fill': {
        var cnt = int(args[0], line);
        if (cnt < 0 || cnt > 4096) fail('Table.fill: Die Größe liegt zwischen 0 und 4096.', line);
        var tb = [];
        for (var ti = 0; ti < cnt; ti++) tb.push(copyVal(args[1], types));
        return tb;
      }
      case 'List.at': {
        if (!Array.isArray(args[0])) fail('List.at erwartet eine Liste.', line);
        var ix = int(args[1], line);
        return ix >= 0 && ix < args[0].length ? args[0][ix] : new Err(mkVariant('Missing', 'Missing', [], []));
      }
    }
    fail(q + ' ist nicht vorhanden.', line);
  }

  function call(f, args, line) {
    if (++depth > 200) fail('Zu tiefe Verschachtelung von Aufrufen (über 200).', line);
    if (f.assembly) {
      depth--;
      out.push({ kind: 'asm', text: f.name + '(' + args.map(function (a) { return show(a, true); }).join(', ') + ')' });
      return DONE;
    }
    var env = { vars: {}, parent: null };
    f.params.forEach(function (p, i) { env.vars[p.name] = p.mode === 'change' ? args[i] : copyVal(args[i], types); });
    f.requires.forEach(function (c) {
      if (!bool(evalE(c.expr, env), c.line)) fail('Vertrag verletzt: ' + f.name + ' verlangt "' + c.text + '".', line);
    });
    var result = DONE;
    stack.push(f);
    try { execBlock(f.body, env); }
    catch (sig) { if (sig instanceof ReturnSignal) result = sig.value; else throw sig; }
    stack.pop();
    if (!(result instanceof Err) && f.errType && isVariant(result) && result.enumName === f.errType) result = new Err(result);
    if (!(result instanceof Err)) {
      var eenv = { vars: { result: result }, parent: env };
      f.ensures.forEach(function (c) {
        if (!bool(evalE(c.expr, eenv), c.line)) fail('Vertrag verletzt: ' + f.name + ' sichert "' + c.text + '" zu, das Ergebnis ' + show(result, true) + ' erfüllt es nicht.', c.line);
      });
    }
    depth--;
    return result;
  }

  function evalE(e, env) {
    tick(e.line);
    switch (e.k) {
      case 'Num': case 'Bool': return e.v;
      case 'Str': return e.parts.map(function (p) { return p.expr ? show(evalE(p.expr, env)) : p.text; }).join('');
      case 'Var': return lookup(env, e.name, e.line).vars[e.name];
      case 'Field': {
        var o = evalE(e.obj, env);
        if (e.name === 'length' && typeof o === 'string') return Array.from(o).length;
        if (e.name === 'length' && Array.isArray(o)) return o.length;
        if ((isRecord(o) || isVariant(o)) && Object.prototype.hasOwnProperty.call(o.f, e.name)) return o.f[e.name];
        fail('Das Feld ' + e.name + ' gibt es an ' + show(o, true) + ' nicht.', e.line);
        break;
      }
      case 'Index': {
        var iarr = evalE(e.obj, env), iix = evalE(e.idx, env);
        slot(iarr, iix, e.line);
        return iarr[iix];
      }
      case 'Un': {
        var u = evalE(e.e, env);
        if (e.op === 'not') return !bool(u, e.line);
        return safe(-int(u, e.line), e.line);
      }
      case 'Bin': return binary(e, env);
      case 'List': return e.items.map(function (x) { return evalE(x, env); });
      case 'Call': {
        var f = funcs[e.name];
        return call(f, e.args.map(function (a) { return evalE(a, env); }), e.line);
      }
      case 'MCall': return builtin(e, e.args.map(function (a) { return evalE(a, env); }));
      case 'Variant': {
        if (e.name === 'Done') return DONE;
        var vd = variants[e.name];
        return mkVariant(e.name, vd.enumName, vd.fields, e.args.map(function (a) { return evalE(a, env); }));
      }
      case 'Record': {
        var td = types[e.type], f2 = {};
        e.fields.forEach(function (fl) { f2[fl.name] = evalE(fl.expr, env); });
        return { rec: e.type, order: td.fields.map(function (x) { return x.name; }), f: f2 };
      }
      case 'Check': {
        var v = evalE(e.e, env);
        var c = convert(v, e.type, e.line);
        return c === null ? new Err(mkVariant('CheckFailed', 'CheckFailed', [], [])) : c;
      }
      case 'Try': {
        var t = evalE(e.e, env);
        if (t instanceof Err) throw new ReturnSignal(t);
        return t;
      }
      case 'Secret': return evalE(e.e, env);
      case 'Reveal': return evalE(e.e, env);
      case 'Mode': return evalE(e.e, env);
      case 'RegionNew': return evalE(e.e, env);
    }
    fail('Dieser Ausdruck wird nicht unterstützt.', e.line);
  }

  function slot(arr, ix, line) {
    if (!Array.isArray(arr)) fail('Eine Stelle [..] gibt es nur an Tabellen und Listen.', line);
    int(ix, line);
    if (ix < 0 || ix >= arr.length) fail('Stelle ' + ix + ' liegt außerhalb der Tabelle (Größe ' + arr.length + '). Echtes Latch müsste das beweisen, etwa über requires.', line);
  }
  function binary(e, env) {
    var op = e.op, line = e.line;
    if (op === 'and') return bool(evalE(e.l, env), line) && bool(evalE(e.r, env), line);
    if (op === 'or') return bool(evalE(e.l, env), line) || bool(evalE(e.r, env), line);
    var l = evalE(e.l, env), r = evalE(e.r, env);
    switch (op) {
      case '+':
        if (typeof l === 'string' && typeof r === 'string') return l + r;
        return safe(int(l, line) + int(r, line), line);
      case '-': return safe(int(l, line) - int(r, line), line);
      case '*': return safe(int(l, line) * int(r, line), line);
      case '/': if (int(r, line) === 0) fail('Division durch null.', line); return Math.trunc(int(l, line) / r);
      case '%': if (int(r, line) === 0) fail('Division durch null.', line); return int(l, line) % r;
      case '..': return { range: [int(l, line), int(r, line)] };
      case '==': return deepEq(l, r);
      case '!=': return !deepEq(l, r);
      case '<': return int(l, line) < int(r, line);
      case '<=': return int(l, line) <= int(r, line);
      case '>': return int(l, line) > int(r, line);
      case '>=': return int(l, line) >= int(r, line);
      case 'in':
        if (r && r.range) return int(l, line) >= r.range[0] && l <= r.range[1];
        if (Array.isArray(r)) return r.some(function (x) { return deepEq(x, l); });
        fail('Rechts von in steht ein Bereich (a..b) oder eine Liste.', line);
    }
    fail('Unbekannter Operator ' + op + '.', line);
  }

  function execBlock(stmts, env) {
    var local = child(env);
    for (var i = 0; i < stmts.length; i++) exec(stmts[i], local);
  }
  function orElse(v, s, env) {
    if (v instanceof Err) {
      if (s.other) {
        if (s.other.k === 'ret') throw new ReturnSignal(evalE(s.other.e, env));
        var oenv = child(env);
        oenv.vars[s.other.name] = v.value;
        execBlock(s.other.body, oenv);
        fail('Der otherwise-Block endete ohne return.', s.line);
      }
      fail('Unbehandelter Fehler ' + show(v) + '.', s.line);
    }
    return v;
  }
  function exec(s, env) {
    tick(s.line);
    switch (s.k) {
      case 'Let': env.vars[s.name] = copyVal(orElse(evalE(s.e, env), s, env), types); break;
      case 'Assign': lookup(env, s.name, s.line).vars[s.name] = copyVal(evalE(s.e, env), types); break;
      case 'FieldAssign': {
        var target = lookup(env, s.name, s.line).vars[s.name];
        if (!isRecord(target) || !Object.prototype.hasOwnProperty.call(target.f, s.field)) fail(s.name + ' hat kein Feld ' + s.field + '.', s.line);
        target.f[s.field] = copyVal(evalE(s.e, env), types);
        break;
      }
      case 'Store': {
        var arr = lookup(env, s.name, s.line).vars[s.name];
        var six = evalE(s.idx, env);
        slot(arr, six, s.line);
        var sval = copyVal(evalE(s.e, env), types);
        if (s.field) {
          var elem = arr[six];
          if (!isRecord(elem) || !Object.prototype.hasOwnProperty.call(elem.f, s.field)) fail('An dieser Stelle gibt es kein Feld ' + s.field + '.', s.line);
          elem.f[s.field] = sval;
        } else arr[six] = sval;
        break;
      }
      case 'Destroy': break;
      case 'Region': execBlock(s.body, env); break;
      case 'Match': {
        var mv = evalE(s.e, env);
        if (!isVariant(mv)) fail('match erwartet einen Wert einer Aufzählung, vorhanden ist ' + show(mv, true) + '.', s.line);
        var arm = null;
        for (var ai = 0; ai < s.arms.length; ai++) if (s.arms[ai].name === mv.variant) { arm = s.arms[ai]; break; }
        if (!arm) fail('Kein Zweig für ' + mv.variant + '.', s.line);
        var menv = child(env);
        arm.binds.forEach(function (bn, bi) { menv.vars[bn] = mv.f[mv.order[bi]]; });
        execBlock(arm.body, menv);
        break;
      }
      case 'Return': {
        if (!s.e) throw new ReturnSignal(DONE);
        var v = evalE(s.e, env);
        if (s.other) v = orElse(v, s, env);
        throw new ReturnSignal(v);
      }
      case 'If':
        if (bool(evalE(s.cond, env), s.line)) execBlock(s.then, env);
        else if (s.els) execBlock(s.els, env);
        break;
      case 'While': while (bool(evalE(s.cond, env), s.line)) { tick(s.line); execBlock(s.body, env); } break;
      case 'For': {
        var it = evalE(s.e, env), items;
        if (it && it.range) { items = []; if (it.range[1] - it.range[0] > 200000) fail('Der Bereich ist für den Prototyp zu groß.', s.line); for (var n = it.range[0]; n <= it.range[1]; n++) items.push(n); }
        else if (Array.isArray(it)) items = it;
        else fail('for läuft über einen Bereich (a..b) oder eine Liste.', s.line);
        for (var i = 0; i < items.length; i++) { var loop = child(env); loop.vars[s.name] = items[i]; execBlock(s.body, loop); }
        break;
      }
      case 'Expr': orElse(evalE(s.e, env), s, env); break;
    }
  }

  if (proofs) return proofs.map(function (p) {
    var t = types[p.type], why = t.whereText ? ' (' + t.whereText.replace(/\s+/g, ' ') + ')' : '';
    steps = 0; depth = 0;
    try {
      if (convert(p.v, p.type, p.line) !== null) return null;
      return { line: p.line, msg: show(p.v, true) + ' erfüllt die Einschränkung von ' + p.type + ' nicht' + why + '. Den Wert anpassen.' };
    } catch (ex) {
      if (lenient) return null;
      if (ex instanceof RuntimeFail) return { line: p.line, msg: 'Ob ' + show(p.v, true) + ' ein ' + p.type + ' ist, lässt sich nicht ausrechnen: ' + ex.message };
      if (ex instanceof RangeError) return { line: p.line, msg: 'Ob ' + show(p.v, true) + ' ein ' + p.type + ' ist, lässt sich nicht ausrechnen: zu tiefe Verschachtelung.' };
      throw ex;
    }
  }).filter(Boolean);
  var res = { output: out, runtimeError: null, mainResult: null, mainFailed: false, screen: null };
  try {
    var r = call(funcs.main, [], funcs.main.line);
    if (r instanceof Err) { res.mainFailed = true; res.mainResult = show(r.value, true); }
    else if (r !== DONE) res.mainResult = show(r, true);
  } catch (ex) {
    if (ex instanceof RuntimeFail) res.runtimeError = { line: ex.line, msg: ex.message };
    else if (ex instanceof RangeError) res.runtimeError = { line: 0, msg: 'Zu tiefe Verschachtelung von Aufrufen.' };
    else throw ex;
  }
  if (serial) out.push({ kind: 'serial', text: serial });
  if (memOther) out.push({ kind: 'mem', text: memOther + (memOther === 1 ? ' Byte' : ' Bytes') + ' außerhalb des Bildschirmspeichers geschrieben' });
  if (screenUsed) {
    var rows = [];
    for (var r = 0; r < VGA_ROWS; r++) {
      var row = '';
      for (var c = 0; c < VGA_COLS; c++) {
        var ch = mem[VGA_BASE + (r * VGA_COLS + c) * 2] || 0;
        row += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : (ch === 0 ? ' ' : '\u00b7');
      }
      rows.push(row.replace(/\s+$/, ''));
    }
    while (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
    res.screen = rows;
  }
  return res;
}

function run(src, worldText) {
  var result = { errors: [], warnings: [], report: null, output: [], runtimeError: null, mainResult: null, mainFailed: false, ran: false, screen: null };
  var prog;
  try { prog = new Parser(lex(src), src).parseProgram(); }
  catch (ex) {
    if (ex instanceof LatchError) { result.errors.push({ line: ex.line, msg: ex.message }); return result; }
    throw ex;
  }
  var info = checkProgram(prog);
  result.errors = info.errors;
  result.warnings = info.warnings;
  result.report = info.report;
  if (info.errors.length) return result;
  var ex2 = execute(info, worldText);
  result.ran = true;
  result.output = ex2.output;
  result.runtimeError = ex2.runtimeError;
  result.mainResult = ex2.mainResult;
  result.mainFailed = ex2.mainFailed;
  result.screen = ex2.screen;
  return result;
}

root.Latch = { run: run };
})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
