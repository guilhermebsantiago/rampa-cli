"""For every shared-text 2.4.4 finding of round 4, the flagged link's ancestors (role and name) and its list-item context.
  python -I study/notes-precision-check/ancestry.py <recordings root>"""
import glob, json, sys, collections
ROOT = sys.argv[1]
f = json.load(open('study/round-4-2026-10-24/data/findings.json', encoding='utf-8'))
rows = [x for x in f if x['origin'] == 'main' and x['shown'] and x['criterion'] == '2.4.4' and 'shared by' in x['message']]
def root_of(d):
    for k in ('root', 'tree'):
        if isinstance(d.get(k), dict): return d[k]
    if isinstance(d.get('snapshot'), dict): return root_of(d['snapshot'])
    return d
def role(n): return (n.get('role') or '').lower()
def txt(n):
    out = []
    def rec(m):
        if m.get('name'): out.append(m['name'])
        for c in m.get('children') or []: rec(c)
    rec(n); return ' '.join(out)
snaps = {}
res = collections.Counter(); shown = collections.Counter()
for x in rows:
    slug = x['slug']
    if slug not in snaps:
        d = json.load(open(glob.glob(f'{ROOT}/round-4-2026-10-24/pages/{slug}/recording/*.snapshot.json')[0], encoding='utf-8'))
        if slug == rows[0]['slug']: print('snapshot keys:', list(d.keys())[:20])
        nodes = []
        def walk(n, p=None):
            n['_p'] = p; nodes.append(n)
            for c in n.get('children') or []: walk(c, n)
        walk(root_of(d))
        if slug == rows[0]['slug']: print('node keys:', sorted(set(k for n in nodes[:200] for k in n.keys()))[:30])
        snaps[slug] = nodes
    nodes = snaps[slug]
    n = next((m for m in nodes if m.get('ref') == x['ref'] or m.get('selector') == x['ref']), None)
    if n is None:
        cands = [m for m in nodes if role(m) == 'link' and (m.get('name') or '').strip() == (x['subject'] or '').strip()]
        n = cands[0] if len(cands) == 1 else None
    if n is None: res[(slug, x['final'], 'unmatched')] += 1; continue
    li = n['_p']
    while li is not None and role(li) != 'listitem': li = li['_p']
    own = li is not None and txt(li).replace(n['name'], '', 1).strip() != ''
    up = li['_p'] if li is not None else None
    while up is not None and role(up) != 'listitem': up = up['_p']
    parent = None
    if up is not None:
        for c in up.get('children') or []:
            if c.get('name') and role(c) != 'list': parent = c['name']; break
    res[(slug, x['final'], 'own' if own else ('parent:' + ('yes' if parent else 'no')))] += 1
    if shown[slug] < 2:
        shown[slug] += 1
        chain = []
        a = n['_p']
        while a is not None and len(chain) < 8:
            chain.append(f"{role(a)}{'['+a['name'][:30]+']' if a.get('name') else ''}"); a = a['_p']
        print(slug, x['final'][:2], repr(x['subject'])[:30], 'own-li-text:', own, 'parent-li:', repr(parent)[:40], '| ancestors:', ' < '.join(chain))
print()
for k in sorted(res): print(k, res[k])
