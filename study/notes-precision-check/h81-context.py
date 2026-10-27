"""Counterfactual: would a list-item (H81) context fact remove the shared-text 2.4.4 findings?

For every labelled "shared by N links" finding of round 4, study 3 and study 2 (after), finds the link in the recorded
snapshot and reports: (a) other text in its own list item, (b) the text of the list item that holds its nested list
(the parent item, as on toolstation.com), (c) the nearest heading. Run from the repository root:
  python -I study/notes-precision-check/h81-context.py <recordings root>
"""
import glob, json, os, sys, collections
ROOT = sys.argv[1]
STUDIES = {
    'round-4': ('round-4-2026-10-24', 'study/round-4-2026-10-24/data/findings.json'),
    's3': ('round-3-2026-10-23', None), 's2-after': ('fresh-2026-10-11', None),
}
rows = []
r4 = json.load(open(STUDIES['round-4'][1], encoding='utf-8'))
for x in r4:
    if x['origin'] == 'main' and x['shown'] and x['criterion'] == '2.4.4' and 'shared by' in x['message']:
        rows.append(('round-4', x['split'], x['slug'], x['subject'], x['final']))
for x in json.load(open('study/notes-precision-probe/data/rows-latest.json', encoding='utf-8')):
    if x['criterion'] == '2.4.4' and x['study'] in ('s3', 's2-after') and x['shown'] and 'shared by' in x['message']:
        rows.append((x['study'], x['split'], x['slug'], x['subject'], x['final']))

def load_snapshot(folder, slug):
    paths = glob.glob(os.path.join(ROOT, folder, 'pages', slug, 'recording', '*.snapshot.json'))
    if not paths: return None
    d = json.load(open(paths[0], encoding='utf-8'))
    return d.get('root') or d.get('snapshot', {}).get('root') or d

def walk(n, parent=None, out=None):
    out = [] if out is None else out
    n['_parent'] = parent
    out.append(n)
    for c in n.get('children') or []: walk(c, n, out)
    return out

def text(n):
    parts = []
    def rec(m):
        if m.get('name') and m.get('role') in ('text', 'StaticText', 'link', 'heading', 'button', 'generic', 'paragraph', None):
            parts.append(m['name'])
        for c in m.get('children') or []: rec(c)
    rec(n)
    return ' '.join(parts)

def walk_children(n):
    out = []
    for c in n.get('children') or []:
        out.append(c); out.extend(walk_children(c))
    return out


def role(n): return (n.get('role') or '').lower()

summary = collections.Counter()
detail = collections.defaultdict(list)
cache = {}
for study, split, slug, subject, final in rows:
    folder = STUDIES[study][0]
    key = (folder, slug)
    if key not in cache:
        root = load_snapshot(folder, slug)
        cache[key] = walk(root) if root else None
    nodes = cache[key]
    if nodes is None:
        summary[(study, final, 'no-snapshot')] += 1; continue
    links = [n for n in nodes if role(n) == 'link' and (n.get('name') or '').strip() == (subject or '').strip()]
    own, parent, head = 0, 0, 0
    for n in links:
        li = n['_parent']
        while li is not None and role(li) != 'listitem': li = li['_parent']
        if li is None: continue
        other = text(li).replace(n['name'], '', 1).strip()
        if other: own += 1
        up = li['_parent']
        while up is not None and role(up) != 'listitem': up = up['_parent']
        if up is not None:
            first = next((c for c in walk_children(up) if role(c) == 'link' and c is not n), None)
            if first and first.get('name'): parent += 1
    verdict = 'own-li-text' if own == len(links) and links else ('parent-li' if parent == len(links) and links else ('mixed' if own or parent else 'none'))
    summary[(study, final, verdict)] += 1
    detail[(study, slug, final, verdict)].append(subject)

for k in sorted(summary): print(k, summary[k])
print()
for k in sorted(detail): print(k, len(detail[k]), [s[:25] for s in detail[k][:6]])
