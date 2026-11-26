# Arbeitsanweisung für Claude Code

## Projekt

Latch ist eine eigene Programmiersprache samt geplantem Betriebssystem. `SPEC.md` enthält die
entschiedenen Regeln. Der Autor entscheidet jede Sprachfrage selbst: Führe kein neues Schlüsselwort
und keine neue Regel ein, ohne nachzufragen. Schlage vor, begründe kurz, warte auf die Entscheidung.

## Aufbau

- `src/latch.js`: Lexer, Parser, statischer Prüfer (Rechte, Markierungen, Ressourcen, Typen), Interpreter,
  Bericht. Eine Datei, keine Abhängigkeiten.
- `src/ui.html`: Oberfläche des Prüfstands mit den Beispielen. `/*__LATCH__*/` wird beim Bauen ersetzt.
- `build.py`: erzeugt `site/index.html`.
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
- Ressourcen können nicht in Feldern, Listen, Tabellen oder Varianten stehen.
- Viele entschiedene Wörter sind nur reserviert und noch ohne Funktion (Aufgabe 2).
- Assembler wird nicht ausgeführt, Hardware ist nachgebaut (VGA-Text ab 0xB8000, COM1 0x3F8, PS/2 0x60/0x64).
- `List.at` und `Table.fill` sind vorläufige Bibliotheksnamen.

## Nächste Aufgaben, in dieser Reihenfolge

1. Erledigt: Typprüfung im Prüfer (Parameter, Rückgaben, Felder, Varianten, Fehlertypen, eingeschränkte
   Typen nur über `check` oder einen festen Wert, Großschreibung). Sieben Vorschläge dazu stehen in `SPEC.md`
   unter "Typprüfung" und warten auf die Entscheidung des Autors.
2. Entschiedene Sprachteile, die der Prüfstand nur reserviert hat (siehe `SPEC.md`): Module mit `public`
   und `import`, `together` mit `uses Tasks`, `foreign function`, `handles Interrupt(n)`, `const`, `test`,
   `with`, `forever`, `old`, `invariant`, `decreases`, die Bibliothek `Bits`, der feste Katalog der Rechte
   (`Db` und `Input` in den Beispielen ersetzen).
3. Die vier Kern-Bausteine (Bildschirm, Tastatur, Seitenverwalter, Planer) zu einem Programm verbinden,
   mit `forever` als Hauptschleife.
4. Compiler. Vorschlag als erster Schritt: Latch nach freistehendem C übersetzen, mit einem kleinen
   Startcode als Multiboot-Kern in QEMU starten und "Latch OS" auf den echten VGA-Textspeicher schreiben.
   Vorher mit dem Autor klären, ob C als Zwischenschritt in Ordnung ist oder direkt Maschinencode gewünscht ist.
5. Vertragsbeweis über einen SMT-Löser (zum Beispiel Z3) mit `old`, `invariant` und `decreases`.
   Erst damit gilt "Unbewiesenes läuft nicht". Tabellengrenzen und Hardware-Adressen gehören dazu.
6. Bericht als eigenes Dokument ausgeben.
7. `hardened` erst nach dem ersten Compiler.
