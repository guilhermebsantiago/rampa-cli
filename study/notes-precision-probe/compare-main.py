"""What today's main (15b1149) reports on the third study's recorded snapshots, against the study's labelled run.

Reads the reports that run-main.sh wrote (data/main-15b1149/<slug>.report.json: the recorded 2.4.4, 2.4.6, 1.3.5,
2.4.2, 3.1.x and 3.3.2 answers read back, 1.1.1 asked again with the version-5 prompt) and the study's labels
(data/rows.json, study s3), matches findings by page, criterion and element, and counts what disappeared (with its
label) and what is new (unlabelled). Also counts the suggestions (needsReview items from the model).

Run from the repository root: python -I study/notes-precision-probe/compare-main.py
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


rows = [r for r in load(os.path.join(DATA, 'rows.json')) if r['study'] == 's3' and r['check'].startswith('judgment')]
labels = {(r['slug'], r['criterion'], r['ref']): r for r in rows}
split_of = {p['slug']: p['split'] for p in load(os.path.join(HERE, '..', 'round-3-2026-10-23', 'data', 'pages-input.json'))['pages']}

today = {}
suggestions = collections.Counter()
discarded = collections.Counter()
for path in glob.glob(os.path.join(DATA, 'main-15b1149', '*.report.json')):
    slug = os.path.basename(path).replace('.report.json', '')
    report = load(path)
    for f in report.get('findings', []) + report.get('belowThreshold', []):
        if f.get('source') != 'judgment':
            continue
        shown = f in report.get('findings', [])
        today[(slug, f['criterion'], f['ref'])] = {**f, 'slug': slug, 'shown': shown}
    for item in report.get('needsReview', []):
        if item.get('model'):
            suggestions[(split_of.get(slug), item['criterion'])] += 1
    for d in report.get('discarded', []):
        discarded[(d['criterion'], d.get('reason'))] += 1

print('# Today\'s main (15b1149) on the third study\'s snapshots\n')
print(f'{len(glob.glob(os.path.join(DATA, "main-15b1149", "*.report.json")))} reports; {len(today)} judgment findings today, {len(labels)} labelled in the study.\n')

# Fate of each labelled finding.
fate = collections.Counter()
gone = collections.defaultdict(list)
for key, r in labels.items():
    t = today.get(key)
    if t is None:
        fate[(r['criterion'], r['final'], 'gone')] += 1
        gone[r['criterion']].append(r)
    elif t['shown'] != r['shown']:
        fate[(r['criterion'], r['final'], 'moved threshold')] += 1
    elif t['message'] != r['message']:
        fate[(r['criterion'], r['final'], 'claim changed')] += 1
    else:
        fate[(r['criterion'], r['final'], 'same')] += 1

print('## The study\'s labelled judgment findings today\n')
print('| criterion | label | fate | count |')
print('| --- | --- | --- | ---: |')
for (crit, label, what), n in sorted(fate.items()):
    print(f'| {crit} | {label} | {what} | {n} |')

print('\n## New findings today (no label in the study)\n')
new = [t for key, t in today.items() if key not in labels]
by = collections.Counter((split_of.get(t['slug']), t['criterion'], t['shown']) for t in new)
print('| split | criterion | shown | count |')
print('| --- | --- | --- | ---: |')
for (split, crit, shown), n in sorted(by.items(), key=lambda kv: str(kv[0])):
    print(f'| {split} | {crit} | {shown} | {n} |')
for t in sorted(new, key=lambda t: (t['slug'], t['criterion'])):
    print(f"- {split_of.get(t['slug'])} {t['slug']} {t['criterion']}: {t['message'][:140]}")

print('\n## Precision today with the study\'s labels (matched findings only; new findings unlabelled)\n')
print('| split | criterion | TP | FP | unc | new (unlabelled) | precision on labelled |')
print('| --- | --- | ---: | ---: | ---: | ---: | --- |')
for split in ('dev', 'test'):
    for crit in sorted({r['criterion'] for r in rows}):
        matched = [labels[k] for k, t in today.items() if k in labels and t['shown'] and labels[k]['criterion'] == crit and split_of.get(k[0]) == split]
        c = collections.Counter(r['final'] for r in matched)
        fresh = sum(1 for t in new if t['shown'] and t['criterion'] == crit and split_of.get(t['slug']) == split)
        if not matched and not fresh:
            continue
        print(f"| {split} | {crit} | {c['true_positive']} | {c['false_positive']} | {c['uncertain']} | {fresh} | {fmt(c['true_positive'], c['true_positive'] + c['false_positive'])} |")
    matched = [labels[k] for k, t in today.items() if k in labels and t['shown'] and split_of.get(k[0]) == split]
    c = collections.Counter(r['final'] for r in matched)
    fresh = sum(1 for t in new if t['shown'] and split_of.get(t['slug']) == split)
    study = collections.Counter(r['final'] for r in rows if r['shown'] and split_of.get(r['slug']) == split)
    print(f"| {split} | **all** | {c['true_positive']} | {c['false_positive']} | {c['uncertain']} | {fresh} | {fmt(c['true_positive'], c['true_positive'] + c['false_positive'])} (study: {fmt(study['true_positive'], study['true_positive'] + study['false_positive'])}) |")

print('\n## Suggestions (needsReview from the model) per split and criterion\n')
for (split, crit), n in sorted(suggestions.items(), key=lambda kv: str(kv[0])):
    print(f'- {split} {crit}: {n}')
print('\n## Claims verification discarded today, by reason\n')
for (crit, reason), n in sorted(discarded.items(), key=lambda kv: (-kv[1], str(kv[0]))):
    print(f'- {crit}: {n} · {reason}')

print('\n## Labelled findings that are gone today, by page\n')
for crit, items in gone.items():
    for r in items:
        print(f"- {r['final'][:2]} {r['slug']} {crit}: {r['subject']!r}")
