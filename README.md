# Latch

Eine Programmiersprache, in der Code nur darf, was seine Signatur erlaubt, und in der
ungeprüfte Daten nichts auslösen können. Gedacht für KI-geschriebenen Code, den Menschen
voreinander verantworten müssen, bis hinunter zum Betriebssystemkern.

Stand: Prototyp 0.9. Ein Interpreter mit statischem Prüfer läuft im Browser ("Latch Prüfstand").
Einen Compiler gibt es noch nicht.

    node tests/run.js        # 175 Testprogramme
    node tests/examples.js   # alle Beispiele der Seite
    python3 build.py         # baut site/index.html

- `kernel/` ist der Anfang von Latch OS: Bildschirm, Tastatur, Seitenverwalter und Planer als Module,
  verbunden in `main.latch`. Er läuft bisher nur im Prüfstand.
- `SPEC.md` fasst die entschiedenen Sprachregeln zusammen.
- `CLAUDE.md` beschreibt Arbeitsweise und nächste Aufgaben.
