"""Joins link-facts.json (link-facts.ts) with the studies' labels and counts what each candidate 2.4.4 rule would move.

Labels: the in-sample replay's default-threshold findings of the second to fourth studies
(study/notes-precision-fixes/data/after/summary.json), those studies' labelled suggestions
(study/notes-precision-probe/data/rows.json), and the fifth study's dev half (study/round-5-2026-10-28/data/findings.json).
The fifth study's test half is never read here.

Run from the repository root: python -I study/notes-precision-round5/analyze_links.py
"""
from __future__ import annotations

import collections
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8', newline='\n')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


facts = load(os.path.join(HERE, 'data', 'link-facts.json'))
rows = facts['rows']
by_key = {(r['study'], r['slug'], r['ref']): r for r in rows}

# Labels: (study, slug, ref) -> {claim, final, shown, origin}
labels = {}
for it in load(os.path.join(ROOT, 'study', 'notes-precision-fixes', 'data', 'after', 'summary.json'))['items']:
    if it['criterion'] != '2.4.4':
        continue
    labels[(it['study'], it['slug'], it['ref'])] = {'claim': it['claim'], 'final': it['final'], 'shown': True, 'origin': 'finding', 'subject': it.get('subject')}
# Suggestions of the second to fourth studies (not shown), where labelled.
S2 = {'s2-after': 's2', 's2': 's2', 's3': 's3', 's4': 's4'}
for r in load(os.path.join(ROOT, 'study', 'notes-precision-probe', 'data', 'rows.json')):
    if r.get('criterion') != '2.4.4' or r.get('shown'):
        continue
    study = S2.get(r.get('study'))
    if not study:
        continue
    key = (study, r['slug'], r['ref'])
    if key not in labels:
        labels[key] = {'claim': r.get('claim'), 'final': r.get('final'), 'shown': False, 'origin': 'suggestion', 'subject': r.get('subject')}
for r in load(os.path.join(ROOT, 'study', 'round-5-2026-10-28', 'data', 'findings.json')):
    if r['split'] != 'dev' or r['criterion'] != '2.4.4' or r['kind'] != 'judgment':
        continue
    key = ('s5', r['slug'], r['ref'])
    shown = bool(r['shown']) and r['run'] == 'default'
    if key in labels and labels[key]['shown']:
        continue
    labels[key] = {'claim': r.get('claim'), 'final': r.get('final'), 'shown': shown, 'origin': 'finding' if shown else 'suggestion', 'subject': r.get('subject')}

joined = []
missing = []
for key, lab in labels.items():
    f = by_key.get(key)
    if f is None:
        missing.append((key, lab))
        continue
    joined.append({**lab, **f, 'key': key})

print(f'labelled 2.4.4 claims: {len(labels)}; with facts (generic text or grounded shared-text): {len(joined)}; without: {len(missing)}')
c = collections.Counter((j['claim'], j['shown'], j['final']) for j in joined)
for k, v in sorted(c.items(), key=str):
    print('  ', k, v)
print('without facts, by claim/shown/final:', collections.Counter((l['claim'], l['shown'], l['final']) for _, l in missing))


def count(items, pred):
    out = collections.Counter()
    pages = collections.defaultdict(collections.Counter)
    for j in items:
        if pred(j):
            out[j['final']] += 1
            pages[(j['study'], j['slug'])][j['final']] += 1
    return out, pages


def show(title, items, pred):
    out, pages = count(items, pred)
    tp, fp, un = out.get('true_positive', 0), out.get('false_positive', 0), out.get('uncertain', 0)
    where = '; '.join(f"{s}/{p}: {dict(c)}" for (s, p), c in sorted(pages.items()))
    print(f'  {title}: moves FP {fp}, TP {tp}, uncertain {un}  [{where}]')


generic_findings = [j for j in joined if j['claim'] in ('generic', 'link-generic') and j['shown']]
generic_sugg = [j for j in joined if j['claim'] in ('generic', 'link-generic') and not j['shown']]
print(f'\n== generic claims: findings {len(generic_findings)} '
      f"({collections.Counter(j['final'] for j in generic_findings)}), suggestions labelled {len(generic_sugg)}")
print('   findings currently grounded by the generic fact:', sum(1 for j in generic_findings if j['groundedGeneric']))
print('\nRules on the generic findings (what each would move to suggestions):')
show('G0 any preceding heading on the page (c.heading set)', generic_findings, lambda j: bool(j.get('heading')))
for depth in (2, 3, 4, 5, 6, 8):
    for length in (300, 600, 1000, 2000):
        show(f'G1 card heading: LCA depth <= {depth}, LCA text <= {length}', generic_findings,
             lambda j, d=depth, l=length: j.get('cardHeading') is not None and j.get('cardHeading')['depth'] <= d and j.get('cardHeading')['textLength'] <= l)
for depth in (2, 3, 4, 5, 6, 8):
    show(f'G2 sibling link to the same place, non-generic name, depth <= {depth}', generic_findings,
         lambda j, d=depth: j.get('siblingSame') is not None and j.get('siblingSame')['depth'] <= d)
show('G3 = G1(depth<=5, text<=1000) or G2(depth<=5)', generic_findings,
     lambda j: (j.get('cardHeading') is not None and j.get('cardHeading')['depth'] <= 5 and j.get('cardHeading')['textLength'] <= 1000) or (j.get('siblingSame') is not None and j.get('siblingSame')['depth'] <= 5))
show('M menu toggle (href # + list after it in its list item)', generic_findings, lambda j: j['menuToggle'])
show('ALL generic claims to suggestions (abstention)', generic_findings, lambda j: True)

print('\nThe same rules on the labelled generic SUGGESTIONS (already not findings; shows what they would also cover):')
show('G3', generic_sugg, lambda j: (j.get('cardHeading') is not None and j.get('cardHeading')['depth'] <= 5 and j.get('cardHeading')['textLength'] <= 1000) or (j.get('siblingSame') is not None and j.get('siblingSame')['depth'] <= 5))

print('\nEvery generic finding, with its facts:')
for j in sorted(generic_findings, key=lambda j: (j['study'], j['slug'])):
    ch = j.get('cardHeading')
    print(f"  {j['study']} {j['slug']} {j['final'][:5]} {j['name']!r:30} grounded={j['groundedGeneric']} heading={bool(j.get('heading'))} "
          f"card={(ch['depth'], ch['textLength'], ch['paragraph'], ch['links']) if ch else None} sib={j.get('siblingSame')} menu={j['menuToggle']}")

shared = [j for j in joined if j['claim'] in ('ambiguous', 'link-ambiguous') and j['shown']]
print(f"\n== shared-text (ambiguous) findings: {len(shared)} ({collections.Counter(j['final'] for j in shared)})")
show('A1 link text names its destination (title or heading read by Rampa contains it)', shared, lambda j: j['namesDestination'])
show('   destination read at all', shared, lambda j: j['destinationRead'])
print('\nEvery shared-text finding that names its destination or whose destination was unread:')
for j in sorted(shared, key=lambda j: (j['study'], j['slug'])):
    if j['namesDestination'] or not j['destinationRead']:
        print(f"  {j['study']} {j['slug']} {j['final'][:5]} {j['name']!r:40} namesDest={j['namesDestination']} read={j['destinationRead']}")

# Unlabelled grounded-generic candidates per page (the model passed them): how many G3 would also un-ground.
print('\nGrounded generic candidates per page (all, labelled or not) and how many G3 un-grounds:')
per = collections.defaultdict(lambda: [0, 0])
for r in rows:
    if r['groundedGeneric']:
        per[(r['study'], r['slug'])][0] += 1
        if (r.get('cardHeading') is not None and r.get('cardHeading')['depth'] <= 5 and r.get('cardHeading')['textLength'] <= 1000) or (r.get('siblingSame') is not None and r.get('siblingSame')['depth'] <= 5):
            per[(r['study'], r['slug'])][1] += 1
tot = [0, 0]
for k, v in sorted(per.items()):
    tot[0] += v[0]
    tot[1] += v[1]
    if v[0] >= 3:
        print(f'  {k[0]} {k[1]}: {v[0]} grounded, {v[1]} un-grounded by G3')
print(f'  total: {tot[0]} grounded generic candidates, {tot[1]} un-grounded by G3')

with open(os.path.join(HERE, 'data', 'link-joined.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump([{**j, 'key': list(j['key'])} for j in joined], f, ensure_ascii=False, indent=1)
