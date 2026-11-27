# Latch

Eine Programmiersprache, in der Code nur darf, was seine Signatur erlaubt, und in der
ungeprüfte Daten nichts auslösen können. Gedacht für KI-geschriebenen Code, den Menschen
voreinander verantworten müssen, bis hinunter zum Betriebssystemkern.

Stand: Prototyp 0.9. Ein Interpreter mit statischem Prüfer läuft im Browser ("Latch Prüfstand").
Der Compiler übersetzt nach C. Der Kern aus `kernel/` startet damit in QEMU, mit echter Uhr und Tastatur.

    node tests/run.js        # 180 Testprogramme
    node tests/examples.js   # alle Beispiele der Seite
    python3 build.py         # baut site/index.html
    node tests/compile.js    # Compiler: Prüfstand gegen QEMU (braucht gcc, ld, qemu-system-i386)
    node tools/compile.js kernel/main.latch kernel build # baut build/kernel.elf
    qemu-system-i386 -kernel build/kernel.elf            # startet ihn
    node tools/report.js kernel/main.latch "Latch OS, Kern" > kernel/REPORT.md

- `kernel/` ist der Anfang von Latch OS: Bildschirm, Tastatur, Seitenverwalter und Planer als Module,
  verbunden in `main.latch`. Er läuft im Prüfstand und übersetzt in QEMU. `kernel/REPORT.md` ist sein Bericht:
  was der Kern darf, was er verspricht und wofür ein Mensch einsteht.
- `boot/main.latch` ist ein kleinerer Kern ohne Unterbrechungen: Er schreibt "Latch OS" über das Modul `Screen`
  in den echten Bildschirmspeicher.
- `SPEC.md` fasst die entschiedenen Sprachregeln zusammen.
- `CLAUDE.md` beschreibt Arbeitsweise und nächste Aufgaben.
