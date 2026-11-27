# Arbeitsanweisung für Claude Code

## Projekt

Latch ist eine eigene Programmiersprache samt geplantem Betriebssystem. `SPEC.md` enthält die
entschiedenen Regeln. Der Autor entscheidet jede Sprachfrage selbst: Führe kein neues Schlüsselwort
und keine neue Regel ein, ohne nachzufragen. Schlage vor, begründe kurz, warte auf die Entscheidung.

## Aufbau

- `src/latch.js`: Lexer, Parser, statischer Prüfer (Rechte, Markierungen, Ressourcen, Typen), Interpreter,
  Bericht. Eine Datei, keine Abhängigkeiten.
- `src/ui.html`: Oberfläche des Prüfstands mit den Beispielen. `/*__LATCH__*/` wird beim Bauen ersetzt.
  Ein Beispiel kann weitere Dateien mitbringen: `modules: { Screen: '...' }`.
- `Latch.run(quelltext, aussenwelt, module)`: `module` ist `{ Modulname: Quelltext }`. Importierte Namen
  heißen intern `Screen.put`, danach arbeiten Prüfer und Interpreter auf einem einzigen Programm.
- `kernel/`: der Kern als Module, `main.latch` ist der Einstieg. Zeilen höchstens rund 40 Zeichen.
- `src/compile_c.js`: Compiler. Übersetzt nach freistehendem C, was von `main` und den Funktionen mit `handles`
  aus erreichbar ist. `tools/compile.js` baut daraus mit gcc und ld einen Multiboot-Kern.
  Der Inhalt von assembly-Funktionen liegt in `kernel/arch/x86/<Modul>.<name>.S`. `boot/main.latch` ist ein
  kleinerer Kern ohne Unterbrechungen.
- `tests/compile.js`: übersetzt, startet in QEMU und vergleicht Bildschirm und serielle Ausgabe mit dem Prüfstand.
- `build.py`: erzeugt `site/index.html`, setzt dabei `src/latch.js` und die Dateien aus `kernel/` ein.
- `tests/run.js`: Testprogramme mit erwartetem Ergebnis. `tests/examples.js`: lässt alle Beispiele laufen.

## Regeln für die Arbeit

- Vor jedem Commit: `node tests/run.js` und `node tests/examples.js` müssen durchlaufen.
- Nach Änderungen am Compiler oder am Kern: `node tests/compile.js`. Ohne gcc, ld und
  qemu-system-i386 prüft der Test nur das Übersetzen nach C und sagt das.
- Nach jeder Änderung am Kern oder am Bericht: `kernel/REPORT.md` neu erzeugen (Befehl in `README.md`).
  Ein Test vergleicht die Datei mit dem aktuellen Stand. So zeigt jeder Unterschied im Bericht, was sich an
  Rechten, Verträgen und Annahmen geändert hat.
- Jede Sprachänderung bekommt einen Test, einen Eintrag in `SPEC.md` und, wenn sinnvoll, ein Beispiel.
- Fehlermeldungen sind deutsch, nennen die Zeile und sagen, wie man den Fehler behebt.
- Beispiele auf der Seite haben höchstens rund 40 Zeichen pro Zeile (Handy).
- Sag ehrlich, was nur simuliert oder nur zur Laufzeit geprüft wird. Die Seite hat dafür den Abschnitt
  "Was der Prototyp kann".

## Bekannte Lücken des Prototyps

- Typprüfung: Der einzige Beweis für eingeschränkte Typen ist das Nachrechnen fester Werte. Tabellengrößen
  werden nur verglichen, wenn sie als feste Zahl dastehen. `Map<K, V>` ist nur als Typ bekannt.
  `secret` und `unchecked` an Feldern werden gelesen, aber nicht ausgewertet. Typisierte Texte fehlen.
- Verträge, Tabellengrenzen und berechnete Hardware-Adressen werden zur Laufzeit geprüft, nicht bewiesen.
  Das widerspricht der Regel "Unbewiesenes läuft nicht" und ist nur im Prototyp so.
- Ressourcen können nicht in Feldern, Listen, Tabellen oder Varianten stehen. Im Kern bekommt deshalb jede
  Zeitscheibe ihre Seite und gibt sie gleich zurück, statt dass eine Aufgabe ihre Seiten behält.
- `invariant`, `decreases` und `old` werden wie alle Verträge nur zur Laufzeit geprüft.
- `forever` hält der Prüfstand an (100 Durchläufe, oder `Interrupt.wait()` bekommt nichts mehr). Unterbrechungen
  kommen nur zu Beginn eines Durchlaufs und in `Interrupt.wait()` an, nie mitten in einer Funktion. `together` läuft nacheinander. `foreign`-Ergebnisse kommen aus der Außenwelt.
- `hardened`, `break`, `continue`, `module` und `async` sind nur reserviert. Typisierte Texte fehlen.
- Rechte nehmen nur feste Zahlen und Texte, keine Konstanten: `uses Memory(0xB8000..0xB8F9F)`.
- Wer ein Modul mit Fehlern beim Verbinden importiert (unbekannter oder privater Name), sieht nur diese Fehler.
  Die übrige Prüfung läuft erst danach.
- Im Prüfstand wird Assembler nicht ausgeführt und Hardware ist nachgebaut (VGA-Text ab 0xB8000, COM1 0x3F8,
  PS/2 0x60/0x64). Der übersetzte Kern nutzt in QEMU die echten Adressen.
- `List.at` und `Table.fill` sind vorläufige Bibliotheksnamen.

## Nächste Aufgaben, in dieser Reihenfolge

1. Erledigt: Typprüfung im Prüfer (Parameter, Rückgaben, Felder, Varianten, Fehlertypen, eingeschränkte
   Typen nur über `check` oder einen festen Wert, Großschreibung). Die Regeln stehen in `SPEC.md` unter "Typprüfung".
2. Erledigt: Module mit `public` und `import`, `together`, `foreign function`, `handles Interrupt(n)`, `const`,
   `test`, `with`, `forever`, `old`, `invariant`, `decreases`, die Bibliothek `Bits`, der feste Katalog der
   Rechte. Die Einzelheiten stehen in `SPEC.md` unter "Einzelheiten der Sprachteile".
3. Erledigt: `kernel/` verbindet Bildschirm, Tastatur, Seitenverwalter und Planer als Module zu einem Programm.
   `main.latch` hält den Zustand und holt Ereignisse in `forever` mit `Interrupt.wait()` ab.
4. Compiler, läuft: Latch nach freistehendem C (entschieden, steht in `SPEC.md`), daraus ein Multiboot-Kern.
   Der volle Kern aus `kernel/main.latch` startet in QEMU mit echter Uhr (Interrupt 32) und echter Tastatur
   (Interrupt 33). `tests/compile.js` vergleicht Bildschirm und serielle Ausgabe mit dem Prüfstand.
   Offen im Compiler:
   - `together`, `region`, `foreign`, `secret`, `hardened`, Texte verbinden mit `+`, Text in Zahl umwandeln
     (`check text as Int`), Listen ohne feste Größe (`List<T>` als Parameter), Vergleich von Texten und Datensätzen.
     Er lehnt das mit Zeile ab.
   - Eingesetzte Texte (`"{wert}"`) gehen nur direkt als Argument an Funktionen ohne `change`-Parameter, die
     nichts oder eine Zahl zurückgeben. Ihr Speicher liegt in der aufrufenden Funktion, höchstens 256 Bytes.
     Mehr braucht Regionen im Compiler.
   - Verträge, Tabellengrenzen und berechnete Adressen prüft der übersetzte Kern zur Laufzeit und hält bei einer
     Verletzung an (Meldung auf COM1). Bewiesen ist nichts, das ist Aufgabe 5.
   - Es entsteht 32-Bit-Code für x86. `Int` hat 64 Bit, der Prüfstand rechnet nur bis 2^53.
   - `kernel/arch/x86/Sched.switch_to.S` ist der Inhalt der assembly-Funktion und tut noch nichts: Aufgaben
     haben keinen eigenen Stapel. Tests (`test`) übersetzt der Compiler nicht, sie laufen im Prüfstand.
   - Nächste Schritte: echte Aufgaben mit eigenem Stapel, Speicherverwaltung mit Seitentabellen, 64 Bit.
5. Vertragsbeweis über einen SMT-Löser (zum Beispiel Z3) mit `old`, `invariant` und `decreases`.
   Erst damit gilt "Unbewiesenes läuft nicht". Tabellengrenzen und Hardware-Adressen gehören dazu.
6. Erledigt: `Latch.reportDocument(ergebnis, titel)` gibt den Bericht als Text aus, `tools/report.js` schreibt ihn
   für eine Datei samt Modulen, die Seite speichert ihn als Datei.
7. `hardened` erst nach dem ersten Compiler.
