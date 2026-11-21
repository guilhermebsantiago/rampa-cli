"""Choose the sixth study's labelled suggestions (pre-registration, section 3, "Labels"): the fifth study's rule, with 20
drawn per split in each block.

A suggestion is an item of a page's needsReview that names a model: a judgment fail Rampa reports for review and not as
a finding. From the main run's suggestions:

1. A suggestion that the --no-confirm or the --no-verify run reports as a finding is not chosen here: it is labelled
   through that run (packets.py).
2. Labelled in full (a suggestion counted once, under the first reason that holds): "unstyled", every suggestion on a
   page the report's capture record reads as unstyled (`capture.styled` false); "2.4.2" and "3.3.2", every suggestion of
   those criteria.
3. Drawn ("seeded"): of the rest, per block (1, 2, 3) and split (dev, then test), 20, as the fifth study drew them: the
   pool in a fixed order (pages in data/pages-input.json order, then their order in the report), shuffled with one
   generator, random.Random(20261029), in that order of pools, taken in turn, skipping a suggestion whose page already has
   3 in the draw, until 20 are taken or none is left.

Writes data/suggestion-sample.json; prints counts only. Run after run-judged.sh main and run-ablation.sh noconfirm and
noverify: python -I study/round-6-2026-10-29/scripts/sample_suggestions.py
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import HERE, page_dir, pages, read_json, write_json  # noqa: E402

SEED = 20261029
PER_POOL = 20
PER_PAGE = 3


def judgment_findings(report):
    return [f for lst in ("findings", "belowThreshold", "beyondTarget") for f in report.get(lst) or [] if f.get("source") == "judgment"]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    pools = {}
    full = []
    counts = {}
    for p in pages():
        slug = p["slug"]
        base = page_dir(slug)
        main_path = os.path.join(base, "report.json")
        if not os.path.exists(main_path):
            continue
        report = read_json(main_path)
        main_prints = {f["fingerprint"] for f in judgment_findings(report)}
        elsewhere = set()
        for run in ("noconfirm", "noverify"):
            path = os.path.join(base, f"{run}-report.json")
            if os.path.exists(path):
                elsewhere |= {(f["criterion"], f.get("ref")) for f in judgment_findings(read_json(path)) if f["fingerprint"] not in main_prints}
        suggestions = [n for n in report.get("needsReview") or [] if n.get("model")]
        kept = [(i, n) for i, n in enumerate(suggestions) if (n.get("criterion"), n.get("ref")) not in elsewhere]
        unstyled = (report.get("capture") or {}).get("styled") is False
        c = {"block": p["block"], "split": p["split"], "suggestions": len(suggestions), "labelledThroughAblation": len(suggestions) - len(kept),
             "unstyled": 0, "2.4.2": 0, "3.3.2": 0, "pool": 0}
        for i, n in kept:
            row = {"slug": slug, "block": p["block"], "split": p["split"], "index": i, **{k: n.get(k) for k in ("criterion", "level", "ruleId", "ref", "message", "evidence", "model")}}
            reason = "unstyled" if unstyled else n["criterion"] if n.get("criterion") in ("2.4.2", "3.3.2") else None
            if reason:
                c[reason] += 1
                full.append({**row, "reason": reason})
            else:
                c["pool"] += 1
                pools.setdefault((p["block"], p["split"]), []).append(row)
        counts[slug] = c
    rng = random.Random(SEED)
    sample = list(full)
    for block in (1, 2, 3):
        for split in ("dev", "test"):
            order = list(pools.get((block, split), []))
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
            print(f"block {block} {split}: labelled in full {sum(1 for s in full if s['split'] == split and s['block'] == block)}, pool {len(order)}, drawn {len(taken)}")
    write_json(os.path.join(HERE, "data", "suggestion-sample.json"), {"seed": SEED, "perPool": PER_POOL, "perPage": PER_PAGE, "pages": counts, "sample": sample})


if __name__ == "__main__":
    main()
