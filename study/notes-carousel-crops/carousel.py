"""How often the crop of an image in a carousel shows another slide's picture, on the dev pages of the four real-page
studies: groups of slides found from the recorded boxes, a pixel comparison of their crops, the members recorded outside
the viewport, a look by eye at a seeded sample, and a join to the dev 1.1.1 findings.

What is counted (docs/studies/notes-carousel-crops.md says why; the thresholds are fixed by the brief, not tuned):
- image nodes: role img or tag img, with a recorded box (width and height above 0);
- slide groups: three or more image nodes under one common ancestor at most 6 levels above each, whose boxes have the
  same width and height within 2 px and the same y within 2 px, and whose x are either all equal within 2 px (stacked)
  or all different, more than 2 px apart (a track). For every node, the image nodes at most 6 levels below it are put in
  clusters of size and y (in document order, a node joins the first cluster it stays within 2 px of in width, height
  and y); a cluster of three or more whose x are stacked or a track is a candidate; candidates are taken largest
  first (then deepest common ancestor, then document order), and one that shares a member with a group already taken
  is left out. Clusters whose x are neither (some equal, some not) are counted as mixed and left out;
- same picture under different sources: every pair of members of a group that both have a crop and whose `src` file
  names differ (both recorded; an image proxy that names the picture in a `url` parameter, such as Next.js's
  /_next/image, is named by that address's file); each crop composited on white, turned grey and resized to 32 x 32
  (Pillow, box filter); the mean absolute difference per pixel on a 0 to 255 scale; a pair under 8 is "the same
  picture". The measure is checked on a pair known to differ and a pair known to be the same picture (MEASURE_CHECK,
  chosen by eye), and on every pair with the same file name (expected under 8). Whether a pair's PNG bytes are
  identical is recorded too, and, page-wide, how many image crops have identical bytes under different file names;
- a member outside the viewport: a recorded box wholly outside 0 <= x < 1280 (x >= 1280 or x + width <= 0), with a crop;
- by eye: every group's crops are written to .rampa/carousel-crops/<slug>/<group>/<position>.png (git-ignored, small
  crops enlarged, large ones shrunk to 900 px), with members.txt beside them. The groups that hold a crop are shuffled
  by random.Random(20261109) and taken in that order until 60 crops are reached, and every group of hcor-com-br is
  added (`look`: sample). As a supplement, reported apart, every crop of a member outside the viewport in a group the
  sample did not take (`look`: supplement), so all of step 3's crops are looked at. The answers (`shows`: own slide,
  another slide, two slides, page content over it or unclear, and `eyeNote`) are typed into data/carousel.json per
  member and kept by every rerun;
- join: the dev rows of each study's data/findings.json with criterion 1.1.1, the same slug and ref.

Dev pages only: each study's data/pages.json decides, before any snapshot is opened, which pages are read; no snapshot,
report or finding of a test page is opened, and a findings.json row is dropped unread unless its split is dev and its
page a dev page. The script stops if Hcor's slide "Votação Reclame aqui 2026" is in no group, or if it was looked at and
is not recorded as another slide. Every number is counted and in-sample (dev).

Run from anywhere: python -I study/notes-carousel-crops/carousel.py
Reads the recordings at C:/Users/guilh/dev/rampa-study-recordings (read only); writes data/carousel.json and the crops;
prints the tables of the note. Reuses the loading code of study/notes-crop-overlay/overlay.py by import.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import random
import shutil
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
# python -I leaves the script's own folder off sys.path: the sibling study's module is put there by hand, and no
# bytecode cache is written into that study's folder.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'notes-crop-overlay'))

import overlay as ov  # noqa: E402

from PIL import Image  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', newline='\n')

ROOT = ov.ROOT
OUT = os.path.join(HERE, 'data', 'carousel.json')
PNG_DIR = os.path.join(ROOT, '.rampa', 'carousel-crops')

TOL = 2
UP = 6
MIN_MEMBERS = 3
SAME = 8
GREY = 32
VIEW_W = 1280
SEED = 20261109
SAMPLE_CROPS = 60
ALWAYS = 'hcor-com-br'
SHOWS = ('own slide', 'another slide', 'two slides', 'page content over it', 'unclear')
WRONG = ('another slide', 'two slides')
EYE_FIELDS = ('shows', 'eyeNote')
LABELS = ('true_positive', 'false_positive', 'uncertain')
# The slide the method must find: Hcor's "Votação Reclame aqui 2026", in the banner carousel's first run of slides.
HCOR = ('round-3-2026-10-23', 'hcor-com-br', 'div:nth-of-type(5) > div > a > picture > img', 'Votação Reclame aqui 2026')
# The measure checked on crops whose relation is known by eye (study, slug, ref a, ref b, what they show).
HCOR_BANNER = 'html > body > section > div:nth-of-type(1) > div:nth-of-type(1) > div > '
MEASURE_CHECK = {
    'known to differ': (
        'round-3-2026-10-23', 'hcor-com-br', HCOR_BANNER + 'div:nth-of-type(4) > div > picture > img', HCOR_BANNER + 'div:nth-of-type(6) > div > a > picture > img',
        'two different banners ("Alerta de Golpe" and "Estudo SIX") under the same navigation bar and four cards: the hard case, other page content shared',
    ),
    'known the same picture': (
        'round-3-2026-10-23', 'travessa-com-br', '#slick-slide00 > a > img', '#DivSlide > div > div > div > div > div:nth-of-type(7) > a > img',
        'a slide ("artefotoarq_vitrine.jpg") and its loop clone, the same file; both crops show the same banner',
    ),
}


def is_image(node):
    return node.get('role') == 'img' or (node.get('native') or {}).get('tag') == 'img'


def file_name(src):
    """The file name of an image's src, without query or fragment; a data: URI is named by a hash of it. An image proxy
    that names the picture in a `url` parameter (Next.js's /_next/image?url=...) is named by that address's file."""
    if not src:
        return None
    if src.startswith('data:'):
        return 'data:' + hashlib.sha256(src.encode('utf-8')).hexdigest()[:12]
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(src).query)
    if query.get('url'):
        src = query['url'][0]
    path = src.split('#', 1)[0].split('?', 1)[0].rstrip('/')
    return path.rsplit('/', 1)[-1] or path


def decode(data_url):
    raw = base64.b64decode(data_url.split(',', 1)[1])
    with Image.open(io.BytesIO(raw)) as im:
        im.load()
        return im.copy()


def grey(data_url):
    im = decode(data_url)
    if im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info):
        im = im.convert('RGBA')
        white = Image.new('RGBA', im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(white, im)
    return im.convert('L').resize((GREY, GREY), Image.Resampling.BOX)


def mad(a, b):
    pa, pb = a.tobytes(), b.tobytes()
    return sum(abs(x - y) for x, y in zip(pa, pb)) / len(pa)


def skip_reason(node):
    if isinstance(node.get('image'), str) and node['image'].startswith('data:image/'):
        return None
    reason = (node.get('native') or {}).get('imageSkipped')
    if reason:
        return reason
    states = node.get('states') or []
    b = node['bounds']
    if 'hidden' in states:
        return 'not attempted: hidden'
    if 'broken' in states:
        return 'not attempted: broken'
    if b['width'] < 8 or b['height'] < 8:
        return 'not attempted: under 8 px'
    return 'not attempted: other'


def classes(node):
    attributes = (node.get('native') or {}).get('attributes') or {}
    value = attributes.get('class') if isinstance(attributes, dict) else None
    return (value or '').strip()[:80]


def find_groups(order, parent, depth):
    """Slide groups of one page, as lists of preorder indices in document order, with their kind and common ancestor."""
    images = [i for i, n in enumerate(order) if is_image(n) and ov.box(n)]
    under = {}
    for i in images:
        up = parent[i]
        for _ in range(UP):
            if up < 0:
                break
            under.setdefault(up, []).append(i)
            up = parent[up]

    def b(i):
        r = order[i]['bounds']
        return r['x'], r['y'], r['width'], r['height']

    def lca(members):
        common = None
        for i in members:
            chain = []
            while i >= 0:
                chain.append(i)
                i = parent[i]
            common = chain if common is None else [a for a in chain if a in set(common)]
        return common[0]

    candidates, mixed = {}, {}
    for anchor in sorted(under):
        members = under[anchor]
        if len(members) < MIN_MEMBERS:
            continue
        clusters = []
        for i in sorted(members):
            x, y, w, h = b(i)
            for cluster in clusters:
                ws = [b(j)[2] for j in cluster] + [w]
                hs = [b(j)[3] for j in cluster] + [h]
                ys = [b(j)[1] for j in cluster] + [y]
                if max(ws) - min(ws) <= TOL and max(hs) - min(hs) <= TOL and max(ys) - min(ys) <= TOL:
                    cluster.append(i)
                    break
            else:
                clusters.append([i])
        for cluster in clusters:
            if len(cluster) < MIN_MEMBERS:
                continue
            key = tuple(sorted(cluster))
            xs = sorted(b(j)[0] for j in cluster)
            if xs[-1] - xs[0] <= TOL:
                kind = 'stacked'
            elif all(xs[k + 1] - xs[k] > TOL for k in range(len(xs) - 1)):
                kind = 'track'
            else:
                mixed[key] = True
                continue
            if key not in candidates:
                common = lca(key)
                candidates[key] = (kind, common)
    ranked = sorted(candidates.items(), key=lambda item: (-len(item[0]), -depth[item[1][1]], item[1][1], item[0]))
    taken, groups, overlapping = set(), [], 0
    for members, (kind, common) in ranked:
        if taken & set(members):
            overlapping += 1
            continue
        taken |= set(members)
        groups.append((list(members), kind, common))
    groups.sort(key=lambda g: g[0][0])
    mixed_left = sum(1 for key in mixed if not (taken & set(key)))
    return groups, mixed_left, overlapping, len(images)


def write_png(path, data_url):
    im = decode(data_url).convert('RGB')
    w, h = im.size
    # Small crops are enlarged (nearest pixel) so they can be looked at; large ones shrunk to 900 px.
    scale = min(900 / max(w, h), max(1.0, 300 / max(w, h)))
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    im.resize(size, Image.NEAREST if scale >= 1 else Image.Resampling.LANCZOS).save(path)
    return [w, h]


def analyse_page(study, rec_folder, page):
    path = os.path.join(ov.RECORDINGS, rec_folder, 'pages', page['slug'], 'recording', page['recording'] + '.snapshot.json')
    with open(path, 'rb') as f:
        raw = f.read()
    snapshot = json.loads(raw.decode('utf-8'))
    viewport = snapshot.get('viewport') or {}
    order, parent, _ = ov.flatten(snapshot['root'])
    depth = [0] * len(order)
    for i in range(1, len(order)):
        depth[i] = depth[parent[i]] + 1
    found, mixed_left, overlapping, image_nodes = find_groups(order, parent, depth)
    groups = []
    for n, (members, kind, common) in enumerate(found, start=1):
        gid = f'g{n:02d}'
        first = order[members[0]]['bounds']
        xs = [order[i]['bounds']['x'] for i in members]
        chain, up = [], common
        for _ in range(3):
            if up < 0:
                break
            chain.append(classes(order[up]))
            up = parent[up]
        rows = []
        for pos, i in enumerate(members, start=1):
            node = order[i]
            native = node.get('native') or {}
            attributes = native.get('attributes') or {}
            bounds = node['bounds']
            reason = skip_reason(node)
            rows.append({
                'pos': pos,
                'ref': node['ref'],
                'alt': (node.get('name') or '').strip()[:120],
                'src': file_name(attributes.get('src') if isinstance(attributes, dict) else None),
                'x': round(bounds['x'], 1),
                'crop': reason is None,
                'skip': reason,
                'outsideViewport': bounds['x'] >= VIEW_W or bounds['x'] + bounds['width'] <= 0,
                '_image': node.get('image') if reason is None else None,
                '_hash': hashlib.sha256(node['image'].encode('utf-8')).hexdigest() if reason is None else None,
            })
        groups.append({
            'study': study,
            'slug': page['slug'],
            'group': gid,
            'kind': kind,
            'size': len(members),
            'ancestor': order[common]['ref'],
            'ancestorClasses': chain,
            'levelsUp': max(depth[i] - depth[common] for i in members),
            'width': round(first['width'], 1),
            'height': round(first['height'], 1),
            'y': round(first['y'], 1),
            'xSpan': round(max(xs) - min(xs), 1),
            'crops': sum(1 for r in rows if r['crop']),
            'outsideViewport': sum(1 for r in rows if r['outsideViewport']),
            'members': rows,
        })
    # Page-wide, in or out of a group: image crops whose bytes are identical though their src file names differ. It is
    # what a check of identical captures across the whole page, not only across stacked boxes, would act on.
    by_hash = {}
    for node in order:
        image = node.get('image')
        if is_image(node) and isinstance(image, str) and image.startswith('data:image/'):
            attributes = (node.get('native') or {}).get('attributes') or {}
            src = file_name(attributes.get('src') if isinstance(attributes, dict) else None)
            by_hash.setdefault(hashlib.sha256(image.encode('utf-8')).hexdigest(), []).append(src)
    identical_pairs, identical_crops = 0, 0
    for sources in by_hash.values():
        differing = [(a, b) for k, a in enumerate(sources) for b in sources[k + 1:] if a and b and a != b]
        if differing:
            identical_pairs += len(differing)
            identical_crops += len(sources)
    meta_identical = {'identicalCropPairsDifferentSrc': identical_pairs, 'cropsInIdenticalPairDifferentSrc': identical_crops}
    meta = {
        'study': study, 'slug': page['slug'], 'split': page['split'],
        'recording': os.path.relpath(path, ov.RECORDINGS).replace(os.sep, '/'),
        'sha256': hashlib.sha256(raw).hexdigest(), 'viewportWidth': viewport.get('width'),
        'imageNodesWithBox': image_nodes, 'groups': len(groups), 'mixedLeftOut': mixed_left, 'overlappingLeftOut': overlapping,
        **meta_identical,
    }
    return meta, groups


def count(rows, test):
    return sum(1 for r in rows if test(r))


def main():
    previous = {}
    if os.path.exists(OUT):
        before = ov.load(OUT)
        for g in before.get('groups', []):
            for m in g['members']:
                if any(m.get(k) is not None for k in EYE_FIELDS):
                    previous[(g['study'], g['slug'], m['ref'])] = {k: m.get(k) for k in EYE_FIELDS}

    pages, groups = [], []
    for study, rec_folder, _ in ov.STUDIES:
        dev = ov.dev_pages(study)
        if len(dev) != 12:
            raise SystemExit(f'{study}: {len(dev)} dev pages, expected 12')
        for page in dev:
            meta, rows = analyse_page(study, rec_folder, page)
            pages.append(meta)
            groups.extend(rows)
    assert len(pages) == 48 and all(p['split'] == 'dev' for p in pages)
    slugs = [p['slug'] for p in pages]
    assert len(set(slugs)) == len(slugs), 'slugs repeat across studies: the crop folders would clash'
    assert all(p['viewportWidth'] == VIEW_W for p in pages), 'a page was recorded at another viewport width'

    def members_of(gs):
        return [m for g in gs for m in g['members']]

    # The method check: Hcor's slide must be a member of a group.
    hcor = [(g, m) for g in groups for m in g['members'] if (g['study'], g['slug']) == HCOR[:2] and m['ref'].endswith(HCOR[2])]
    if len(hcor) != 1 or hcor[0][1]['alt'] != HCOR[3] or not hcor[0][1]['crop']:
        raise SystemExit(f'Hcor\'s slide "{HCOR[3]}" is in no group, or has no crop: the method is wrong')

    # 1. Groups, members and crops, per study.
    per_study = {}
    for study, _, _ in ov.STUDIES:
        gs = [g for g in groups if g['study'] == study]
        ms = members_of(gs)
        skips = {}
        for m in ms:
            if not m['crop']:
                skips[m['skip']] = skips.get(m['skip'], 0) + 1
        sizes = {}
        for g in gs:
            sizes[g['size']] = sizes.get(g['size'], 0) + 1
        per_study[study] = {
            'pages': count(pages, lambda p, s=study: p['study'] == s),
            'pagesWithGroup': len({g['slug'] for g in gs}),
            'groups': len(gs),
            'tracks': count(gs, lambda g: g['kind'] == 'track'),
            'stacked': count(gs, lambda g: g['kind'] == 'stacked'),
            'groupsWithCrop': count(gs, lambda g: g['crops'] > 0),
            'groupsWithMemberOutside': count(gs, lambda g: g['outsideViewport'] > 0),
            'members': len(ms),
            'membersWithCrop': count(ms, lambda m: m['crop']),
            'membersSkipped': count(ms, lambda m: not m['crop']),
            'skipped': dict(sorted(skips.items(), key=lambda kv: (-kv[1], kv[0]))),
            'sizes': {str(k): v for k, v in sorted(sizes.items())},
            'mixedLeftOut': sum(p['mixedLeftOut'] for p in pages if p['study'] == study),
            'overlappingLeftOut': sum(p['overlappingLeftOut'] for p in pages if p['study'] == study),
        }
    totals = {}
    for key in ('pages', 'pagesWithGroup', 'groups', 'tracks', 'stacked', 'groupsWithCrop', 'groupsWithMemberOutside', 'members', 'membersWithCrop', 'membersSkipped', 'mixedLeftOut', 'overlappingLeftOut'):
        totals[key] = sum(v[key] for v in per_study.values())
    skips, sizes = {}, {}
    for v in per_study.values():
        for k, n in v['skipped'].items():
            skips[k] = skips.get(k, 0) + n
        for k, n in v['sizes'].items():
            sizes[k] = sizes.get(k, 0) + n
    totals['skipped'] = dict(sorted(skips.items(), key=lambda kv: (-kv[1], kv[0])))
    totals['sizes'] = dict(sorted(sizes.items(), key=lambda kv: int(kv[0])))
    per_study['all'] = totals

    # 2. The same picture under different sources.
    greys = {}

    def grey_of(g, m):
        key = (g['study'], g['slug'], m['ref'])
        if key not in greys:
            greys[key] = grey(m['_image'])
        return greys[key]

    # Pairs with the same file name are not counted; their distances are kept as a check of the measure (the same
    # file should give the same picture, unless something else is in one of the crops).
    pairs, same_source, not_compared = [], [], {'same file name': 0, 'a src missing': 0}
    for g in groups:
        cropped = [m for m in g['members'] if m['crop']]
        for a in range(len(cropped)):
            for b in range(a + 1, len(cropped)):
                ma, mb = cropped[a], cropped[b]
                if not ma['src'] or not mb['src']:
                    not_compared['a src missing'] += 1
                    continue
                d = mad(grey_of(g, ma), grey_of(g, mb))
                row = {'study': g['study'], 'slug': g['slug'], 'group': g['group'], 'a': ma['pos'], 'b': mb['pos'], 'srcA': ma['src'], 'srcB': mb['src'], 'mad': round(d, 2), 'same': d < SAME, 'identicalBytes': ma['_hash'] == mb['_hash']}
                if ma['src'] == mb['src']:
                    not_compared['same file name'] += 1
                    same_source.append(row)
                    continue
                pairs.append(row)
    same_pairs = [p for p in pairs if p['same']]
    in_same = {(p['study'], p['slug'], p['group'], pos) for p in same_pairs for pos in (p['a'], p['b'])}
    for g in groups:
        for m in g['members']:
            m['inSamePair'] = (g['study'], g['slug'], g['group'], m['pos']) in in_same if m['crop'] else None
    same_by_study = {}
    for study, _, _ in ov.STUDIES:
        ps = [p for p in pairs if p['study'] == study]
        same_by_study[study] = {
            'pairsCompared': len(ps),
            'pairsSame': count(ps, lambda p: p['same']),
            'cropsInSamePair': len({k for k in in_same if k[0] == study}),
            'groupsWithSamePair': len({(p['slug'], p['group']) for p in ps if p['same']}),
        }
    same_by_study['all'] = {
        'pairsCompared': len(pairs), 'pairsSame': len(same_pairs), 'cropsInSamePair': len(in_same),
        'groupsWithSamePair': len({(p['study'], p['slug'], p['group']) for p in same_pairs}), 'notCompared': not_compared,
        'samePairsWithIdenticalBytes': count(same_pairs, lambda p: p['identicalBytes']),
        'smallestDistanceAboveThreshold': min((p['mad'] for p in pairs if not p['same']), default=None),
    }
    same_source_check = {
        'pairs': len(same_source),
        'under8': count(same_source, lambda p: p['same']),
        'identicalBytes': count(same_source, lambda p: p['identicalBytes']),
        'largest': max((p['mad'] for p in same_source), default=None),
        'atOrAbove8': [p for p in same_source if not p['same']],
    }

    def find(study, slug, ref):
        for g in groups:
            if (g['study'], g['slug']) == (study, slug):
                for m in g['members']:
                    if m['ref'] == ref and m['crop']:
                        return g, m
        raise SystemExit(f'measure check: no crop for {study} {slug} {ref}')

    measure_check = {}
    for label, spec in MEASURE_CHECK.items():
        if spec is None:
            measure_check[label] = None
            continue
        study, slug, ref_a, ref_b, why = spec
        ga, ma = find(study, slug, ref_a)
        gb, mb = find(study, slug, ref_b)
        measure_check[label] = {'study': study, 'slug': slug, 'refA': ref_a, 'refB': ref_b, 'srcA': ma['src'], 'srcB': mb['src'], 'why': why, 'mad': round(mad(grey_of(ga, ma), grey_of(gb, mb)), 2)}

    # 3. Members outside the viewport, with a crop.
    outside = {}
    for study, _, _ in ov.STUDIES:
        ms = members_of(g for g in groups if g['study'] == study)
        outside[study] = {
            'membersOutside': count(ms, lambda m: m['outsideViewport']),
            'outsideWithCrop': count(ms, lambda m: m['outsideViewport'] and m['crop']),
            'outsideSkipped': count(ms, lambda m: m['outsideViewport'] and not m['crop']),
            'pages': len({g['slug'] for g in groups if g['study'] == study and any(m['outsideViewport'] and m['crop'] for m in g['members'])}),
        }
    outside['all'] = {k: sum(v[k] for v in outside.values()) for k in ('membersOutside', 'outsideWithCrop', 'outsideSkipped', 'pages')}
    outside_skips = {}
    for m in members_of(groups):
        if m['outsideViewport'] and not m['crop']:
            outside_skips[m['skip']] = outside_skips.get(m['skip'], 0) + 1
    outside['all']['skipped'] = dict(sorted(outside_skips.items(), key=lambda kv: (-kv[1], kv[0])))

    # 4. The crops on disk, and the seeded sample of groups looked at by eye.
    if os.path.isdir(PNG_DIR):
        shutil.rmtree(PNG_DIR)
    for g in groups:
        folder = os.path.join(PNG_DIR, g['slug'], g['group'])
        os.makedirs(folder, exist_ok=True)
        lines = [f"{g['study']} {g['slug']} {g['group']}: {g['kind']}, {g['size']} members, box {g['width']} x {g['height']} at y {g['y']}, ancestor {g['ancestor']}", f"ancestor classes: {' / '.join(g['ancestorClasses'])}", '']
        for m in g['members']:
            size = ''
            if m['crop']:
                size = write_png(os.path.join(folder, f"{m['pos']:02d}.png"), m['_image'])
                m['cropSize'] = size
                m['png'] = f".rampa/carousel-crops/{g['slug']}/{g['group']}/{m['pos']:02d}.png"
            else:
                m['cropSize'] = None
                m['png'] = None
            state = f"crop {size[0]}x{size[1]}" if m['crop'] else f"no crop ({m['skip']})"
            lines.append(f"{m['pos']:02d}  x={m['x']}{'  outside the viewport' if m['outsideViewport'] else ''}  {state}\n    alt: {m['alt'] or '(empty)'}\n    src: {m['src']}\n    ref: {m['ref']}")
        with open(os.path.join(folder, 'members.txt'), 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(lines) + '\n')

    pool = sorted((g for g in groups if g['crops'] > 0), key=lambda g: (g['study'], g['slug'], g['group']))
    random.Random(SEED).shuffle(pool)
    drawn, total = [], 0
    for g in pool:
        if total >= SAMPLE_CROPS:
            break
        drawn.append(g)
        total += g['crops']
    picked = {(g['study'], g['slug'], g['group']): 'drawn' for g in drawn}
    for g in groups:
        key = (g['study'], g['slug'], g['group'])
        if g['slug'] == ALWAYS and g['crops'] > 0 and key not in picked:
            picked[key] = 'always (hcor-com-br)'
    # The sample's crops, and as a supplement, reported apart: every crop of a member outside the viewport in a group the
    # sample did not take (step 3's crops, the ones taken after a movement).
    for g in groups:
        g['sampled'] = picked.get((g['study'], g['slug'], g['group']))
        for m in g['members']:
            m['look'] = None if not m['crop'] else 'sample' if g['sampled'] else 'supplement' if m['outsideViewport'] else None
            eye = previous.get((g['study'], g['slug'], m['ref']), {}) if m['look'] else {}
            for k in EYE_FIELDS:
                m[k] = eye.get(k)
            if m['shows'] is not None and m['shows'] not in SHOWS:
                raise SystemExit(f"{g['slug']} {g['group']} {m['pos']}: shows is {m['shows']!r}, not one of {SHOWS}")
    looked = [(g, m) for g in groups for m in g['members'] if m['look'] == 'sample']
    supplement = [(g, m) for g in groups for m in g['members'] if m['look'] == 'supplement']
    every = looked + supplement

    hg, hm = hcor[0]
    if not hg['sampled']:
        raise SystemExit("Hcor's slide is not in a sampled group: the method is wrong")
    if hm['shows'] is not None and hm['shows'] != 'another slide':
        raise SystemExit(f"Hcor's slide \"{HCOR[3]}\" is recorded as {hm['shows']!r}, not another slide: the method is wrong")

    def tally(rows):
        out = {k: count(rows, lambda gm, k=k: gm[1]['shows'] == k) for k in SHOWS}
        out['not yet looked at'] = count(rows, lambda gm: gm[1]['shows'] is None)
        return out

    by_eye = {
        'groups': len([g for g in groups if g['sampled']]),
        'groupsDrawn': len(drawn),
        'groupsAlways': count(groups, lambda g: g['sampled'] == 'always (hcor-com-br)'),
        'crops': len(looked),
        'cropsDrawn': sum(g['crops'] for g in drawn),
        'tally': tally(looked),
        'drawnOnly': tally([(g, m) for g, m in looked if g['sampled'] == 'drawn']),
        'byKind': {kind: tally([(g, m) for g, m in looked if g['kind'] == kind]) for kind in ('track', 'stacked')},
        'outsideViewport': tally([(g, m) for g, m in looked if m['outsideViewport']]),
        'insideViewport': tally([(g, m) for g, m in looked if not m['outsideViewport']]),
        'inSamePair': tally([(g, m) for g, m in looked if m['inSamePair']]),
        'notInSamePair': tally([(g, m) for g, m in looked if not m['inSamePair']]),
        'supplement': {'crops': len(supplement), 'groups': len({(g['study'], g['slug'], g['group']) for g, _ in supplement}), 'tally': tally(supplement)},
        'outsideViewportAll': {'crops': count(every, lambda gm: gm[1]['outsideViewport']), 'tally': tally([gm for gm in every if gm[1]['outsideViewport']])},
        'groupsWithWrongCrop': sorted({f"{g['study']} {g['slug']} {g['group']}" for g, m in every if m['shows'] in WRONG}),
    }

    def wrong_share(rows):
        k = count(rows, lambda gm: gm[1]['shows'] in WRONG)
        p, lo, hi = ov.wilson(k, len(rows))
        return {'k': k, 'n': len(rows), 'p': p, 'lo': lo, 'hi': hi}

    # Crops that show another slide or two slides, with 95% Wilson intervals, over each set looked at.
    by_eye['wrongShare'] = {
        'sample': wrong_share(looked),
        'drawn only (Hcor not forced in)': wrong_share([gm for gm in looked if gm[0]['sampled'] == 'drawn']),
        'supplement': wrong_share(supplement),
        'outside the viewport (all 46 looked at)': wrong_share([gm for gm in every if gm[1]['outsideViewport']]),
        'inside the viewport (sample)': wrong_share([gm for gm in looked if not gm[1]['outsideViewport']]),
        'all looked at': wrong_share(every),
    }

    # 5. Join to the dev 1.1.1 findings: only rows whose split is dev, on dev pages.
    findings = {}
    for study, _, _ in ov.STUDIES:
        dev_slugs = {p['slug'] for p in ov.dev_pages(study)}
        for f in ov.load(os.path.join(ROOT, 'study', study, 'data', 'findings.json')):
            if f.get('split') != 'dev' or f.get('slug') not in dev_slugs or f.get('criterion') != '1.1.1':
                continue
            findings.setdefault((study, f['slug'], f['ref']), []).append(f)
    for g in groups:
        for m in g['members']:
            rows = findings.get((g['study'], g['slug'], m['ref']), [])
            m['finding111'] = [{'key': f.get('key'), 'final': f.get('final'), 'shown': f.get('shown'), 'message': f.get('message')} for f in rows] or None

    def labels_of(rows):
        hits = [f for _, m in rows for f in (m['finding111'] or [])]
        out = {'crops': len(rows), 'cropsWithFinding': count(rows, lambda gm: gm[1]['finding111']), 'findings': len(hits)}
        for name in LABELS:
            out[name] = count(hits, lambda f, n=name: f['final'] == n)
        return out

    join = {'sample': labels_of(looked)}
    for k in SHOWS:
        join[f'sample: {k}'] = labels_of([(g, m) for g, m in looked if m['shows'] == k])
    join['supplement'] = labels_of(supplement)
    for k in SHOWS:
        join[f'supplement: {k}'] = labels_of([(g, m) for g, m in supplement if m['shows'] == k])
    join['another slide or two slides (sample and supplement)'] = labels_of([(g, m) for g, m in every if m['shows'] in WRONG])
    join['all crops in groups'] = labels_of([(g, m) for g in groups for m in g['members'] if m['crop']])
    join['outside the viewport, with a crop'] = labels_of([(g, m) for g in groups for m in g['members'] if m['crop'] and m['outsideViewport']])
    join['in a same-picture pair'] = labels_of([(g, m) for g in groups for m in g['members'] if m['inSamePair']])
    wrong_with_finding = [
        {'study': g['study'], 'slug': g['slug'], 'group': g['group'], 'pos': m['pos'], 'ref': m['ref'], 'alt': m['alt'], 'shows': m['shows'], 'eyeNote': m['eyeNote'], 'final': f['final'], 'message': f['message']}
        for g, m in every if m['shows'] in WRONG for f in (m['finding111'] or [])
    ]
    looked_with_finding = [
        {'study': g['study'], 'slug': g['slug'], 'group': g['group'], 'pos': m['pos'], 'look': m['look'], 'alt': m['alt'], 'shows': m['shows'], 'final': f['final'], 'message': f['message']}
        for g, m in every for f in (m['finding111'] or [])
    ]

    out = {
        'about': 'Counted, in-sample (dev): slide groups among the image nodes of the 48 dev pages of the four real-page studies, how often their crops show the same picture under different sources, members recorded outside the viewport, a look by eye at a seeded sample of groups, and a join to the dev 1.1.1 findings. Written by study/notes-carousel-crops/carousel.py; shows and eyeNote on the members are typed by eye and kept by reruns. See docs/studies/notes-carousel-crops.md.',
        'method': {
            'tolerancePx': TOL, 'maxLevelsUp': UP, 'minMembers': MIN_MEMBERS, 'imageNodes': 'role img or tag img, with a recorded box',
            'samePictureBelow': SAME, 'greySize': GREY, 'resample': 'box', 'viewportWidth': VIEW_W,
            'seed': SEED, 'sampleCrops': SAMPLE_CROPS, 'always': ALWAYS, 'shows': list(SHOWS),
        },
        'pages': pages,
        'groupsPerStudy': per_study,
        'measureCheck': measure_check,
        'samePicture': same_by_study,
        'samePairs': same_pairs,
        'sameSourceCheck': same_source_check,
        'identicalCropsPageWide': {
            'pairsDifferentSrc': sum(p['identicalCropPairsDifferentSrc'] for p in pages),
            'crops': sum(p['cropsInIdenticalPairDifferentSrc'] for p in pages),
            'pages': count(pages, lambda p: p['identicalCropPairsDifferentSrc'] > 0),
        },
        'outsideViewport': outside,
        'byEye': by_eye,
        'join111': join,
        'wrongCropsWithFinding': wrong_with_finding,
        'lookedAtWithFinding': looked_with_finding,
        'hcor': {'study': hg['study'], 'slug': hg['slug'], 'group': hg['group'], **{k: v for k, v in hm.items() if not k.startswith('_')}},
        'groups': [{**{k: v for k, v in g.items() if k != 'members'}, 'members': [{k: v for k, v in m.items() if not k.startswith('_')} for m in g['members']]} for g in groups],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print(f"Pages {len(pages)} (dev); groups {totals['groups']} ({totals['tracks']} tracks, {totals['stacked']} stacked) on {totals['pagesWithGroup']} pages")
    print('\n| Study | Pages with a group | Groups | Tracks | Stacked | Members | With a crop | Skipped | Groups with a member outside |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
    for name, v in per_study.items():
        print(f"| {name} | {v['pagesWithGroup']} | {v['groups']} | {v['tracks']} | {v['stacked']} | {v['members']} | {v['membersWithCrop']} | {v['membersSkipped']} | {v['groupsWithMemberOutside']} |")
    print('Sizes', json.dumps(totals['sizes']))
    print('Skipped', json.dumps(totals['skipped']))
    print('Mixed left out', totals['mixedLeftOut'], 'overlapping left out', totals['overlappingLeftOut'])
    print('Measure check', json.dumps(measure_check, ensure_ascii=False))
    print('Same picture', json.dumps(same_by_study))
    for p in same_pairs:
        print('  same', p['study'], p['slug'], p['group'], p['a'], p['b'], p['srcA'], p['srcB'], p['mad'], 'identical bytes' if p['identicalBytes'] else '')
    print('Same-source check', json.dumps({k: v for k, v in same_source_check.items() if k != 'atOrAbove8'}))
    for p in same_source_check['atOrAbove8']:
        print('  same file, distance at or above 8', p['study'], p['slug'], p['group'], p['a'], p['b'], p['srcA'], p['mad'])
    print('Identical crops page-wide', json.dumps(out['identicalCropsPageWide']))
    print('Outside viewport', json.dumps(outside))
    print('By eye', json.dumps({k: v for k, v in by_eye.items() if k != 'wrongShare'}, ensure_ascii=False))
    for name, cell in by_eye['wrongShare'].items():
        print(f"  another slide or two slides, {name}: {cell['k']} of {cell['n']} ({cell['p']}, {cell['lo']}-{cell['hi']})")
    print('Join 1.1.1', json.dumps(join))
    for row in wrong_with_finding:
        print('  wrong crop with finding', json.dumps(row, ensure_ascii=False))
    print('Hcor', hg['group'], hm['pos'], hm['shows'], hm['eyeNote'])


if __name__ == '__main__':
    main()
