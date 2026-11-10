"""The draw of round 6's pass sample (study/round-6-2026-10-29/preregistration-draft.md, section 3, "What Rampa passed",
and section 5, item 7), run as a dry run on the dev rows list.ts wrote (data/outcomes.json). No model, no network.

Per criterion (1.1.1 and 2.4.4), three strata of judged candidates that are not findings at any confidence: passed (the
model's verdict is pass and verification kept it), discarded (a fail verification discarded) and held back (a verified
fail that is the model's suggestion, whatever the reason the code gives: the second pass did not confirm it, no checked
fact supports it, the P3 social icon, or the page was read without its styles). Sizes 60, 20 and 20; a stratum with
fewer takes all. Within a stratum, over the pages pooled (no cap per page), in ascending order of the SHA-256 of
"rampa-round-6-passes|<slug>|<criterion>|<ref>" (UTF-8, hexadecimal); the first n. The specialist's subset is the
first 15 passed items of each criterion in that order. Candidates answered cannot_tell, passes verification discarded,
judgments that ended in an error and the rest are counted and never drawn.

Run from the repository root: python -I study/notes-pass-sample/draw.py
Writes study/notes-pass-sample/data/draw.json; a second run writes the same bytes.
"""
import collections
import hashlib
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = "rampa-round-6-passes"
CRITERIA = ["1.1.1", "2.4.4"]
SIZES = {"passed": 60, "discarded": 20, "held_back": 20}
SPECIALIST = 15

with open(os.path.join(HERE, "data", "outcomes.json"), encoding="utf-8") as f:
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
            if stratum == "passed" and rank <= SPECIALIST:
                item["specialist"] = True
            drawn.append(item)

head = {
    "about": "Dry run of round 6's pass-sample draw on the dev pages of the second to fifth real-page studies (study/notes-pass-sample/draw.py). Counted, in-sample (dev); no item labelled, no rate estimated.",
    "seed": SEED,
    "order": "ascending SHA-256 of '<seed>|<slug>|<criterion>|<ref>' (UTF-8, hexadecimal)",
    "sizes": SIZES,
    "specialist": f"the first {SPECIALIST} passed items of each criterion in the draw's order",
    "strata": strata,
    "notDrawn": not_drawn,
}
text = json.dumps(head, ensure_ascii=False, indent=1)
body = ",\n".join("  " + json.dumps(item, ensure_ascii=False) for item in drawn)
with open(os.path.join(HERE, "data", "draw.json"), "w", encoding="utf-8", newline="\n") as f:
    f.write(text[: text.rindex("\n}")] + ',\n "items": [\n' + body + "\n ]\n}\n")

print("| criterion | stratum | population | drawn | pages in population | pages drawn | largest page | top three pages |")
print("| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |")
for s in strata:
    largest = f"{s['largestPage']['slug']} ({s['largestPage']['items']})" if s["largestPage"] else "-"
    print(f"| {s['criterion']} | {s['stratum']} | {s['population']} | {s['drawn']} | {s['pagesInPopulation']} | {s['pagesDrawn']} | {largest} | {s['topThreePages']} |")
print(f"\n{len(drawn)} items drawn; specialist's subset: {sum(1 for item in drawn if item.get('specialist'))}")
