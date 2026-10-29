"""Human-Claude agreement on the blind human-review sample, and what the studies' precision would be with human labels.

  python -I study/human-review-2026-10/scripts/analyze.py EXPORT [EXPORT ...] [--primary NAME] [--out FILE.md] [--json FILE.json]
  python -I study/human-review-2026-10/scripts/analyze.py --self-test

EXPORT is a file Rampa Lab's "Exportar rótulos" wrote (rampa-lab-labels-<name>-<date>.json), or a study label file
({page, labeler, judgments}), or a list of them. One file per person; the author's 100 and the second person's 30.

Each judgment is joined to its finding through data/sample.json, by page address and the package's fingerprint, and to
the Claude labels of the study it came from (data/findings.json of rounds 3, 4 and 5: the two judges and the final
label, the one both gave or else uncertain). Labels outside the sample, as a browser that labelled something else
also exports, are counted and left out.

Reports, in Markdown:
- per person, agreement with the Claude final label and Cohen's kappa over the three labels, overall, by part of the
  sample, by criterion, by claim kind and by study; agreement with each judge; the causes of the false positives both
  name; the items where they differ;
- between two people, on the items both labelled (the 30): agreement and kappa;
- for the primary person (--primary, else whoever labelled most), the default-threshold precision of each study and
  half (judged findings, burst pages included): the published Claude number over every finding; Claude's and the
  person's on the sampled items, with Wilson intervals; a stratified estimate for every finding (each stratum's sampled
  share weighted by its size, with a Wilson interval at Kish's effective n); and the study's own number with the
  person's labels in place of Claude's on the sampled items. All are estimates from a sample;
- the sampled suggestions, Claude's labels and the person's.

The report names Claude's labels, so open it only after the labelling is done.

--self-test checks the arithmetic without any label file: with Claude's own final labels in the person's place, kappa
must be 1 and the stratified estimate must give back each study's published precision exactly (every stratum of the
draw holds one Claude label). It prints nothing about the sample.
"""

import argparse
import json
import math
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

PACKAGE_DATE = "2026-10-29"
LABELS = common.LABELS
SHORT = common.SHORT
SPLITS = ("dev", "test", "all")


def parse_exports(paths, items_by_key, claude):
    """{person: {item id: judgment}} and the problems found."""
    people = defaultdict(dict)
    notes = defaultdict(Counter)
    warnings = []
    for path in paths:
        data = common.read_json(path)
        if isinstance(data, dict) and data.get("format") == "rampa-lab-labels":
            pages, top = data.get("pages") or [], data.get("labeler")
        elif isinstance(data, dict):
            pages, top = [data], None
        elif isinstance(data, list):
            pages, top = data, None
        else:
            raise SystemExit(f"{path}: not a labels file")
        for page in pages:
            person = page.get("labeler") or page.get("reviewer") or top or os.path.basename(path)
            for j in page.get("judgments") or []:
                item = items_by_key.get((page.get("page"), j.get("fingerprint")))
                if item is None:
                    notes[person]["outside the sample (left out)"] += 1
                    continue
                if j.get("label") not in LABELS:
                    notes[person]["no valid label (left out)"] += 1
                    continue
                c = claude[item["id"]]
                rationale = (j.get("rationale") or "").strip()
                if rationale and rationale in {(c.get(w) or {}).get("rationale", "").strip() for w in ("auditor", "skeptic")}:
                    warnings.append(f"{person}: the note on {item['id']} is a judge's rationale word for word; left out")
                    notes[person]["copied from a judge (left out)"] += 1
                    continue
                when = j.get("labeledAt") or page.get("labeledAt") or ""
                if when and when[:10] < PACKAGE_DATE:
                    notes[person]["labelled before the package existed (kept)"] += 1
                old = people[person].get(item["id"])
                if old is not None:
                    notes[person]["labelled twice (the later kept)"] += 1
                    if (old.get("labeledAt") or "") > when:
                        continue
                cause = j.get("cause")
                people[person][item["id"]] = {"label": j["label"], "cause": None if cause in (None, "none") else cause,
                                              "rationale": rationale, "labeledAt": when}
    return people, notes, warnings


def kappa_row(pairs):
    k = common.cohen_kappa(pairs)
    if not k:
        return None
    decided = [(a, b) for a, b in pairs if a != "uncertain" and b != "uncertain"]
    return {**k, "agree": sum(1 for a, b in pairs if a == b), "decided": len(decided), "decidedAgree": sum(1 for a, b in decided if a == b)}


def fmt_p(p, digits=2):
    return "–" if p is None else f"{p:.{digits}f}"


def fmt_ci(ci):
    return "" if not ci else f" ({ci[0]:.2f}–{ci[1]:.2f})"


def fmt_k(k):
    return "–" if k is None or k.get("kappa") is None else f"{k['kappa']:.2f}"


def precision(labels):
    c = Counter(labels)
    n = c["true_positive"] + c["false_positive"]
    return {"tp": c["true_positive"], "fp": c["false_positive"], "unc": c["uncertain"], "n": n,
            "p": None if n == 0 else c["true_positive"] / n, "ci": common.wilson(c["true_positive"], n)}


def stratified(population, sampled, person_labels):
    """Each stratum's labelled share, weighted by its size; Wilson at Kish's effective n. Strata with no label
    from the person keep Claude's labels, counted as they are."""
    strata = defaultdict(list)
    for r in population:
        strata[common.stratum_of(r)].append(r)
    tp = fp = 0.0
    weights = []
    fallback = 0
    for key, rows in strata.items():
        labelled = [person_labels[common.item_id(r)] for r in rows if common.item_id(r) in sampled and common.item_id(r) in person_labels]
        if not labelled:
            fallback += len(rows)
            for r in rows:
                if r["final"] != "uncertain":
                    weights.append(1.0)
                    tp += r["final"] == "true_positive"
                    fp += r["final"] == "false_positive"
            continue
        w = len(rows) / len(labelled)
        for label in labelled:
            if label != "uncertain":
                weights.append(w)
                tp += w * (label == "true_positive")
                fp += w * (label == "false_positive")
    if tp + fp == 0:
        return {"p": None, "ci": None, "neff": 0, "fallback": fallback, "tp": tp, "fp": fp}
    p = tp / (tp + fp)
    neff = sum(weights) ** 2 / sum(w * w for w in weights)
    return {"p": p, "ci": common.wilson(p * neff, neff), "neff": neff, "fallback": fallback, "tp": tp, "fp": fp}


def confusion(pairs, row_name, col_name):
    c = Counter(pairs)
    lines = [f"| {row_name} \\ {col_name} | " + " | ".join(SHORT[l] for l in LABELS) + " | total |", "| --- | " + " | ".join("---:" for _ in LABELS) + " | ---: |"]
    for a in LABELS:
        lines.append(f"| {SHORT[a]} | " + " | ".join(str(c[(a, b)]) for b in LABELS) + f" | {sum(c[(a, b)] for b in LABELS)} |")
    lines.append("| total | " + " | ".join(str(sum(c[(a, b)] for a in LABELS)) for b in LABELS) + f" | {len(pairs)} |")
    return lines


def agreement_table(title, groups, out):
    """groups: [(name, [(claude, human)])]."""
    out += [f"#### {title}", "", "| | n | agree | kappa | decided agree | Claude TP/FP/unc | person TP/FP/unc |", "| --- | ---: | ---: | ---: | ---: | --- | --- |"]
    for name, pairs in groups:
        k = kappa_row(pairs)
        if not k:
            continue
        cc, hc = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
        out.append(f"| {name} | {k['n']} | {k['agree']} ({k['observed']:.2f}) | {fmt_k(k)} | {k['decidedAgree']}/{k['decided']} | "
                   f"{cc['true_positive']}/{cc['false_positive']}/{cc['uncertain']} | {hc['true_positive']}/{hc['false_positive']}/{hc['uncertain']} |")
    out.append("")


def active_time(judgments):
    """Median seconds between consecutive labels, gaps over 15 minutes left out (a pause)."""
    times = sorted(j["labeledAt"] for j in judgments if j.get("labeledAt"))
    from datetime import datetime

    def parse(t):
        return datetime.fromisoformat(t.replace("Z", "+00:00"))

    gaps = []
    for a, b in zip(times, times[1:]):
        try:
            g = (parse(b) - parse(a)).total_seconds()
        except ValueError:
            continue
        if 0 < g <= 900:
            gaps.append(g)
    if not gaps:
        return None
    gaps.sort()
    mid = len(gaps) // 2
    median = gaps[mid] if len(gaps) % 2 else (gaps[mid - 1] + gaps[mid]) / 2
    return {"median": median, "active": sum(gaps), "gaps": len(gaps)}


def self_test():
    manifest = common.read_json(common.MANIFEST)
    rows, _ = common.load_studies()
    by_id = {common.item_id(r): r for r in rows}
    sampled = {it["id"] for it in manifest["items"]}
    mirror = {iid: by_id[iid]["final"] for iid in sampled}
    k = common.cohen_kappa([(v, v) for v in mirror.values()])
    assert k["kappa"] == 1.0, k
    population = [r for r in rows if common.part_of(r) in ("judged", "burst")]
    checked = 0
    for sid in [s[0] for s in common.STUDIES] + ["pooled"]:
        for split in SPLITS:
            pop = [r for r in population if (sid == "pooled" or r["study"] == sid) and (split == "all" or r["split"] == split)]
            published = precision([r["final"] for r in pop])
            st = stratified(pop, sampled, mirror)
            assert st["fallback"] == 0, (sid, split, st)
            assert abs(st["tp"] - published["tp"]) < 1e-9 and abs(st["fp"] - published["fp"]) < 1e-9, (sid, split, st, published)
            assert abs(st["p"] - published["p"]) < 1e-12, (sid, split)
            checked += 1
    assert common.wilson(0, 10) == [0.0, 0.278] and common.wilson(10, 10) == [0.722, 1.0]
    k = common.cohen_kappa([("true_positive", "true_positive")] * 8 + [("false_positive", "false_positive")] * 8 + [("true_positive", "false_positive")] * 4)
    assert k["kappa"] == 0.615, k  # (0.8 - 0.48) / 0.52
    print(f"self-test ok: {len(sampled)} items, {checked} precision rows reproduce the published counts")


def main():
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("exports", nargs="+")
    ap.add_argument("--primary", help="whose labels the precision tables use (default: whoever labelled most)")
    ap.add_argument("--out", help="write the Markdown report here as well as to the console")
    ap.add_argument("--json", help="write the numbers here")
    args = ap.parse_args()

    manifest = common.read_json(common.MANIFEST)
    items = {it["id"]: it for it in manifest["items"]}
    items_by_key = {(it["page"], it["fingerprint"]): it for it in manifest["items"]}
    rows, _ = common.load_studies()
    by_id = {common.item_id(r): r for r in rows}
    claude = {iid: by_id[iid] for iid in items}
    for iid in items:
        if common.stratum_of(claude[iid]) is None:
            raise SystemExit(f"{iid} is no longer in the sampled populations")
    second = {iid for iid, it in items.items() if it["second"]}

    people, notes, warnings = parse_exports(args.exports, items_by_key, claude)
    if not people:
        raise SystemExit("no label in these files is on a sampled item")
    names = sorted(people, key=lambda p: (-len(people[p]), p))
    primary = args.primary or names[0]
    if primary not in people:
        raise SystemExit(f"--primary {primary}: no labels from that person; there are {', '.join(names)}")

    out = ["# Human review of rounds 3–5: agreement and precision", ""]
    if any("synthetic" in p.lower() for p in names):
        out += ["**SYNTHETIC TEST DATA: these labels were generated by check-lab.mjs to test this script. They are not human judgments, and no number below says anything about Rampa.**", ""]
    out += [f"Sample: {len(items)} items (seed `{manifest['seed']}`), {len(second)} of them for the second person. "
            f"Files: {', '.join(os.path.basename(p) for p in args.exports)}.", ""]
    result = {"seed": manifest["seed"], "people": {}, "humanHuman": None, "precision": {}, "suggestions": {}}

    out += ["## Who labelled what", "", "| person | labelled of the 100 | of the 30 | median time between labels | active time | notes |", "| --- | ---: | ---: | ---: | ---: | --- |"]
    for p in names:
        t = active_time(people[p].values())
        time_cell = "–" if not t else f"{t['median']:.0f} s"
        active = "–" if not t else f"{t['active'] / 60:.0f} min"
        note = "; ".join(f"{v} {k}" for k, v in notes[p].items()) or "–"
        out.append(f"| {p}{' (primary)' if p == primary else ''} | {len(people[p])} | {len(set(people[p]) & second)} | {time_cell} | {active} | {note} |")
    out.append("")
    for w in warnings:
        out.append(f"- Warning: {w}")
    if warnings:
        out.append("")

    def part_name(iid):
        return {"judged": "default-threshold findings", "burst": "burst pages", "suggestion": "suggestions"}[items[iid]["part"]]

    # Human-Claude agreement, per person.
    out += ["## Agreement with the Claude labels", "",
            "The Claude label is the study's final label: the one both judges gave, else uncertain. Kappa is Cohen's over the "
            "three labels, on the sampled items as drawn (the draw over-represents rare strata, so it is not a population figure). "
            "\"Decided agree\" counts the items both call true or false.", ""]
    for p in names:
        mine = people[p]
        pairs = {iid: (claude[iid]["final"], j["label"]) for iid, j in mine.items()}
        k = kappa_row(list(pairs.values()))
        out += [f"### {p}", "", f"Overall: {k['agree']} of {k['n']} agree ({k['observed']:.2f}), kappa {fmt_k(k)}; "
                f"on the items both decided, {k['decidedAgree']} of {k['decided']}.", ""]
        out += confusion(list(pairs.values()), "Claude", p) + [""]

        def grouped(key):
            g = defaultdict(list)
            for iid, pair in pairs.items():
                g[key(iid)].append(pair)
            return sorted(g.items())

        agreement_table("By part of the sample", grouped(part_name), out)
        agreement_table("By criterion", grouped(lambda iid: items[iid]["criterion"]), out)
        agreement_table("By claim kind", grouped(lambda iid: items[iid]["claimKind"]), out)
        agreement_table("By study", grouped(lambda iid: common.STUDY_NAME[items[iid]["study"]]), out)
        judges = []
        for who in ("auditor", "skeptic"):
            jp = [((claude[iid].get(who) or {}).get("label"), j["label"]) for iid, j in mine.items() if (claude[iid].get(who) or {}).get("label") in LABELS]
            judges.append((f"the {who}", jp))
        agreement_table("With each judge", judges, out)

        causes = Counter((claude[iid].get("finalCause") or "none given", j["cause"] or "none given") for iid, j in mine.items()
                         if claude[iid]["final"] == "false_positive" and j["label"] == "false_positive")
        if causes:
            out += ["#### Causes, where both say false positive", "", "| Claude's cause | the person's cause | items |", "| --- | --- | ---: |"]
            out += [f"| {a} | {b} | {n} |" for (a, b), n in sorted(causes.items(), key=lambda kv: (-kv[1], kv[0]))] + [""]

        differ = [iid for iid, (a, b) in pairs.items() if a != b]
        if differ:
            out += [f"#### Where they differ ({len(differ)})", "", "| item | claim | Claude | person | person's cause | person's note |", "| --- | --- | --- | --- | --- | --- |"]
            for iid in sorted(differ, key=lambda i: (items[i]["claimKind"], i)):
                j = mine[iid]
                note = j["rationale"].replace("|", "/").replace("\n", " ")
                note = note if len(note) <= 160 else note[:159] + "…"
                out.append(f"| {iid} | {items[iid]['claimKind']} | {SHORT[claude[iid]['final']]} | {SHORT[j['label']]} | {j['cause'] or ''} | {note} |")
            out.append("")
        result["people"][p] = {"labelled": len(mine), "overall": k,
                               "byCriterion": {c: kappa_row(v) for c, v in grouped(lambda iid: items[iid]["criterion"])},
                               "byClaim": {c: kappa_row(v) for c, v in grouped(lambda iid: items[iid]["claimKind"])},
                               "byPart": {c: kappa_row(v) for c, v in grouped(part_name)}}

    # Human-human.
    out += ["## Between people", ""]
    if len(names) < 2:
        out += ["Only one person's labels were given.", ""]
    else:
        a, b = names[0], names[1]
        both = sorted(set(people[a]) & set(people[b]))
        hh = [(people[a][i]["label"], people[b][i]["label"]) for i in both]
        k = kappa_row(hh)
        if k:
            out += [f"{a} and {b} both labelled {len(both)} items: {k['agree']} agree ({k['observed']:.2f}), kappa {fmt_k(k)} "
                    f"(the plan asks for 0.61 or more); on the items both decided, {k['decidedAgree']} of {k['decided']}.", ""]
            out += confusion(hh, a, b) + [""]
            ka = kappa_row([(claude[i]["final"], people[a][i]["label"]) for i in both])
            kb = kappa_row([(claude[i]["final"], people[b][i]["label"]) for i in both])
            out += [f"On the same items, kappa with the Claude labels: {a} {fmt_k(ka)}, {b} {fmt_k(kb)}.", ""]
            result["humanHuman"] = {"people": [a, b], **k}
            if len(names) > 2:
                out += [f"Other people's labels ({', '.join(names[2:])}) are counted above, not here.", ""]
        else:
            out += [f"{a} and {b} labelled no item in common.", ""]

    # Precision.
    mine = {iid: j["label"] for iid, j in people[primary].items()}
    sampled = set(items)
    out += ["## Precision with human labels (estimates from a sample)", "",
            f"Labels: {primary}. Population: each study's default-threshold judged findings, burst pages included, as its report "
            "counts them; precision is TP / (TP + FP), uncertain left out, with 95% Wilson intervals. Every column but the first "
            "is an estimate from the sample:", "",
            "- **Claude, all**: the study's published number, over every finding.",
            "- **Claude, sampled** and **person, sampled**: the same items, labelled by each. Unweighted: the draw over-represents "
            "rare strata and holds 8 of each 50-finding burst page.",
            "- **Person, stratified**: every finding, each stratum's labelled share weighted by the stratum's size; the interval is "
            "Wilson's at Kish's effective n (n_eff).",
            "- **Claude with the person's labels where sampled**: the study's own count, with the person's label in place of "
            "Claude's on the sampled items.", "",
            "| study | half | Claude, all | sampled | Claude, sampled | person, sampled | person, stratified (n_eff) | Claude with the person's labels where sampled |",
            "| --- | --- | --- | ---: | --- | --- | --- | --- |"]
    population = [r for r in rows if common.part_of(r) in ("judged", "burst")]
    studies = [(s[0], s[3]) for s in common.STUDIES] + [("pooled", "rounds 3–5")]
    for sid, sname in studies:
        for split in SPLITS:
            pop = [r for r in population if (sid == "pooled" or r["study"] == sid) and (split == "all" or r["split"] == split)]
            if not pop:
                continue
            ids = [common.item_id(r) for r in pop]
            labelled = [i for i in ids if i in sampled and i in mine]
            pc = precision([r["final"] for r in pop])
            cs = precision([claude[i]["final"] for i in labelled])
            hs = precision([mine[i] for i in labelled])
            st = stratified(pop, sampled, mine)
            sub = precision([mine.get(i, by_id[i]["final"]) if i in sampled else by_id[i]["final"] for i in ids])

            def cell(x):
                return f"{fmt_p(x['p'], 3)}{fmt_ci(x['ci'])} {x['tp']}/{x['fp']}/{x['unc']}"

            st_cell = f"{fmt_p(st['p'], 3)}{fmt_ci(st['ci'])} ({st['neff']:.0f})" + (f", {st['fallback']} on Claude's labels" if st["fallback"] else "")
            out.append(f"| {sname} | {split} | {cell(pc)} | {len(labelled)} | {cell(cs)} | {cell(hs)} | {st_cell} | {cell(sub)} |")
            result["precision"][f"{sid} {split}"] = {"claudeAll": pc, "sampled": len(labelled), "claudeSampled": cs, "personSampled": hs,
                                                     "personStratified": st, "claudeWithPerson": sub}
    out += ["", "Cells read precision (interval) TP/FP/uncertain.", ""]

    # Suggestions.
    out += ["## Sampled suggestions", "", "Items Rampa reported as needing review, drawn from the suggestions rounds 4 and 5 had already sampled and "
            "labelled. A true one is a failure the default report does not show: a recall cost.", "",
            "| study | sampled | labelled | Claude TP/FP/unc | person TP/FP/unc |", "| --- | ---: | ---: | --- | --- |"]
    for sid in common.SUGGESTION_STUDIES:
        ids = [i for i, it in items.items() if it["part"] == "suggestion" and it["study"] == sid]
        lab = [i for i in ids if i in mine]
        cc = Counter(claude[i]["final"] for i in lab)
        hc = Counter(mine[i] for i in lab)
        out.append(f"| {common.STUDY_NAME[sid]} | {len(ids)} | {len(lab)} | {cc['true_positive']}/{cc['false_positive']}/{cc['uncertain']} | "
                   f"{hc['true_positive']}/{hc['false_positive']}/{hc['uncertain']} |")
        result["suggestions"][sid] = {"sampled": len(ids), "labelled": len(lab), "claude": dict(cc), "person": dict(hc)}
    out.append("")

    text = "\n".join(out)
    sys.stdout.reconfigure(encoding="utf-8")
    print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text + "\n")
    if args.json:
        common.write_json(args.json, result)


if __name__ == "__main__":
    main()
