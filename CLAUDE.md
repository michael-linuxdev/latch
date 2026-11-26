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
- `build.py`: erzeugt `site/index.html`, setzt dabei `src/latch.js` und die Dateien aus `kernel/` ein.
- `tests/run.js`: Testprogramme mit erwartetem Ergebnis. `tests/examples.js`: lässt alle Beispiele laufen.

## Regeln für die Arbeit

- Vor jedem Commit: `node tests/run.js` und `node tests/examples.js` müssen durchlaufen.
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
- Assembler wird nicht ausgeführt, Hardware ist nachgebaut (VGA-Text ab 0xB8000, COM1 0x3F8, PS/2 0x60/0x64).
- `List.at` und `Table.fill` sind vorläufige Bibliotheksnamen.

## Nächste Aufgaben, in dieser Reihenfolge

1. Erledigt: Typprüfung im Prüfer (Parameter, Rückgaben, Felder, Varianten, Fehlertypen, eingeschränkte
   Typen nur über `check` oder einen festen Wert, Großschreibung). Die Regeln stehen in `SPEC.md` unter "Typprüfung".
2. Erledigt: Module mit `public` und `import`, `together`, `foreign function`, `handles Interrupt(n)`, `const`,
   `test`, `with`, `forever`, `old`, `invariant`, `decreases`, die Bibliothek `Bits`, der feste Katalog der
   Rechte. Die Einzelheiten stehen in `SPEC.md` unter "Einzelheiten der Sprachteile".
3. Erledigt: `kernel/` verbindet Bildschirm, Tastatur, Seitenverwalter und Planer als Module zu einem Programm.
   `main.latch` hält den Zustand und holt Ereignisse in `forever` mit `Interrupt.wait()` ab.
4. Compiler. Vorschlag als erster Schritt: Latch nach freistehendem C übersetzen, mit einem kleinen
   Startcode als Multiboot-Kern in QEMU starten und "Latch OS" auf den echten VGA-Textspeicher schreiben.
   Vorher mit dem Autor klären, ob C als Zwischenschritt in Ordnung ist oder direkt Maschinencode gewünscht ist.
5. Vertragsbeweis über einen SMT-Löser (zum Beispiel Z3) mit `old`, `invariant` und `decreases`.
   Erst damit gilt "Unbewiesenes läuft nicht". Tabellengrenzen und Hardware-Adressen gehören dazu.
6. Bericht als eigenes Dokument ausgeben.
7. `hardened` erst nach dem ersten Compiler.
