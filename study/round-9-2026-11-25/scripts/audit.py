"""The recall audit of the ninth real-page study (pre-registration, section 6): its packets and prompts, and the check of
the auditors' files.

  python -I audit.py packets     builds audit-packets/<slug>.json for the six audited test pages (data/pages-input.json,
                                 "audit": true): the page, its snapshot and screenshot (copied to audit-packets/<slug>/,
                                 out of git) and every image of the snapshot with its crop when the snapshot holds one; no
                                 Rampa finding, suggestion or report is in a packet. Then writes one prompt per page from
                                 scripts/audit-prompt.txt to audit-prompts/<slug>.recall-auditor.txt and an index,
                                 audit-prompts/index.json, in the judge prompts' format (entries {file, packet, role,
                                 output}), largest snapshots first.
  python -I audit.py check       checks every audits/<slug>.audit.json: it parses, names the page and the labeler, names the
                                 eight criteria in "checked", gives every failure its six fields, a criterion of the eight,
                                 a ref that is in the snapshot ("page" allowed for 2.4.2 and 3.1.1) and a certainty
                                 ("clear" or "borderline"). Prints counts and problems, no failure.
  python -I audit.py --self-test renders the prompt for a made-up page and checks that no placeholder is left.
"""
import base64
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DEFAULT_CRITERIA, HERE, page_dir, pages, read_json, snapshot_file, write_json  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
ROLE = "recall-auditor"
CERTAINTY = ("clear", "borderline")
FIELDS = ("id", "criterion", "ref", "description", "evidence", "certainty")
PAGE_LEVEL = ("2.4.2", "3.1.1")


def walk(node):
    yield node
    for child in node.get("children", []):
        yield from walk(child)


def render(name, packet):
    with open(os.path.join(HERE, "scripts", "audit-prompt.txt"), encoding="utf-8") as f:
        text = f.read()
    values = {
        "NODE": os.environ.get("NODE") or shutil.which("node") or "/c/Users/<user>/AppData/Local/Programs/node-v24.21.0-win-x64/node.exe",
        "ROOT": ROOT.replace("\\", "/"),
        "NAME": name,
        "URL": packet["page"],
        "COLLECTED": packet["collectedAt"],
        "BACKUPS": os.environ.get("BACKUPS") or "C:/Users/guilh/dev/rampa-study-recordings",
    }
    for key, value in values.items():
        text = text.replace("{" + key + "}", value)
    left = sorted(set(re.findall(r"\{[A-Z_]+\}", text)))
    if left:
        sys.exit(f"{name}: placeholders not replaced: {', '.join(left)}")
    return text


def build():
    out_dir = os.path.join(HERE, "audit-prompts")
    os.makedirs(out_dir, exist_ok=True)
    entries = []
    for meta in pages():
        if not meta.get("audit"):
            continue
        slug = meta["slug"]
        base = page_dir(slug)
        snap_path = snapshot_file(os.path.join(base, "recording"))
        if not snap_path:
            print(f"{slug}: no snapshot")
            continue
        snap = read_json(snap_path)
        folder = os.path.join(HERE, "audit-packets", slug)
        if os.path.isdir(folder):
            shutil.rmtree(folder)
        os.makedirs(folder)
        shutil.copyfile(snap_path, os.path.join(folder, "snapshot.json"))
        shot = os.path.join(base, "main-screenshot.png")
        if os.path.exists(shot):
            shutil.copyfile(shot, os.path.join(folder, "screenshot.png"))
        images, counts = [], {"nodes": 0, "links": 0, "images": 0, "formFields": 0, "headings": 0}
        for n in walk(snap["root"]):
            counts["nodes"] += 1
            native = n.get("native") or {}
            tag, role = native.get("tag"), n.get("role")
            counts["links"] += role == "link"
            counts["headings"] += role == "heading"
            counts["formFields"] += tag in ("input", "select", "textarea") and (native.get("attributes") or {}).get("type") != "hidden"
            if role in ("img", "image", "graphics-document") or tag in ("img", "svg", "canvas", "picture") or n.get("image"):
                counts["images"] += 1
                row = {"ref": n["ref"], "role": role, "tag": tag, "name": n.get("name"),
                       "alt": (native.get("attributes") or {}).get("alt"), "bounds": n.get("bounds")}
                image = n.get("image")
                if image and image.startswith("data:image/"):
                    ext = image.split(";", 1)[0].split("/", 1)[1]
                    path = os.path.join(folder, f"img-{len(images) + 1}.{ext}")
                    with open(path, "wb") as f:
                        f.write(base64.b64decode(image.split(",", 1)[1]))
                    row["crop"] = os.path.relpath(path, HERE).replace("\\", "/")
                else:
                    row["crop"] = None
                    row["note"] = native.get("imageSkipped") or "no crop in the snapshot: look at its bounds in the screenshot"
                images.append(row)
        packet = {"page": meta["url"], "slug": slug, "title": snap.get("title"), "language": snap.get("locale"),
                  "snapshot": f"audit-packets/{slug}/snapshot.json", "screenshot": f"audit-packets/{slug}/screenshot.png",
                  "collectedAt": snap.get("collectedAt"), "counts": counts, "images": images,
                  "note": ("Audit the captured document. Every image of the snapshot is listed with its crop when the snapshot "
                           "holds one; the rest are in the screenshot at their bounds (CSS pixels, 1280 px wide).")}
        write_json(os.path.join(HERE, "audit-packets", f"{slug}.json"), packet)
        text = render(slug, packet)
        path = os.path.join(out_dir, f"{slug}.{ROLE}.txt")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text if text.endswith("\n") else text + "\n")
        entries.append({"file": f"audit-prompts/{slug}.{ROLE}.txt", "packet": slug, "role": ROLE, "nodes": counts["nodes"],
                        "output": f"audits/{slug}.audit.json"})
    entries.sort(key=lambda e: (-e["nodes"], e["packet"]))
    write_json(os.path.join(out_dir, "index.json"), {
        "note": ("One prompt per recall-auditor agent (one per audited test page), largest snapshots first. Paths are relative to "
                 "this study's folder. Launch each agent with its prompt file's text; the auditor is a separate agent from the judges."),
        "prompts": len(entries), "entries": entries})
    print(f"{len(entries)} audit packets and prompts; audit-prompts/index.json written")


def check():
    problems, total = 0, 0
    for meta in pages():
        if not meta.get("audit"):
            continue
        slug = meta["slug"]
        path = os.path.join(HERE, "audits", f"{slug}.audit.json")
        if not os.path.exists(path):
            print(f"{slug:40} missing")
            continue
        try:
            d = read_json(path)
        except ValueError as error:
            print(f"{slug:40} not JSON ({error})")
            problems += 1
            continue
        snap = read_json(os.path.join(HERE, "audit-packets", slug, "snapshot.json")) if os.path.exists(os.path.join(HERE, "audit-packets", slug, "snapshot.json")) \
            else read_json(snapshot_file(os.path.join(page_dir(slug), "recording")))
        refs = {n["ref"] for n in walk(snap["root"])}
        bad = []
        if d.get("page") != meta["url"]:
            bad.append("page differs")
        if d.get("labeler") != ROLE:
            bad.append("labeler differs")
        if sorted((d.get("checked") or {}).keys()) != sorted(DEFAULT_CRITERIA):
            bad.append("checked does not name the eight criteria")
        ids = set()
        failures = d.get("failures")
        if not isinstance(failures, list):
            bad.append("no failures list")
            failures = []
        for f in failures:
            if any(k not in f for k in FIELDS):
                bad.append(f"failure {f.get('id')}: missing fields")
                continue
            if f["id"] in ids:
                bad.append(f"failure {f['id']}: id twice")
            ids.add(f["id"])
            if f["criterion"] not in DEFAULT_CRITERIA:
                bad.append(f"failure {f['id']}: criterion {f['criterion']}")
            if f["certainty"] not in CERTAINTY:
                bad.append(f"failure {f['id']}: certainty")
            if f["ref"] not in refs and not (f["ref"] == "page" and f["criterion"] in PAGE_LEVEL):
                bad.append(f"failure {f['id']}: ref not in the snapshot")
        total += len(failures)
        problems += bool(bad)
        print(f"{slug:40} {len(failures):4} failures  {'ok' if not bad else '; '.join(bad[:4]) + (f' (+{len(bad) - 4})' if len(bad) > 4 else '')}")
    print("audited failures:", total, " problems:", problems)


def self_test():
    packet = {"page": "https://example.org/", "collectedAt": "2026-11-01T12:00:00.000Z"}
    text = render("example-org", packet)
    assert "{" + "URL}" not in text and "example-org" in text and "recall-auditor" in text
    for c in DEFAULT_CRITERIA:
        assert c in text, c
    print("self-test passed: no placeholder left, the eight criteria and the output format are in the prompt")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    arg = sys.argv[1:] or ["check"]
    {"packets": build, "check": check, "--self-test": self_test}[arg[0]]()
