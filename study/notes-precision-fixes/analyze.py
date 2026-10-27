"""Precision of one replay (replay.sh) of the second, third and fourth real-page studies, against the studies' labels.

Every number is in-sample: all six halves of the three studies have been read (docs/studies/notes-precision-check.md).

Counting, fixed before the final replay (docs/studies/notes-precision-fixes.md, "Frozen rules"):
- a finding is a judgment finding at the default threshold: source judgment, confidence medium or high, not
  experimental (the replays use --min-confidence low, so the threshold is applied here);
- it is matched to a label by page, criterion and element (`ref`); s4 labels come from every origin of the fourth
  study (main run, --no-confirm ablation, suggestion sample), s3 from the third study, s2 from the second study's run
  and its re-judged run (`s2-after`), in that order;
- s2's 2.4.4 and 2.4.6 were not replayed (replay.sh): their default-threshold findings are the re-judged run's, with
  the rules since applied (a raw address in a sentence and a shared label are suggestions; F1's shared-text fact from
  data/shared-text.json; a page the replay found unstyled moves them all to suggestions);
- precision per element: TP / (TP + FP), uncertain findings left out, Wilson 95%;
- precision per group (the group definition shared with the report's collapse): on one page, findings with the same
  criterion, the same check id (`judgment/<criterion>` for every finding counted here) and the same claim kind form a
  group when there are more than BURST = 5 of them, i.e. 6 or more; a group counts as one finding, labelled with the
  label most of its labelled members have (true, false or uncertain), uncertain on a tie; unlabelled members are left
  out of that vote; mixed groups are listed;
- per page: precision on each page with a decided finding, the share of those pages on which every decided finding is
  a TP, and the mean of the pages' precisions; and a page bootstrap of the per-element precision (10,000 resamples of
  the set's pages with a decided finding, `random.Random(20261027)`, the 2.5th and 97.5th percentiles), since findings
  cluster on pages and the Wilson interval assumes they do not;
- findings with no label are counted apart as "new, unlabelled" and are in no precision.

Run from the repository root: python -I study/notes-precision-fixes/analyze.py <label> [<label> ...]
Writes data/<label>/summary.json and prints markdown tables.
"""
from __future__ import annotations

import collections
import glob
import json
import math
import os
import random
import sys

BURST = 5
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.stdout.reconfigure(encoding='utf-8', newline='\n')

STUDIES = {
    's2': 'fresh-2026-10-11',
    's3': 'round-3-2026-10-23',
    's4': 'round-4-2026-10-24',
}
CARRIED_ON_S2 = {'2.4.4', '2.4.6'}


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def wilson(k, n, z=1.96):
    if n == 0:
        return (float('nan'), 0.0, 0.0)
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
    return f'{p:.2f} ({lo:.2f}–{hi:.2f})'


def split_of(study):
    return {p['slug']: p['split'] for p in load(os.path.join(ROOT, 'study', STUDIES[study], 'data', 'pages-input.json'))['pages']}


# Labels.
rows = load(os.path.join(ROOT, 'study', 'notes-precision-probe', 'data', 'rows.json'))
labels = {}
for r in rows:
    if r['check'].startswith('judgment') and r['study'] in ('s2', 's2-after', 's3'):
        name = 's3' if r['study'] == 's3' else 's2'
        key = (name, r['slug'], r['criterion'], r['ref'])
        # s2: the study's own run first, then the re-judged run.
        if key not in labels or (labels[key]['study'] == 's2-after' and r['study'] == 's2'):
            labels[key] = {'final': r['final'], 'claim': r['claim'], 'subject': r['subject'], 'study': r['study']}
ORIGIN_ORDER = {'main': 0, 'noconfirm-only': 1, 'suggestion-sample': 2}
for r in sorted(load(os.path.join(ROOT, 'study', 'round-4-2026-10-24', 'data', 'findings.json')), key=lambda r: ORIGIN_ORDER.get(r['origin'], 9)):
    if r['source'] != 'judgment':
        continue
    key = ('s4', r['slug'], r['criterion'], r['ref'])
    labels.setdefault(key, {'final': r['final'], 'claim': r.get('kind') or r['criterion'], 'subject': r['subject'], 'study': 's4', 'origin': r['origin']})

shared_text = load(os.path.join(HERE, 'data', 'shared-text.json'))
shared_after = {(r['study'], r['slug'], r['ref']): bool(r['after'] and r['after']['places'] > 1 and not r['after']['apart']) for r in shared_text['rows']}

CLAIM_PATTERNS = [
    ('2.4.4', 'shared by', 'ambiguous'),
    ('2.4.4', 'is an address', 'url_or_filename'),
    ('2.4.4', 'nothing around it does', 'generic'),
    ('2.4.4', 'does not match', 'mismatch'),
]


def claim_of(finding, label):
    """The claim a finding states: the report's own (`claim`, added by the collapse), else read from the message."""
    if finding.get('claim'):
        return finding['claim']
    for criterion, needle, claim in CLAIM_PATTERNS:
        if finding['criterion'] == criterion and needle in finding['message']:
            return claim
    if label and label.get('claim'):
        return label['claim']
    return 'fail'


def shown(finding):
    return finding.get('source') == 'judgment' and finding.get('confidence') in ('medium', 'high') and not finding.get('experimental')


def unstyled(report):
    sheets = ((report.get('coverage') or {}).get('reach') or {}).get('stylesheets') or {}
    return bool(sheets.get('unstyled'))


def collect(label):
    """Every default-threshold judgment finding of a replay, with its label, by study and half."""
    items = []
    for study in STUDIES:
        splits = split_of(study)
        # The full reports where they are, else the part of them compact.py keeps in git.
        paths = glob.glob(os.path.join(HERE, 'data', label, f'{study}.*.report.json')) or glob.glob(os.path.join(HERE, 'data', label, f'{study}.*.judged.json'))
        reports = {os.path.basename(p).split('.')[1]: load(p) for p in paths}
        for slug, report in sorted(reports.items()):
            for f in report.get('findings', []) + report.get('belowThreshold', []):
                if not shown(f):
                    continue
                if study == 's2' and f['criterion'] in CARRIED_ON_S2:
                    continue
                lab = labels.get((study, slug, f['criterion'], f.get('ref')))
                items.append({
                    'study': study, 'split': splits.get(slug), 'slug': slug, 'criterion': f['criterion'], 'ref': f.get('ref'),
                    'claim': claim_of(f, lab), 'final': lab['final'] if lab else 'unlabelled', 'subject': f.get('subject'),
                    'group': f.get('group'), 'confirmation': f.get('confirmation'), 'message': f['message'],
                })
            if study == 's2':
                # The re-judged run's 2.4.4 and 2.4.6 findings, with the rules since applied.
                for (name, lslug, criterion, ref), lab in labels.items():
                    if name != 's2' or lslug != slug or criterion not in CARRIED_ON_S2 or lab['study'] != 's2-after':
                        continue
                    row = next((r for r in rows if r['study'] == 's2-after' and r['slug'] == slug and r['criterion'] == criterion and r['ref'] == ref), None)
                    if not row or not row['shown'] or row['claim'] == 'link-url' or row['claim'].startswith('label'):
                        continue
                    if unstyled(report):
                        continue
                    if row['claim'] == 'link-ambiguous' and label != 'base' and not shared_after.get(('s2', slug, ref), True):
                        continue
                    items.append({
                        'study': 's2', 'split': splits.get(slug), 'slug': slug, 'criterion': criterion, 'ref': ref,
                        'claim': {'link-ambiguous': 'ambiguous', 'link-generic': 'generic'}.get(row['claim'], row['claim']),
                        'final': lab['final'], 'subject': row['subject'], 'group': None, 'confirmation': None, 'message': row['message'], 'carried': True,
                    })
    return items


def counts(items):
    c = collections.Counter(i['final'] for i in items)
    return c['true_positive'], c['false_positive'], c['uncertain'], c['unlabelled']


def groups_of(items):
    """Units after the collapse: one per (page, criterion, check id, claim) with more than BURST findings, else one per finding."""
    by = collections.defaultdict(list)
    for i in items:
        by[(i['study'], i['slug'], i['criterion'], i['claim'])].append(i)
    units = []
    for key, members in by.items():
        if len(members) > BURST:
            tp, fp, un, new = counts(members)
            votes = sorted([(tp, 'true_positive'), (fp, 'false_positive'), (un, 'uncertain')], reverse=True)
            if votes[0][0] == 0:
                final = 'unlabelled'
            elif votes[0][0] == votes[1][0]:
                final = 'uncertain'
            else:
                final = votes[0][1]
            units.append({'key': key, 'size': len(members), 'final': final, 'mixed': tp > 0 and fp > 0, 'tp': tp, 'fp': fp, 'split': members[0]['split'], 'study': key[0], 'slug': key[1]})
        else:
            units.extend({'key': key, 'size': 1, 'final': m['final'], 'mixed': False, 'split': m['split'], 'study': m['study'], 'slug': m['slug']} for m in members)
    return units


def page_stats(items):
    by = collections.defaultdict(list)
    for i in items:
        by[(i['study'], i['slug'])].append(i)
    pages = []
    for key, members in by.items():
        tp, fp, _, _ = counts(members)
        if tp + fp:
            pages.append({'page': key, 'tp': tp, 'fp': fp, 'precision': tp / (tp + fp)})
    return pages


def bootstrap(pages, rounds=10_000):
    """The page bootstrap of per-element precision: pages resampled with replacement."""
    if not pages:
        return None
    rng = random.Random(20261027)
    values = []
    for _ in range(rounds):
        sample = [pages[rng.randrange(len(pages))] for _ in pages]
        tp = sum(p['tp'] for p in sample)
        fp = sum(p['fp'] for p in sample)
        values.append(tp / (tp + fp))
    values.sort()
    return values[int(0.025 * rounds)], values[int(0.975 * rounds) - 1]


def summarize(label):
    items = collect(label)
    out = {'label': label, 'halves': [], 'pages': [], 'groups': []}
    print(f'## {label}: every default-threshold judgment finding, in-sample\n')
    print('| study | half | per element TP / FP / unc. | precision per element | page bootstrap | units after collapse TP / FP | precision per group | pages with a decided finding | all right | mean page precision | new, unlabelled |')
    print('| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | ---: |')
    sets = [(s, h) for s in STUDIES for h in ('dev', 'test', 'both')]
    sets += [('all', 'dev'), ('all', 'test'), ('all', 'both')]
    for study, half in sets:
        chosen = [i for i in items if (study == 'all' or i['study'] == study) and (half == 'both' or i['split'] == half)]
        tp, fp, un, new = counts(chosen)
        units = groups_of(chosen)
        gtp = sum(1 for u in units if u['final'] == 'true_positive')
        gfp = sum(1 for u in units if u['final'] == 'false_positive')
        pages = page_stats(chosen)
        right = sum(1 for p in pages if p['fp'] == 0)
        mean = sum(p['precision'] for p in pages) / len(pages) if pages else float('nan')
        name = f'**{study}**' if study == 'all' else study
        boot = bootstrap(pages)
        said = f'{boot[0]:.2f}–{boot[1]:.2f}' if boot else '–'
        print(f"| {name} | {half} | {tp} / {fp} / {un} | {fmt(tp, fp)} | {said} | {gtp} / {gfp} | {fmt(gtp, gfp)} | {len(pages)} | {right} | {mean:.2f} | {new} |")
        out['halves'].append({'study': study, 'half': half, 'tp': tp, 'fp': fp, 'uncertain': un, 'unlabelled': new, 'pageBootstrap': boot, 'groupTp': gtp, 'groupFp': gfp, 'pages': len(pages), 'pagesAllRight': right, 'meanPagePrecision': mean})
    print()
    units = groups_of(items)
    collapsed = [u for u in units if u['size'] > 1]
    print(f'Collapsed groups (more than {BURST} findings of one claim on one page):')
    for u in sorted(collapsed, key=lambda u: u['key']):
        print(f"- {u['key'][0]} {u['split']} {u['key'][1]} {u['key'][2]} {u['key'][3]}: {u['size']} findings, {u['tp']} TP / {u['fp']} FP -> one {u['final']}{' (mixed)' if u['mixed'] else ''}")
        out['groups'].append({k: v for k, v in u.items() if k != 'key'} | {'criterion': u['key'][2], 'claim': u['key'][3]})
    print()
    print('Per page (decided findings): ' + ', '.join(f"{p['page'][0]}/{p['page'][1]} {p['tp']}/{p['fp']}" for p in sorted(page_stats(items), key=lambda p: (p['page']))))
    print()
    by = collections.Counter((i['criterion'], i['final']) for i in items)
    print('By criterion (TP / FP / unc. / new): ' + ', '.join(f"{c} {by[(c, 'true_positive')]}/{by[(c, 'false_positive')]}/{by[(c, 'uncertain')]}/{by[(c, 'unlabelled')]}" for c in sorted({i['criterion'] for i in items})))
    print()
    fresh = [i for i in items if i['final'] == 'unlabelled']
    if fresh:
        print('New, unlabelled findings:')
        for i in fresh:
            print(f"- {i['study']} {i['split']} {i['slug']} {i['criterion']} {i['claim']}: {i['message'][:110]}")
        print()
    out['items'] = items
    with open(os.path.join(HERE, 'data', label, 'summary.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return items


def compare(base, after):
    key = lambda i: (i['study'], i['slug'], i['criterion'], i['ref'])
    b = {key(i): i for i in base}
    a = {key(i): i for i in after}
    print('## What changed\n')
    gone = [b[k] for k in b if k not in a]
    came = [a[k] for k in a if k not in b]
    tally = collections.Counter((i['study'], i['split'], i['final']) for i in gone)
    print('Findings gone, by study, half and label: ' + ', '.join(f'{k[0]} {k[1]} {k[2]} {v}' for k, v in sorted(tally.items())))
    for i in gone:
        if i['final'] == 'true_positive':
            print(f"- TP lost: {i['study']} {i['split']} {i['slug']} {i['criterion']} {i['claim']}: {i['subject']!r}")
    tally = collections.Counter((i['study'], i['split'], i['final']) for i in came)
    print('Findings that appeared, by study, half and label: ' + ', '.join(f'{k[0]} {k[1]} {k[2]} {v}' for k, v in sorted(tally.items())))
    for i in came:
        print(f"- new: {i['study']} {i['split']} {i['slug']} {i['criterion']} {i['claim']} [{i['final']}]: {i['message'][:100]}")
    print()


if __name__ == '__main__':
    results = {label: summarize(label) for label in sys.argv[1:]}
    if len(results) == 2:
        compare(*results.values())
