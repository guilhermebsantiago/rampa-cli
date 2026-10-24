"""Counterfactual simulations of the precision interventions on the labelled findings of studies 2 and 3.

Joins the labels (data/rows.json, from breakdown.py) with the recorded model answers and the facts today's code
computes for each candidate (data/fates-*.json, from fates-all.ts), the committed fates of the second study's run
asked again after the 2.4.4/2.4.6 change (study/fresh-2026-10-11/data/after/fates), and the one-word verifier's
answers (data/verifier-*.json, from verifier.ts). Then applies each intervention as a filter over the findings a
user sees today and reports what it removes: false positives gone, true positives lost, precision before and after
with 95% Wilson intervals, per study and pooled. Every number is in-sample: the pages were read to choose the
interventions. The per-study columns say what an intervention written from one study's patterns does on the other.

Run from the repository root: python -I study/notes-precision-probe/simulate.py [--verbose]
"""
from __future__ import annotations

import collections
import glob
import json
import math
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(HERE, 'data')
VERBOSE = '--verbose' in sys.argv
sys.stdout.reconfigure(encoding='utf-8', newline='\n')


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def wilson(k, n, z=1.96):
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


def fold(text):
    return unicodedata.normalize('NFD', (text or '').lower()).encode('ascii', 'ignore').decode()


def words(text):
    return [w for w in re.split(r'[^a-z0-9]+', fold(text)) if w]


KIND_WORDS = {
    'icon', 'icone', 'icons', 'icones', 'logo', 'logos', 'logotipo', 'logomarca', 'imagem', 'image', 'img', 'foto', 'photo', 'picture', 'banner',
    'ilustracao', 'illustration', 'figura', 'figure', 'thumbnail', 'miniatura', 'decorative', 'decorativo', 'decorativa',
}
STOP = {'the', 'and', 'for', 'with', 'from', 'this', 'that', 'our', 'your', 'you', 'are', 'its', 'into', 'all', 'uma', 'com', 'para', 'por', 'dos', 'das', 'nos', 'nas', 'que', 'del', 'los', 'las', 'de', 'da', 'do', 'of', 'to', 'in', 'on', 'at', 'em', 'no', 'na'}


def content_words(text):
    return {w for w in words(text) if (len(w) >= 3 or w.isdigit()) and w not in STOP and w not in KIND_WORDS}


LANG_CODES = {'pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'zh', 'ru', 'ar', 'nl', 'pt-br', 'en-us', 'en-gb', 'es-es', 'ptbr', 'enus'}
LANG_NAMES = {
    'portugues', 'portuguese', 'english', 'ingles', 'espanol', 'spanish', 'espanhol', 'french', 'frances', 'deutsch', 'german', 'alemao', 'italiano', 'italian',
}


# ---------------------------------------------------------------- loading

rows = load(os.path.join(DATA, 'rows.json'))
STUDIES = {'s2-after': 'fresh-2026-10-11', 's3': 'round-3-2026-10-23'}


def fates_of(study, slug):
    """Today's facts and the recorded answers for every candidate of a page, keyed by (criterion, ref)."""
    out = {}
    folder = 's2' if study == 's2-after' else 's3'
    for sub in (f'fates-{folder}', f'fates111-{folder}'):
        path = os.path.join(DATA, sub, f'{slug}.json')
        if os.path.exists(path):
            for r in load(path):
                out[(r['criterion'], r['ref'])] = r
    return out


_fates_cache = {}


def fates(study, slug):
    key = (study, slug)
    if key not in _fates_cache:
        _fates_cache[key] = fates_of(study, slug)
    return _fates_cache[key]


_after = {}


def after_output(slug, criterion, ref):
    """The model's answer in the second study's run asked again (4fd54fc), from the committed fates."""
    if slug not in _after:
        path = os.path.join(ROOT, 'study', 'fresh-2026-10-11', 'data', 'after', 'fates', f'{slug}.json')
        _after[slug] = {(r['criterion'], r['ref']): r for r in load(path)} if os.path.exists(path) else {}
    return _after[slug].get((criterion, ref))


_snapshots = {}


def snapshot_index(study, slug):
    """Parent map and node map of a page's snapshot, for facts the candidates do not carry (the list a link sits in)."""
    key = (study, slug)
    if key in _snapshots:
        return _snapshots[key]
    folder = STUDIES[study]
    paths = glob.glob(os.path.join(ROOT, 'study', folder, 'pages', slug, 'recording', '*.snapshot.json'))
    nodes, parents = {}, {}
    if paths:
        snap = load(paths[0])
        stack = [(snap['root'], None)]
        while stack:
            node, parent = stack.pop()
            nodes[node['ref']] = node
            parents[node['ref']] = parent
            for child in node.get('children', []):
                stack.append((child, node['ref']))
    _snapshots[key] = (nodes, parents)
    return _snapshots[key]


def count_links(node):
    n = 1 if node.get('role') == 'link' else 0
    for child in node.get('children', []):
        n += count_links(child)
    return n


def enclosing_list(study, slug, ref):
    """The nearest list around an element: how many links it holds and how tall it is."""
    nodes, parents = snapshot_index(study, slug)
    current = parents.get(ref)
    while current is not None:
        node = nodes[current]
        if node.get('role') == 'list':
            return {'links': count_links(node), 'height': (node.get('bounds') or {}).get('height', 0)}
        current = parents.get(current)
    return None


_verifier = {}


def verifier(study):
    if study not in _verifier:
        path = os.path.join(DATA, f"verifier-{'s2' if study == 's2-after' else 's3'}.json")
        table = collections.defaultdict(dict)
        if os.path.exists(path):
            for r in load(path):
                table[(r['slug'], r['criterion'], r['ref'])][r['framing']] = r.get('pFail')
        _verifier[study] = table
    return _verifier[study]


# ---------------------------------------------------------------- the findings a user sees today

def enrich(row):
    """One labelled finding with its facts, answer and verifier probabilities."""
    f = fates(row['study'], row['slug']).get((row['criterion'], row['ref']))
    facts = (f or {}).get('facts') or {}
    output = (f or {}).get('output') or {}
    if row['study'] == 's2-after' and row['criterion'] in ('2.4.4', '2.4.6'):
        a = after_output(row['slug'], row['criterion'], row['ref'])
        if a:
            output = a.get('output') or output
    row = dict(row)
    row['facts'] = facts
    row['output'] = output
    row['todayFate'] = (f or {}).get('fate')
    row['todayVerification'] = (f or {}).get('verification')
    row['verifier'] = verifier(row['study']).get((row['slug'], row['criterion'], row['ref']), {})
    return row


base = [enrich(r) for r in rows if r['study'] in STUDIES and r['check'].startswith('judgment') and r['shown']]


def summary(items):
    c = collections.Counter(r['final'] for r in items)
    return c['true_positive'], c['false_positive'], c['uncertain']


# ---------------------------------------------------------------- interventions

def is_wrong_content(r):
    return r['criterion'] == '1.1.1' and r['claim'] == 'wrong_content'


def functional(r):
    return r['facts'].get('functional') or {}


def alt_names_language(r):
    """A flag in a language link, named by its language code or name (cnj.jus.br's GTranslate flags)."""
    if r['criterion'] != '1.1.1':
        return False
    alt = fold(r['facts'].get('alt', ''))
    around = fold(' '.join(str(x or '') for x in [r['facts'].get('actionText'), r['facts'].get('controlText'), functional(r).get('title'), functional(r).get('nextTo'), r['facts'].get('html')]))
    names_language = alt in LANG_CODES or any(w in LANG_NAMES for w in words(alt)) or alt in LANG_NAMES
    link_is_language = 'hreflang' in around or any(w in LANG_NAMES or w in LANG_CODES for w in words(around)) or 'gtranslate' in around or 'translate' in around
    return names_language and link_is_language


def alt_in_nearby_text(r):
    """An icon named for what it stands for, next to a heading or card text of the same words (my.clevelandclinic.org)."""
    if r['criterion'] != '1.1.1' or r['claim'] not in ('wrong_content', 'missing_information'):
        return False
    said = content_words(r['facts'].get('alt', ''))
    if not said:
        return False
    nearby = set(words(r['facts'].get('nearbyText') or '')) | set(words(r['facts'].get('controlText') or '')) | set(words(functional(r).get('nextTo') or ''))
    return said <= nearby


def logo_to_home(r):
    """A linked logo that names the site and leads to its home page (H30's accepted convention)."""
    if r['criterion'] != '1.1.1' or r['claim'] not in ('functional-link',):
        return False
    f = functional(r)
    href = (f.get('href') or '').strip()
    alt = r['facts'].get('alt', '')
    if not href:
        return False
    path = re.sub(r'^https?://[^/]+', '', href)
    is_home = path in ('', '/', '/#') or re.fullmatch(r'/([a-z]{2}([-_][a-z]{2})?/?|index\.html?|home/?|pt-br/?|inicio/?)', path, re.I) is not None
    site = set(f.get('siteWords') or [])
    said = content_words(alt)
    # A logo, or an alternative that is mostly the site's own name ("Cleveland Clinic"), not a photo that mentions it.
    names_site = 'logo' in words(alt) or (bool(said) and len(said & site) * 2 >= len(said))
    return is_home and names_site


def purpose_mostly_named(r, share=2 / 3):
    """A functional image whose alternative shares most of its content words with the link's title, destination or caption
    (a looser namesPurpose: puc-rio.br's "Selo da Arquidiocese…" on a link titled "Site da Arquidiocese…")."""
    if r['criterion'] != '1.1.1' or r['claim'] != 'functional-link':
        return False
    f = functional(r)
    said = content_words(r['facts'].get('alt', ''))
    if len(said) < 2:
        return False
    for purpose in (f.get('title'), f.get('destination'), f.get('nextTo') if f.get('nextTo') and len(f['nextTo']) <= 80 else None, *(f.get('names') or [])):
        if not purpose:
            continue
        there = set(words(purpose))
        if len(said & there) >= share * len(said):
            return True
    return False


def description_contradicts(r):
    """The model's own description of the image names what the alternative names (today's keepsAlternative, on imageShows)."""
    if not is_wrong_content(r):
        return False
    said = content_words(r['facts'].get('alt', ''))
    shows = set(words(r['output'].get('imageShows', ''))) | set(words(r['output'].get('suggestedAlt', '')))
    return bool(said) and said <= shows


def url_in_sentence(r):
    """A raw address whose sentence says where it leads (cnj.jus.br's 'www.cnj.jus.br/comopeticionar.')."""
    return r['criterion'] == '2.4.4' and r['claim'] == 'link-url' and bool(r['facts'].get('context'))


def in_giant_list(r, limit=100):
    """A link in a list of more than `limit` links: a data list such as a type-ahead's, not navigation (ufpe.br)."""
    if r['criterion'] != '2.4.4':
        return False
    lst = enclosing_list(r['study'], r['slug'], r['ref'])
    return bool(lst and lst['links'] > limit)


def ambiguous_pairs_same_list(r):
    """The 'ambiguous' fact where the links that share the text sit in one list of more than 50 links."""
    return r['criterion'] == '2.4.4' and r['claim'] == 'link-ambiguous' and in_giant_list(r, 50)


def verifier_says_pass(r, framing, threshold=0.5):
    p = r['verifier'].get(framing)
    return p is not None and p < threshold


def verifier_votes(r):
    """How many of the three framings say fail (None when no framing answered)."""
    ps = [p for p in (r['verifier'].get(k) for k in 'ABC') if p is not None]
    if not ps:
        return None
    return sum(1 for p in ps if p >= 0.5), len(ps)


def mean_pfail(r):
    ps = [p for p in (r['verifier'].get(k) for k in 'ABC') if p is not None]
    return sum(ps) / len(ps) if ps else None


def min_pfail(r):
    ps = [p for p in (r['verifier'].get(k) for k in 'ABC') if p is not None]
    return min(ps) if ps else None


def reading_claim(r):
    """A 1.1.1 claim that rests on the model's reading of the picture: no pattern or list decides it."""
    return r['criterion'] == '1.1.1' and r['claim'] in ('wrong_content', 'functional-link', 'functional-button', 'missing_information')


INTERVENTIONS = [
    ('T0 today\'s main (15b1149) verification on the recorded answers: 1.1.1 claims it now discards', lambda r: r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded'),
    ('I1 collector: a page rendered without its stylesheet (ufpe.br) reports no judgment finding; proxy here: a link in a list of >100 links', in_giant_list),
    ('I1b the same with a smaller list (>50 links)', lambda r: in_giant_list(r, 50)),
    ('I2 1.1.1 "describes something the image does not show" becomes a suggestion (no fact can ground it)', is_wrong_content),
    ('I2b 1.1.1 wrong_content stays a finding only when the model\'s description shares no content word with the alternative', lambda r: is_wrong_content(r) and bool(content_words(r['facts'].get('alt', '')) & (set(words(r['output'].get('imageShows', ''))) | set(words(r['output'].get('suggestedAlt', '')))))),
    ('I3 1.1.1 fact: an alternative that names the language of its language link (flags)', alt_names_language),
    ('I4 1.1.1 fact: an alternative whose words are all in the text next to it (icon beside a heading or card)', alt_in_nearby_text),
    ('I5 1.1.1 fact: a linked logo that names the site and leads to its home page', logo_to_home),
    ('I5b 1.1.1 fact: a functional image whose alternative shares two thirds of its words with the link\'s title, destination or caption', purpose_mostly_named),
    ('I6 2.4.4 fact: a raw address inside a sentence is a suggestion, not a finding', url_in_sentence),
    ('I7 2.4.4 fact: "ambiguous" links that sit in one list of >50 links', ambiguous_pairs_same_list),
    ('I8 all 2.4.6, 2.4.2 and 3.3.2 judgment findings become suggestions', lambda r: r['criterion'] in ('2.4.6', '2.4.2', '3.3.2')),
    ('I9 all 2.4.4 findings become suggestions (only facts, no model, would remain)', lambda r: r['criterion'] == '2.4.4'),
    ('V-A second pass, framing A (criterion rules, one word): drop when P(fail) < 0.5', lambda r: verifier_says_pass(r, 'A')),
    ('V-B second pass, framing B (is the claim correct?): drop when P(yes) < 0.5', lambda r: verifier_says_pass(r, 'B')),
    ('V-C second pass, framing C (symmetric question): drop when P(fail) < 0.5', lambda r: verifier_says_pass(r, 'C')),
    ('V-2of3 keep only when at least 2 of the 3 framings say fail', lambda r: (lambda v: v is not None and v[0] < 2)(verifier_votes(r))),
    ('V-3of3 keep only when all 3 framings say fail', lambda r: (lambda v: v is not None and v[0] < v[1])(verifier_votes(r))),
    ('V-mean keep only when the mean P(fail) over the framings is at least 0.9', lambda r: (lambda m: m is not None and m < 0.9)(mean_pfail(r))),
]


def subset(items, where):
    study, _, split = where.partition(' ')
    return [r for r in items if r['study'] == study and (not split or r['split'] == split)]


def report(title, items, predicate, by=('s2-after', 's3', 's3 dev', 's3 test')):
    removed = [r for r in items if predicate(r)]
    kept = [r for r in items if not predicate(r)]
    tp0, fp0, un0 = summary(items)
    tp1, fp1, un1 = summary(kept)
    rtp, rfp, run_ = summary(removed)
    line = f'| {title} | {rfp} | {rtp} | {run_} | {fmt(tp0, tp0 + fp0)} → {fmt(tp1, tp1 + fp1)} |'
    for study in by:
        sub = subset(items, study)
        subk = [r for r in sub if not predicate(r)]
        a, b, _ = summary(sub)
        c, d, _ = summary(subk)
        e, f, _ = summary([r for r in sub if predicate(r)])
        line += f' {fmt(a, a + b)} → {fmt(c, c + d)} (−{f} FP, −{e} TP) |'
    print(line)
    if VERBOSE and removed:
        for r in removed:
            print(f"    - [{r['final'][:2]}] {r['study']} {r['slug']} {r['criterion']} {r['claim']}: {r['subject']!r}")


def header():
    print('| intervention | FP removed | TP lost | unc. removed | pooled precision before → after | s2-after before → after | s3 before → after | s3 dev | s3 test |')
    print('| --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |')


def main():
    tp, fp, un = summary(base)
    print('# Counterfactual simulations on the judgment findings a user sees (default threshold)\n')
    print(f'Base: studies 2 (run asked again after the 2.4.4/2.4.6 change) and 3, {len(base)} labelled judgment findings: {tp} TP, {fp} FP, {un} uncertain; precision {fmt(tp, tp + fp)}.')
    joined = sum(1 for r in base if r['facts'])
    print(f'{joined} of them joined to today\'s facts and the recorded answer; {len(base) - joined} did not (a candidate today\'s code no longer makes, or a hidden-image question).')
    print(f"Verifier answers available: {sum(1 for r in base if r['verifier'])} findings.\n")

    print('## Each intervention alone\n')
    header()
    for title, predicate in INTERVENTIONS:
        report(title, base, predicate)

    print('\n## Stacks (applied together)\n')
    header()
    stacks = [
        ('S1 = T0 + I1 (collector guard)', lambda r: r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded' or in_giant_list(r)),
        ('S2 = S1 + I3 + I4 + I5 + I6 (new facts)', lambda r: (r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded') or in_giant_list(r) or alt_names_language(r) or alt_in_nearby_text(r) or logo_to_home(r) or url_in_sentence(r)),
        ('S3 = S2 + I8 (2.4.6, 2.4.2, 3.3.2 suggest only)', lambda r: (r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded') or in_giant_list(r) or alt_names_language(r) or alt_in_nearby_text(r) or logo_to_home(r) or url_in_sentence(r) or r['criterion'] in ('2.4.6', '2.4.2', '3.3.2')),
        ('S4 = S3 + I2 (wrong_content suggest only)', lambda r: (r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded') or in_giant_list(r) or alt_names_language(r) or alt_in_nearby_text(r) or logo_to_home(r) or url_in_sentence(r) or r['criterion'] in ('2.4.6', '2.4.2', '3.3.2') or is_wrong_content(r)),
        ('S5 = S3 + V-2of3 (second pass on what is left)', lambda r: (r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded') or in_giant_list(r) or alt_names_language(r) or alt_in_nearby_text(r) or logo_to_home(r) or url_in_sentence(r) or r['criterion'] in ('2.4.6', '2.4.2', '3.3.2') or (lambda v: v is not None and v[0] < 2)(verifier_votes(r))),
        ('S6 = S3 + V-3of3', lambda r: (r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded') or in_giant_list(r) or alt_names_language(r) or alt_in_nearby_text(r) or logo_to_home(r) or url_in_sentence(r) or r['criterion'] in ('2.4.6', '2.4.2', '3.3.2') or (lambda v: v is not None and v[0] < v[1])(verifier_votes(r))),
        ('S7 = S4 + V-2of3', lambda r: (r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded') or in_giant_list(r) or alt_names_language(r) or alt_in_nearby_text(r) or logo_to_home(r) or url_in_sentence(r) or r['criterion'] in ('2.4.6', '2.4.2', '3.3.2') or is_wrong_content(r) or (lambda v: v is not None and v[0] < 2)(verifier_votes(r))),
        ('S8 = S3 + V-3of3 on the 1.1.1 claims that rest on the model\'s reading only (wrong_content, functional)', lambda r: (r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded') or in_giant_list(r) or alt_names_language(r) or alt_in_nearby_text(r) or logo_to_home(r) or url_in_sentence(r) or r['criterion'] in ('2.4.6', '2.4.2', '3.3.2') or (reading_claim(r) and (lambda v: v is not None and v[0] < v[1])(verifier_votes(r)))),
        ('S9 = S8 with min P(fail) over the framings ≥ 0.9 instead of three votes', lambda r: (r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded') or in_giant_list(r) or alt_names_language(r) or alt_in_nearby_text(r) or logo_to_home(r) or url_in_sentence(r) or r['criterion'] in ('2.4.6', '2.4.2', '3.3.2') or (reading_claim(r) and (lambda m: m is not None and m < 0.9)(min_pfail(r)))),
    ]
    for title, predicate in stacks:
        report(title, base, predicate)

    print('\n## Precision against coverage: 1.1.1 reading claims (wrong_content, functional) left after the facts of S3, by the verifier\'s min P(fail) over the three framings\n')
    left = [r for r in base if reading_claim(r) and not ((r['criterion'] == '1.1.1' and r['todayFate'] == 'discarded') or alt_names_language(r) or alt_in_nearby_text(r) or logo_to_home(r)) and r['final'] != 'uncertain']
    print(f'{len(left)} decided findings: {sum(1 for r in left if r["final"] == "true_positive")} TP, {sum(1 for r in left if r["final"] == "false_positive")} FP.\n')
    print('| threshold on min P(fail) | kept TP | kept FP | precision of what is kept | share of TP kept |')
    print('| --- | ---: | ---: | --- | ---: |')
    tp_all = sum(1 for r in left if r['final'] == 'true_positive')
    for threshold in (0.0, 0.5, 0.7, 0.9, 0.95, 0.99):
        kept = [r for r in left if (min_pfail(r) or 0) >= threshold]
        tp = sum(1 for r in kept if r['final'] == 'true_positive')
        fp = sum(1 for r in kept if r['final'] == 'false_positive')
        print(f'| {threshold} | {tp} | {fp} | {fmt(tp, tp + fp)} | {tp / tp_all if tp_all else 0:.0%} |')

    print('\n## Per criterion and claim, today (base), for the report-or-suggest decision\n')
    print('| criterion · claim | TP | FP | unc | precision | s2-after | s3 |')
    print('| --- | ---: | ---: | ---: | --- | --- | --- |')
    groups = collections.defaultdict(list)
    for r in base:
        groups[(r['criterion'], r['claim'])].append(r)
    for (crit, claim), items in sorted(groups.items()):
        tp, fp, un = summary(items)
        a = summary([r for r in items if r['study'] == 's2-after'])
        b = summary([r for r in items if r['study'] == 's3'])
        print(f'| {crit} · {claim} | {tp} | {fp} | {un} | {fmt(tp, tp + fp)} | {a[0]}/{a[1]}/{a[2]} | {b[0]}/{b[1]}/{b[2]} |')

    print('\n## The verifier signal, where it answered\n')
    answered = [r for r in base if r['verifier'] and r['final'] != 'uncertain']
    for crit in ('1.1.1', '2.4.4', '2.4.6'):
        items = [r for r in answered if r['criterion'] == crit]
        if not items:
            continue
        print(f'\n### {crit}: {len(items)} decided findings with answers\n')
        print('| framing | AUROC of P(fail) vs label | P(fail) ≥ 0.5: TP kept / FP kept | P(fail) ≥ 0.9: TP kept / FP kept | mean P(fail) on TP / on FP |')
        print('| --- | --- | --- | --- | --- |')
        for framing in 'ABC':
            pairs = [(r['verifier'].get(framing), r['final'] == 'true_positive') for r in items if r['verifier'].get(framing) is not None]
            if not pairs:
                continue
            pos = [p for p, t in pairs if t]
            neg = [p for p, t in pairs if not t]
            auc = sum((1 if a > b else 0.5 if a == b else 0) for a in pos for b in neg) / (len(pos) * len(neg)) if pos and neg else float('nan')
            k5 = (sum(1 for p in pos if p >= 0.5), sum(1 for p in neg if p >= 0.5))
            k9 = (sum(1 for p in pos if p >= 0.9), sum(1 for p in neg if p >= 0.9))
            mp = (sum(pos) / len(pos) if pos else float('nan'), sum(neg) / len(neg) if neg else float('nan'))
            print(f'| {framing} | {auc:.2f} | {k5[0]}/{len(pos)} · {k5[1]}/{len(neg)} | {k9[0]}/{len(pos)} · {k9[1]}/{len(neg)} | {mp[0]:.2f} / {mp[1]:.2f} |')
        votes = [(verifier_votes(r), r['final'] == 'true_positive') for r in items]
        print('\nVotes (framings saying fail) by label: ' + ', '.join(f"{label}: {dict(collections.Counter(v[0] for v, t in votes if v and t == is_tp))}" for label, is_tp in (('TP', True), ('FP', False))))

    if VERBOSE:
        print('\n## Every base finding\n')
        for r in sorted(base, key=lambda r: (r['study'], r['slug'], r['criterion'])):
            v = r['verifier']
            print(f"- [{r['final'][:2]}] {r['study']} {r['slug']} {r['criterion']} {r['claim']} {r['subject']!r} today={r['todayFate']} {r['todayVerification'] or ''} A={v.get('A')} B={v.get('B')} C={v.get('C')}")


if __name__ == '__main__':
    main()
