"""The 1.1.1 second pass replayed with group rules, on every labelled reading claim whose second-pass answers are recorded.

Claims and their answers come from:
- s2, s3: study/notes-precision-probe/data/verifier-s{2,3}.json (per framing, the probability of "fail" on each labelled
  first-pass claim of the second and third studies; the probe's framings A, B, C are the shipped rules/claim/reversed);
- s4: the fourth study's main reports (recordings round-4-2026-10-24/pages/<slug>/report.json): a confirmed claim's
  lowest probability, a denied claim's three probabilities from its needsReview evidence; labels from
  study/round-4-2026-10-24/data/findings.json;
- s5 dev: the same from recordings round-5/pages/<slug>/report.json and study/round-5-2026-10-28/data/findings.json.
  The fifth study's test half is never read.

The shipped rule: confirmed when every framing answers a confirming word and the lowest probability is >= 0.99.
Group rules (a group = one page, one normalised alternative text, two claims or more, all with the shipped rule's
framings available):
- C1 "any": one confirmed claim confirms the whole group;
- C2 "majority": more confirmed than denied confirms the group, more denied than confirmed denies it;
- C3 "mean": the group's mean lowest probability >= 0.99 confirms it (and < 0.99 denies it).
Every number is in-sample (s2–s4) or on the fifth study's dev half.

Run from the repository root: python -I study/notes-precision-round5/confirm_groups.py
"""
from __future__ import annotations

import collections
import json
import os
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding='utf-8', newline='\n')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
REC = os.environ.get('RECORDINGS', 'C:/Users/guilh/dev/rampa-study-recordings')
CUT = 0.99


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def norm(text):
    text = unicodedata.normalize('NFKD', text or '')
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r'\s+', ' ', text).strip().casefold()


claims = []  # {study, slug, ref, alt, final, probs: [p1,p2,p3] or None, confirmed (shipped), min}

# s2, s3 from the probe's verifier files.
# The probe's framings: A rules ("fail" confirms), B claim ("yes" confirms), C reversed ("no" confirms); pFail is the
# probability of the confirming word under each framing. Subjects (the alternative text) come from the probe's label rows.
CONFIRMING = {'A': 'fail', 'B': 'yes', 'C': 'no'}
subjects = {}
for r in load(os.path.join(ROOT, 'study', 'notes-precision-probe', 'data', 'rows.json')):
    if r['criterion'] == '1.1.1' and r['study'] in ('s2', 's3'):
        subjects[(r['study'], r['slug'], r['ref'])] = r.get('subject') or ''
for study in ('s2', 's3'):
    by_key = collections.defaultdict(dict)
    meta = {}
    for r in load(os.path.join(ROOT, 'study', 'notes-precision-probe', 'data', f'verifier-{study}.json')):
        if r['criterion'] != '1.1.1':
            continue
        key = (r['slug'], r['ref'])
        by_key[key][r['framing']] = (r['pFail'], r['first'] == CONFIRMING[r['framing']])
        meta[key] = r
    for key, framings in by_key.items():
        if len(framings) < 3:
            continue
        probs = [framings[k][0] for k in sorted(framings)]
        denied_word = not all(framings[k][1] for k in framings)
        mn = min(probs)
        claims.append({'study': study, 'slug': key[0], 'ref': key[1], 'alt': subjects.get((study, key[0], key[1]), ''), 'final': meta[key]['final'],
                       'probs': probs, 'min': mn, 'confirmed': (not denied_word) and mn >= CUT, 'deniedWord': denied_word})

# s4 and s5 dev from the main reports.
EVIDENCE = re.compile(r'\(rules: (\w+) \(([\d.]+)\), claim: (\w+) \(([\d.]+)\), reversed: (\w+) \(([\d.]+)\)\)')
FAIL_WORDS = {'fail', 'yes', 'no_reversed'}


def from_reports(study, folder, findings_path, split_filter):
    rows = [r for r in load(findings_path) if r['criterion'] == '1.1.1' and r['kind'] == 'judgment' and (split_filter is None or r['split'] == split_filter)]
    label = {}
    for r in rows:
        label.setdefault((r['slug'], r['ref']), r['final'])
    slugs = sorted({r['slug'] for r in rows})
    for slug in slugs:
        path = os.path.join(REC, folder, 'pages', slug, 'report.json')
        if not os.path.exists(path):
            print(f'  no report for {study} {slug}', file=sys.stderr)
            continue
        rep = load(path)
        for f in rep['findings']:
            if f['criterion'] != '1.1.1' or f.get('source') != 'judgment' or not f.get('confirmation'):
                continue
            key = (slug, f['ref'])
            if key not in label:
                continue
            claims.append({'study': study, 'slug': slug, 'ref': f['ref'], 'alt': f.get('subject') or '', 'final': label[key],
                           'probs': None, 'min': f['confirmation']['minProbability'], 'confirmed': f['confirmation']['minProbability'] >= CUT})
        for n in rep.get('needsReview', []):
            if n['criterion'] != '1.1.1':
                continue
            m = EVIDENCE.search(n.get('evidence') or '')
            if not m:
                continue
            key = (slug, n['ref'])
            if key not in label:
                continue
            words = [m.group(1), m.group(3), m.group(5)]
            probs = [float(m.group(2)), float(m.group(4)), float(m.group(6))]
            # The evidence prints the probability of the confirming word; a denying word is a denial whatever it is.
            confirming = [words[0] == 'fail', words[1] == 'yes', words[2] == 'no']
            mn = min(probs)
            subject = re.search(r'"([^"]*)"', n.get('message') or '')
            claims.append({'study': study, 'slug': slug, 'ref': n['ref'], 'alt': subject.group(1) if subject else '', 'final': label[key],
                           'probs': probs, 'min': mn, 'confirmed': all(confirming) and mn >= CUT, 'deniedWord': not all(confirming)})


from_reports('s4', 'round-4-2026-10-24', os.path.join(ROOT, 'study', 'round-4-2026-10-24', 'data', 'findings.json'), None)
from_reports('s5', 'round-5', os.path.join(ROOT, 'study', 'round-5-2026-10-28', 'data', 'findings.json'), 'dev')

# One row per claim (a ref may appear in a report twice when the same image is judged under two claims; keep the first).
seen = set()
unique = []
for c in claims:
    k = (c['study'], c['slug'], c['ref'])
    if k in seen:
        continue
    seen.add(k)
    unique.append(c)
claims = unique

print(f'claims with second-pass answers and a label: {len(claims)}')
print(collections.Counter((c['study'], c['final']) for c in claims))


def precision(sel):
    tp = sum(1 for c in sel if c['final'] == 'true_positive')
    fp = sum(1 for c in sel if c['final'] == 'false_positive')
    un = sum(1 for c in sel if c['final'] == 'uncertain')
    return tp, fp, un


def report(name, decided):
    sel = [c for c in claims if decided(c)]
    tp, fp, un = precision(sel)
    p = tp / (tp + fp) if tp + fp else float('nan')
    print(f'  {name:48} confirmed: TP {tp:3} FP {fp:3} unc {un:3}  precision {p:.2f}')
    return sel


print('\nShipped rule and group rules, over all claims:')
base = report('shipped (every framing confirms, min >= 0.99)', lambda c: c['confirmed'])

groups = collections.defaultdict(list)
for c in claims:
    groups[(c['study'], c['slug'], norm(c['alt']))].append(c)
multi = {k: v for k, v in groups.items() if len(v) >= 2}
print(f'\ngroups of 2+ claims with one alternative on one page: {len(multi)} '
      f"({sum(len(v) for v in multi.values())} claims); mixed verdicts in {sum(1 for v in multi.values() if len({c['confirmed'] for c in v}) > 1)}")
for k, v in sorted(multi.items()):
    labels = collections.Counter(c['final'][:4] for c in v)
    print(f"  {k[0]} {k[1]:24} {k[2][:40]!r:42} n={len(v)} confirmed={sum(c['confirmed'] for c in v)} labels={dict(labels)} mins={[round(c['min'], 3) for c in v]}")


def group_rule(rule):
    decision = {}
    for k, v in groups.items():
        conf = sum(c['confirmed'] for c in v)
        if len(v) == 1:
            d = v[0]['confirmed']
        elif rule == 'any':
            d = conf >= 1
        elif rule == 'majority':
            d = conf > len(v) - conf if conf != len(v) - conf else None
        elif rule == 'mean':
            d = sum(c['min'] for c in v) / len(v) >= CUT and not any(c.get('deniedWord') for c in v)
        for c in v:
            decision[(c['study'], c['slug'], c['ref'])] = d if d is not None else c['confirmed']
    return lambda c: decision[(c['study'], c['slug'], c['ref'])]


print()
for rule in ('any', 'majority', 'mean'):
    sel = report(f'group rule C-{rule}', group_rule(rule))
    gained = [c for c in sel if not c['confirmed']]
    lost = [c for c in claims if c['confirmed'] and c not in sel]
    print(f"      gained: {precision(gained)} (TP, FP, unc) on {sorted({(c['study'], c['slug']) for c in gained})}; "
          f"lost: {precision(lost)} on {sorted({(c['study'], c['slug']) for c in lost})}")

# How the remaining confirmed false positives look: alt equals a nearby heading or link text is not known here; print them.
print('\nConfirmed false positives under the shipped rule (the second pass cannot reach them):')
for c in base:
    if c['final'] == 'false_positive':
        print(f"  {c['study']} {c['slug']:24} {c['alt'][:50]!r} min={c['min']:.4f}")
print('\nDenied true positives under the shipped rule (what the pass costs):')
for c in claims:
    if not c['confirmed'] and c['final'] == 'true_positive':
        print(f"  {c['study']} {c['slug']:24} {c['alt'][:50]!r} min={c['min']:.3f} probs={c['probs']}")

with open(os.path.join(HERE, 'data', 'confirm-claims.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(claims, f, ensure_ascii=False, indent=1)
