"""Writes, next to each replay report, the part of it the analysis reads (data/<label>/<study>.<slug>.judged.json): the
judgment findings at any threshold, the model's suggestions, the criteria's summaries, the notes, the capture state and
the usage. The full reports (engine and rule findings included) stay out of git; analyze.py reads either.

Run from the repository root: python -I study/notes-precision-fixes/compact.py <label> [<label> ...]
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
for label in sys.argv[1:]:
    for path in glob.glob(os.path.join(HERE, 'data', label, '*.report.json')):
        with open(path, encoding='utf-8') as f:
            r = json.load(f)
        judged = {
            'rampaVersion': r.get('rampaVersion'), 'target': r['target'], 'model': r.get('model'), 'minConfidence': r.get('minConfidence'),
            'findings': [x for x in r.get('findings', []) if x.get('source') == 'judgment'],
            'belowThreshold': [x for x in r.get('belowThreshold', []) if x.get('source') == 'judgment'],
            'needsReview': [x for x in r.get('needsReview', []) if x.get('model')],
            'criteria': r.get('criteria'), 'notes': r.get('notes'), 'errors': r.get('errors'), 'usage': r.get('usage'),
            'coverage': {'reach': (r.get('coverage') or {}).get('reach')},
        }
        with open(path.replace('.report.json', '.judged.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump(judged, f, ensure_ascii=False, indent=1)
