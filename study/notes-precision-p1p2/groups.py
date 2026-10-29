"""P2 predicted from the shipped pipeline's own second-pass outcomes, before the replay: every 1.1.1 claim the second
pass was asked about in the reports main's code wrote (s2-s4: the precision-fixes replay, study/notes-precision-fixes/data/
after; s5: the fifth study's reports), grouped by page and alternative (lower case, accents and repeated spaces ignored),
and the denied claims a group with a confirmed claim would confirm, with their labels.

A confirmed claim is a 1.1.1 judgment finding with a `confirmation`; a denied one is a 1.1.1 suggestion whose evidence says
the second pass did not confirm it (its alternative is the quoted text of its message). Every claim of the pass is a fail,
so the verdict adds nothing to the key here.

Labels as analyze.py reads them. The fifth study's test half is counted only: no alternative or message is printed.

Run from the repository root: python -I study/notes-precision-p1p2/groups.py
Writes study/notes-precision-p1p2/data/groups-predicted.json.
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
FIXES = os.path.join(ROOT, 'study', 'notes-precision-fixes', 'data', 'after')
R5 = os.path.join(ROOT, 'study', 'round-5-2026-10-28')
sys.path.insert(0, HERE)
from labels import label_of, split_of  # noqa: E402


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def norm(text):
    text = unicodedata.normalize('NFKD', text or '')
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r'\s+', ' ', text).strip().lower()


def claims_of(report):
    out = []
    for f in report.get('findings', []) + report.get('belowThreshold', []):
        if f['criterion'] == '1.1.1' and f.get('source') == 'judgment' and f.get('confirmation'):
            out.append({'ref': f['ref'], 'alt': f.get('subject') or '', 'outcome': 'confirmed', 'shown': f.get('confidence') in ('medium', 'high') and not f.get('experimental')})
    for n in report.get('needsReview', []):
        if n['criterion'] != '1.1.1' or 'did not confirm it' not in (n.get('evidence') or ''):
            continue
        alt = re.search(r'"([^"]*)"', n.get('message') or '')
        out.append({'ref': n['ref'], 'alt': alt.group(1) if alt else '', 'outcome': 'denied', 'shown': True})
    return out


pages = []
for name in sorted(os.listdir(FIXES)):
    if name.endswith('.judged.json'):
        study, slug = name.split('.')[0], name.split('.')[1]
        pages.append((study, slug, load(os.path.join(FIXES, name))))
for slug in sorted(os.listdir(os.path.join(R5, 'pages'))):
    path = os.path.join(R5, 'pages', slug, 'report.judged.json')
    if os.path.exists(path):
        pages.append(('s5', slug, load(path)))

rows = []
tally = collections.Counter()
for study, slug, report in pages:
    split = split_of(study, slug)
    held_out = study == 's5' and split == 'test'
    groups = collections.defaultdict(list)
    for claim in claims_of(report):
        groups[norm(claim['alt'])].append(claim)
    for alt, members in groups.items():
        if len(members) < 2:
            continue
        confirmed = sum(1 for m in members if m['outcome'] == 'confirmed')
        promoted = [m for m in members if m['outcome'] == 'denied'] if confirmed else []
        labels = collections.Counter(label_of(study, slug, '1.1.1', m['ref']) for m in promoted)
        tally[(study, split, 'groups')] += 1
        tally[(study, split, 'mixed')] += 1 if promoted else 0
        for lab, count in labels.items():
            tally[(study, split, lab)] += count
        row = {'study': study, 'split': split, 'members': len(members), 'confirmed': confirmed, 'promoted': len(promoted), 'labels': dict(labels)}
        if not held_out:
            row |= {'slug': slug, 'alt': alt}
        rows.append(row)

print('Groups of two or more 1.1.1 second-pass claims with one alternative on one page, in the reports of main\'s code:\n')
for row in rows:
    where = f"{row['study']} {row['split']} {row.get('slug', '(test page)')}"
    what = f" {row['alt'][:50]!r}" if 'alt' in row else ''
    print(f"- {where}{what}: {row['members']} claims, {row['confirmed']} confirmed, {row['promoted']} the group would confirm {row['labels']}")
print('\nBy study and half (groups, groups with a claim to confirm, and the labels of the claims it would confirm):')
for key in sorted({(k[0], k[1]) for k in tally}):
    print(f"  {key[0]} {key[1]}: groups {tally[key + ('groups',)]}, mixed {tally[key + ('mixed',)]}, "
          f"TP {tally[key + ('true_positive',)]}, FP {tally[key + ('false_positive',)]}, uncertain {tally[key + ('uncertain',)]}, unlabelled {tally[key + ('unlabelled',)]}")
with open(os.path.join(HERE, 'data', 'groups-predicted.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(rows, f, ensure_ascii=False, indent=1)
    f.write('\n')
