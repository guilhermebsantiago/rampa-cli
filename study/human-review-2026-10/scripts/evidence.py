"""The extra evidence a v2 review package carries: facts of the captured page, read from the full recorded snapshot.

The format is docs/studies/human-review-evidence-format.md (version 1); Rampa Lab's review mode reads it from the
top-level key `reviewEvidence` of each snapshots/<slug>.snapshot.json. Every value is a fact of the page as it was
captured: its structure, its text, its declared languages, its screenshot, the addresses of its links and images, and
what Rampa read at those addresses. None of Rampa's own readings is here (no verdict, confidence, suggested text or
held-back claim): they would tell a reviewer what Rampa concluded. The block's keys avoid every name in
sample.FORBIDDEN_KEYS.

Use:
  tree = Tree(snapshot)                                 # the snapshot as recorded, before sample.prune
  images = page_images(screenshot, snapshot, refs)      # optional; a Pillow image the caller opened
  block = build(snapshot, refs, images=images, rubric="three-answers-1")

Everything but page_images is pure: a dict and a list of refs in, a dict out, standard library only. page_images
needs Pillow and the screenshot passed in; it draws each context image with sample.context_image itself, into a
temporary file that is read back and removed, so the image is exactly the one the sent packages' contexto/ holds.
Importing this module (or sample) runs nothing.
"""

import base64
import io
import os
import re
import sys
import tempfile
import unicodedata
from urllib.parse import urljoin, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sample  # noqa: E402  - only its functions; its main() is never called from here

VERSION = 1
RUBRICS = ("three-answers-1",)
LONG_TEXT, SHORT_TEXT = 300, 160
MAX_LIST_ITEMS, MAX_BEFORE, MAX_SAME_TEXT = 6, 4, 12
CAPTURE_WIDTH, CAPTURE_MAX_HEIGHT, CAPTURE_QUALITY = 640, 6000, 60
ENCLOSING_ROLES = {"paragraph", "listitem", "cell", "gridcell", "columnheader", "rowheader"}
ENCLOSING_TAGS = {"p", "li", "td", "th"}
LIST_TAGS = {"ul", "ol", "menu"}
PAGE_FIELDS = ("lang", "capture", "captureSize", "captureAligned")
ITEM_FIELDS = ("lang", "context", "enclosing", "headingBefore", "listItems", "before", "sameText", "imageFile")
# Leading and trailing C0 controls and spaces are stripped from an address, and tabs and newlines inside it removed,
# as a browser does before it resolves one (WHATWG URL); a recorded href can start with a newline.
_EDGES = "".join(chr(i) for i in range(0x21))


class Tree:
    """A snapshot walked once, without recursion: document order, parents, and each subtree's span in that order."""

    def __init__(self, snapshot):
        self.snapshot = snapshot
        self.order, self.parent, self.by_ref = [], {}, {}
        stack = [(snapshot["root"], None)]
        while stack:
            node, parent = stack.pop()
            self.parent[id(node)] = parent
            self.order.append(node)
            ref = node.get("ref")
            # The first node with a ref wins, as in sample.index_snapshot and the Lab.
            if isinstance(ref, str) and ref not in self.by_ref:
                self.by_ref[ref] = node
            for child in reversed(node.get("children") or []):
                stack.append((child, node))
        self.position = {id(n): i for i, n in enumerate(self.order)}
        size = {}
        for n in reversed(self.order):
            size[id(n)] = 1 + sum(size[id(c)] for c in n.get("children") or [])
        self.end = {id(n): self.position[id(n)] + size[id(n)] for n in self.order}

    def ancestors(self, node):
        out, at = [], self.parent.get(id(node))
        while at is not None:
            out.append(at)
            at = self.parent.get(id(at))
        return out

    def subtree(self, node):
        return self.order[self.position[id(node)]:self.end[id(node)]]


def native(node):
    value = node.get("native")
    return value if isinstance(value, dict) else {}


def attributes(node):
    value = native(node).get("attributes")
    return value if isinstance(value, dict) else {}


def tag(node):
    value = native(node).get("tag")
    return value.lower() if isinstance(value, str) else None


def hidden(node):
    states = node.get("states") or []
    return "hidden" in states or "aria-hidden" in states


def is_list(node):
    return node.get("role") == "list" or tag(node) in LIST_TAGS


def collapse(text):
    return re.sub(r"\s+", " ", text or "").strip()


def short(text, n):
    text = collapse(text)
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def text_of(node, skip_lists=False):
    """What a person reads in a subtree, in document order: a block's reading text when the collector recorded one
    (native.readingText: its text in order, images by their accessible names, hidden parts left out), else each node's
    own text and the names of images, hidden descendants left out. With skip_lists, lists nested in the node are left
    out too (a reading text that holds one is then not used)."""
    parts, stack = [], [(node, True)]
    while stack:
        n, top = stack.pop()
        if not top and (hidden(n) or (skip_lists and is_list(n))):
            continue
        reading = native(n).get("readingText")
        if isinstance(reading, str) and not (skip_lists and any(is_list(d) for d in _below(n))):
            parts.append(reading)
            continue
        if isinstance(n.get("text"), str):
            parts.append(n["text"])
        if n.get("role") == "img" and isinstance(n.get("name"), str):
            parts.append(n["name"])
        for child in reversed(n.get("children") or []):
            stack.append((child, False))
    return collapse(" ".join(parts))


def _below(node):
    stack = list(node.get("children") or [])
    while stack:
        n = stack.pop()
        yield n
        stack.extend(n.get("children") or [])


def holds(node, role):
    return any(n.get("role") == role and not hidden(n) for n in _with_below(node))


def _with_below(node):
    yield node
    yield from _below(node)


def name_key(node):
    """A link's accessible name (the name, else its own text), NFKC, lower case, spaces collapsed."""
    name = collapse(node.get("name") if isinstance(node.get("name"), str) else "")
    if not name:
        name = collapse(node.get("text") if isinstance(node.get("text"), str) else "")
    return collapse(unicodedata.normalize("NFKC", name).lower())


def resolve(address, base):
    if not isinstance(address, str):
        return None
    cleaned = re.sub(r"[\t\n\r]", "", address.strip(_EDGES))
    if not cleaned:
        return None
    try:
        return urljoin(base, cleaned)
    except ValueError:
        return None


def is_http(address):
    try:
        parts = urlsplit(address)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and bool(parts.netloc)


# The page.

def page_lang(snapshot):
    """The language the root element declares: the root node's `lang` (the collector's getAttribute('lang') on <html>),
    trimmed; an empty string when it declares none."""
    value = snapshot["root"].get("lang")
    return value.strip() if isinstance(value, str) else ""


# The fields of one element.

def item_lang(tree, node):
    """The nearest non-empty `lang` on the node or an ancestor. An empty lang declares nothing, as the collector and
    ACT read it, so the walk goes past it."""
    for n in [node] + tree.ancestors(node):
        value = n.get("lang")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def enclosing(tree, node):
    """The nearest paragraph, list item or table cell holding the element (or the element itself)."""
    for n in [node] + tree.ancestors(node):
        if n.get("role") in ENCLOSING_ROLES or tag(n) in ENCLOSING_TAGS:
            text = text_of(n)
            if not text:
                return None
            entry = {"role": n.get("role"), "tag": tag(n), "text": short(text, LONG_TEXT)}
            return {k: v for k, v in entry.items() if v is not None}
    return None


def heading_rank(node):
    """aria-level when it is a positive whole number (it overrides the tag, as in ARIA), else the h1-h6 tag's digit."""
    level = attributes(node).get("aria-level")
    if isinstance(level, str) and level.strip().isdigit() and int(level.strip()) > 0:
        return int(level.strip())
    found = re.fullmatch(r"h([1-6])", tag(node) or "")
    return int(found.group(1)) if found else None


def levels_up(tree, node, other):
    """How many levels above `node` its closest common ancestor with `other` sits (0 when `other` is inside it)."""
    theirs = {id(n) for n in [other] + tree.ancestors(other)}
    for up, n in enumerate([node] + tree.ancestors(node)):
        if id(n) in theirs:
            return up
    return None


def heading_before(tree, node):
    """The nearest heading before the element in document order, not hidden, with text."""
    for j in range(tree.position[id(node)] - 1, -1, -1):
        h = tree.order[j]
        if h.get("role") != "heading" or hidden(h):
            continue
        text = collapse(h.get("name") if isinstance(h.get("name"), str) else "") or text_of(h)
        if not text:
            continue
        out = {}
        rank = heading_rank(h)
        if rank is not None:
            out["rank"] = rank
        out["text"] = short(text, LONG_TEXT)
        out["up"] = levels_up(tree, node, h)
        return out
    return None


def list_items(tree, node):
    """The list items the element is nested in, nearest first: each one's own text, without the lists nested in it."""
    out = []
    for a in tree.ancestors(node):
        if a.get("role") == "listitem" or tag(a) == "li":
            text = text_of(a, skip_lists=True)
            if text:
                out.append({"text": short(text, SHORT_TEXT)})
            if len(out) == MAX_LIST_ITEMS:
                break
    return out


def before(tree, node):
    """For each of the nearest ancestors, the closest earlier sibling of the branch that holds the element, among those
    with text. `up` is 1 for the element's parent."""
    out, branch = [], node
    for up, a in enumerate(tree.ancestors(node)[:MAX_BEFORE], start=1):
        kids = a.get("children") or []
        at = next(i for i, k in enumerate(kids) if k is branch)
        for sibling in reversed(kids[:at]):
            if hidden(sibling):
                continue
            text = text_of(sibling)
            if text:
                entry = {"up": up, "role": sibling.get("role"), "tag": tag(sibling), "text": short(text, SHORT_TEXT),
                         "holdsHeading": holds(sibling, "heading"), "holdsLink": holds(sibling, "link")}
                out.append({k: v for k, v in entry.items() if v is not None})
                break
        branch = a
    return out


def same_text(tree, node):
    """For a link, or an element in one: the page's other links, not hidden, with the same accessible name."""
    link = next((n for n in [node] + tree.ancestors(node) if n.get("role") == "link"), None)
    if link is None:
        return None
    key = name_key(link)
    if not key:
        return None
    others = [n for n in tree.order if n is not link and n.get("role") == "link" and not hidden(n) and name_key(n) == key]
    if not others:
        return None
    target = tree.snapshot.get("target") or ""
    destinations = tree.snapshot.get("destinations") or {}
    links = []
    for n in others[:MAX_SAME_TEXT]:
        href = attributes(n).get("href")
        entry = {}
        resolved = resolve(href, target)
        if resolved:
            entry["href"] = resolved
        read = destinations.get(href) if isinstance(href, str) else None
        if isinstance(read, dict):
            for field, n_chars in (("title", LONG_TEXT), ("heading", LONG_TEXT)):
                if isinstance(read.get(field), str) and collapse(read[field]):
                    entry[field] = short(read[field], n_chars)
            if isinstance(read.get("finalUrl"), str) and read["finalUrl"].strip():
                entry["finalUrl"] = read["finalUrl"].strip()
        links.append(entry)
    return {"total": len(others) + 1, "links": links}


def image_file(tree, node):
    """For an image: its src resolved against the page's address, when that is an http(s) address."""
    if node.get("role") != "img" and tag(node) != "img":
        return None
    resolved = resolve(attributes(node).get("src"), tree.snapshot.get("target") or "")
    return resolved if resolved and is_http(resolved) else None


def item_evidence(tree, node, context=None):
    fields = {
        "lang": item_lang(tree, node),
        "context": context,
        "enclosing": enclosing(tree, node),
        "headingBefore": heading_before(tree, node),
        "listItems": list_items(tree, node) or None,
        "before": before(tree, node) or None,
        "sameText": same_text(tree, node),
        "imageFile": image_file(tree, node),
    }
    return {k: v for k, v in fields.items() if v is not None}


# The images (Pillow, and a screenshot the caller opened).

def data_url(image, quality):
    out = io.BytesIO()
    image.convert("RGB").save(out, "JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def viewport_pixels(snapshot):
    """The width of the snapshot's viewport in screenshot pixels, or None when the snapshot does not record it."""
    viewport = snapshot.get("viewport") if isinstance(snapshot.get("viewport"), dict) else {}
    width, scale = viewport.get("width"), viewport.get("scale") or 1
    return round(width * scale) if isinstance(width, (int, float)) and width > 0 and isinstance(scale, (int, float)) else None


def page_capture(screenshot, viewport_width=None):
    """The screenshot scaled to CAPTURE_WIDTH wide (never enlarged), cut at CAPTURE_MAX_HEIGHT of scaled height.

    A screenshot wider than the viewport (content that overflows to the right, such as a carousel's track, makes the
    full-page screenshot that wide) keeps only the viewport's width from its left edge, what the page shows unscrolled;
    scaled whole, it would be a strip a few pixels high. pageWidth and pageHeight are the screenshot's own size."""
    from PIL import Image

    W, H = screenshot.size
    shown = min(W, viewport_width) if viewport_width else W
    width = min(CAPTURE_WIDTH, shown)
    scale = width / shown
    height = max(1, round(H * scale))
    cut = height > CAPTURE_MAX_HEIGHT
    bottom = H
    if cut:
        height = CAPTURE_MAX_HEIGHT
        bottom = min(H, round(CAPTURE_MAX_HEIGHT / scale))
    region = screenshot.crop((0, 0, shown, bottom)) if (shown, bottom) != (W, H) else screenshot
    scaled = region.convert("RGB").resize((width, height), Image.LANCZOS)
    size = {"width": width, "height": height, "pageWidth": W, "pageHeight": H, "cut": cut}
    return data_url(scaled, CAPTURE_QUALITY), size


def context_images(screenshot, tree, refs):
    """What sample.context_image draws for each element whose own crop matches the screenshot (sample.ALIGN_ITEM), as
    a JPEG data URL. The caller has already checked that the page lines up (sample.alignment)."""
    out = {}
    with tempfile.TemporaryDirectory(prefix="rampa-evidence-") as tmp:
        for i, ref in enumerate(dict.fromkeys(refs)):
            node = tree.by_ref.get(ref)
            if node is None:
                continue
            own = sample.crop_difference(screenshot, node)
            if own is not None and own > sample.ALIGN_ITEM:
                continue
            path = os.path.join(tmp, f"{i}.jpg")
            if sample.context_image(screenshot, node.get("bounds"), path):
                with open(path, "rb") as f:
                    out[ref] = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")
    return out


def page_images(screenshot, snapshot, refs, tree=None):
    """The page's capture fields, the elements' context images, and the alignment report (sample.alignment over every
    crop the full snapshot holds, as sample.main computes it)."""
    tree = tree or Tree(snapshot)
    capture, size = page_capture(screenshot, viewport_pixels(snapshot))
    report = sample.alignment(screenshot, sample.index_snapshot(snapshot))
    contexts = context_images(screenshot, tree, refs) if report["aligned"] else {}
    return {"capture": capture, "captureSize": size, "captureAligned": bool(report["aligned"]), "contexts": contexts, "alignment": report}


# The block.

def build(snapshot, refs, images=None, rubric=None, tree=None):
    """The reviewEvidence block for these refs. Refs not in the snapshot get no entry."""
    if rubric is not None and rubric not in RUBRICS:
        raise ValueError(f"unknown rubric {rubric!r}")
    tree = tree or Tree(snapshot)
    block = {"version": VERSION}
    if rubric is not None:
        block["rubric"] = rubric
    page = {"lang": page_lang(snapshot)}
    contexts = {}
    if images is not None:
        page.update({k: images[k] for k in ("capture", "captureSize", "captureAligned")})
        contexts = images["contexts"]
    block["page"] = page
    items = {}
    for ref in dict.fromkeys(refs):
        node = tree.by_ref.get(ref)
        if node is not None:
            items[ref] = item_evidence(tree, node, contexts.get(ref))
    block["items"] = items
    return block


def keys_in(value, path="reviewEvidence"):
    """Every (path, key) inside a value, for the blindness scan."""
    out = []
    if isinstance(value, dict):
        for k, v in value.items():
            out.append((f"{path}.{k}", k))
            out += keys_in(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            out += keys_in(v, f"{path}[{i}]")
    return out


def texts_in(value):
    """Every string inside a value, data: images left out."""
    if isinstance(value, str):
        return [] if value.startswith("data:") else [value]
    if isinstance(value, dict):
        return [t for v in value.values() for t in texts_in(v)]
    if isinstance(value, list):
        return [t for v in value for t in texts_in(v)]
    return []


def fields_of(block, ref):
    """Which evidence fields an item got: the page's and its own, in the format's order."""
    page = block.get("page") or {}
    item = (block.get("items") or {}).get(ref) or {}
    return {"page": [f for f in PAGE_FIELDS if f in page], "item": [f for f in ITEM_FIELDS if f in item]}
