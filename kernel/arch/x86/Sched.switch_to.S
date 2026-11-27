/* Inhalt der assembly-Funktion Sched.switch_to(id: Int).
   Niemand prueft diese Datei. Es gilt die Annahme aus dem Kopf in Sched.latch:
   "saves and loads all registers".

   Stand: Die Aufgaben des Planers sind bisher nur Eintraege in einer Tabelle, sie haben
   keinen eigenen Stapel und keine eigenen Register. Der Wechsel hat deshalb noch nichts
   zu sichern und kehrt sofort zurueck. Sobald Aufgaben eigenen Code ausfuehren, steht
   hier das Sichern und Laden der Register. */
    .text
    .global A_Sched_switch_to
A_Sched_switch_to:
    ret
