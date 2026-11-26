#!/usr/bin/env python3
"""Baut site/index.html: setzt src/latch.js und die Dateien aus kernel/ in src/ui.html ein."""
import json
from pathlib import Path

root = Path(__file__).parent
js = (root / "src" / "latch.js").read_text(encoding="utf-8")
ui = (root / "src" / "ui.html").read_text(encoding="utf-8")
assert "</script" not in js, "latch.js darf kein </script enthalten"
assert ui.count("/*__LATCH__*/") == 1
assert ui.count("/*__KERNEL__*/") == 1
files = {f.stem: f.read_text(encoding="utf-8").rstrip("\n") for f in sorted((root / "kernel").glob("*.latch"))}
kernel = json.dumps({"main": files.pop("main"), "modules": files}, ensure_ascii=False)
assert "</script" not in kernel
ui = ui.replace("/*__KERNEL__*/", kernel)
out = root / "site" / "index.html"
out.parent.mkdir(exist_ok=True)
out.write_text(ui.replace("/*__LATCH__*/", js), encoding="utf-8")
print("geschrieben:", out, len(js) + len(ui), "Zeichen")
