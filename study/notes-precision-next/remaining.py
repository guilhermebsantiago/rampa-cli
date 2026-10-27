"""What is left after the merged precision work, across the labelled findings of studies 2, 3 and 4.

Studies 2 and 3: the merged code replayed on the recorded snapshots (study/notes-precision-probe/data/impl, in-sample),
matched to the labels of study/notes-precision-probe/data/rows.json the way compare-impl.py does. Study 4: the main run's
labelled findings (study/round-4-2026-10-24/data/findings.json), judged criteria at the default threshold, out-of-sample.
Prints, per page and claim, the false positives that remain; how much of each half's error sits on one or two pages; and
counterfactual filters (the planned fixes, a per-page cap, a 3.1.2 policy, the 0.99 cut) with TP lost and precision.

Run from the repository root: python -I study/notes-precision-next/remaining.py
"""
from __future__ import annotations

import collections
import glob
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STUDY = os.path.dirname(HERE)
PROBE = os.path.join(STUDY, 'notes-precision-probe', 'data')
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


def fmt(tp, fp):
    n = tp + fp
    if n == 0:
        return '–'
    p, lo, hi = wilson(tp, n)
    return f'{tp} / {fp}: {p:.2f} ({lo:.2f}–{hi:.2f})'


# ---- studies 2 and 3: merged code on the recordings, with labels ----
STUDIES = {
    'round-3-2026-10-23': {'name': 's3', 'labels': ('s3',)},
    'fresh-2026-10-11': {'name': 's2', 'labels': ('s2', 's2-after')},
}
NOT_RUN_ON_S2 = {'2.4.4', '2.4.6'}
rows = load(os.path.join(PROBE, 'rows.json'))
labels = {}
for r in rows:
    if r['check'].startswith('judgment') and r['study'] in ('s2', 's2-after', 's3'):
        labels.setdefault((r['study'], r['slug'], r['criterion'], r['ref']), r)

items = []  # every labelled default-threshold finding the merged code still shows
for folder, meta in STUDIES.items():
    split_of = {p['slug']: p['split'] for p in load(os.path.join(STUDY, folder, 'data', 'pages-input.json'))['pages']}
    for path in glob.glob(os.path.join(PROBE, 'impl', f'{folder}.*.report.json')):
        slug = os.path.basename(path).split('.')[1]
        for f in load(path).get('findings', []):
            if f.get('source') != 'judgment' or f.get('confidence') not in ('medium', 'high') or f.get('experimental'):
                continue
            for study in meta['labels']:
                r = labels.get((study, slug, f['criterion'], f['ref']))
                if r:
                    conf = f.get('confirmation') or {}
                    items.append({'study': meta['name'], 'split': split_of.get(slug), 'slug': slug, 'criterion': f['criterion'],
                                  'claim': r['claim'], 'final': r['final'], 'cause': r['cause'], 'subject': r['subject'],
                                  'minP': conf.get('minProbability')})
                    break
    if meta['name'] == 's2':
        for (study, slug, criterion, ref), r in labels.items():
            if study != 's2-after' or criterion not in NOT_RUN_ON_S2 or not r['shown']:
                continue
            if r['claim'] == 'link-url' or r['claim'].startswith('label'):
                continue
            items.append({'study': 's2', 'split': split_of.get(slug), 'slug': slug, 'criterion': criterion, 'claim': r['claim'],
                          'final': r['final'], 'cause': r['cause'], 'subject': r['subject'], 'minP': None})

# ---- study 4: the main run, judged criteria, default threshold ----
for f in load(os.path.join(STUDY, 'round-4-2026-10-24', 'data', 'findings.json')):
    if f['origin'] != 'main' or f['group'] != 'judged' or f['confidence'] not in ('medium', 'high'):
        continue
    conf = f.get('confirmation') or {}
    claim = f['criterion']
    msg = f.get('message') or ''
    if f['criterion'] == '2.4.4':
        claim = 'link-ambiguous' if 'shared by' in msg else ('link-url' if 'address' in msg else 'link-other')
    elif f['criterion'] == '1.1.1':
        claim = 'wrong_content' if 'describes something' in msg else 'other'
    items.append({'study': 's4', 'split': f['split'], 'slug': f['slug'], 'criterion': f['criterion'], 'claim': claim,
                  'final': f['final'], 'cause': f.get('finalCause') or 'none', 'subject': f.get('subject'), 'minP': conf.get('minProbability')})


def table(group_fn, title, rows_):
    c = collections.defaultdict(lambda: [0, 0, 0])
    for it in rows_:
        k = group_fn(it)
        c[k][{'true_positive': 0, 'false_positive': 1, 'uncertain': 2}[it['final']]] += 1
    print(f'\n### {title}\n')
    print('| group | TP | FP | unc | precision |\n| --- | ---: | ---: | ---: | --- |')
    for k, (tp, fp, un) in sorted(c.items(), key=lambda kv: (-kv[1][1], kv[0])):
        print(f'| {k} | {tp} | {fp} | {un} | {fmt(tp, fp)} |')
    return c


print('# Remaining labelled findings after the merged precision work (s2, s3 replayed in-sample; s4 out-of-sample)')
table(lambda it: f"{it['study']} {it['split']}", 'By study and half', items)
table(lambda it: f"{it['criterion']} {it['claim']}", 'By criterion and claim', items)
fps = [it for it in items if it['final'] == 'false_positive']
table(lambda it: f"{it['study']} {it['split']} {it['slug']} {it['criterion']} {it['claim']} ({it['cause']})", 'False positives by page and claim', fps)

# ---- bursts: findings per (page, criterion) ----
print('\n### Findings per page and criterion (bursts), TP / FP\n')
burst = collections.defaultdict(lambda: [0, 0])
for it in items:
    if it['final'] in ('true_positive', 'false_positive'):
        burst[(it['study'], it['split'], it['slug'], it['criterion'])][0 if it['final'] == 'true_positive' else 1] += 1
print('| study | split | page | criterion | TP | FP |\n| --- | --- | --- | --- | ---: | ---: |')
for (s, sp, slug, crit), (tp, fp) in sorted(burst.items(), key=lambda kv: -(kv[1][0] + kv[1][1]))[:14]:
    print(f'| {s} | {sp} | {slug} | {crit} | {tp} | {fp} |')
print('\nShare of each half\'s FP on its top FP page:')
for key in sorted({(it['study'], it['split']) for it in items}):
    half = [it for it in fps if (it['study'], it['split']) == key]
    by_page = collections.Counter(it['slug'] for it in half)
    top = by_page.most_common(2)
    print(f'- {key[0]} {key[1]}: {len(half)} FP; top page {top[0] if top else None}; top two {sum(v for _, v in top)}')


# ---- counterfactual filters ----
def simulate(name, drop_fn):
    print(f'\n### {name}\n')
    print('| set | before | after | TP lost | FP gone | sample |\n| --- | --- | --- | ---: | ---: | --- |')
    sets = [('s2 dev', 's2', 'dev'), ('s2 test', 's2', 'test'), ('s3 dev', 's3', 'dev'), ('s3 test', 's3', 'test'),
            ('s4 dev', 's4', 'dev'), ('s4 test', 's4', 'test'), ('s4 both', 's4', None), ('all', None, None)]
    for label, study, split in sets:
        sub = [it for it in items if (study is None or it['study'] == study) and (split is None or it['split'] == split)]
        before = [it for it in sub if it['final'] != 'uncertain']
        after = [it for it in before if not drop_fn(it)]
        btp = sum(it['final'] == 'true_positive' for it in before)
        bfp = len(before) - btp
        atp = sum(it['final'] == 'true_positive' for it in after)
        afp = len(after) - atp
        sample = 'in-sample' if study in ('s2', 's3') else ('out-of-sample' if study == 's4' else 'mixed')
        if study == 's4' and split == 'dev':
            sample = 'out-of-sample (dev: read for choosing)'
        print(f'| {label} | {fmt(btp, bfp)} | {fmt(atp, afp)} | {btp - atp} | {bfp - afp} | {sample} |')


# Planned fixes: ufpe.br's 50 (the unstyled guard, which the replay could not apply) and toolstation's 50 (H81 context).
PLANNED_PAGES = {('s3', 'www-ufpe-br', '2.4.4'), ('s4', 'toolstation-plumbing', '2.4.4')}
slugs_ufpe = {it['slug'] for it in items if 'ufpe' in it['slug']}
print('\nufpe slugs seen:', slugs_ufpe)


def planned(it):
    return (it['criterion'] == '2.4.4' and ('ufpe' in it['slug'] or it['slug'] == 'toolstation-plumbing'))


simulate('P0: planned fixes (unstyled guard on ufpe.br, H81 context on toolstation.com)', planned)

# Burst cap: at most K findings per page and criterion; the ones beyond K are dropped in proportion (order unknown).
per_page = collections.defaultdict(list)
for it in items:
    if it['final'] != 'uncertain':
        per_page[(it['study'], it['slug'], it['criterion'])].append(it)
for K in (3, 5, 8):
    dropped = set()
    for key, lst in per_page.items():
        if len(lst) > K:
            # worst case for TP: drop proportionally, rounding against the cap (TP dropped = round(share))
            tps = [x for x in lst if x['final'] == 'true_positive']
            fps_ = [x for x in lst if x['final'] == 'false_positive']
            n_drop = len(lst) - K
            tp_drop = round(n_drop * len(tps) / len(lst))
            fp_drop = n_drop - tp_drop
            for x in tps[:tp_drop] + fps_[:fp_drop]:
                dropped.add(id(x))
    simulate(f'B{K}: after P0, at most {K} findings per page and criterion (beyond that, a page-level note), proportional drop', lambda it, d=dropped: planned(it) or id(it) in d)


# 3.1.2 policy: a 3.1.2 claim is a finding only with a deterministic fact (language identifier agreeing); museudoamanha's 8 were a collector error.
def policy_312(it):
    return planned(it) or (it['criterion'] == '3.1.2' and it['slug'] == 'museudoamanha')


simulate('C1: after P0, 3.1.2 on museudoamanha dropped (a collector-error check: text read as foreign that is the page language, or a repeated burst)', policy_312)


# 0.99 cut on 1.1.1 confirmations
def cut99(it):
    return planned(it) or (it['criterion'] == '1.1.1' and it['minP'] is not None and it['minP'] < 0.99)


simulate('C2: after P0, 1.1.1 findings whose lowest confirming probability is under 0.99 dropped', cut99)


# All 2.4.4 shared-text to suggestions (the deterministic-fact-only reading)
def no_ambiguous(it):
    return it['criterion'] == '2.4.4' and it['claim'] == 'link-ambiguous'


simulate('C3: every 2.4.4 shared-text ("ambiguous") finding a suggestion (instead of P0)', no_ambiguous)
simulate('C4: P0 + C1 + C2', lambda it: planned(it) or policy_312(it) or cut99(it))


# Collapse instead of drop: a group of more than N findings with one page, criterion and claim becomes one page-level finding,
# labelled by the group's majority label. Counted as findings, a wrong burst costs 1 FP instead of 50 and a right one keeps 1 TP.
def collapsed(n_max, extra_drop=lambda it: False):
    groups = collections.defaultdict(list)
    for it in items:
        if it['final'] != 'uncertain' and not extra_drop(it):
            groups[(it['study'], it['split'], it['slug'], it['criterion'], it['claim'])].append(it)
    out = []
    for key, lst in groups.items():
        if len(lst) > n_max:
            tp = sum(x['final'] == 'true_positive' for x in lst)
            out.append({**lst[0], 'final': 'true_positive' if tp * 2 >= len(lst) else 'false_positive', 'collapsed': len(lst)})
        else:
            out.extend(lst)
    return out


for n_max, extra, name in ((5, lambda it: False, 'K1: collapse groups > 5 (page, criterion, claim) into one page-level finding, no planned fixes'),
                           (5, planned, 'K2: P0, then collapse groups > 5')):
    print(f'\n### {name}\n')
    print('| set | before | after (collapsed count) | sample |\n| --- | --- | --- | --- |')
    col = collapsed(n_max, extra)
    for label, study, split in (('s2 dev', 's2', 'dev'), ('s2 test', 's2', 'test'), ('s3 dev', 's3', 'dev'), ('s3 test', 's3', 'test'),
                                ('s4 dev', 's4', 'dev'), ('s4 test', 's4', 'test'), ('s4 both', 's4', None), ('all', None, None)):
        pick = lambda lst: [it for it in lst if (study is None or it['study'] == study) and (split is None or it['split'] == split) and it['final'] != 'uncertain']
        b, a = pick(items), pick(col)
        btp = sum(it['final'] == 'true_positive' for it in b); atp = sum(it['final'] == 'true_positive' for it in a)
        sample = 'in-sample' if study in ('s2', 's3') else ('out-of-sample' if study == 's4' else 'mixed')
        print(f'| {label} | {fmt(btp, len(b) - btp)} | {fmt(atp, len(a) - atp)} | {sample} |')
