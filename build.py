#!/usr/bin/env python3
"""Baut site/index.html: setzt src/latch.js in src/ui.html ein."""
from pathlib import Path

root = Path(__file__).parent
js = (root / "src" / "latch.js").read_text(encoding="utf-8")
ui = (root / "src" / "ui.html").read_text(encoding="utf-8")
assert "</script" not in js, "latch.js darf kein </script enthalten"
assert ui.count("/*__LATCH__*/") == 1
out = root / "site" / "index.html"
out.parent.mkdir(exist_ok=True)
out.write_text(ui.replace("/*__LATCH__*/", js), encoding="utf-8")
print("geschrieben:", out, len(js) + len(ui), "Zeichen")
