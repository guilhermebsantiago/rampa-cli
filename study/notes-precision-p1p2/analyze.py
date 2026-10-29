"""Precision of two replays (replay.sh) of the second to fifth real-page studies, before and after P1 and P2, against the
studies' labels (labels.py).

Which numbers are what:
- s2-s4 (both halves) and the fifth study's dev half are in-sample: all of them were read, and P1 and P2 were chosen on
  them (docs/studies/notes-precision-round5.md);
- the fifth study's test half was held out from the design of P1 and P2 but has been counted once since (the round-5
  notes counted each rule's effect on it): it is read-once data. It is counted here, never read: no message, subject or
  page of it is printed, only counts.

Counting, frozen in docs/studies/notes-precision-p1p2.md before the replay, as study/notes-precision-fixes/analyze.py
counts:
- a finding is a judgment finding at the default threshold: source judgment, confidence medium or high, not experimental;
- matched to a label by page, criterion and element (`ref`); precision TP / (TP + FP), uncertain left out, Wilson 95%;
- per group: on one page, findings with the same criterion, check and claim kind form a group when there are more than
  5 (6 or more), counted as one finding labelled by the plurality of its labelled members (a tie uncertain);
- page bootstrap of the per-element precision: 10,000 resamples of the set's pages with a decided finding, seed 20261027;
- s2's 2.4.4 and 2.4.6 are carried from the second study's re-judged run with the rules since applied, as the
  precision-fixes analysis did, and, after, with P1's facts (data/prompts.json: a carried generic finding on a link
  whose generic fact P1 takes away is a suggestion);
- findings with no label are counted apart as new and unlabelled, never in a precision.

Run from the repository root: python -I study/notes-precision-p1p2/analyze.py <before label> <after label>
Writes data/<label>/summary.json and data/compare.json, and prints markdown tables.
"""
from __future__ import annotations

import collections
import glob
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
from labels import LABELS, ROWS, split_of  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', newline='\n')
BURST = 5
STUDIES = ('s2', 's3', 's4', 's5')
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


shared_text = load(os.path.join(ROOT, 'study', 'notes-precision-fixes', 'data', 'shared-text.json'))
shared_after = {(r['study'], r['slug'], r['ref']): bool(r['after'] and r['after']['places'] > 1 and not r['after']['apart']) for r in shared_text['rows']}
prompts = load(os.path.join(HERE, 'data', 'prompts.json'))
p1_ungrounded = {(r['study'], r['slug'], link['ref']) for r in prompts['rows'] for link in r.get('links', [])}

CLAIM_PATTERNS = [
    ('2.4.4', 'shared by', 'ambiguous'),
    ('2.4.4', 'is an address', 'url_or_filename'),
    ('2.4.4', 'nothing around it does', 'generic'),
    ('2.4.4', 'does not match', 'mismatch'),
]


def claim_of(finding, label):
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


def reports_of(label):
    out = {}
    for study in STUDIES:
        paths = glob.glob(os.path.join(HERE, 'data', label, f'{study}.*.report.json')) or glob.glob(os.path.join(HERE, 'data', label, f'{study}.*.judged.json'))
        for path in paths:
            out[(study, os.path.basename(path).split('.')[1])] = load(path)
    return out


def collect(label, p1):
    """Every default-threshold judgment finding of a replay, with its label, by study and half."""
    items = []
    usage = collections.Counter()
    for (study, slug), report in sorted(reports_of(label).items()):
        split = split_of(study, slug)
        usage[(study, split, 'pages')] += 1
        usage[(study, split, 'calls')] += (report.get('usage') or {}).get('calls', 0)
        usage[(study, split, 'cachedCalls')] += (report.get('usage') or {}).get('cachedCalls', 0)
        usage[(study, split, 'offlineMisses')] += sum(c.get('offlineMisses', 0) for c in report.get('criteria') or [])
        usage[(study, split, 'errors')] += len(report.get('errors') or [])
        usage[(study, split, 'suggestions')] += len([n for n in report.get('needsReview') or [] if n.get('model')])
        for f in report.get('findings', []) + report.get('belowThreshold', []):
            if not shown(f):
                continue
            if study == 's2' and f['criterion'] in CARRIED_ON_S2:
                continue
            lab = LABELS.get((study, slug, f['criterion'], f.get('ref')))
            items.append({
                'study': study, 'split': split, 'slug': slug, 'criterion': f['criterion'], 'ref': f.get('ref'),
                'claim': claim_of(f, lab), 'final': lab['final'] if lab else 'unlabelled', 'subject': f.get('subject'),
                'confirmation': f.get('confirmation'), 'message': f['message'],
            })
        if study == 's2':
            # The re-judged run's 2.4.4 and 2.4.6 findings, with the rules since applied (and P1's facts, after).
            for (name, lslug, criterion, ref), lab in LABELS.items():
                if name != 's2' or lslug != slug or criterion not in CARRIED_ON_S2 or lab['study'] != 's2-after':
                    continue
                row = next((r for r in ROWS if r['study'] == 's2-after' and r['slug'] == slug and r['criterion'] == criterion and r['ref'] == ref), None)
                if not row or not row['shown'] or row['claim'] == 'link-url' or row['claim'].startswith('label'):
                    continue
                if unstyled(report):
                    continue
                if row['claim'] == 'link-ambiguous' and not shared_after.get(('s2', slug, ref), True):
                    continue
                if p1 and row['claim'] == 'link-generic' and ('s2', slug, ref) in p1_ungrounded:
                    continue
                items.append({
                    'study': 's2', 'split': split, 'slug': slug, 'criterion': criterion, 'ref': ref,
                    'claim': {'link-ambiguous': 'ambiguous', 'link-generic': 'generic'}.get(row['claim'], row['claim']),
                    'final': lab['final'], 'subject': row['subject'], 'confirmation': None, 'message': row['message'], 'carried': True,
                })
    return items, usage


def counts(items):
    c = collections.Counter(i['final'] for i in items)
    return c['true_positive'], c['false_positive'], c['uncertain'], c['unlabelled']


def groups_of(items):
    by = collections.defaultdict(list)
    for i in items:
        by[(i['study'], i['slug'], i['criterion'], i['claim'])].append(i)
    units = []
    for key, members in by.items():
        if len(members) > BURST:
            tp, fp, un, _ = counts(members)
            votes = sorted([(tp, 'true_positive'), (fp, 'false_positive'), (un, 'uncertain')], reverse=True)
            final = 'unlabelled' if votes[0][0] == 0 else 'uncertain' if votes[0][0] == votes[1][0] else votes[0][1]
            units.append({'key': key, 'size': len(members), 'final': final, 'mixed': tp > 0 and fp > 0, 'tp': tp, 'fp': fp, 'split': members[0]['split'], 'study': key[0]})
        else:
            units.extend({'key': key, 'size': 1, 'final': m['final'], 'mixed': False, 'split': m['split'], 'study': m['study']} for m in members)
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


SETS = [('s2', 'dev'), ('s2', 'test'), ('s3', 'dev'), ('s3', 'test'), ('s4', 'dev'), ('s4', 'test'), ('s5', 'dev'), ('s5', 'test'),
        ('s2-s4', 'both'), ('s2-s4 + s5 dev', 'in-sample'), ('s5', 'both'), ('all', 'both')]
STATUS = {('s5', 'test'): 'read-once (counted)', ('s5', 'both'): 'in-sample + read-once', ('all', 'both'): 'in-sample + read-once'}


def chosen(items, study, half):
    if study == 's2-s4':
        return [i for i in items if i['study'] in ('s2', 's3', 's4')]
    if study == 's2-s4 + s5 dev':
        return [i for i in items if i['study'] in ('s2', 's3', 's4') or (i['study'] == 's5' and i['split'] == 'dev')]
    return [i for i in items if (study == 'all' or i['study'] == study) and (half == 'both' or i['split'] == half)]


def table(items):
    rows = []
    for study, half in SETS:
        sel = chosen(items, study, half)
        tp, fp, un, new = counts(sel)
        units = groups_of(sel)
        gtp = sum(1 for u in units if u['final'] == 'true_positive')
        gfp = sum(1 for u in units if u['final'] == 'false_positive')
        pages = page_stats(sel)
        rows.append({'study': study, 'half': half, 'status': STATUS.get((study, half), 'in-sample'), 'tp': tp, 'fp': fp, 'uncertain': un, 'unlabelled': new,
                     'groupTp': gtp, 'groupFp': gfp, 'pageBootstrap': bootstrap(pages), 'pages': len(pages), 'pagesAllRight': sum(1 for p in pages if p['fp'] == 0)})
    return rows


def held_out(i):
    return i['study'] == 's5' and i['split'] == 'test'


def summarize(label, p1):
    items, usage = collect(label, p1)
    rows = table(items)
    out = {'label': label, 'rows': rows, 'usage': {' '.join(map(str, k)): v for k, v in usage.items()},
           'items': [i if not held_out(i) else {k: i[k] for k in ('study', 'split', 'criterion', 'claim', 'final')} for i in items]}
    with open(os.path.join(HERE, 'data', label, 'summary.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    return items, rows, usage


def row_text(r):
    boot = f"{r['pageBootstrap'][0]:.2f}–{r['pageBootstrap'][1]:.2f}" if r['pageBootstrap'] else '–'
    unc = f" ({r['uncertain']} unc.)" if r['uncertain'] else ''
    new = f", {r['unlabelled']} unlabelled" if r['unlabelled'] else ''
    return f"{r['tp']} / {r['fp']}{unc}{new}: {fmt(r['tp'], r['fp'])}", boot, f"{r['groupTp']} / {r['groupFp']}: {fmt(r['groupTp'], r['groupFp'])}"


def main(before, after):
    b_items, b_rows, b_usage = summarize(before, p1=False)
    a_items, a_rows, a_usage = summarize(after, p1=True)
    print(f'## Default-threshold judgment findings, {before} -> {after}\n')
    print('| study | half | status | per element before | per element after | page bootstrap after | per group before | per group after |')
    print('| --- | --- | --- | --- | --- | --- | --- | --- |')
    for b, a in zip(b_rows, a_rows):
        be, _, bg = row_text(b)
        ae, aboot, ag = row_text(a)
        print(f"| {b['study']} | {b['half']} | {b['status']} | {be} | {ae} | {aboot} | {bg} | {ag} |")
    print()
    print('Cells are true / false findings (uncertain and unlabelled apart) and precision with its Wilson 95% interval.\n')

    key = lambda i: (i['study'], i['slug'], i['criterion'], i['ref'])
    b = {key(i): i for i in b_items}
    a = {key(i): i for i in a_items}
    gone = [b[k] for k in b if k not in a]
    came = [a[k] for k in a if k not in b]
    print('## What moved\n')
    for name, moved in (('left the default threshold', gone), ('came to the default threshold', came)):
        tally = collections.Counter((i['study'], i['split'], i['criterion'], i['final']) for i in moved)
        print(f'Findings that {name}, by study, half, criterion and label: ' + (', '.join(f'{k[0]} {k[1]} {k[2]} {k[3]} {v}' for k, v in sorted(tally.items())) or 'none'))
        for i in moved:
            if held_out(i):
                continue
            conf = i.get('confirmation') or {}
            together = f" (identical: {conf['identical']})" if conf.get('identical') else ''
            print(f"- {i['study']} {i['split']} {i['slug']} {i['criterion']} {i['claim']} [{i['final']}]{together}: {(i['subject'] or '')[:60]!r}")
        print()
    print('## Model calls and cache misses\n')
    print('| study | half | pages | new model calls before | after | cached calls after | offline misses before | after | errors after | suggestions before | after |')
    print('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
    for study in STUDIES:
        for half in ('dev', 'test'):
            g = lambda u, what: u[(study, half, what)]
            if not g(a_usage, 'pages'):
                continue
            print(f"| {study} | {half} | {g(a_usage, 'pages')} | {g(b_usage, 'calls')} | {g(a_usage, 'calls')} | {g(a_usage, 'cachedCalls')} | {g(b_usage, 'offlineMisses')} | {g(a_usage, 'offlineMisses')} | {g(a_usage, 'errors')} | {g(b_usage, 'suggestions')} | {g(a_usage, 'suggestions')} |")
    print()
    by = collections.Counter((i['criterion'], i['final']) for i in a_items if not held_out(i))
    print('After, by criterion, in-sample sets only (TP / FP / unc. / unlabelled): ' + ', '.join(
        f"{c} {by[(c, 'true_positive')]}/{by[(c, 'false_positive')]}/{by[(c, 'uncertain')]}/{by[(c, 'unlabelled')]}" for c in sorted({i['criterion'] for i in a_items})))
    with open(os.path.join(HERE, 'data', 'compare.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'before': before, 'after': after, 'rows': [{'before': x, 'after': y} for x, y in zip(b_rows, a_rows)],
                   'gone': [i if not held_out(i) else {k: i[k] for k in ('study', 'split', 'criterion', 'claim', 'final')} for i in gone],
                   'came': [i if not held_out(i) else {k: i[k] for k in ('study', 'split', 'criterion', 'claim', 'final')} for i in came]}, f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
