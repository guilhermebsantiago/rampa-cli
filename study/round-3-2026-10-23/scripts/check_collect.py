"""Sanity check of the collection: for each page, the snapshot's size, title and the candidates each judged
criterion found, from the no-model collection report. Run: python -I study/round-3-2026-10-23/scripts/check_collect.py [probe]"""

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mode = sys.argv[1] if len(sys.argv) > 1 else "main"
rec = "probe-recording" if mode == "probe" else "recording"
meta = json.load(open(os.path.join(HERE, "data", "pages-input.json"), encoding="utf-8"))
sys.stdout.reconfigure(encoding="utf-8")
for page in meta["pages"]:
    base = os.path.join(HERE, "pages", page["slug"])
    snaps = glob.glob(os.path.join(base, rec, "*.snapshot.json"))
    if not snaps:
        print(f"{page['slug'][:44]:44} no snapshot")
        continue
    snap = json.load(open(snaps[0], encoding="utf-8"))
    count = 0
    stack = [snap["root"]]
    while stack:
        node = stack.pop()
        count += 1
        stack.extend(node.get("children", []))
    report = json.load(open(os.path.join(base, f"{mode}-collect.json"), encoding="utf-8"))
    cands = {c["criterion"]: c["candidates"] for c in report["criteria"]}
    probes = len((snap.get("observations") or {}).get("probes") or [])
    print(f"{page['split']:4} {page['slug'][:44]:44} {'TRUNC ' if snap.get('truncated') else ''}nodes {count:5} dest {len(snap.get('destinations') or {}):3} probes {probes:2} {(snap.get('title') or '')[:36]!r:40} {cands}")
