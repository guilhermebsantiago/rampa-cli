"""Draw the fourth study's labelled sample of suggestions, as pre-registered (preregistration.md, "Suggestion sample").

A suggestion is an item of a page's needsReview that names a model (the second study's after.py counted them so): a
judgment fail that Rampa reports for review and not as a finding. The claims the second pass left as suggestions are
not drawn: they are findings of the --no-confirm run and are all labelled through it. From each split, the remaining
suggestions are put in a fixed order (pages in data/pages-input.json order, then their order in the report), shuffled
with random.Random(20261024) (one generator, dev first, then test), and taken in that order, skipping a suggestion when
its page already has 3 in the sample, until 20 are taken or none is left.

Writes data/suggestion-sample.json (the pool counts and the drawn suggestions). Run after run-judged.sh default and
run-noconfirm.sh: python -I study/round-4-2026-10-24/scripts/sample_suggestions.py
"""

import json
import os
import random

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = 20261024
PER_SPLIT = 20
PER_PAGE = 3


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def judgment_findings(report):
    return [f for lst in ("findings", "belowThreshold", "beyondTarget") for f in report.get(lst, []) if f.get("source") == "judgment"]


def main():
    meta = read_json(os.path.join(HERE, "data", "pages-input.json"))
    pools = {"dev": [], "test": []}
    counts = {}
    for p in meta["pages"]:
        base = os.path.join(HERE, "pages", p["slug"])
        main_path, ablation_path = os.path.join(base, "report.json"), os.path.join(base, "noconfirm-report.json")
        if not os.path.exists(main_path):
            continue
        report = read_json(main_path)
        main_prints = {f["fingerprint"] for f in judgment_findings(report)}
        ablation_only = set()
        if os.path.exists(ablation_path):
            ablation_only = {(f["criterion"], f.get("ref")) for f in judgment_findings(read_json(ablation_path)) if f["fingerprint"] not in main_prints}
        suggestions = [n for n in report.get("needsReview", []) if n.get("model")]
        kept = [(i, n) for i, n in enumerate(suggestions) if (n.get("criterion"), n.get("ref")) not in ablation_only]
        counts[p["slug"]] = {"split": p["split"], "suggestions": len(suggestions), "secondPass": len(suggestions) - len(kept), "pool": len(kept)}
        pools[p["split"]] += [{"slug": p["slug"], "index": i, **{k: n.get(k) for k in ("criterion", "level", "ruleId", "ref", "message", "evidence", "model")}} for i, n in kept]
    rng = random.Random(SEED)
    sample = []
    for split in ("dev", "test"):
        order = list(pools[split])
        rng.shuffle(order)
        taken, per_page = [], {}
        for s in order:
            if len(taken) == PER_SPLIT:
                break
            if per_page.get(s["slug"], 0) == PER_PAGE:
                continue
            per_page[s["slug"]] = per_page.get(s["slug"], 0) + 1
            taken.append({**s, "split": split})
        sample += taken
        print(f"{split}: pool {len(pools[split])}, drawn {len(taken)}")
    out = {"seed": SEED, "perSplit": PER_SPLIT, "perPage": PER_PAGE, "pages": counts, "sample": sample}
    with open(os.path.join(HERE, "data", "suggestion-sample.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
