"""The labels of the judgment findings of the second to fifth real-page studies, by page, criterion and element, as
study/notes-precision-fixes/analyze.py reads them for s2-s4, and the fifth study's the same way:
- s2: the second study's run, then its re-judged run (`s2-after`), from the precision probe's rows;
- s3: the third study, from the same rows;
- s4: the fourth study's findings, every origin (main run, the --no-confirm ablation, the suggestion sample), in that order;
- s5: the fifth study's findings, every origin in the same order, both halves. The test half's labels are used for
  counts only.
The labels are two Claude judges' (the label both gave, else uncertain), not people's.
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
STUDIES = {'s2': 'fresh-2026-10-11', 's3': 'round-3-2026-10-23', 's4': 'round-4-2026-10-24', 's5': 'round-5-2026-10-28'}
ORIGIN_ORDER = {'main': 0, 'noconfirm-only': 1, 'suggestion-sample': 2}


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


ROWS = load(os.path.join(ROOT, 'study', 'notes-precision-probe', 'data', 'rows.json'))
LABELS: dict[tuple[str, str, str, str], dict] = {}
for r in ROWS:
    if r['check'].startswith('judgment') and r['study'] in ('s2', 's2-after', 's3'):
        name = 's3' if r['study'] == 's3' else 's2'
        key = (name, r['slug'], r['criterion'], r['ref'])
        if key not in LABELS or (LABELS[key]['study'] == 's2-after' and r['study'] == 's2'):
            LABELS[key] = {'final': r['final'], 'claim': r['claim'], 'subject': r['subject'], 'study': r['study']}
for study in ('s4', 's5'):
    path = os.path.join(ROOT, 'study', STUDIES[study], 'data', 'findings.json')
    for r in sorted(load(path), key=lambda r: ORIGIN_ORDER.get(r['origin'], 9)):
        if r['source'] != 'judgment':
            continue
        LABELS.setdefault((study, r['slug'], r['criterion'], r['ref']), {'final': r['final'], 'claim': r.get('claim') or r.get('kind') or r['criterion'], 'subject': r['subject'], 'study': study, 'origin': r['origin']})

SPLITS = {study: {p['slug']: p['split'] for p in load(os.path.join(ROOT, 'study', folder, 'data', 'pages-input.json'))['pages']} for study, folder in STUDIES.items()}


def label_of(study: str, slug: str, criterion: str, ref: str | None) -> str:
    found = LABELS.get((study, slug, criterion, ref))
    return found['final'] if found else 'unlabelled'


def split_of(study: str, slug: str) -> str | None:
    return SPLITS[study].get(slug)
