"""Choose the fifth study's labelled suggestions, as pre-registered (preregistration.md, "The suggestion sample").

The fourth study's sample_suggestions.py, with the claims the frozen rules moved to review labelled in full before the
seeded draw. A suggestion is an item of a page's needsReview that names a model: a judgment fail Rampa reports for
review and not as a finding. From the main run's suggestions:

1. The claims the second pass left as suggestions are not chosen here: they are findings of the --no-confirm run and
   are all labelled through it (the 1.1.1 claims between 0.9 and 0.99 among them: run-cut090.sh's findings).
2. Labelled in full, in this order (a suggestion is counted once, under the first reason that holds):
   - "unstyled": every suggestion on a page the checks read as unstyled (data/capture.json, `verdict.unstyled`);
   - "nesting": every 2.4.4 claim "is shared by N links ..." whose link the shared-text fact grounds without the H81
     nesting and not with it (data/shared-text.json): the claims the nesting tells apart;
   - "2.4.2" and "3.3.2": every suggestion of those two criteria.
3. Drawn ("seeded"): of the rest, 20 per split, as the fourth study drew them: in a fixed order (pages in
   data/pages-input.json order, then their order in the report), shuffled with random.Random(20261027) (one generator,
   dev first, then test), taken in that order, skipping a suggestion when its page already has 3 in the draw, until 20
   are taken or none is left.

Writes data/suggestion-sample.json (each page's counts, the pools and the chosen suggestions with their reason).
Run after run-judged.sh default, run-noconfirm.sh, run-cut090.sh, shared-text.sh and capture.ts:
python -I study/round-5-2026-10-28/scripts/sample_suggestions.py
"""

import json
import os
import random

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = 20261027
PER_SPLIT = 20
PER_PAGE = 3
SHARED = "is shared by"


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def judgment_findings(report):
    return [f for lst in ("findings", "belowThreshold", "beyondTarget") for f in report.get(lst, []) if f.get("source") == "judgment"]


def grounds(fact):
    return bool(fact and fact["places"] > 1 and not fact["apart"])


def main():
    meta = read_json(os.path.join(HERE, "data", "pages-input.json"))
    capture = {c["slug"]: c for c in read_json(os.path.join(HERE, "data", "capture.json"))}
    shared = read_json(os.path.join(HERE, "data", "shared-text.json"))
    told_apart = {(l["slug"], l["ref"]) for l in shared["links"] if grounds(l.get("before")) and not grounds(l.get("after"))}
    pools = {"dev": [], "test": []}
    full = []
    counts = {}
    for p in meta["pages"]:
        slug = p["slug"]
        base = os.path.join(HERE, "pages", slug)
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
        unstyled = bool((capture.get(slug) or {}).get("verdict", {}).get("unstyled"))
        c = {"split": p["split"], "suggestions": len(suggestions), "secondPass": len(suggestions) - len(kept),
             "unstyled": 0, "nesting": 0, "2.4.2": 0, "3.3.2": 0, "pool": 0}
        for i, n in kept:
            row = {"slug": slug, "split": p["split"], "index": i, **{k: n.get(k) for k in ("criterion", "level", "ruleId", "ref", "message", "evidence", "model")}}
            if unstyled:
                reason = "unstyled"
            elif n.get("criterion") == "2.4.4" and SHARED in (n.get("message") or "") and (slug, n.get("ref")) in told_apart:
                reason = "nesting"
            elif n.get("criterion") in ("2.4.2", "3.3.2"):
                reason = n["criterion"]
            else:
                reason = None
            if reason:
                c[reason] += 1
                full.append({**row, "reason": reason})
            else:
                c["pool"] += 1
                pools[p["split"]].append(row)
        counts[slug] = c
    rng = random.Random(SEED)
    sample = list(full)
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
            taken.append({**s, "reason": "seeded"})
        sample += taken
        print(f"{split}: labelled in full {sum(1 for s in full if s['split'] == split)}, seeded pool {len(pools[split])}, drawn {len(taken)}")
    out = {"seed": SEED, "perSplit": PER_SPLIT, "perPage": PER_PAGE, "pages": counts, "sample": sample}
    with open(os.path.join(HERE, "data", "suggestion-sample.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
