"""The draw of the seventh study's pass sample (preregistration.md, section 3, "Pass sample"), on the rows
scripts/pass_list.ts wrote from the main run of all 60 pages (data/pass-outcomes.json). The sixth study's pass_draw.py
with this study's seed string. No model, no network.

Per criterion (1.1.1 and 2.4.4), three strata of judged candidates that are not findings at any confidence: passed (the
model's verdict is pass and verification kept it), discarded (a fail verification discarded) and held back (a verified
fail that is the model's suggestion, whatever the reason the code gives: the second pass did not confirm it, no checked
fact supports it, the P3 social icon, or the page was read without its styles). Sizes 60, 20 and 20; a stratum with
fewer takes all. Within a stratum, over the pages pooled (no cap per page), in ascending order of the SHA-256 of
"rampa-round-7-passes|<slug>|<criterion>|<ref>" (UTF-8, hexadecimal); the first n. Candidates answered cannot_tell,
passes verification discarded, judgments that ended in an error and the rest are counted and never drawn. Prints counts
only.

Run from the repository root: python -I study/round-7-2026-11-21/scripts/pass_draw.py
Writes study/round-7-2026-11-21/data/pass-draw.json; a second run writes the same bytes.
"""
import collections
import hashlib
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = "rampa-round-7-passes"
CRITERIA = ["1.1.1", "2.4.4"]
SIZES = {"passed": 60, "discarded": 20, "held_back": 20}

with open(os.path.join(HERE, "data", "pass-outcomes.json"), encoding="utf-8") as f:
    data = json.load(f)
rows = data["rows"]


def key(row):
    return hashlib.sha256(f"{SEED}|{row['slug']}|{row['criterion']}|{row['ref']}".encode("utf-8")).hexdigest()


keys = [key(row) for row in rows]
if len(set(keys)) != len(keys):
    sys.exit("two rows share a slug, a criterion and a ref: the draw's order is not defined")

strata = []
drawn = []
not_drawn = {}
for criterion in CRITERIA:
    of_criterion = [row for row in rows if row["criterion"] == criterion]
    counted = collections.Counter(row["outcome"] for row in of_criterion if row["outcome"] not in SIZES)
    not_drawn[criterion] = {outcome: counted.get(outcome, 0) for outcome in data["outcomes"] if outcome not in SIZES}
    for stratum, size in SIZES.items():
        population = sorted((row for row in of_criterion if row["outcome"] == stratum), key=key)
        chosen = population[:size]
        per_page = collections.Counter(row["slug"] for row in chosen)
        top = sorted(per_page.items(), key=lambda item: (-item[1], item[0]))
        strata.append(
            {
                "criterion": criterion,
                "stratum": stratum,
                "population": len(population),
                "size": size,
                "drawn": len(chosen),
                "pagesInPopulation": len({row["slug"] for row in population}),
                "pagesDrawn": len(per_page),
                "largestPage": {"slug": top[0][0], "items": top[0][1]} if top else None,
                "topThreePages": sum(count for _, count in top[:3]),
            }
        )
        for rank, row in enumerate(chosen, 1):
            item = {"slug": row["slug"], "criterion": criterion, "ref": row["ref"], "stratum": stratum, "rank": rank}
            drawn.append(item)

head = {
    "about": "The seventh study's pass sample, drawn from the main run of its 60 pages (scripts/pass_draw.py, pre-registration section 3).",
    "seed": SEED,
    "order": "ascending SHA-256 of '<seed>|<slug>|<criterion>|<ref>' (UTF-8, hexadecimal)",
    "sizes": SIZES,
    "strata": strata,
    "notDrawn": not_drawn,
}
text = json.dumps(head, ensure_ascii=False, indent=1)
body = ",\n".join("  " + json.dumps(item, ensure_ascii=False) for item in drawn)
with open(os.path.join(HERE, "data", "pass-draw.json"), "w", encoding="utf-8", newline="\n") as f:
    f.write(text[: text.rindex("\n}")] + ',\n "items": [\n' + body + "\n ]\n}\n")

print("| criterion | stratum | population | drawn | pages in population | pages drawn |")
print("| --- | --- | ---: | ---: | ---: | ---: |")
for s in strata:
    print(f"| {s['criterion']} | {s['stratum']} | {s['population']} | {s['drawn']} | {s['pagesInPopulation']} | {s['pagesDrawn']} |")
print(f"\n{len(drawn)} items drawn")
