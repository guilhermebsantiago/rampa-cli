"""The human-review sample of rounds 3 to 5: the populations, the strata and the draw, shared by sample.py and analyze.py.

The rule is written in docs/studies/human-review-plan.md and fixed here before the draw:

- Population J, the default-threshold judged findings of the three studies (origin main, group "judged", shown), minus
  the three burst pages; strata: study x half x criterion x Claude final label. Every stratum gets one item, and the
  rest of N_JUDGED is shared in proportion to what is left in each stratum (N_h - 1), by largest remainder.
- Population B, the burst pages' findings: round 3 ufpe-br (50), round 4 toolstation-plumbing (50) and
  museudoamanha (8). All 8 of museudoamanha; BURST_DRAW of each 50, at most one per link text.
- Population S, the suggestions the studies already drew and labelled (origin suggestion-sample; rounds 4 and 5):
  SUGGESTIONS_PER_STUDY per study, strata Claude final label, one per stratum and the rest as for J.
- Inside a stratum, items are taken in the order of the SHA-256 of SEED|study|slug|key, smallest first.
- The 30 for the second person: the 100 sorted by part, Claude label, study, half, criterion and the same hash,
  then every 100/30-th item from a seeded start (systematic sampling of a sorted list, which stratifies implicitly).
- The package's order: by SHA-256 of SEED|order|study|slug|key; an item's fingerprint in the package is the first 12
  hex digits of SHA-256 of SEED|fingerprint|study|slug|key (data/sample.json maps it back).

Python's standard library only. Run the scripts that import this with python -I.
"""

import hashlib
import json
import math
import os
from collections import Counter, defaultdict

SEED = "rampa-human-review-2026-10-29"
N_TOTAL = 100
N_SECOND = 30
BURST_DRAW = 8
SUGGESTIONS_PER_STUDY = 5

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(HERE)  # study/human-review-2026-10
STUDY_ROOT = os.path.dirname(FOLDER)  # study/
REPO = os.path.dirname(STUDY_ROOT)
MANIFEST = os.path.join(FOLDER, "data", "sample.json")

# (id, folder under study/, folder in the recordings backup, name in tables)
STUDIES = (
    ("r3", "round-3-2026-10-23", "round-3-2026-10-23", "round 3"),
    ("r4", "round-4-2026-10-24", "round-4-2026-10-24", "round 4"),
    ("r5", "round-5-2026-10-28", "round-5", "round 5"),
)
STUDY_NAME = {s[0]: s[3] for s in STUDIES}
# ufpe-br and toolstation-plumbing hold 50 findings each and are drawn down; museudoamanha's 8 are all taken.
BURST_PAGES = {("r3", "ufpe-br"): "draw", ("r4", "toolstation-plumbing"): "draw", ("r4", "museudoamanha"): "all"}
SUGGESTION_STUDIES = ("r4", "r5")
LABELS = ("true_positive", "false_positive", "uncertain")
SHORT = {"true_positive": "TP", "false_positive": "FP", "uncertain": "unc"}
PART_ORDER = {"judged": 0, "burst": 1, "suggestion": 2}
Z = 1.959963984540054


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def digest(*parts):
    return hashlib.sha256("|".join((SEED,) + tuple(str(p) for p in parts)).encode("utf-8")).hexdigest()


def claim_kind(row):
    """The kind of claim a finding makes, read from its message's template (the same for every round)."""
    c, m = row["criterion"], row["message"]
    kinds = {
        "1.1.1": (("describes something the image does not show", "wrong_content"), ("is a file name or a placeholder", "placeholder"),
                  ("is all its link holds", "functional"), ("too generic", "generic"), ("names an image that is decorative", "decorative"),
                  ("hidden from screen readers", "hidden_image")),
        "2.4.4": (("is shared by", "shared_text"), ("does not tell where the link goes", "generic"), ("is an address", "address"),
                  ("does not match where the link leads", "mismatch")),
        "2.4.6": (("The heading", "heading"), ("The label", "label")),
    }
    single = {"1.3.5": "autocomplete", "2.4.2": "title", "3.1.1": "page_language", "3.1.2": "passage_language", "3.3.2": "label_not_visible"}
    if c in single:
        return f"{c} {single[c]}"
    for needle, kind in kinds.get(c, ()):
        if needle in m:
            return f"{c} {kind}"
    return f"{c} other"


def load_studies():
    """Every row of the three studies' findings.json, with the study id; and the page address of each (study, slug)."""
    rows, urls = [], {}
    for sid, folder, _, _ in STUDIES:
        data = os.path.join(STUDY_ROOT, folder, "data")
        for p in read_json(os.path.join(data, "pages.json")):
            urls[(sid, p["slug"])] = p["url"]
        for r in read_json(os.path.join(data, "findings.json")):
            rows.append({**r, "study": sid})
    return rows, urls


def is_default_judged(r):
    return r.get("origin") in (None, "main") and r["group"] == "judged" and r["shown"] is True


def is_suggestion(r):
    return r.get("origin") == "suggestion-sample"


def part_of(r):
    """judged, burst or suggestion for the rows the sample draws from; None for the rest."""
    if is_suggestion(r):
        return "suggestion" if r["study"] in SUGGESTION_STUDIES else None
    if is_default_judged(r):
        return "burst" if (r["study"], r["slug"]) in BURST_PAGES else "judged"
    return None


def stratum_of(r):
    """The stratum a row is drawn in (and weighted by in analyze.py)."""
    part = part_of(r)
    if part == "judged":
        return ("judged", r["study"], r["split"], r["criterion"], r["final"])
    if part == "burst":
        return ("burst", r["study"], r["slug"])
    if part == "suggestion":
        return ("suggestion", r["study"], r["final"])
    return None


def populations(rows):
    out = defaultdict(list)
    for r in rows:
        s = stratum_of(r)
        if s is not None:
            out[s].append(r)
    return out


def allocate(sizes, total):
    """One item per stratum, then the rest in proportion to N_h - 1 (what is left in it), by largest remainder."""
    alloc = {k: 1 for k in sorted(sizes) if sizes[k] > 0}
    left = total - len(alloc)
    if left < 0:
        raise ValueError(f"{len(alloc)} strata do not fit in {total} items")
    room = {k: sizes[k] - 1 for k in alloc}
    spare = sum(room.values())
    if left >= spare:
        return {k: sizes[k] for k in alloc}
    # left < spare, so every quota is below its room and a floor plus one still fits.
    quotas = {k: left * room[k] / spare for k in alloc}
    for k in alloc:
        alloc[k] += int(math.floor(quotas[k]))
    rest = total - sum(alloc.values())
    # Largest remainder; ties by the larger stratum, then by the stratum's key.
    for k in sorted(alloc, key=lambda k: (-(quotas[k] - math.floor(quotas[k])), -sizes[k], k))[:rest]:
        alloc[k] += 1
    return alloc


def by_hash(rows, *salt):
    return sorted(rows, key=lambda r: digest(*salt, r["study"], r["slug"], r["key"]))


def draw(rows):
    """The 100 items: returns a list of rows, each with `part` and `stratum` set."""
    pops = populations(rows)
    chosen = []

    # B: the burst pages.
    burst_keys = sorted(k for k in pops if k[0] == "burst")
    for k in burst_keys:
        page = pops[k]
        if BURST_PAGES[(k[1], k[2])] == "all":
            take = by_hash(page)
        else:
            take, texts = [], set()
            for r in by_hash(page):
                text = (r.get("subject") or r.get("evidence") or "").strip().lower()
                if text in texts:
                    continue
                texts.add(text)
                take.append(r)
                if len(take) == BURST_DRAW:
                    break
        chosen += [(k, r) for r in take]
    n_burst = len(chosen)

    # S: the suggestions.
    for sid in SUGGESTION_STUDIES:
        sizes = {k: len(v) for k, v in pops.items() if k[0] == "suggestion" and k[1] == sid}
        for k, n in allocate(sizes, SUGGESTIONS_PER_STUDY).items():
            chosen += [(k, r) for r in by_hash(pops[k])[:n]]
    n_suggestion = len(chosen) - n_burst

    # J: the other default-threshold judged findings.
    n_judged = N_TOTAL - n_burst - n_suggestion
    sizes = {k: len(v) for k, v in pops.items() if k[0] == "judged"}
    for k, n in allocate(sizes, n_judged).items():
        chosen += [(k, r) for r in by_hash(pops[k])[:n]]

    out = []
    for k, r in chosen:
        out.append({**r, "part": k[0], "stratum": k})
    if len(out) != N_TOTAL or len({(r["study"], r["slug"], r["key"]) for r in out}) != N_TOTAL:
        raise AssertionError(f"the draw gave {len(out)} items")
    return out


def second_subsample(sample):
    """The 30 for the second person: systematic sampling of the 100 sorted by the strata."""
    ordered = sorted(sample, key=lambda r: (PART_ORDER[r["part"]], LABELS.index(r["final"]), r["study"], r["split"], r["criterion"],
                                            digest(r["study"], r["slug"], r["key"])))
    step = len(ordered) / N_SECOND
    start = int(digest("second-person-start")[:8], 16) / 16 ** 8 * step
    picks = [ordered[int(math.floor(start + i * step))] for i in range(N_SECOND)]
    if len({id(r) for r in picks}) != N_SECOND:
        raise AssertionError("the subsample repeats an item")
    return picks


def package_order(items):
    return sorted(items, key=lambda r: digest("order", r["study"], r["slug"], r["key"]))


def item_id(r):
    return f"{r['study']}/{r['slug']}/{r['key']}"


def package_fingerprint(r):
    """The fingerprint an item has in the package: neutral, since the studies' keys for suggestions start with "s"."""
    return digest("fingerprint", r["study"], r["slug"], r["key"])[:12]


# Statistics, as the studies compute them.

def wilson(successes, n):
    if not n:
        return None
    p = successes / n
    denom = 1 + Z * Z / n
    centre = (p + Z * Z / (2 * n)) / denom
    half = Z * math.sqrt(max(0.0, p * (1 - p) / n + Z * Z / (4 * n * n))) / denom
    return [round(max(0.0, centre - half), 3), round(min(1.0, centre + half), 3)]


def cohen_kappa(pairs, categories=LABELS):
    n = len(pairs)
    if n == 0:
        return None
    observed = sum(1 for a, b in pairs if a == b) / n
    ca = Counter(a for a, _ in pairs)
    cb = Counter(b for _, b in pairs)
    expected = sum(ca[c] * cb[c] for c in categories) / (n * n)
    kappa = None if expected == 1 else (observed - expected) / (1 - expected)
    return {"n": n, "observed": round(observed, 3), "expected": round(expected, 3), "kappa": None if kappa is None else round(kappa, 3)}
