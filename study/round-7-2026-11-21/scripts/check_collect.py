"""Sanity check of the collection, per page: the snapshot's size and title, whether it was truncated, the destinations
read, and how many candidates each judged criterion found, from the no-model collection report. These are capture notes
and counts, the only things of the pages the person running the study reads before the counts are reported.

Run: python -I study/round-7-2026-11-21/scripts/check_collect.py [main|fast]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import page_dir, pages, read_json, snapshot_file  # noqa: E402

mode = sys.argv[1] if len(sys.argv) > 1 else "main"
rec = "fast-recording" if mode == "fast" else "recording"
sys.stdout.reconfigure(encoding="utf-8")
missing = 0
for page in pages():
    if mode == "fast" and not page["t4Subset"]:
        continue
    base = page_dir(page["slug"])
    snap_path = snapshot_file(os.path.join(base, rec))
    if not snap_path:
        print(f"{page['split']:4} {page['slug'][:40]:40} no snapshot")
        missing += 1
        continue
    snap = read_json(snap_path)
    count, stack = 0, [snap["root"]]
    while stack:
        node = stack.pop()
        count += 1
        stack.extend(node.get("children", []))
    report_path = os.path.join(base, f"{mode}-collect.json")
    cands, capture = {}, {}
    if os.path.exists(report_path):
        report = read_json(report_path)
        cands = {c["criterion"]: c["candidates"] for c in report.get("criteria") or []}
        capture = report.get("capture") or {}
    title = (snap.get("title") or "")[:40]
    notes = [k for k in ("blocked", "httpStatus", "cut", "loadTimedOutMs") if capture.get(k)]
    flags = ("UNSTYLED " if capture.get("styled") is False else "") + " ".join(f"{k}={capture[k]}" for k in notes)
    print(f"{page['split']:4} {page['slug'][:40]:40} nodes {count:5} dest {len(snap.get('destinations') or {}):3} {title!r:44} {flags} {cands}")
print("pages without a snapshot:", missing)
