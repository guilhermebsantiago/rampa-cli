"""Precision of two replays (replay.sh) of the second to fifth real-page studies, before and after P3, P4 and the
card-heading refinement, against the studies' labels (study/notes-precision-p1p2/labels.py), counted as
study/notes-precision-p1p2/analyze.py counts.

Which numbers are what:
- s2-s4 (both halves) and the fifth study's dev half are in-sample: all of them were read, and P3 and P4 were chosen on
  s2-s4 (docs/studies/notes-precision-round5.md); the refinement was chosen on a test fixture, not on a study;
- the fifth study's test half was held out from the design of P1 to P4 but has been counted since (the round-5 notes
  and the P1/P2 replay counted each rule's effect on it): it is counted here, never read: no message, subject or page of
  it is printed, only counts.

Counting, frozen in docs/studies/notes-precision-p3p4.md before the confirming replay, as the P1/P2 analysis counts:
- a finding is a judgment finding at the default threshold: source judgment, confidence medium or high, not experimental;
- matched to a label by page, criterion and element (`ref`); precision TP / (TP + FP), uncertain left out, Wilson 95%;
- per group: on one page, findings with the same criterion and claim kind form a group when there are more than 5 (6
  or more), counted as one finding labelled by the plurality of its labelled members (a tie uncertain);
- page bootstrap of the per-element precision: 10,000 resamples of the set's pages with a decided finding, seed 20261027;
- s2's 2.4.4 and 2.4.6 are carried from the second study's re-judged run with the rules since applied, P1's facts
  included (study/notes-precision-p1p2/data/prompts.json) on both sides, as main has P1; after, also P4's and the
  refinement's facts (data/facts.json);
- findings with no label are counted apart as new and unlabelled, never in a precision.

Run from the repository root:
  python -I study/notes-precision-p3p4/analyze.py <before label> <after label>      the replays compared
  python -I study/notes-precision-p3p4/analyze.py <before label> --predict          the before replay with the moves
                                                                                      data/facts.json predicts
Writes data/<label>/summary.json and data/compare.json (or data/expected.json), and prints markdown tables.
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
P1P2 = os.path.join(ROOT, 'study', 'notes-precision-p1p2')
sys.path.insert(0, P1P2)
from labels import LABELS, ROWS, split_of  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', newline='\n')
BURST = 5
STUDIES = ('s2', 's3', 's4', 's5')
CARRIED_ON_S2 = {'2.4.4', '2.4.6'}
READING = {'wrong_content', 'missing_information'}


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
p1_prompts = load(os.path.join(P1P2, 'data', 'prompts.json'))
p1_ungrounded = {(r['study'], r['slug'], link['ref']) for r in p1_prompts['rows'] for link in r.get('links', [])}
facts = load(os.path.join(HERE, 'data', 'facts.json'))
p4_ungrounded = {(r['study'], r['slug'], link['ref']) for r in facts['rows'] for link in r['p4Links']}
p1_regrounded = {(r['study'], r['slug'], link['ref']) for r in facts['rows'] for link in r['p1Links']}
p3_images = {(r['study'], r['slug'], image['ref']) for r in facts['rows'] for image in r['p3Images']}
left_cap = {(r['study'], r['slug'], ref) for r in facts['rows'] for ref in r['leftRefs']}

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


def collect(label, after):
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
            # The re-judged run's 2.4.4 and 2.4.6 findings, with the rules since applied: P1's facts on both sides (main
            # has P1), and after, P4's and the refinement's.
            for (name, lslug, criterion, ref), lab in LABELS.items():
                if name != 's2' or lslug != slug or criterion not in CARRIED_ON_S2 or lab['study'] != 's2-after':
                    continue
                row = next((r for r in ROWS if r['study'] == 's2-after' and r['slug'] == slug and r['criterion'] == criterion and r['ref'] == ref), None)
                if not row or not row['shown'] or row['claim'] == 'link-url' or row['claim'].startswith('label'):
                    continue
                if unstyled(report):
                    continue
                key = ('s2', slug, ref)
                if row['claim'] == 'link-ambiguous' and not shared_after.get(key, True):
                    continue
                if row['claim'] == 'link-ambiguous' and after and key in p4_ungrounded:
                    continue
                if row['claim'] == 'link-generic' and key in p1_ungrounded and not (after and key in p1_regrounded):
                    continue
                items.append({
                    'study': 's2', 'split': split, 'slug': slug, 'criterion': criterion, 'ref': ref,
                    'claim': {'link-ambiguous': 'ambiguous', 'link-generic': 'generic'}.get(row['claim'], row['claim']),
                    'final': lab['final'], 'subject': row['subject'], 'confirmation': None, 'message': row['message'], 'carried': True,
                })
    return items, usage


def predicted(items):
    """The before replay's findings without the ones data/facts.json says the branch moves: a reading claim on a social
    network icon that names the network (P3), and a shared-text claim on a link that names its destination or that the
    judge-first order no longer reaches under the cap (P4). The refinement gives the generic fact back to no recorded
    link, and what newly judged links would answer is not known before the replay."""
    out = []
    for i in items:
        key = (i['study'], i['slug'], i['ref'])
        if i['criterion'] == '1.1.1' and key in p3_images and i['claim'] in READING:
            continue
        if i['criterion'] == '2.4.4' and i['claim'] == 'ambiguous' and (key in p4_ungrounded or key in left_cap):
            continue
        if i['criterion'] == '2.4.4' and key in left_cap:
            raise SystemExit(f'a finding that leaves the cap without P4: {key}')
        out.append(i)
    return out


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
STATUS = {('s5', 'test'): 'counted', ('s5', 'both'): 'in-sample + counted', ('all', 'both'): 'in-sample + counted'}


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


def public(i):
    return i if not held_out(i) else {k: i[k] for k in ('study', 'split', 'criterion', 'claim', 'final')}


def row_text(r):
    boot = f"{r['pageBootstrap'][0]:.2f}–{r['pageBootstrap'][1]:.2f}" if r['pageBootstrap'] else '–'
    unc = f" ({r['uncertain']} unc.)" if r['uncertain'] else ''
    new = f", {r['unlabelled']} unlabelled" if r['unlabelled'] else ''
    return f"{r['tp']} / {r['fp']}{unc}{new}: {fmt(r['tp'], r['fp'])}", boot, f"{r['groupTp']} / {r['groupFp']}: {fmt(r['groupTp'], r['groupFp'])}"


def compare(b_items, a_items, b_rows, a_rows, title):
    print(f'## {title}\n')
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
            print(f"- {i['study']} {i['split']} {i['slug']} {i['criterion']} {i['claim']} [{i['final']}]: {(i['subject'] or '')[:60]!r}")
        print()
    return gone, came


def main(before, after):
    b_items, b_usage = collect(before, after=False)
    b_rows = table(b_items)
    with open(os.path.join(HERE, 'data', before, 'summary.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'label': before, 'rows': b_rows, 'usage': {' '.join(map(str, k)): v for k, v in b_usage.items()}, 'items': [public(i) for i in b_items]}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    if after == '--predict':
        a_items = predicted(b_items)
        a_rows = table(a_items)
        gone, came = compare(b_items, a_items, b_rows, a_rows, f'Expected from data/facts.json: default-threshold judgment findings, {before} -> predicted')
        with open(os.path.join(HERE, 'data', 'expected.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump({'before': before, 'rows': [{'before': x, 'after': y} for x, y in zip(b_rows, a_rows)], 'gone': [public(i) for i in gone], 'came': [public(i) for i in came]}, f, ensure_ascii=False, indent=1)
            f.write('\n')
        return
    a_items, a_usage = collect(after, after=True)
    a_rows = table(a_items)
    with open(os.path.join(HERE, 'data', after, 'summary.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'label': after, 'rows': a_rows, 'usage': {' '.join(map(str, k)): v for k, v in a_usage.items()}, 'items': [public(i) for i in a_items]}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    gone, came = compare(b_items, a_items, b_rows, a_rows, f'Default-threshold judgment findings, {before} -> {after}')
    print('## Model calls and cache misses\n')
    print('| study | half | pages | new model calls before | after | cached calls before | after | offline misses before | after | errors after | suggestions before | after |')
    print('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
    for study in STUDIES:
        for half in ('dev', 'test'):
            g = lambda u, what: u[(study, half, what)]
            if not g(a_usage, 'pages'):
                continue
            print(f"| {study} | {half} | {g(a_usage, 'pages')} | {g(b_usage, 'calls')} | {g(a_usage, 'calls')} | {g(b_usage, 'cachedCalls')} | {g(a_usage, 'cachedCalls')} | {g(b_usage, 'offlineMisses')} | {g(a_usage, 'offlineMisses')} | {g(a_usage, 'errors')} | {g(b_usage, 'suggestions')} | {g(a_usage, 'suggestions')} |")
    print()
    by = collections.Counter((i['criterion'], i['final']) for i in a_items if not held_out(i))
    print('After, by criterion, in-sample sets only (TP / FP / unc. / unlabelled): ' + ', '.join(
        f"{c} {by[(c, 'true_positive')]}/{by[(c, 'false_positive')]}/{by[(c, 'uncertain')]}/{by[(c, 'unlabelled')]}" for c in sorted({i['criterion'] for i in a_items})))
    with open(os.path.join(HERE, 'data', 'compare.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'before': before, 'after': after, 'rows': [{'before': x, 'after': y} for x, y in zip(b_rows, a_rows)], 'gone': [public(i) for i in gone], 'came': [public(i) for i in came]}, f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
