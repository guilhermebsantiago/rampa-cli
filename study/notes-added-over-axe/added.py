"""True judged findings that axe-core, run on the same snapshot, does not report.

For the current code on studies 2 to 5: the in-sample replay of studies 2 to 4 (notes-precision-fixes,
`after`) and the fifth study's main run (held out). A judged finding counts as found by axe-core too when
an axe-core finding of the same report fails the same element under the same criterion; a looser reading
also counts an axe-core finding on that element under any criterion.

    python -I study/notes-added-over-axe/added.py
"""
import collections
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RECORDINGS = os.environ.get('RECORDINGS', 'C:/Users/guilh/dev/rampa-study-recordings')
sys.stdout.reconfigure(encoding='utf-8', newline='\n')


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


spec = importlib.util.spec_from_file_location('fixes', os.path.join(ROOT, 'study', 'notes-precision-fixes', 'analyze.py'))
fixes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixes)

items = [dict(i, held_out=False) for i in fixes.collect('after')]
for r in load(os.path.join(ROOT, 'study', 'round-5-2026-10-28', 'data', 'findings.json')):
    if r.get('origin', 'main') == 'main' and r['group'] == 'judged' and r['shown']:
        items.append({'study': 's5', 'split': r['split'], 'slug': r['slug'], 'criterion': r['criterion'], 'ref': r['ref'],
                      'claim': r.get('claim') or r.get('kind'), 'final': r['final'], 'subject': r.get('subject'), 'held_out': True})


def report_of(study, slug):
    if study == 's5':
        return load(os.path.join(RECORDINGS, 'round-5', 'pages', slug, 'report.json'))
    return load(os.path.join(ROOT, 'study', fixes.STUDIES[study], 'pages', slug, 'report.json'))


engine = {}
for study, slug in sorted({(i['study'], i['slug']) for i in items}):
    rep = report_of(study, slug)
    rows = [f for f in rep.get('findings', []) + rep.get('belowThreshold', []) if f.get('source') == 'engine']
    engine[(study, slug)] = {
        'same': {(f['criterion'], f.get('ref')) for f in rows},
        'element': {f.get('ref') for f in rows},
        'criteria': {f['criterion'] for f in rows},
        'count': len(rows),
    }

pages = {
    's2': len(fixes.split_of('s2')), 's3': len(fixes.split_of('s3')), 's4': len(fixes.split_of('s4')),
    's5': len(load(os.path.join(ROOT, 'study', 'round-5-2026-10-28', 'data', 'pages-input.json'))['pages']),
}
out = {'pages': pages, 'sets': {}}
for name, held in (('in-sample, studies 2-4', False), ('held out, study 5', True), ('studies 2-5', None)):
    rows = [i for i in items if held is None or i['held_out'] == held]
    tp = [i for i in rows if i['final'] == 'true_positive']
    fp = [i for i in rows if i['final'] == 'false_positive']
    same = [i for i in tp if (i['criterion'], i['ref']) in engine[(i['study'], i['slug'])]['same']]
    element = [i for i in tp if i['ref'] in engine[(i['study'], i['slug'])]['element']]
    no_axe_criterion = [i for i in tp if i['criterion'] not in engine[(i['study'], i['slug'])]['criteria']]
    tp_pages = {(i['study'], i['slug']) for i in tp}
    only_pages = {(i['study'], i['slug']) for i in no_axe_criterion}
    by_criterion = collections.Counter(i['criterion'] for i in tp)
    added_by_criterion = collections.Counter(i['criterion'] for i in tp if (i['criterion'], i['ref']) not in engine[(i['study'], i['slug'])]['same'])
    n_pages = sum(pages[s] for s in {i['study'] for i in rows})
    out['sets'][name] = {
        'pages': n_pages, 'true': len(tp), 'false': len(fp),
        'alsoAxeSameCriterion': len(same), 'alsoAxeAnyCriterion': len(element),
        'added': len(tp) - len(same), 'addedStrict': len(tp) - len(element),
        'trueUnderCriterionAxeDidNotFailOnPage': len(no_axe_criterion),
        'pagesWithTrue': len(tp_pages), 'pagesWithTrueUnderCriterionAxeDidNotFail': len(only_pages),
        'trueByCriterion': dict(sorted(by_criterion.items())), 'addedByCriterion': dict(sorted(added_by_criterion.items())),
        'axeFindingsOnThesePages': sum(engine[k]['count'] for k in {(i['study'], i['slug']) for i in rows}),
        'overlap': [{k: i[k] for k in ('study', 'slug', 'criterion', 'claim', 'subject')} for i in element],
    }
    s = out['sets'][name]
    print(f"## {name}: {n_pages} pages")
    print(f"true judged findings {s['true']} (false {s['false']}); axe-core fails the same element under the same criterion: {s['alsoAxeSameCriterion']}; under any criterion: {s['alsoAxeAnyCriterion']}")
    print(f"added over axe-core: {s['added']} (strict {s['addedStrict']}); under a criterion axe-core failed nothing on that page: {s['trueUnderCriterionAxeDidNotFailOnPage']}")
    print(f"pages with a true judged finding: {s['pagesWithTrue']}; with one under a criterion axe-core failed nothing on: {s['pagesWithTrueUnderCriterionAxeDidNotFail']}")
    print(f"by criterion: {s['trueByCriterion']}; added: {s['addedByCriterion']}")
    for o in s['overlap']:
        print(f"  overlap: {o}")
    print()

with open(os.path.join(HERE, 'added.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
