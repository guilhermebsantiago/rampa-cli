"""How many findings and pages a sixth round needs for a defensible "0.9 or more".

- Wilson 95% lower bound for an observed precision, by n;
- the page-level design effect from the fifth study's findings (both halves, counts and labels by page only: the
  intra-page correlation of the true/false label, Fleiss' ANOVA estimator), and the pages that effect implies at the
  fifth study's findings per page;
- the chance that a round with a true precision p gives an observed lower bound >= 0.85, by n (binomial, no clustering).

Run from the repository root: python -I study/notes-precision-round5/sample_size.py
"""
from __future__ import annotations

import collections
import json
import math
import os
import sys

sys.stdout.reconfigure(encoding='utf-8', newline='\n')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def wilson(k, n, z=1.96):
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


print('Wilson 95% lower bound by observed precision and n:')
print('  n     p=0.90  p=0.92  p=0.95')
for n in (25, 40, 63, 80, 100, 120, 150, 200, 250, 300, 400):
    print(f'  {n:4} ', '  '.join(f'{wilson(round(p * n), n)[0]:.3f}' for p in (0.90, 0.92, 0.95)))


def smallest_n(p, bound):
    for n in range(10, 2000):
        if wilson(round(p * n), n)[0] >= bound:
            return n
    return None


for p in (0.90, 0.92, 0.95):
    print(f'smallest n with lower bound >= 0.85 at observed {p}: {smallest_n(p, 0.85)}; >= 0.90: {smallest_n(p, 0.90)}')

# Design effect from the fifth study: judged default-threshold findings, both halves, by page (labels counted, not read).
rows = json.load(open(os.path.join(ROOT, 'study', 'round-5-2026-10-28', 'data', 'findings.json'), encoding='utf-8'))
by_page = collections.defaultdict(list)
for r in rows:
    if r['kind'] == 'judgment' and r['group'] == 'judged' and r['shown'] and r['run'] == 'default' and r['origin'] == 'main' and r['final'] in ('true_positive', 'false_positive'):
        by_page[r['slug']].append(1 if r['final'] == 'true_positive' else 0)
sizes = [len(v) for v in by_page.values()]
N = sum(sizes)
k = len(sizes)
p = sum(sum(v) for v in by_page.values()) / N
# Fleiss-style ANOVA estimator of the intra-cluster correlation for binary data.
n0 = (N - sum(s * s for s in sizes) / N) / (k - 1)
msb = sum(len(v) * (sum(v) / len(v) - p) ** 2 for v in by_page.values()) / (k - 1)
msw = sum(sum((x - sum(v) / len(v)) ** 2 for x in v) for v in by_page.values()) / (N - k)
icc = (msb - msw) / (msb + (n0 - 1) * msw) if msb + (n0 - 1) * msw > 0 else 0.0
icc = max(0.0, icc)
mean_size = N / k
deff = 1 + (mean_size - 1) * icc
print(f'\nFifth study, both halves: {N} decided findings on {k} pages (mean {mean_size:.2f} a page with a finding; '
      f'{len(json.load(open(os.path.join(ROOT, "study", "round-5-2026-10-28", "data", "pages-input.json"), encoding="utf-8"))["pages"])} pages collected), '
      f'precision {p:.3f}, ICC {icc:.3f}, design effect {deff:.2f}')
per_collected = N / 24
print(f'findings per collected page: {per_collected:.2f}')
for target_n in (120, 150, 200, 250):
    eff = target_n * deff
    print(f'  for {target_n} effective findings: {eff:.0f} raw findings, about {eff / per_collected:.0f} pages at the fifth study\'s rate')

# Chance of a lower bound >= 0.85 by n, for a true precision p, from the binomial.
print('\nChance that the Wilson lower bound is >= 0.85 (no clustering), by true precision and n:')
print('  n     p=0.88  p=0.90  p=0.92  p=0.95')
for n in (63, 100, 150, 200, 300):
    out = []
    for p in (0.88, 0.90, 0.92, 0.95):
        prob = sum(math.comb(n, x) * p ** x * (1 - p) ** (n - x) for x in range(n + 1) if wilson(x, n)[0] >= 0.85)
        out.append(f'{prob:.2f}')
    print(f'  {n:4} ', '   '.join(out))
