"""Which claims should be findings and which only suggestions: a policy fitted on some studies, checked on another.

For each claim (criterion and the kind of problem the message states) the labelled findings at the default threshold
are counted per study. A policy keeps a claim as a finding when its precision on the fitting studies is at least the
target; the other claims become suggestions. The policy is then applied to the held-out study, and the precision there
is what a fresh set of pages would have seen. Two directions: fit on studies 1 (first run and re-measure) and 2 (after
the 2.4.4/2.4.6 change), check on 3; fit on 2 and 3, check on 1. Both are optimistic in a weaker way than the
simulations: the claims were named after reading all three studies, but the decision for each is taken without the
held-out study's labels.

Run from the repository root: python -I study/notes-precision-probe/policy.py
"""
from __future__ import annotations

import collections
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.stdout.reconfigure(encoding='utf-8', newline='\n')


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


with open(os.path.join(HERE, 'data', 'rows-latest.json'), encoding='utf-8') as f:
    rows = [r for r in json.load(f) if r['check'].startswith('judgment') and r['shown']]

STUDY_GROUPS = {'s1': ('s1', 's1-remeasure'), 's2': ('s2-after',), 's3': ('s3',)}


def counts(items):
    c = collections.Counter(r['final'] for r in items)
    return c['true_positive'], c['false_positive'], c['uncertain']


claims = sorted({(r['criterion'], r['claim']) for r in rows})
print('# Claims as findings or suggestions: a policy fitted on some studies, checked on another\n')
print('Default-threshold judgment findings only. Each cell is TP/FP/uncertain.\n')
print('| criterion · claim | s1 (first run + re-measure) | s2 (after the 2.4.4/2.4.6 change) | s3 |')
print('| --- | --- | --- | --- |')
for crit, claim in claims:
    cells = []
    for group, names in STUDY_GROUPS.items():
        tp, fp, un = counts([r for r in rows if r['study'] in names and (r['criterion'], r['claim']) == (crit, claim)])
        cells.append(f'{tp}/{fp}/{un}')
    print(f'| {crit} · {claim} | ' + ' | '.join(cells) + ' |')


def policy(fit_groups, target):
    keep = set()
    for crit, claim in claims:
        tp, fp, _ = counts([r for r in rows if r['study'] in sum((STUDY_GROUPS[g] for g in fit_groups), ()) and (r['criterion'], r['claim']) == (crit, claim)])
        # A claim never seen on the fitting studies is kept: there is no evidence against it.
        if tp + fp == 0 or tp / (tp + fp) >= target:
            keep.add((crit, claim))
    return keep


def apply(keep, group):
    items = [r for r in rows if r['study'] in STUDY_GROUPS[group]]
    kept = [r for r in items if (r['criterion'], r['claim']) in keep]
    tp0, fp0, _ = counts(items)
    tp1, fp1, _ = counts(kept)
    return tp0, fp0, tp1, fp1


print('\n## Policies\n')
print('| fitted on | target precision for a claim to stay a finding | claims kept | checked on | before | after | TP kept |')
print('| --- | --- | --- | --- | --- | --- | --- |')
for fit, check in ((('s1', 's2'), 's3'), (('s2', 's3'), 's1'), (('s1', 's3'), 's2')):
    for target in (0.3, 0.5, 0.7):
        keep = policy(fit, target)
        tp0, fp0, tp1, fp1 = apply(keep, check)
        kept = ', '.join(f'{c} {k}' for c, k in sorted(keep) if any(r['study'] in STUDY_GROUPS[check] and (r['criterion'], r['claim']) == (c, k) for r in rows))
        print(f'| {"+".join(fit)} | {target} | {kept} | {check} | {fmt(tp0, tp0 + fp0)} | {fmt(tp1, tp1 + fp1)} | {tp1} of {tp0} |')
