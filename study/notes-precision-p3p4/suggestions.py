"""How the model's suggestions (needsReview items with a model) moved between two replays, by study, half and criterion;
itemised for the in-sample sets, counted only for the fifth study's test half.

Run from the repository root: python -I study/notes-precision-p3p4/suggestions.py <before label> <after label>
"""
import collections
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'notes-precision-p1p2'))
sys.path.insert(1, HERE)
from labels import split_of  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', newline='\n')


def items(label):
    out = {}
    for path in glob.glob(os.path.join(HERE, 'data', label, '*.judged.json')):
        study, slug = os.path.basename(path).split('.')[:2]
        with open(path, encoding='utf-8') as f:
            report = json.load(f)
        for n in report.get('needsReview') or []:
            if n.get('model'):
                out[(study, slug, n['criterion'], n.get('ref'))] = n
    return out


before, after = items(sys.argv[1]), items(sys.argv[2])
for name, moved in (('left', [k for k in before if k not in after]), ('new', [k for k in after if k not in before])):
    tally = collections.Counter((k[0], split_of(k[0], k[1]), k[2]) for k in moved)
    print(f'Suggestions {name}: ' + (', '.join(f'{s} {h} {c} {v}' for (s, h, c), v in sorted(tally.items())) or 'none'))
    for k in sorted(moved):
        if k[0] == 's5' and split_of(k[0], k[1]) == 'test':
            continue
        n = (before if name == 'left' else after)[k]
        print(f"- {k[0]} {split_of(k[0], k[1])} {k[1]} {k[2]}: {n['message'][:110]}")
