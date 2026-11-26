# Latch: Sprachregeln (Kurzfassung, Stand 26.11.2026)

Die ausführliche Fassung mit Begründungen ist das Dokument "Latch – Sprachbeschreibung".
Diese Datei hält nur fest, was entschieden ist. Neue Wörter oder Regeln entscheidet der Autor.

## Leitgedanken

- Code wird künftig von KI geschrieben. Menschen lesen nur noch den Funktionskopf und den Bericht.
- Verantworten lässt sich nur, was bewiesen oder offen als Annahme benannt ist.
- Der Betriebssystemkern wird in Latch geschrieben. Diese Vorgabe hat Vorrang.

## Entwurfsregeln

1. Wörter für Bedeutung, Zeichen für Struktur.
2. Englische Schlüsselwörter. Satzartigkeit ist kein Kriterium.
3. Ein Weg pro Sache (bewusste Ausnahme: `try`). Ein Wort, eine Bedeutung.
4. Versionszeile `latch 1` in jeder Datei.
5. Aufrufe immer mit Klammern, Blöcke immer mit `{ }`.
6. `let` ist unveränderlich, `var` veränderlich.
7. Keine Magie: Aufrufe nennen ihr Modul (`Net.get`), keine Makros, kein Überladen, keine stillen Umwandlungen.
8. Grammatik ohne Typwissen lesbar.
9. Ein eingebauter Formatierer legt die einzige Schreibweise fest.
10. Nur ASCII außerhalb von Texten.
11. Wörter großzügig reservieren.

## Funktionskopf

Feste Reihenfolge: Parameter, `->`, `uses`, `requires`, `ensures`, `assumes`.

    function store(s: Signup)
        -> Id fails SignupError
        uses Db("accounts")
        requires ...
        ensures ...
        assumes "..."

- `-> T fails E`: Ergebnis und Fehlertyp. `or`, `and`, `not` stehen nur für Logik.
- `uses`: alle Rechte der Funktion und der von ihr aufgerufenen Funktionen. Ohne `uses` ist eine Funktion rein.
- Hardware sind Rechte: `Memory(0xB8000..0xB8F9F)`, `Port(0x3F8)`, `Cpu`. Es gibt kein `unsafe`.
- Aufrufer brauchen mindestens den Bereich der aufgerufenen Funktion.
- `requires` / `ensures`: Verträge. Unbewiesenes läuft nicht, es gibt keine Laufzeitprüfung als Ausweg.
- `assumes "..."`: was sich grundsätzlich nicht beweisen lässt. Ein Mensch steht dafür ein.
- Öffentliche Funktionen brauchen einen Vertrag.
- `assembly function name(...) uses Cpu assumes "..."`: kein Latch-Rumpf, im Bericht als ungeprüft.

## Daten

- `type Age = Int where it in 0..150`: Einschränkung mit `where`, `it` ist der Wert.
- `type Signup = { name: Name, ... }`, `enum E { A, B(field: Text) }`.
- Kein `null`. Fehlendes steht im Kopf: `-> Account fails Missing`.
- `unchecked`: alles von außen. Kein Rechnen, Vergleichen, Speichern, Senden. Ausweg nur `check x as T`.
- `secret`: keine Ausgabe, kein Vergleich, kein Einsetzen in Text, keine Verzweigung, keine Tabellenstelle.
  Ausweg nur über die Kryptobibliothek oder `reveal x because "Grund"`.
- Ganze Zahlen laufen nie still über. Text ist UTF-8.
- `Table<Task, 8>`: feste Größe, `t[i]` liest, `t[i] = v` und `t[i].feld = v` schreiben. Der Compiler beweist die Grenze.

## Fehler

- Fehler sind Werte. Jeder Fehlerfall wird behandelt.
- `x otherwise return wert`
- `x otherwise as e { ...; return ... }` bindet den Fehlerwert, der Block endet mit `return`.
- `try x` gibt den Fehler unverändert weiter, nur bei gleichem Fehlertyp.
- `else` ist nur der zweite Zweig von `if`.
- `match` deckt jede Variante ab.

## Speicher

Keine Speicherbereinigung, keine Laufzeitumgebung. Lineare Typen und Regionen.

- `resource Page { ... }`: genau einmal vorhanden, genau einmal verbraucht.
- Parameter: ohne Wort lesen, `change` verändern, `take` übernehmen. Dieselben Wörter stehen beim Aufruf.
- `change` verlangt eine `var`-Variable.
- Eine Ressource endet durch `take`, `return` oder `destroy name` (später nur im definierenden Modul).
- `return`, `try`, `otherwise return` sind verboten, solange eine unverbrauchte Ressource lebt.
- `region r { ... r.new(wert) ... }`: nichts aus der Region verlässt den Block.
- Geliehene Werte lassen sich nicht aufbewahren. Keine Lebenszeit-Angaben.

## Gleichzeitigkeit

`together` verlangt `uses Tasks`. Der Kern stellt das Recht bereit und kann es selbst nicht benutzen.
Jede Zeile im Block läuft gleichzeitig, danach stehen die Namen zur Verfügung. Tupel gibt es nicht.

    together {
        let a = weather(berlin)
        let b = weather(dresden)
    }

## Aufbau

- Module: Jede Datei ist ein Modul. Alles ist privat, sichtbar ist nur `public`.
- Namen: Typen, Varianten, Module groß; Variablen, Funktionen, Felder klein. Der Compiler erzwingt das.
- Generische Typen: nur die eingebauten (`List<T>`, `Map<K, V>`, `Table<T, n>`). Keine eigenen.
- Fremder Code: `foreign function name(...) uses ... assumes "..."` ohne Rumpf, im Bericht als ungeprüft.
- Katalog der Rechte ist fest: `Net`, `File`, `Clock`, `Random`, `Env`, `Process`, `Console`, `Memory`,
  `Port`, `Cpu`, `Tasks`, `Interrupt`. Pakete definieren keine eigenen Rechte.
  `Db` und `Input` im Prüfstand sind Platzhalter.
- Programmstart: Die Rechte von `main` sind die Obergrenze. Das Programm meldet sie beim Start an das
  Betriebssystem (OpenBSD: pledge/unveil; eigenes OS: direkt), als zweites Netz neben dem Compiler.
- Typisierte Texte, fester Satz: `sql"..."`, `html"..."`, `shell"..."`, `url"..."`, `path"..."`.
- `const NAME = wert` auf Modulebene, `test "name" { ... }` neben dem Code,
  `satz with { feld: wert }` für geänderte Kopien. (Von Claude ergänzt, Einspruch des Autors möglich.)

## Zahlen und Bits

- Es gibt nur `Int`. Der Bereich aus `where` bestimmt die Speichergröße:
  `type Byte = Int where it in 0..255`. Keine Typen wie U8 oder U32.
- Bit-Operationen über die Bibliothek `Bits`: `Bits.and(a, b)`, `Bits.or`, `Bits.xor`,
  `Bits.shift_left(a, n)`, `Bits.shift_right`, `Bits.test(a, bit)`. Keine eigenen Zeichen oder Wörter.

## Unterbrechungen

    function on_key()
        handles Interrupt(33)
        uses Port(0x60)

Reihenfolge im Kopf damit: Parameter, `->`, `handles`, `uses`, `requires`, `ensures`, `assumes`.

## Beweise

- `old(x)` in `ensures`: Wert vor dem Aufruf. `ensures pool.free == old(pool.free) - 1`
- `for` endet immer. `while` nennt `invariant` (gilt in jedem Durchlauf) und `decreases` (warum sie endet):

      while i < n
          invariant total >= 0
          decreases n - i
      { ... }

- `forever { ... }` ist die gewollte Endlosschleife und steht im Bericht.
- `if`/`else`, `for x in ...`, `while`, `match` sind endgültig.

## Gehärtete Daten

`hardened` ist eine Markierung wie `secret`: Der Compiler hält den Wert dreifach und lässt abstimmen.
Gebaut wird das nach dem ersten Compiler.

## Bericht

Der Compiler erzeugt je Programm: Rechte, Verträge, Annahmen, Freigaben, Unterbrechungen,
Endlosschleifen sowie Assembler- und Fremdfunktionen.

## Offen

Nur noch die Prüfung des Namens "Latch" gegen Marken und Domains.

Verwandtes Projekt: Vow (github.com/vow-lang/vow), verifizierte Sprache für KI-Agenten.
