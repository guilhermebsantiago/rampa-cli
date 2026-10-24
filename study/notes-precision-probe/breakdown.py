"""Where the false positives are, across the three real-page studies.

Reads the committed labels of the first study (study/data), its re-measure (study/remeasure-2026-10-09), the
second study (study/fresh-2026-10-11, the run of ebd4d07 and the run asked again after the 2.4.4/2.4.6 change)
and the third (study/round-3-2026-10-23), puts every labelled finding in one row shape, and prints the counts the
notes quote: by study and split, by check, by claim, by page, by the judges' cause, and the clusters of
(criterion, claim, page) that hold most of the false positives. Writes data/rows.json for the other scripts.

Run from the repository root: python -I study/notes-precision-probe/breakdown.py
"""
from __future__ import annotations

import collections
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
sys.stdout.reconfigure(encoding='utf-8', newline='\n')


def load(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return json.load(f)


def wilson(k: int, n: int, z: float = 1.96):
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (p, max(0.0, c - h), min(1.0, c + h))


def fmt(k, n):
    if n == 0:
        return '–'
    p, lo, hi = wilson(k, n)
    return f'{p:.2f} ({lo:.2f}–{hi:.2f})'


CLAIMS = [
    # 1.1.1
    (r'is all its link holds, and does not say where the link leads', 'functional-link'),
    (r'is all its button holds', 'functional-button'),
    (r'describes something the image does not show', 'wrong_content'),
    (r'is a file name or a placeholder', 'placeholder'),
    (r'is too generic to describe the image', 'generic-alt'),
    (r'leaves out what the image conveys', 'missing_information'),
    (r'names an image that is decorative', 'decorative'),
    (r'does not serve the same purpose as the image', 'alt-none'),
    (r'hidden from assistive technology|carries information|aria-hidden|is hidden', 'hidden-image'),
    # 2.4.4
    (r'does not tell where the link goes, and nothing around it does', 'link-generic'),
    (r'is an address, not a purpose', 'link-url'),
    (r'does not match where the link', 'link-mismatch'),
    (r'is shared by \d+ links', 'link-ambiguous'),
    (r'could mean several things', 'link-ambiguous'),
    (r'does not tell where the link goes', 'link-none'),
    # 2.4.6
    (r'The heading .* says nothing about the content', 'heading-says-nothing'),
    (r'The heading .* names a different topic', 'heading-mismatch'),
    (r'The label .* does not say what to enter', 'label-says-nothing'),
    (r'The label ', 'label-other'),
    (r'The heading ', 'heading-other'),
    # 2.4.2
    (r'The page title ', 'title'),
    # 3.3.2
    (r'Nothing on screen tells what to enter', 'no-visible-instruction'),
]


def claim_of(criterion: str, message: str, rule_id: str | None, source: str | None) -> str:
    if rule_id and rule_id.startswith('rampa/'):
        return rule_id
    if source == 'engine':
        return 'engine'
    for pattern, name in CLAIMS:
        if re.search(pattern, message):
            return name
    return f'{criterion}:other'


def check_of(row) -> str:
    rid = row.get('ruleId')
    if rid and rid.startswith('rampa/'):
        return rid
    if row.get('kind') == 'experimental-judgment' or 'hidden' in (row.get('message') or '').lower() and row.get('criterion') == '1.1.1' and row.get('experimental'):
        return 'judgment-hidden/1.1.1'
    return f'judgment/{row["criterion"]}'


def rows_of(study: str, rows, split_of=None, shown_default=True, run=None):
    out = []
    for r in rows:
        if run is not None and r.get('run', r.get('mode')) != run:
            continue
        message = r.get('message') or ''
        check = check_of(r)
        claim = claim_of(r['criterion'], message, r.get('ruleId'), r.get('source'))
        if check == 'judgment-hidden/1.1.1':
            claim = 'hidden-image'
        out.append(
            {
                'study': study,
                'split': r.get('split') or (split_of(r) if split_of else 'test'),
                'slug': r['slug'],
                'criterion': r['criterion'],
                'check': check,
                'claim': claim,
                'kind': r.get('kind') or 'judgment',
                'shown': r.get('shown', shown_default),
                'final': r['final'],
                'cause': r.get('finalCause'),
                'subject': r.get('subject') or r.get('evidence'),
                'message': message,
                'ref': r.get('ref'),
                'key': r.get('key') or r.get('fingerprint'),
                'patch_to': (r.get('patch') or {}).get('to') if isinstance(r.get('patch'), dict) else None,
                'auditor': (r.get('auditor') or {}).get('rationale'),
                'skeptic': (r.get('skeptic') or {}).get('rationale'),
            }
        )
    return out


def main():
    s1 = rows_of('s1', load('study', 'data', 'findings.json'))
    rm = rows_of('s1-remeasure', load('study', 'remeasure-2026-10-09', 'data', 'findings.json'))
    s2 = rows_of('s2', load('study', 'fresh-2026-10-11', 'data', 'findings.json'), run='default')
    s2p = rows_of('s2', load('study', 'fresh-2026-10-11', 'data', 'findings.json'), run='probe')
    s2a = rows_of('s2-after', load('study', 'fresh-2026-10-11', 'data', 'after', 'findings.json'), run='after')
    s3 = rows_of('s3', load('study', 'round-3-2026-10-23', 'data', 'findings.json'), run='default')
    s3p = rows_of('s3', load('study', 'round-3-2026-10-23', 'data', 'findings.json'), run='probe')
    everything = s1 + rm + s2 + s2p + s2a + s3 + s3p
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'rows.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(everything, f, ensure_ascii=False, indent=1)

    def table(title, rows, key, top=None, min_fp=1):
        c = collections.defaultdict(lambda: collections.Counter())
        for r in rows:
            c[key(r)][r['final']] += 1
        items = sorted(c.items(), key=lambda kv: -kv[1]['false_positive'])
        total_fp = sum(v['false_positive'] for v in c.values())
        print(f'\n### {title} (FP total {total_fp})\n')
        print('| group | TP | FP | unc | precision (Wilson) | share of FP |')
        print('| --- | ---: | ---: | ---: | --- | ---: |')
        shown = 0
        for k, v in items:
            if v['false_positive'] < min_fp:
                continue
            if top and shown >= top:
                break
            shown += 1
            tp, fp, un = v['true_positive'], v['false_positive'], v['uncertain']
            print(f'| {k} | {tp} | {fp} | {un} | {fmt(tp, tp + fp)} | {fp / total_fp if total_fp else 0:.0%} |')

    # The latest state of each study: s1 at 46029c1, s1-remeasure at cf7991a, s2-after (4fd54fc) for the judged criteria
    # plus s2's rules and probes (not re-run), s3 at d23cfb5.
    judged = lambda r: r['kind'] in ('judgment', 'like')
    latest = s1 + rm + [r for r in s2a if judged(r)] + [r for r in s2 if not judged(r)] + s2p + s3 + s3p
    with open(os.path.join(OUT, 'rows-latest.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(latest, f, ensure_ascii=False, indent=1)

    print('# False positives across the studies\n')
    print('Every count below is of labelled findings (two Claude judges; uncertain = the judges disagreed).')
    table('By study and split, every labelled finding', everything, lambda r: f"{r['study']} {r['split']}")
    table('By study and split, default threshold only (what a user sees)', [r for r in everything if r['shown']], lambda r: f"{r['study']} {r['split']}")

    print('\n## The latest run of each study (s1 first run, its re-measure, s2 after the 2.4.4/2.4.6 change, s3)')
    table('By check, all thresholds', latest, lambda r: r['check'])
    table('By check, default threshold', [r for r in latest if r['shown']], lambda r: r['check'])
    table('By claim (judged criteria), all thresholds', [r for r in latest if r['check'].startswith('judgment')], lambda r: f"{r['criterion']} {r['claim']}")
    table('By claim, default threshold', [r for r in latest if r['check'].startswith('judgment') and r['shown']], lambda r: f"{r['criterion']} {r['claim']}")
    table('By page, default threshold (top 15)', [r for r in latest if r['shown']], lambda r: f"{r['study']} {r['slug']}", top=15)
    table("By the judges' cause, default threshold", [r for r in latest if r['shown']], lambda r: f"{r['cause']}")
    table('Clusters: criterion, claim and page, default threshold (top 25)', [r for r in latest if r['shown']], lambda r: f"{r['study']} {r['slug']} · {r['criterion']} {r['claim']}", top=25)

    print('\n## Studies 2 and 3 only (the code since the 2.4.4/2.4.6 change), judged criteria, default threshold')
    recent = [r for r in latest if r['study'] in ('s2-after', 's3') and r['check'].startswith('judgment') and r['shown']]
    table('By criterion', recent, lambda r: r['criterion'])
    table('By claim', recent, lambda r: f"{r['criterion']} {r['claim']}")
    table('By page (top 12)', recent, lambda r: f"{r['study']} {r['slug']}", top=12)

    print('\n## Experimental rules and probes, studies 2 and 3')
    exp = [r for r in latest if r['study'] in ('s2', 's3') and not r['check'].startswith('judgment')]
    table('By check', exp, lambda r: r['check'], min_fp=0)
    table('Clusters by check and page (FP only, top 12)', exp, lambda r: f"{r['study']} {r['slug']} · {r['check']}", top=12)


if __name__ == '__main__':
    main()
