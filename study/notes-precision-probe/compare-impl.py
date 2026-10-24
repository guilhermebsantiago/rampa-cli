"""The implementation of the probe's interventions, run on the recorded snapshots of studies 2 and 3, against the labels.

Reads the reports that run-impl.sh wrote (data/impl/<study>.<slug>.report.json), matches every judgment finding at the
default threshold to the studies' labels by page, criterion and element, and prints precision per study and split,
per criterion, with 95% Wilson intervals; what the second pass did (confirmed, denied, could not ask); the labelled
findings that are gone and why; and the new, unlabelled findings. For the second study, 2.4.4 and 2.4.6 were not run
(their prompts changed version since the study's run and the answers were not kept): their default-threshold findings
are taken from the study's re-judged run (study s2-after in data/rows.json) with the two changes that touch them
applied as in simulate.py (a raw address in a sentence and a shared label become suggestions), and said so.

Every number is in-sample: these pages were read to choose the interventions.

Run from the repository root: python -I study/notes-precision-probe/compare-impl.py
"""
from __future__ import annotations

import collections
import glob
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
sys.stdout.reconfigure(encoding='utf-8', newline='\n')


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (p, max(0.0, c - h), min(1.0, c + h))


def fmt(k, n):
    if n == 0:
        return '–'
    p, lo, hi = wilson(k, n)
    return f'{p:.2f} ({lo:.2f}–{hi:.2f})'


STUDIES = {
    'round-3-2026-10-23': {'name': 's3', 'labels': ('s3',), 'pages': os.path.join(HERE, '..', 'round-3-2026-10-23', 'data', 'pages-input.json')},
    'fresh-2026-10-11': {'name': 's2', 'labels': ('s2', 's2-after'), 'pages': os.path.join(HERE, '..', 'fresh-2026-10-11', 'data', 'pages-input.json')},
}
NOT_RUN_ON_S2 = {'2.4.4', '2.4.6'}

rows = load(os.path.join(DATA, 'rows.json'))
labels = {}
for r in rows:
    if r['check'].startswith('judgment') and r['study'] in ('s2', 's2-after', 's3'):
        labels.setdefault((r['study'], r['slug'], r['criterion'], r['ref']), r)


def label_of(study_names, slug, criterion, ref):
    for study in study_names:
        r = labels.get((study, slug, criterion, ref))
        if r:
            return r
    return None


def counts(items):
    c = collections.Counter(r['final'] for r in items)
    return c['true_positive'], c['false_positive'], c['uncertain']


print('# The implementation on the recorded snapshots of studies 2 and 3 (in-sample)\n')
summary_rows = []
for folder, meta in STUDIES.items():
    split_of = {p['slug']: p['split'] for p in load(meta['pages'])['pages']}
    reports = {os.path.basename(p).split('.')[1]: load(p) for p in glob.glob(os.path.join(DATA, 'impl', f'{folder}.*.report.json'))}
    print(f"## {meta['name']}: {len(reports)} reports\n")
    matched, new, gone = [], [], []
    passes = collections.Counter()
    # Findings shown today, with their labels.
    for slug, report in reports.items():
        for f in report.get('findings', []):
            # The runs used --min-confidence low, so `findings` holds every level: the default threshold is applied here.
            if f.get('source') != 'judgment' or f.get('confidence') not in ('medium', 'high') or f.get('experimental'):
                continue
            r = label_of(meta['labels'], slug, f['criterion'], f['ref'])
            if r:
                matched.append({**r, 'split': split_of.get(slug), 'confirmation': f.get('confirmation')})
            else:
                new.append({'slug': slug, 'split': split_of.get(slug), 'criterion': f['criterion'], 'message': f['message'], 'confirmation': f.get('confirmation')})
            if f.get('confirmation'):
                passes['confirmed'] += 1
        for item in report.get('needsReview', []):
            if item.get('model') and item['criterion'] == '1.1.1' and 'second pass' in (item.get('evidence') or ''):
                passes['denied' if 'did not confirm' in item['evidence'] else 'not asked'] += 1
        summary = {c['criterion']: c for c in report.get('criteria', [])}
        for c in summary.values():
            passes['summary unconfirmed'] += c.get('unconfirmed', 0)
            passes['summary confirmed'] += c.get('confirmed', 0)
    # For s2, the criteria not run: the re-judged run's default-threshold findings, with the two rule changes applied.
    carried = []
    if meta['name'] == 's2':
        for (study, slug, criterion, ref), r in labels.items():
            if study != 's2-after' or criterion not in NOT_RUN_ON_S2 or not r['shown']:
                continue
            if r['claim'] == 'link-url' or r['claim'].startswith('label'):
                continue
            carried.append({**r, 'split': split_of.get(slug)})
    # Labelled default-threshold findings of the study's latest run that are not shown now.
    shown_now = {(r['slug'], r['criterion'], r['ref']) for r in matched + carried}
    for (study, slug, criterion, ref), r in labels.items():
        if study not in meta['labels'] or not r['shown'] or slug not in reports:
            continue
        if meta['name'] == 's2' and ((study == 's2' and criterion in NOT_RUN_ON_S2) or (study == 's2-after' and criterion not in NOT_RUN_ON_S2)):
            continue
        if (slug, criterion, ref) not in shown_now:
            gone.append({**r, 'split': split_of.get(slug)})
    print('| split | criterion | TP | FP | unc | new (unlabelled) | precision on labelled |')
    print('| --- | --- | ---: | ---: | ---: | ---: | --- |')
    for split in ('dev', 'test'):
        items = [r for r in matched + carried if r['split'] == split]
        for criterion in sorted({r['criterion'] for r in items} | {n['criterion'] for n in new if n['split'] == split}):
            tp, fp, un = counts([r for r in items if r['criterion'] == criterion])
            fresh = sum(1 for n in new if n['split'] == split and n['criterion'] == criterion)
            print(f'| {split} | {criterion}{" (carried from s2-after)" if meta["name"] == "s2" and criterion in NOT_RUN_ON_S2 else ""} | {tp} | {fp} | {un} | {fresh} | {fmt(tp, tp + fp)} |')
        tp, fp, un = counts(items)
        fresh = sum(1 for n in new if n['split'] == split)
        before = [r for r in labels.values() if r['shown'] and r['study'] in meta['labels'] and split_of.get(r['slug']) == split and not (meta['name'] == 's2' and ((r['study'] == 's2' and r['criterion'] in NOT_RUN_ON_S2) or (r['study'] == 's2-after' and r['criterion'] not in NOT_RUN_ON_S2)))]
        btp, bfp, _ = counts(before)
        print(f'| {split} | **all** | {tp} | {fp} | {un} | {fresh} | **{fmt(tp, tp + fp)}** (before: {fmt(btp, btp + bfp)}) |')
        summary_rows.append((meta['name'], split, btp, bfp, tp, fp, un, fresh))
    tp, fp, un = counts(matched + carried)
    print(f"\nBoth halves: {tp} TP, {fp} FP, {un} uncertain: **{fmt(tp, tp + fp)}**. Second pass: {dict(passes)}.\n")
    print('Labelled findings gone (TP = a true positive lost):')
    for r in sorted(gone, key=lambda r: (r['final'], r['slug'])):
        print(f"- {r['final'][:2]} {r['split']} {r['slug']} {r['criterion']} {r['claim']}: {r['subject']!r}")
    print('\nNew findings, unlabelled:')
    for n in new:
        print(f"- {n['split']} {n['slug']} {n['criterion']}: {n['message'][:120]} {n['confirmation'] or ''}")
    print()

print('## Summary (in-sample)\n')
print('| study | split | before TP/FP | before precision | after TP/FP/unc | after precision | new unlabelled |')
print('| --- | --- | --- | --- | --- | --- | ---: |')
for name, split, btp, bfp, tp, fp, un, fresh in summary_rows:
    print(f'| {name} | {split} | {btp}/{bfp} | {fmt(btp, btp + bfp)} | {tp}/{fp}/{un} | {fmt(tp, tp + fp)} | {fresh} |')
btp = sum(r[2] for r in summary_rows)
bfp = sum(r[3] for r in summary_rows)
tp = sum(r[4] for r in summary_rows)
fp = sum(r[5] for r in summary_rows)
print(f'| **all** | | {btp}/{bfp} | {fmt(btp, btp + bfp)} | {tp}/{fp} | **{fmt(tp, tp + fp)}** | {sum(r[7] for r in summary_rows)} |')
