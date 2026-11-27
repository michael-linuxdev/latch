# Bericht: Latch OS, Kern

Erzeugt vom Latch-Prüfstand 0.9 aus dem Quelltext. Der Bericht sagt, was das Programm darf,
was es verspricht und wofür ein Mensch einstehen muss.

## Ergebnis der Prüfung

**Angenommen.** Geprüft sind Rechte, Typen, ungeprüfte Daten, Geheimnisse, Fehlerfälle und Ressourcen.

Nicht bewiesen: Verträge (`requires`, `ensures`, `invariant`, `decreases`), Tabellengrenzen und berechnete
Hardware-Adressen. Der Prüfstand prüft sie erst beim Ausführen.

## Das Programm darf

- `Memory(0xB8000..0xB8F9F)`
- `Port(0x60)`
- `Port(0x3F8)`
- `Cpu`
- `Interrupt`

## Annahmen

Was sich nicht beweisen lässt. Dafür steht ein Mensch ein.

- `Screen.put`: "VGA text buffer at 0xB8000"
- `Keyboard.read_scan`: "PS/2 data port at 0x60"
- `Sched.switch_to`: "saves and loads all registers"
- `log`: "COM1 serial port at 0x3F8"

## Ungeprüfter Code

Assembler und fremder Code. Niemand prüft den Inhalt, es gelten nur Kopf und Annahmen.

- `Sched.switch_to` (Assembler), Rechte: `Cpu`

## Freigaben von Geheimnissen

Keine.

## Unterbrechungen

- `Interrupt(33)` ruft `on_key`, gemeldet wird `Event`
- `Interrupt(32)` ruft `on_tick`, gemeldet wird `Event`

## Endlosschleifen

- `main`, Zeile 98

## Module

- `Screen`
- `Keyboard`
- `Pages`
- `Sched`

## Funktionen

### Screen.start (öffentlich)

- Rechte: keine, die Funktion ist rein
- sichert zu: `result.row == 0`
- sichert zu: `result.col == 0`

### Screen.clear (öffentlich)

- Rechte: `Memory(0xB8000..0xB8F9F)`
- sichert zu: `result.row == 0`
- sichert zu: `result.col == 0`

### Screen.cell

- Rechte: keine, die Funktion ist rein
- verlangt: `cur.row in 0..HEIGHT - 1`
- verlangt: `cur.col in 0..WIDTH - 1`

### Screen.newline (öffentlich)

- Rechte: keine, die Funktion ist rein
- verändert: `cur: Screen.Cursor`
- sichert zu: `cur.col == 0`

### Screen.put (öffentlich)

- Rechte: `Memory(0xB8000..0xB8F9F)`
- verändert: `cur: Screen.Cursor`
- verlangt: `ch in 0..255`
- sichert zu: `cur.col in 0..WIDTH - 1`
- nimmt an: "VGA text buffer at 0xB8000"

### Screen.print (öffentlich)

- Rechte: `Memory(0xB8000..0xB8F9F)`
- verändert: `cur: Screen.Cursor`
- sichert zu: `cur.row in 0..HEIGHT - 1`

### Keyboard.read_scan (öffentlich)

- Rechte: `Port(0x60)`
- sichert zu: `result in 0..255`
- nimmt an: "PS/2 data port at 0x60"

### Keyboard.pick

- Rechte: keine, die Funktion ist rein

### Keyboard.decode (öffentlich)

- Rechte: keine, die Funktion ist rein
- sichert zu: `result in 0..127`

### Pages.pool (öffentlich)

- Rechte: keine, die Funktion ist rein
- verlangt: `frames >= 0`
- sichert zu: `result.free == frames`

### Pages.alloc (öffentlich)

- Rechte: keine, die Funktion ist rein
- verändert: `pool: Pages.Pool`
- sichert zu: `pool.free == old(pool.free) - 1`

### Pages.free (öffentlich)

- Rechte: keine, die Funktion ist rein
- verändert: `pool: Pages.Pool`
- übernimmt: `page: Pages.Page`
- sichert zu: `pool.free == old(pool.free) + 1`

### Sched.switch_to (Assembler)

- Rechte: `Cpu`
- nimmt an: "saves and loads all registers"

### Sched.task (öffentlich)

- Rechte: keine, die Funktion ist rein
- verlangt: `left > 0`
- sichert zu: `result.left == left`

### Sched.pick (öffentlich)

- Rechte: keine, die Funktion ist rein
- verlangt: `last in 0..2`
- sichert zu: `result in -1..2`

### Sched.step (öffentlich)

- Rechte: `Cpu`
- verändert: `tasks: Table<Sched.Task, 3>`
- verlangt: `i in 0..2`
- verlangt: `tasks[i].left > 0`
- sichert zu: `tasks[i].left == old(tasks[i].left) - 1`

### on_key (behandelt Interrupt(33))

- Rechte: `Port(0x60)`

### on_tick (behandelt Interrupt(32))

- Rechte: keine, die Funktion ist rein

### log

- Rechte: `Port(0x3F8)`
- nimmt an: "COM1 serial port at 0x3F8"

### slice

- Rechte: `Port(0x3F8)`, `Cpu`
- verändert: `tasks: Table<Sched.Task, 3>`
- verändert: `pool: Pages.Pool`
- verlangt: `last in 0..2`
- sichert zu: `result in 0..2`
- sichert zu: `pool.free == old(pool.free)`

### type_key

- Rechte: `Memory(0xB8000..0xB8F9F)`
- verändert: `cur: Screen.Cursor`

### main (endet nie)

- Rechte: `Memory(0xB8000..0xB8F9F)`, `Port(0x60)`, `Port(0x3F8)`, `Cpu`, `Interrupt`

## Tests

- Screen: "erste Zelle", bestanden
- Screen: "letzte Zelle", bestanden
- Screen: "Zeilenende springt um", bestanden
- Keyboard: "a", bestanden
- Keyboard: "Leertaste", bestanden
- Keyboard: "losgelassen zaehlt nicht", bestanden
- Pages: "holen und zurueckgeben", bestanden
- Pages: "leer heisst leer", bestanden
- Sched: "reihum", bestanden
