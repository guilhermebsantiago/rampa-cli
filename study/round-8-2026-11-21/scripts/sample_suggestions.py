"""Choose the eighth study's labelled suggestions (pre-registration, section 3, "Labels"): the seventh study's rule for
five blocks of 12 test pages, 12 drawn per block, and without its first step (the ablations' findings are not labelled
in this round, so no suggestion is labelled through them).

A suggestion is an item of a page's needsReview that names a model: a judgment fail Rampa reports for review and not as
a finding. From the main run's suggestions:

1. Labelled in full (a suggestion counted once, under the first reason that holds): "unstyled", every suggestion on a
   page the report's capture record reads as unstyled (`capture.styled` false); "2.4.2" and "3.3.2", every suggestion of
   those criteria.
2. Drawn ("seeded"): of the rest, per block (1 to 5), 12: the pool in a fixed order (pages in data/pages-input.json order,
   then their order in the report), shuffled with one generator, random.Random(202611218), block by block, taken in turn,
   skipping a suggestion whose page already has 3 in the draw, until 12 are taken or none is left.

Writes data/suggestion-sample.json; prints counts only. Run after run-judged.sh main:
python -I study/round-8-2026-11-21/scripts/sample_suggestions.py
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, page_dir, pages, read_json, write_json  # noqa: E402

SEED = 202611218
PER_POOL = 12
PER_PAGE = 3
BLOCKS = (1, 2, 3, 4, 5)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    pools = {}
    full = []
    counts = {}
    for p in pages():
        slug = p["slug"]
        main_path = os.path.join(page_dir(slug), "report.json")
        if not os.path.exists(main_path):
            continue
        report = read_json(main_path)
        suggestions = [n for n in report.get("needsReview") or [] if n.get("model")]
        unstyled = (report.get("capture") or {}).get("styled") is False
        c = {"block": p["block"], "split": p["split"], "suggestions": len(suggestions), "unstyled": 0, "2.4.2": 0, "3.3.2": 0, "pool": 0}
        for i, n in enumerate(suggestions):
            row = {"slug": slug, "block": p["block"], "split": p["split"], "index": i,
                   **{k: n.get(k) for k in ("criterion", "level", "ruleId", "ref", "message", "evidence", "model")}}
            reason = "unstyled" if unstyled else n["criterion"] if n.get("criterion") in ("2.4.2", "3.3.2") else None
            if reason:
                c[reason] += 1
                full.append({**row, "reason": reason})
            else:
                c["pool"] += 1
                pools.setdefault(p["block"], []).append(row)
        counts[slug] = c
    rng = random.Random(SEED)
    sample = list(full)
    for block in BLOCKS:
        order = list(pools.get(block, []))
        rng.shuffle(order)
        taken, per_page = [], {}
        for s in order:
            if len(taken) == PER_POOL:
                break
            if per_page.get(s["slug"], 0) == PER_PAGE:
                continue
            per_page[s["slug"]] = per_page.get(s["slug"], 0) + 1
            taken.append({**s, "reason": "seeded"})
        sample += taken
        print(f"block {block}: labelled in full {sum(1 for s in full if s['block'] == block)}, pool {len(order)}, drawn {len(taken)}")
    write_json(os.path.join(HERE, "data", "suggestion-sample.json"), {"seed": SEED, "perPool": PER_POOL, "perPage": PER_PAGE, "pages": counts, "sample": sample})


if __name__ == "__main__":
    main()
