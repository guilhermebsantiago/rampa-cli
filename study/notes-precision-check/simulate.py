"""Counterfactual filters over the labelled default-threshold judgment findings of the current code: round 4 (main run)
and the merged code's replay on studies 2 and 3 (study/notes-precision-probe/data/compare-impl.md, whose remaining
findings are reconstructed from rows-latest.json minus the findings that replay removed).
  python -I study/notes-precision-check/simulate.py
Every number is in-sample: all halves have been read. Filters:
  F1  H81: a shared-text 2.4.4 finding on a link whose list item sits in a list item of its own (nested list under a parent
      item) is not a finding. In the labels: toolstation.com's 50 (ancestry.py); no true positive sits in a list item.
  F2  default body look: a page whose body text is the browser default (Times New Roman 16px 400 black) while no author
      stylesheet applied is treated as unstyled. In the labels: museudoamanha.org.br (round 4) and www.ufpe.br (study 3).
  F3  1.1.1 second pass at 0.99 instead of 0.9 (round 4 only; the replay reports lack the probabilities).
  F4  reasoned: 2.4.4 shared text told apart by its landmark (osesp's two footers): -2 FP, 0 TP, not simulated by code.
"""
import json, math, re, collections
def wilson(tp, n):
    if n == 0: return '–'
    p = tp / n; z = 1.96; d = 1 + z*z/n; c = (p + z*z/(2*n)) / d; h = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d
    return f'{p:.2f} ({c-h:.2f}–{c+h:.2f})'
rows = []
r4 = json.load(open('study/round-4-2026-10-24/data/findings.json', encoding='utf-8'))
for x in r4:
    if x['origin'] == 'main' and x['group'] == 'judged' and x['shown']:
        c = x.get('confirmation') or {}
        rows.append(dict(study='r4', split=x['split'], slug=x['slug'], criterion=x['criterion'], subject=str(x['subject']),
                         final=x['final'], shared='shared by' in x['message'], prob=c.get('minProbability')))
# studies 2 and 3 under the replay: labelled findings minus the ones compare-impl.md lists as gone
md = open('study/notes-precision-probe/data/compare-impl.md', encoding='utf-8').read()
gone = collections.Counter((m.group(3), m.group(4), m.group(6)) for m in re.finditer(r"^- (fa|tr|un) (\w+) (\S+) (\S+) (\S+): '(.*)'$", md, re.M))
latest = json.load(open('study/notes-precision-probe/data/rows-latest.json', encoding='utf-8'))
for x in latest:
    if x['kind'] != 'judgment' or not x['shown']: continue
    if x['study'] == 's3': study = 's3'
    elif x['study'] == 's2-after': study = 's2'   # the second study's judgment rows after its 2.4.4/2.4.6 change, all criteria
    else: continue
    k = (x['slug'], x['criterion'], str(x['subject']))
    if gone[k] > 0: gone[k] -= 1; continue
    rows.append(dict(study=study, split=x['split'], slug=x['slug'], criterion=x['criterion'], subject=str(x['subject']),
                     final=x['final'], shared='shared by' in (x['message'] or ''), prob=None))
NESTED = {'toolstation-plumbing'}          # ancestry.py: every flagged link has a parent list item ('Deals', 'Sale & Clearance')
DEFAULT_LOOK = {('r4', 'museudoamanha'), ('s3', 'ufpe-br')}   # bodyLook times new roman 16/400/black, no sheet applied
def F1(r): return r['criterion'] == '2.4.4' and r['shared'] and r['slug'] in NESTED
def F2(r): return (r['study'], r['slug']) in DEFAULT_LOOK
def F3(r): return r['criterion'] == '1.1.1' and r['prob'] is not None and r['prob'] < 0.99
def F4(r): return r['criterion'] == '2.4.4' and r['shared'] and r['slug'] == 'osesp-contato'
FILTERS = [('today', lambda r: False), ('F1 H81 nested list', F1), ('F2 default body look', F2), ('F1+F2', lambda r: F1(r) or F2(r)),
           ('F1+F2+F3 (0.99)', lambda r: F1(r) or F2(r) or F3(r)), ('F1+F2+F3+F4 (reasoned)', lambda r: F1(r) or F2(r) or F3(r) or F4(r))]
groups = [('r4 test', lambda r: r['study'] == 'r4' and r['split'] == 'test'), ('r4 dev', lambda r: r['study'] == 'r4' and r['split'] == 'dev'),
          ('r4 all', lambda r: r['study'] == 'r4'), ('s3 test', lambda r: r['study'] == 's3' and r['split'] == 'test'),
          ('s3 dev', lambda r: r['study'] == 's3' and r['split'] == 'dev'), ('s2 test', lambda r: r['study'] == 's2' and r['split'] == 'test'),
          ('s2 dev', lambda r: r['study'] == 's2' and r['split'] == 'dev'), ('all three', lambda r: True), ('all test halves', lambda r: r['split'] == 'test')]
print('| filter | ' + ' | '.join(g for g, _ in groups) + ' |'); print('|' + ' --- |' * (len(groups) + 1))
for name, f in FILTERS:
    cells = []
    for g, sel in groups:
        kept = [r for r in rows if sel(r) and not f(r)]
        tp = sum(r['final'] == 'true_positive' for r in kept); fp = sum(r['final'] == 'false_positive' for r in kept)
        lost = sum(r['final'] == 'true_positive' for r in rows if sel(r) and f(r))
        cells.append(f'{tp}/{fp} {wilson(tp, tp + fp)}' + (f' −{lost}TP' if lost else ''))
    print(f'| {name} | ' + ' | '.join(cells) + ' |')
print()
print('Remaining false positives after F1+F2+F3+F4, by page and claim:')
left = collections.Counter((r['study'], r['split'], r['slug'], r['criterion']) for r in rows if r['final'] == 'false_positive' and not (F1(r) or F2(r) or F3(r) or F4(r)))
for k in sorted(left): print(' ', k, left[k])
