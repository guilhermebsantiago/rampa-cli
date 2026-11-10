"""Builds a v2 review package: the layout of pacote-30, with a reviewEvidence block in each snapshot file.

  python -I study/human-review-2026-10/scripts/evidence_package.py --select pilot --name pacote-v2-piloto --rubric three-answers-1 [--recordings DIR]
  python -I study/human-review-2026-10/scripts/evidence_package.py --self-test

The format of the block and the pilot's rule are in docs/studies/human-review-evidence-format.md; the fields are
computed by evidence.py from each page's full recorded snapshot (the recordings backup, default
C:/Users/guilh/dev/rampa-study-recordings, or $RECORDINGS, or --recordings, read only).

Writes only:
  study/human-review-2026-10/<name>/data/findings.json   the items, blind (sample.blind_row), in common.package_order
  study/human-review-2026-10/<name>/data/pages.json
  study/human-review-2026-10/<name>/snapshots/<slug>.snapshot.json   sample.prune's cut, plus `reviewEvidence`
  study/human-review-2026-10/data/<select>-v2.json        the manifest: which finding each item is, no Claude label
<name> must start with pacote-v2-. There is no contexto/ folder: the context images are in the block.

The pilot (--select pilot), fixed before any draw: from the 100 of common.draw, the items of the dev half. First
r3/hcor-com-br/38c348a1cde8; then, walking the dev items in the order of common.digest("pilot", study, slug, key), the
first item of each claim kind in PILOT_KINDS. Only dev pages' snapshots and screenshots are opened.

Blindness: sample.check_blind on the written package (stops on a problem); before writing, every key inside each block
against sample.FORBIDDEN_KEYS, and every text of a block against the suggested text (patch.to, 12 characters or more)
of every finding on that page. sample.py itself is imported, never run: its main() rewrites pacote-100 and pacote-30.
"""

import argparse
import base64
import glob
import io
import os
import re
import shutil
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import evidence  # noqa: E402
import sample as package  # noqa: E402  - imported for its functions; its main() is never called

NAME = re.compile(r"pacote-v2-[a-z0-9]+(?:-[a-z0-9]+)*")
PILOT_FIRST = "r3/hcor-com-br/38c348a1cde8"
PILOT_KINDS = ("2.4.4 shared_text", "2.4.4 generic", "3.1.2 passage_language", "1.1.1 functional")
PILOT_RULE = ("From the 100 of common.draw (data/sample.json), the items whose split is dev. First r3/hcor-com-br/38c348a1cde8; "
              "then, walking the dev items in the order of common.digest('pilot', study, slug, key), the first item of each claim kind "
              "(common.claim_kind): " + ", ".join(PILOT_KINDS) + ". Package order: common.package_order.")
SUGGESTED_MIN = 12


def norm(text):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text or "")).strip().lower()


def page_splits():
    out = {}
    for sid, folder, _, _ in common.STUDIES:
        for p in common.read_json(os.path.join(common.STUDY_ROOT, folder, "data", "pages.json")):
            out[(sid, p["slug"])] = p["split"]
    return out


def select_pilot(drawn):
    dev = [r for r in drawn if r["split"] == "dev"]
    chosen = [r for r in dev if common.item_id(r) == PILOT_FIRST]
    if len(chosen) != 1:
        raise SystemExit(f"{PILOT_FIRST} is not a dev item of the draw")
    walk = sorted(dev, key=lambda r: common.digest("pilot", r["study"], r["slug"], r["key"]))
    for kind in PILOT_KINDS:
        found = next((r for r in walk if common.claim_kind(r) == kind and all(r is not c for c in chosen)), None)
        if found is None:
            raise SystemExit(f"no dev item of claim kind {kind}")
        chosen.append(found)
    return chosen


def blindness_of_block(block, suggested):
    """Problems in one block: a forbidden key, or a text equal to a suggested text of a finding on its page."""
    problems = [f"forbidden key {path}" for path, key in evidence.keys_in(block) if key in package.FORBIDDEN_KEYS]
    for text in evidence.texts_in(block):
        if norm(text) in suggested:
            problems.append(f"a text equals Rampa's suggested text for {suggested[norm(text)]}")
    return problems


def suggested_texts(rows):
    out = {}
    for r in rows:
        to = ((r.get("patch") or {}).get("to") or "").strip()
        if len(to) >= SUGGESTED_MIN:
            out[norm(to)] = common.item_id(r)
    return out


def build_package(args):
    if not NAME.fullmatch(args.name):
        raise SystemExit(f"--name must start with pacote-v2- and hold only a-z, 0-9 and hyphens: {args.name!r}")
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None  # the studies' own full-page screenshots, some over 200 million pixels

    rows, urls = common.load_studies()
    splits = page_splits()
    drawn = common.draw(rows)
    items = common.package_order(select_pilot(drawn))
    by_page = {}
    for r in items:
        if splits[(r["study"], r["slug"])] != "dev" or r["split"] != "dev":
            raise SystemExit(f"{common.item_id(r)} is not on a dev page")
        by_page.setdefault((r["study"], r["slug"]), []).append(r)
    if len({slug for _, slug in by_page}) != len(by_page):
        raise SystemExit("two pages of the package share a slug")

    snapshots, blocks, alignment, problems = {}, {}, {}, []
    for (sid, slug), page_items in by_page.items():
        snapshot = common.read_json(package.snapshot_path(args.recordings, sid, slug))
        if snapshot["target"].rstrip("/") != urls[(sid, slug)].rstrip("/"):
            raise SystemExit(f"{sid}/{slug}: snapshot target {snapshot['target']} is not {urls[(sid, slug)]}")
        refs = [r["ref"] for r in page_items]
        cut, missing, _ = package.prune(snapshot, refs)
        if missing:
            raise SystemExit(f"{sid}/{slug}: elements not in the snapshot: {missing}")
        tree = evidence.Tree(snapshot)
        images = None
        shot_path = os.path.join(package.recording_dir(args.recordings, sid), "pages", slug, "main-screenshot.png")
        if os.path.exists(shot_path):
            with Image.open(shot_path) as shot:
                shot.load()
                images = evidence.page_images(shot, snapshot, refs, tree=tree)
            alignment[f"{sid}/{slug}"] = images["alignment"]
        block = evidence.build(snapshot, refs, images=images, rubric=args.rubric, tree=tree)
        for r in page_items:
            if r["ref"] not in block["items"]:
                raise SystemExit(f"{common.item_id(r)}: no evidence entry")
        page_rows = [x for x in rows if x["study"] == sid and x["slug"] == slug]
        problems += [f"{slug}: {p}" for p in blindness_of_block(block, suggested_texts(page_rows))]
        cut["reviewEvidence"] = block
        snapshots[slug] = cut
        blocks[slug] = block
    if problems:
        for p in problems:
            print(f"BLINDNESS: {p}", file=sys.stderr)
        raise SystemExit("the evidence is not blind; nothing written")

    base = os.path.join(common.FOLDER, args.name)
    for sub in ("data", "snapshots"):
        shutil.rmtree(os.path.join(base, sub), ignore_errors=True)
    common.write_json(os.path.join(base, "data", "findings.json"), [package.blind_row(r, None) for r in items])
    pages = []
    for r in items:
        if not any(p["slug"] == r["slug"] for p in pages):
            pages.append({"slug": r["slug"], "url": urls[(r["study"], r["slug"])]})
    common.write_json(os.path.join(base, "data", "pages.json"), pages)
    for slug, cut in sorted(snapshots.items()):
        common.write_json(os.path.join(base, "snapshots", f"{slug}.snapshot.json"), cut)

    manifest_path = os.path.join(common.FOLDER, "data", f"{args.select}-v2.json")
    position = {common.item_id(r): i + 1 for i, r in enumerate(items)}
    manifest = {
        "seed": common.SEED,
        "rule": PILOT_RULE,
        "format": "docs/studies/human-review-evidence-format.md",
        "package": f"study/human-review-2026-10/{args.name}",
        "rubric": args.rubric,
        "studies": {s[0]: f"study/{s[1]}" for s in common.STUDIES},
        "counts": {"items": len(items), "pages": len(by_page)},
        "items": [
            {
                "id": common.item_id(r),
                "study": r["study"],
                "slug": r["slug"],
                "key": r["key"],
                "fingerprint": common.package_fingerprint(r),
                "page": urls[(r["study"], r["slug"])],
                "criterion": r["criterion"],
                "claimKind": common.claim_kind(r),
                "order": position[common.item_id(r)],
                "evidence": evidence.fields_of(blocks[r["slug"]], r["ref"]),
            }
            for r in items
        ],
        "notes": {"screenshotAlignment": alignment},
    }

    failed, warnings = package.check_blind(base, rows)
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    if failed:
        for p in failed:
            print(f"BLINDNESS {args.name}: {p}", file=sys.stderr)
        for sub in ("data", "snapshots"):
            shutil.rmtree(os.path.join(base, sub), ignore_errors=True)
        raise SystemExit("the package is not blind; removed what was written")
    common.write_json(manifest_path, manifest)

    for e in manifest["items"]:
        print(f"{e['order']}. {e['id']} ({e['claimKind']}): page {', '.join(e['evidence']['page'])}; item {', '.join(e['evidence']['item'])}")
    size = sum(os.path.getsize(p) for p in glob.glob(os.path.join(base, "**", "*"), recursive=True) if os.path.isfile(p))
    rel = lambda p: os.path.relpath(p, common.REPO).replace(os.sep, "/")  # noqa: E731
    print(f"items {len(items)}, pages {len(by_page)}, written to {rel(base)} ({size} bytes) and {rel(manifest_path)}; blindness checks passed")


# The self-test: a small snapshot written here, no recordings.

def node(ref, role, tag, children=(), **extra):
    attrs = extra.pop("attrs", {})
    native = {"tag": tag, "attributes": attrs}
    native.update(extra.pop("native", {}))
    out = {"ref": ref, "role": role, "states": extra.pop("states", []), "native": native, "children": list(children)}
    out.update(extra)
    return out


def self_test_snapshot():
    a1 = node("#a1", "link", "a", name="Leia mais", text="Leia mais", attrs={"href": "/noticias/a"})
    a2 = node("#a2", "link", "a", name="Leia  MAIS", text="Leia  MAIS", attrs={"href": "\nhttps://example.com/noticias/b"})
    hidden_link = node("#a3", "link", "a", name="Leia mais", text="Leia mais", attrs={"href": "/c"}, states=["hidden"])
    news = node("#news", "list", "ul", [
        node("#li1", "listitem", "li", [a1]),
        node("#li2", "listitem", "li", [a2]),
    ])
    deep = node("#deep", "link", "a", name="Fundo", text="Fundo", attrs={"href": "https://example.com/fundo"})
    nested = node("#outer-list", "list", "ul", [
        node("#outer", "listitem", "li", [
            node("#outer-label", "generic", "span", text="Externo"),
            node("#inner-list", "list", "ul", [node("#inner", "listitem", "li", [deep], text="Interno")]),
        ]),
    ])
    english = node("#en-p", "paragraph", "p", [node("#en", "link", "a", name="report", text="report", attrs={"href": "/en/report"})],
                   lang="en", text="Read the", native={"readingText": "Read the report"})
    return {
        "schemaVersion": 1,
        "target": "https://example.com/pagina/",
        "root": node("html", "document", "html", [
            node("html > body", "generic", "body", [
                node("#main", "main", "main", [
                    node("#h2", "heading", "h2", name="Notícias", text="Notícias"),
                    news,
                    hidden_link,
                    node("#banner", "img", "img", name="Banner", attrs={"src": "/img/banner.png", "alt": "Banner"}),
                    node("#pixel", "img", "img", name="Pixel", attrs={"src": "data:image/gif;base64,R0lGODlhAQABAAAAACw="}),
                    nested,
                    english,
                ]),
            ]),
        ], lang="pt-BR", attrs={"lang": "pt-BR"}),
        "destinations": {
            "/noticias/a": {"kind": "page", "status": 200, "title": "Notícia A", "heading": "A"},
            "\nhttps://example.com/noticias/b": {"kind": "page", "status": 200, "title": "Notícia B", "finalUrl": "https://example.org/b2"},
        },
    }


def self_test():
    snapshot = self_test_snapshot()
    refs = ["#a1", "#a2", "#banner", "#pixel", "#deep", "#en", "#missing"]
    block = evidence.build(snapshot, refs, rubric="three-answers-1")
    items = block["items"]

    def check(name, got, want):
        if got != want:
            raise AssertionError(f"{name}: got {got!r}, want {want!r}")
        print(f"ok  {name}")

    check("version and rubric", (block["version"], block["rubric"]), (1, "three-answers-1"))
    check("no rubric unless asked", "rubric" in evidence.build(snapshot, ["#a1"]), False)
    check("page.lang", block["page"], {"lang": "pt-BR"})
    check("refs not in the snapshot get no entry", sorted(items), sorted(r for r in refs if r != "#missing"))
    check("#a1 lang", items["#a1"]["lang"], "pt-BR")
    check("#a1 enclosing", items["#a1"]["enclosing"], {"role": "listitem", "tag": "li", "text": "Leia mais"})
    check("#a1 headingBefore", items["#a1"]["headingBefore"], {"rank": 2, "text": "Notícias", "up": 3})
    check("#a1 listItems", items["#a1"]["listItems"], [{"text": "Leia mais"}])
    check("#a1 before", items["#a1"]["before"],
          [{"up": 3, "role": "heading", "tag": "h2", "text": "Notícias", "holdsHeading": True, "holdsLink": False}])
    check("#a1 sameText (hidden link left out; NFKC, case and spaces folded)", items["#a1"]["sameText"],
          {"total": 2, "links": [{"href": "https://example.com/noticias/b", "title": "Notícia B", "finalUrl": "https://example.org/b2"}]})
    check("#a2 sameText (relative href resolved)", items["#a2"]["sameText"],
          {"total": 2, "links": [{"href": "https://example.com/noticias/a", "title": "Notícia A", "heading": "A"}]})
    check("#a2 before (the earlier list item)", items["#a2"]["before"][0],
          {"up": 2, "role": "listitem", "tag": "li", "text": "Leia mais", "holdsHeading": False, "holdsLink": True})
    check("#banner imageFile", items["#banner"].get("imageFile"), "https://example.com/img/banner.png")
    check("#banner has no sameText, enclosing or listItems", [k for k in ("sameText", "enclosing", "listItems") if k in items["#banner"]], [])
    check("#pixel: a data: address is never an imageFile", "imageFile" in items["#pixel"], False)
    check("#deep listItems (nested list left out of the outer item)", items["#deep"]["listItems"], [{"text": "Interno Fundo"}, {"text": "Externo"}])
    check("#deep has no sameText (no other link shares its text)", "sameText" in items["#deep"], False)
    check("#en lang (the paragraph's)", items["#en"]["lang"], "en")
    check("#en enclosing (the reading text, in order)", items["#en"]["enclosing"], {"role": "paragraph", "tag": "p", "text": "Read the report"})
    check("no context or capture without a screenshot", ["context" in v for v in items.values()] + ["capture" in block["page"]], [False] * 7)
    check("no forbidden key in the block", [k for _, k in evidence.keys_in(block) if k in package.FORBIDDEN_KEYS], [])
    check("the suggested-text check catches an equal text",
          blindness_of_block(block, {norm("Notícia  B"): "x/y/z"}), ["a text equals Rampa's suggested text for x/y/z"])
    check("fields_of", evidence.fields_of(block, "#a1"),
          {"page": ["lang"], "item": ["lang", "enclosing", "headingBefore", "listItems", "before", "sameText"]})
    long = node("#long-p", "paragraph", "p", [node("#x", "link", "a", name="x", text="x")], native={"readingText": "palavra " * 100})
    snap = {"target": "https://example.com/", "root": node("html", "document", "html", [long])}
    check("enclosing text bound at 300", len(evidence.build(snap, ["#x"])["items"]["#x"]["enclosing"]["text"]), 300)
    check("an empty root lang is an empty string", evidence.page_lang(snap), "")
    check("--name rule", [bool(NAME.fullmatch(n)) for n in ("pacote-v2-piloto", "pacote-30", "pacote-v2-../x", "pacote-v2-")], [True, False, False, False])

    try:
        from PIL import Image
    except ImportError:
        print("skipped: the capture checks (no Pillow)")
    else:
        data = re.compile(r"^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$")
        capture, size = evidence.page_capture(Image.new("RGB", (1280, 14000), (200, 210, 220)))
        check("a tall capture is cut", size, {"width": 640, "height": 6000, "pageWidth": 1280, "pageHeight": 14000, "cut": True})
        check("the capture is a JPEG data URL", bool(data.match(capture)), True)
        _, size = evidence.page_capture(Image.new("RGBA", (1280, 2001)))
        check("a short capture is not cut", size, {"width": 640, "height": 1000, "pageWidth": 1280, "pageHeight": 2001, "cut": False})
        _, size = evidence.page_capture(Image.new("RGB", (400, 300)))
        check("a narrow capture is not enlarged", size, {"width": 400, "height": 300, "pageWidth": 400, "pageHeight": 300, "cut": False})
        wide = Image.new("RGB", (4000, 2000), (255, 255, 255))
        wide.paste((0, 0, 0), (1280, 0, 4000, 2000))
        capture, size = evidence.page_capture(wide, evidence.viewport_pixels({"viewport": {"width": 1280, "height": 800, "scale": 1}}))
        check("a screenshot wider than the viewport keeps the viewport's width", size,
              {"width": 640, "height": 1000, "pageWidth": 4000, "pageHeight": 2000, "cut": False})
        shown = Image.open(io.BytesIO(base64.b64decode(capture.split(",", 1)[1]))).convert("L")
        check("... from the left edge (nothing right of it shows)", shown.getextrema()[0] > 200, True)
    print("self-test passed")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--select", choices=("pilot",))
    ap.add_argument("--name")
    ap.add_argument("--rubric", choices=evidence.RUBRICS)
    ap.add_argument("--recordings", default=os.environ.get("RECORDINGS", "C:/Users/guilh/dev/rampa-study-recordings"))
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.select or not args.name:
        ap.error("--select and --name are required (or --self-test)")
    build_package(args)


if __name__ == "__main__":
    main()
