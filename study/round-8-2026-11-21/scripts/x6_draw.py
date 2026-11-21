"""The cost of the shared-text proof rule (X6; pre-registration, section 5, measure h): count the shared-text claims the
rule moved to suggestions in the main run, and draw up to 20 of them for the judges, on the rows scripts/pass_list.ts
wrote (data/pass-outcomes.json, rows marked x6). No model, no network.

The rule (ae2d5be, "2.4.4: a shared-text claim needs its pair read at both ends") makes a 2.4.4 claim that a link shares
its text with links that lead elsewhere the model's suggestion when the link and one of those links were not both read.
pass_list.ts marks a held-back row x6 when that is the only reason it is not a finding, with the confidence it would
have had. The population drawn from: the x6 rows that would have been findings at the default threshold (medium or
high), over the 60 pages pooled (no cap per page); in ascending order of the SHA-256 of "rampa-round-8-x6|<slug>|<ref>"
(UTF-8, hexadecimal); the first 20 (all when fewer). The x6 rows below the threshold are counted and never drawn.
scripts/packets.py puts each drawn claim in its page's packet as a suggestion row in Rampa's own words (the main run's
suggestion), or marks the item when the claim is already there for another reason.

Run from the repository root: python -I study/round-8-2026-11-21/scripts/x6_draw.py
Writes study/round-8-2026-11-21/data/x6-sample.json; a second run writes the same bytes. Prints counts only.
"""
import collections
import hashlib
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = "rampa-round-8-x6"
SIZE = 20
DEFAULT = ("medium", "high")

with open(os.path.join(HERE, "data", "pass-outcomes.json"), encoding="utf-8") as f:
    data = json.load(f)
moved = [row for row in data["rows"] if row.get("x6")]


def key(row):
    return hashlib.sha256(f"{SEED}|{row['slug']}|{row['ref']}".encode("utf-8")).hexdigest()


population = sorted((row for row in moved if row.get("x6Confidence") in DEFAULT), key=key)
if len({key(row) for row in population}) != len(population):
    sys.exit("two rows share a slug and a ref: the draw's order is not defined")
chosen = population[:SIZE]
per_page = collections.Counter(row["slug"] for row in chosen)
head = {
    "about": ("Shared-text claims the proof rule (ae2d5be) moved to suggestions in the eighth study's main run, and the sample "
              "drawn for the judges (scripts/x6_draw.py, pre-registration section 5, measure h)."),
    "seed": SEED,
    "order": "ascending SHA-256 of '<seed>|<slug>|<ref>' (UTF-8, hexadecimal)",
    "size": SIZE,
    "moved": len(moved),
    "movedByConfidence": dict(collections.Counter(row.get("x6Confidence") for row in moved)),
    "population": len(population),
    "pagesInPopulation": len({row["slug"] for row in population}),
    "drawn": len(chosen),
    "pagesDrawn": len(per_page),
}
items = [{"slug": row["slug"], "criterion": "2.4.4", "ref": row["ref"], "x6Confidence": row["x6Confidence"], "rank": rank}
         for rank, row in enumerate(chosen, 1)]
text = json.dumps(head, ensure_ascii=False, indent=1)
body = ",\n".join("  " + json.dumps(item, ensure_ascii=False) for item in items)
with open(os.path.join(HERE, "data", "x6-sample.json"), "w", encoding="utf-8", newline="\n") as f:
    f.write(text[: text.rindex("\n}")] + ',\n "items": [' + ("\n" + body + "\n " if items else "") + "]\n}\n")
print(f"X6: {len(moved)} shared-text claims moved to suggestions ({head['movedByConfidence']}); "
      f"{len(population)} at the default threshold on {head['pagesInPopulation']} pages; {len(chosen)} drawn from {len(per_page)} pages")
