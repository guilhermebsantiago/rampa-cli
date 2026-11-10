"""How many of the image crops the model saw on the dev pages of the four real-page studies have other page content
inside their box, and how much of the box: a count from the recorded geometry, with a calibration by eye.

What is counted (docs/studies/notes-crop-overlay.md says why):
- crops: every node with an `image` crop that is an image (role img, or tag img, svg, canvas, input), on the 12 dev
  pages of each study (48 pages); the subset with a non-empty alternative (`name`) is what 1.1.1 judges;
- candidates over a crop: nodes whose `bounds` intersect the image's box with a positive area, that are not the image,
  not an ancestor of it and not a descendant, not `hidden`, and carry something visible (own `text`, a `name`, or a role
  among link, button, heading, img, textbox). Left out and counted apart, because `rampa check` hides them before the
  crop: a node in a `position: fixed` layer that does not hold the image (the node itself or an ancestor recorded as
  fixed; markLayers and showLayersAround in src/surfaces/web.ts), and a node in the branch of another picture stacked in
  the same box (intersection over union of 0.8 or more, not the same `src`; prepareImageInPage in
  src/surfaces/image-capture.ts);
- covered share: the share of the image's box inside the union of the candidates' boxes, on a 64 x 64 grid of cell
  centres over the box, so a parent and its children never count twice; also split by document order (candidates
  after the image, before it) and by the recorded `native.position` (absolute, or none recorded);
- per study and overall: crops with a share above 0 and of at least 0.05, 0.25 and 0.5, with 95% Wilson intervals;
- calibration by eye: the 15 crops with the highest share (equal shares in the order of a seeded shuffle, the same
  seed) and 10 drawn by random.Random(20261109) among those with a share of at least 0.05 and under 0.25, written as
  PNG files to .rampa/crop-overlay/ (git-ignored), with the Hcor banner's as 00-..., each the crop as
  recorded and, beside or under it, the same crop with the candidates' boxes drawn (red: after the image in document
  order; blue: before it). The by-eye answers (`paintedOver`: yes, no or unclear, and `eyeNote`, in `calibration` and
  `hcor`) are typed into data/overlay.json and kept by every rerun;
- a crop is flagged when its share is at least 0.05; flagged crops are joined to the dev rows of each study's
  data/findings.json (criterion 1.1.1, same slug and ref) and the Claude final labels among them are counted.

Dev pages only: each study's data/pages.json decides, before any snapshot is opened, which pages are read; no snapshot,
report or finding of a test page is opened, and a findings.json row is dropped unread unless its split is dev and its
page a dev page. The script stops if the Hcor banner is not flagged. Every number is counted and in-sample (dev). Geometry only: it cannot tell paint order or
transparency.

Run from anywhere: python -I study/notes-crop-overlay/overlay.py
Reads the recordings at C:/Users/guilh/dev/rampa-study-recordings (read only); writes data/overlay.json and the PNG
files; prints the tables of the note.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding='utf-8', newline='\n')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RECORDINGS = 'C:/Users/guilh/dev/rampa-study-recordings'
OUT = os.path.join(HERE, 'data', 'overlay.json')
PNG_DIR = os.path.join(ROOT, '.rampa', 'crop-overlay')

# (study folder in rampa-cli/study, folder of its recordings, short name)
STUDIES = (
    ('fresh-2026-10-11', 'fresh-2026-10-11', 's1'),
    ('round-3-2026-10-23', 'round-3-2026-10-23', 's3'),
    ('round-4-2026-10-24', 'round-4-2026-10-24', 's4'),
    ('round-5-2026-10-28', 'round-5', 's5'),
)
GRID = 64
THRESHOLDS = (('above 0', lambda s: s > 0), ('>= 0.05', lambda s: s >= 0.05), ('>= 0.25', lambda s: s >= 0.25), ('>= 0.5', lambda s: s >= 0.5))
FLAG = 0.05
TOP = 15
DRAWN = 10
SEED = 20261109
BAND = (0.05, 0.25)
IMAGE_TAGS = {'img', 'svg', 'canvas', 'input'}
VISIBLE_ROLES = {'link', 'button', 'heading', 'img', 'textbox'}
PICTURE_TAGS = {'img', 'svg', 'canvas', 'video'}
STACKED_IOU = 0.8
HCOR = ('round-3-2026-10-23', 'hcor-com-br', 'div:nth-of-type(4) > div > picture > img')
EYE_FIELDS = ('paintedOver', 'eyeNote')


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def wilson(k, n, z=1.96):
    if n == 0:
        return (None, None, None)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (round(p, 4), round(max(0.0, c - h), 4), round(min(1.0, c + h), 4))


def dev_pages(study):
    """The dev rows of a study's pages.json: the only pages this script reads."""
    rows = load(os.path.join(ROOT, 'study', study, 'data', 'pages.json'))
    return [r for r in rows if r['split'] == 'dev']


def flatten(root):
    """Preorder list of (node, parent index); end[i] is the last preorder index inside node i's subtree."""
    order, parent, end = [], [], []
    stack = [(root, -1, False)]
    while stack:
        node, up, done = stack.pop()
        if done:
            end[up] = len(order) - 1
            continue
        index = len(order)
        order.append(node)
        parent.append(up)
        end.append(index)
        stack.append((None, index, True))
        for child in reversed(node.get('children') or []):
            stack.append((child, index, False))
    return order, parent, end


def box(node):
    b = node.get('bounds')
    if not b or b['width'] <= 0 or b['height'] <= 0:
        return None
    return (b['x'], b['y'], b['x'] + b['width'], b['y'] + b['height'])


def inter_area(a, b):
    return max(0.0, min(a[2], b[2]) - max(a[0], b[0])) * max(0.0, min(a[3], b[3]) - max(a[1], b[1]))


def is_image(node):
    return node.get('role') == 'img' or (node.get('native') or {}).get('tag') in IMAGE_TAGS


def is_picture(node):
    native = node.get('native') or {}
    tag = native.get('tag')
    attributes = native.get('attributes') or {}
    return tag in PICTURE_TAGS or node.get('role') == 'img' or (tag == 'input' and attributes.get('type') == 'image')


def shows_something(node):
    if (node.get('text') or '').strip() or (node.get('name') or '').strip():
        return True
    return node.get('role') in VISIBLE_ROLES


def position(node):
    return (node.get('native') or {}).get('position')


def cell_range(lo, hi, origin, size):
    """Indices of the grid cells whose centres fall in [lo, hi) along one axis."""
    step = size / GRID
    first = max(0, math.ceil((lo - origin) / step - 0.5))
    last = min(GRID - 1, math.ceil((hi - origin) / step - 0.5) - 1)
    return first, last


def cover(mask, target, other):
    x0, y0, x1, y1 = target
    c0, c1 = cell_range(other[0], other[2], x0, x1 - x0)
    r0, r1 = cell_range(other[1], other[3], y0, y1 - y0)
    if c0 > c1 or r0 > r1:
        return
    bits = ((1 << (c1 - c0 + 1)) - 1) << c0
    for r in range(r0, r1 + 1):
        mask[r] |= bits


def share(mask):
    return sum(bin(row).count('1') for row in mask) / (GRID * GRID)


def png_size(data_url):
    raw = base64.b64decode(data_url.split(',', 1)[1])
    with Image.open(io.BytesIO(raw)) as im:
        return im.size


def analyse_page(study, rec_folder, page):
    path = os.path.join(RECORDINGS, rec_folder, 'pages', page['slug'], 'recording', page['recording'] + '.snapshot.json')
    with open(path, 'rb') as f:
        raw = f.read()
    snapshot = json.loads(raw.decode('utf-8'))
    viewport = snapshot.get('viewport') or {}
    order, parent, end = flatten(snapshot['root'])
    boxes = [box(n) for n in order]

    # A node inside a fixed layer: the nearest fixed node at or above it, if any.
    fixed_layer = [-1] * len(order)
    for i, node in enumerate(order):
        up = parent[i]
        fixed_layer[i] = i if position(node) == 'fixed' else (fixed_layer[up] if up >= 0 else -1)

    def ancestor_of(a, b):
        """Whether node a is an ancestor of node b."""
        return a < b <= end[a]

    def nearest_fixed_hidden(i, target):
        """Whether node i sits in a fixed layer that does not hold the target (the capture hides such a layer)."""
        layer = fixed_layer[i]
        while layer >= 0:
            if not (ancestor_of(layer, target) or layer == target):
                return True
            up = parent[layer]
            layer = fixed_layer[up] if up >= 0 else -1
        return False

    def path_to_root(i):
        out = []
        while i >= 0:
            out.append(i)
            i = parent[i]
        return out

    crops, no_box = [], []
    for t, node in enumerate(order):
        image = node.get('image')
        if not (isinstance(image, str) and image.startswith('data:image/') and is_image(node)):
            continue
        name = (node.get('name') or '').strip()
        target = boxes[t]
        native = node.get('native') or {}
        base = {'study': study, 'slug': page['slug'], 'ref': node['ref'], 'role': node.get('role'), 'tag': native.get('tag'), 'alt': name[:120], 'hasAlt': bool(name)}
        if target is None:
            no_box.append(base)
            continue
        area = (target[2] - target[0]) * (target[3] - target[1])

        # Other pictures stacked in the same box: prepareImageInPage hides each one's branch below the closest common box.
        stacked_roots = []
        own_src = (native.get('attributes') or {}).get('src')
        for o, other in enumerate(order):
            if o == t or boxes[o] is None or not is_picture(other) or 'hidden' in other.get('states', []):
                continue
            if ancestor_of(o, t) or ancestor_of(t, o):
                continue
            shared = inter_area(target, boxes[o])
            union = area + (boxes[o][2] - boxes[o][0]) * (boxes[o][3] - boxes[o][1]) - shared
            if union <= 0 or shared / union < STACKED_IOU:
                continue
            other_src = ((other.get('native') or {}).get('attributes') or {}).get('src')
            if native.get('tag') == 'img' and (other.get('native') or {}).get('tag') == 'img' and own_src and own_src == other_src:
                continue
            mine = set(path_to_root(t))
            branch = o
            while parent[branch] >= 0 and parent[branch] not in mine:
                branch = parent[branch]
            stacked_roots.append(branch)

        masks = {k: [0] * GRID for k in ('all', 'after', 'before', 'absolute', 'none')}
        candidates, left_fixed, left_stacked = [], 0, 0
        for c, other in enumerate(order):
            if c == t or boxes[c] is None or ancestor_of(c, t) or ancestor_of(t, c):
                continue
            if inter_area(target, boxes[c]) <= 0 or 'hidden' in other.get('states', []) or not shows_something(other):
                continue
            if nearest_fixed_hidden(c, t):
                left_fixed += 1
                continue
            if any(c == r or ancestor_of(r, c) for r in stacked_roots):
                left_stacked += 1
                continue
            when = 'after' if c > t else 'before'
            pos = 'absolute' if position(other) == 'absolute' else 'none'
            one = [0] * GRID
            cover(one, target, boxes[c])
            own = share(one)
            for key in ('all', when, pos):
                cover(masks[key], target, boxes[c])
            label = (other.get('name') or other.get('text') or '').strip()
            candidates.append({'ref': other['ref'], 'role': other.get('role'), 'order': when, 'position': position(other), 'share': round(own, 4), 'label': label[:60], 'box': boxes[c]})

        crop_w, crop_h = png_size(image)
        candidates.sort(key=lambda x: (-x['share'], x['ref']))
        width = viewport.get('width') or 0
        row = {
            **base,
            'bounds': node['bounds'],
            'cropSize': [crop_w, crop_h],
            'sizeDrift': abs(crop_w - node['bounds']['width']) > 2 or abs(crop_h - node['bounds']['height']) > 2,
            'beyondViewport': bool(width) and (target[0] < -1 or target[2] > width + 1),
            'share': round(share(masks['all']), 4),
            'shareAfter': round(share(masks['after']), 4),
            'shareBefore': round(share(masks['before']), 4),
            'shareAbsolute': round(share(masks['absolute']), 4),
            'shareNoPosition': round(share(masks['none']), 4),
            'candidates': len(candidates),
            'leftOutFixed': left_fixed,
            'leftOutStacked': left_stacked,
            'topCandidates': [{k: v for k, v in x.items() if k != 'box'} for x in candidates[:5]],
        }
        row['_image'] = image
        row['_boxes'] = [(x['box'], x['order']) for x in candidates]
        crops.append(row)
    meta = {'study': study, 'slug': page['slug'], 'split': page['split'], 'recording': os.path.relpath(path, RECORDINGS).replace(os.sep, '/'), 'sha256': hashlib.sha256(raw).hexdigest(), 'nodes': len(order), 'crops': len(crops), 'cropsWithoutBox': len(no_box)}
    return meta, crops, no_box


def thresholds(rows, field='share'):
    n = len(rows)
    out = {'n': n}
    for name, test in THRESHOLDS:
        k = sum(1 for r in rows if test(r[field]))
        p, lo, hi = wilson(k, n)
        out[name] = {'k': k, 'p': p, 'lo': lo, 'hi': hi}
    return out


def write_png(path, row):
    raw = base64.b64decode(row['_image'].split(',', 1)[1])
    with Image.open(io.BytesIO(raw)) as im:
        crop = im.convert('RGB')
    w, h = crop.size
    b = row['bounds']
    sx, sy = w / b['width'], h / b['height']
    drawn = crop.copy()
    draw = ImageDraw.Draw(drawn)
    for (x0, y0, x1, y1), when in row['_boxes']:
        rect = [(x0 - b['x']) * sx, (y0 - b['y']) * sy, (x1 - b['x']) * sx - 1, (y1 - b['y']) * sy - 1]
        rect = [max(0, rect[0]), max(0, rect[1]), min(w - 1, rect[2]), min(h - 1, rect[3])]
        if rect[2] > rect[0] and rect[3] > rect[1]:
            draw.rectangle(rect, outline=(220, 0, 0) if when == 'after' else (0, 90, 255), width=2)
    # Small crops are enlarged (nearest pixel) so they can be looked at; large ones shrunk to 900 px.
    scale = min(900 / max(w, h), max(1.0, 300 / max(w, h)))
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    left, right = crop.resize(size, Image.NEAREST), drawn.resize(size, Image.NEAREST)
    gap = 12
    if size[0] >= size[1]:
        sheet = Image.new('RGB', (size[0], size[1] * 2 + gap), (128, 128, 128))
        sheet.paste(left, (0, 0))
        sheet.paste(right, (0, size[1] + gap))
    else:
        sheet = Image.new('RGB', (size[0] * 2 + gap, size[1]), (128, 128, 128))
        sheet.paste(left, (0, 0))
        sheet.paste(right, (size[0] + gap, 0))
    sheet.save(path)


def fmt(cell):
    if cell['p'] is None:
        return '-'
    return f"{cell['k']} ({cell['p']:.2f}, {cell['lo']:.2f}-{cell['hi']:.2f})"


def main():
    previous, hcor_eye = {}, {}
    if os.path.exists(OUT):
        before = load(OUT)
        for entry in before.get('calibration', []):
            previous[(entry['study'], entry['slug'], entry['ref'])] = {k: entry.get(k) for k in EYE_FIELDS}
        hcor_eye = {k: (before.get('hcor') or {}).get(k) for k in EYE_FIELDS}

    pages, crops, no_box = [], [], []
    for study, rec_folder, _ in STUDIES:
        dev = dev_pages(study)
        if len(dev) != 12:
            raise SystemExit(f'{study}: {len(dev)} dev pages, expected 12')
        for page in dev:
            meta, rows, missing = analyse_page(study, rec_folder, page)
            pages.append(meta)
            crops.extend(rows)
            no_box.extend(missing)
    assert len(pages) == 48 and all(p['split'] == 'dev' for p in pages)

    hcor = [r for r in crops if (r['study'], r['slug']) == HCOR[:2] and r['ref'].endswith(HCOR[2])]
    if len(hcor) != 1 or hcor[0]['share'] < FLAG:
        raise SystemExit(f'The Hcor banner is not flagged ({[r["share"] for r in hcor]}): the method is wrong')

    # Calibration: the highest shares, then a seeded draw in the band.
    # Many crops tie at the top (a share of 1): the order among equal shares is a seeded shuffle, not the page's name.
    ranked = sorted(crops, key=lambda r: (r['study'], r['slug'], r['ref']))
    random.Random(SEED).shuffle(ranked)
    ranked.sort(key=lambda r: -r['share'])
    top = ranked[:TOP]
    chosen = {(r['study'], r['slug'], r['ref']) for r in top}
    band = sorted((r for r in crops if BAND[0] <= r['share'] < BAND[1] and (r['study'], r['slug'], r['ref']) not in chosen), key=lambda r: (r['study'], r['slug'], r['ref']))
    rng = random.Random(SEED)
    rng.shuffle(band)
    drawn = band[:DRAWN]
    os.makedirs(PNG_DIR, exist_ok=True)
    short = {s: name for s, _, name in STUDIES}
    calibration = []
    for i, (row, why) in enumerate([(r, 'top') for r in top] + [(r, 'drawn') for r in drawn], start=1):
        file = f'{i:02d}-{short[row["study"]]}-{row["slug"]}.png'
        write_png(os.path.join(PNG_DIR, file), row)
        key = (row['study'], row['slug'], row['ref'])
        eye = previous.get(key, {})
        calibration.append({'n': i, 'pick': why, 'study': row['study'], 'slug': row['slug'], 'ref': row['ref'], 'alt': row['alt'], 'share': row['share'], 'shareAfter': row['shareAfter'], 'shareBefore': row['shareBefore'], 'png': f'.rampa/crop-overlay/{file}', **{k: eye.get(k) for k in EYE_FIELDS}})
    # The Hcor banner, looked at by eye too, outside the 25 unless it was drawn among them.
    hcor_file = f'00-s3-{HCOR[1]}.png'
    write_png(os.path.join(PNG_DIR, hcor_file), hcor[0])

    # Join to the dev 1.1.1 findings: only rows whose split is dev, on dev pages.
    findings = {}
    for study, _, _ in STUDIES:
        dev_slugs = {p['slug'] for p in dev_pages(study)}
        for f in load(os.path.join(ROOT, 'study', study, 'data', 'findings.json')):
            if f.get('split') != 'dev' or f.get('slug') not in dev_slugs or f.get('criterion') != '1.1.1':
                continue
            findings.setdefault((study, f['slug'], f['ref']), []).append(f)
    labels = ('true_positive', 'false_positive', 'uncertain')

    def joined(rows):
        hits = [findings[(r['study'], r['slug'], r['ref'])] for r in rows if (r['study'], r['slug'], r['ref']) in findings]
        rows_found = [f for group in hits for f in group]
        out = {'crops': len(rows), 'cropsWithFinding': len(hits), 'findings': len(rows_found)}
        for name in labels:
            out[name] = sum(1 for f in rows_found if f.get('final') == name)
        out['shown'] = {'findings': sum(1 for f in rows_found if f.get('shown'))}
        for name in labels:
            out['shown'][name] = sum(1 for f in rows_found if f.get('shown') and f.get('final') == name)
        return out

    join = {'all crops': joined(crops)}
    for name, test in THRESHOLDS:
        join[name] = joined([r for r in crops if test(r['share'])])
    join['by eye: yes'] = joined([r for r in crops if previous.get((r['study'], r['slug'], r['ref']), {}).get('paintedOver') == 'yes'])
    flagged_with_finding = []
    for r in crops:
        key = (r['study'], r['slug'], r['ref'])
        if r['share'] >= FLAG and key in findings:
            for f in findings[key]:
                flagged_with_finding.append({'study': r['study'], 'slug': r['slug'], 'ref': r['ref'], 'share': r['share'], 'key': f.get('key'), 'source': f.get('source'), 'experimental': f.get('experimental'), 'final': f.get('final')})
    findings_on_crops = sum(len(v) for k, v in findings.items() if any((r['study'], r['slug'], r['ref']) == k for r in crops))

    table = {}
    for study, _, _ in STUDIES:
        rows = [r for r in crops if r['study'] == study]
        table[study] = {'crops': thresholds(rows), 'withAlt': thresholds([r for r in rows if r['hasAlt']])}
    table['overall'] = {'crops': thresholds(crops), 'withAlt': thresholds([r for r in crops if r['hasAlt']])}
    splits = {field: thresholds(crops, field) for field in ('share', 'shareAfter', 'shareBefore', 'shareAbsolute', 'shareNoPosition')}

    eye_tally = {k: sum(1 for c in calibration if c['paintedOver'] == k) for k in ('yes', 'no', 'unclear')}
    eye_tally['not yet looked at'] = sum(1 for c in calibration if c['paintedOver'] is None)
    for pick in ('top', 'drawn'):
        eye_tally[pick] = {k: sum(1 for c in calibration if c['pick'] == pick and c['paintedOver'] == k) for k in ('yes', 'no', 'unclear')}

    # The two looks are random draws inside two strata: the top 15 among the crops with a share of 1 (ties broken by the
    # seeded shuffle), the other 10 among the band. What they say holds for their stratum, not for every flagged crop.
    strata = {
        'share 0': sum(1 for r in crops if r['share'] == 0),
        'above 0, under 0.05': sum(1 for r in crops if 0 < r['share'] < FLAG),
        'band 0.05 to under 0.25': sum(1 for r in crops if BAND[0] <= r['share'] < BAND[1]),
        '0.25 to under 1': sum(1 for r in crops if 0.25 <= r['share'] < 1),
        'share 1': sum(1 for r in crops if r['share'] == 1),
    }
    looked = {}
    for pick, stratum in (('top', 'share 1'), ('drawn', 'band 0.05 to under 0.25')):
        seen = [c for c in calibration if c['pick'] == pick]
        yes = sum(1 for c in seen if c['paintedOver'] == 'yes')
        p, lo, hi = wilson(yes, len(seen))
        looked[pick] = {'stratum': stratum, 'cropsInStratum': strata[stratum], 'lookedAt': len(seen), 'yes': yes, 'p': p, 'lo': lo, 'hi': hi}
        if pick == 'top' and any(c['share'] != 1 for c in seen):
            looked[pick]['stratum'] = 'highest shares (not all 1)'

    caveats = {
        'cropsWithoutBox': len(no_box),
        'cropsWithSizeDrift': sum(1 for r in crops if r['sizeDrift']),
        'cropsBeyondViewport': sum(1 for r in crops if r['beyondViewport']),
        'cropsBeyondViewportFlagged': sum(1 for r in crops if r['beyondViewport'] and r['share'] >= FLAG),
        'cropsWithFixedLeftOut': sum(1 for r in crops if r['leftOutFixed']),
        'candidatesFixedLeftOut': sum(r['leftOutFixed'] for r in crops),
        'cropsWithStackedLeftOut': sum(1 for r in crops if r['leftOutStacked']),
        'candidatesStackedLeftOut': sum(r['leftOutStacked'] for r in crops),
        'cropsFlaggedOnlyByBefore': sum(1 for r in crops if r['share'] >= FLAG and r['shareAfter'] < FLAG),
    }
    out = {
        'about': 'Counted, in-sample (dev): image crops on the 48 dev pages of the four real-page studies with other page content inside their box, from the recorded geometry. Written by study/notes-crop-overlay/overlay.py; paintedOver and eyeNote in calibration are typed by eye and kept by reruns. See docs/studies/notes-crop-overlay.md.',
        'method': {
            'grid': GRID, 'flag': FLAG, 'thresholds': [name for name, _ in THRESHOLDS], 'imageTags': sorted(IMAGE_TAGS), 'visibleRoles': sorted(VISIBLE_ROLES),
            'stackedIoU': STACKED_IOU, 'seed': SEED, 'top': TOP, 'drawn': DRAWN, 'band': list(BAND),
        },
        'pages': pages,
        'totals': {'pages': len(pages), 'crops': len(crops), 'cropsWithAlt': sum(1 for r in crops if r['hasAlt']), 'cropsWithoutBox': len(no_box), 'dev111FindingsOnCrops': findings_on_crops},
        'table': table,
        'splits': splits,
        'caveats': caveats,
        'calibration': calibration,
        'calibrationTally': eye_tally,
        'strata': strata,
        'calibrationByStratum': looked,
        'join111': join,
        'flaggedWithFinding': flagged_with_finding,
        'hcor': {**{k: v for k, v in hcor[0].items() if not k.startswith('_')}, 'png': f'.rampa/crop-overlay/{hcor_file}', **{k: hcor_eye.get(k) for k in EYE_FIELDS}},
        'cropsWithoutBox': no_box,
        'crops': [{k: v for k, v in r.items() if not k.startswith('_')} for r in crops],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print(f"Pages {len(pages)} (dev), crops {len(crops)} with a box, {sum(1 for r in crops if r['hasAlt'])} with an alternative; {len(no_box)} crops without a box")
    print('\n| Study | Crops | Share above 0 | At least 0.05 | At least 0.25 | At least 0.5 |\n| --- | ---: | --- | --- | --- | --- |')
    for name in [s for s, _, _ in STUDIES] + ['overall']:
        for part, label in (('crops', ''), ('withAlt', ', with an alternative')):
            cell = table[name][part]
            print(f"| {name}{label} | {cell['n']} | " + ' | '.join(fmt(cell[t]) for t, _ in THRESHOLDS) + ' |')
    print('\n| Candidates counted | Share above 0 | At least 0.05 | At least 0.25 | At least 0.5 |\n| --- | --- | --- | --- | --- |')
    for field in splits:
        print(f'| {field} | ' + ' | '.join(fmt(splits[field][t]) for t, _ in THRESHOLDS) + ' |')
    print('\nCaveats', json.dumps(caveats))
    print('Hcor banner', hcor[0]['share'], hcor[0]['shareAfter'], hcor[0]['shareBefore'], hcor[0]['shareAbsolute'], hcor[0]['shareNoPosition'])
    print('Calibration tally', json.dumps(eye_tally))
    print('Strata', json.dumps(strata))
    print('By stratum', json.dumps(looked))
    print('Join 1.1.1', json.dumps(join))


if __name__ == '__main__':
    main()
