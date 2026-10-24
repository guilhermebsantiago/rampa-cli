"""Print the prompt given to one judge agent for one packet: python -I judge_prompt.py <packet name> <auditor|skeptic>

The second study's judge_prompt.py; the prompt text (judge-prompt.txt) also names the recordings backup the
judges may not open.

A packet is packets/<slug>.json (the findings of the default run) or packets/<slug>--probe.json (the
findings that only the probe run has: probe findings and probe judgments).
"""

import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(HERE))
ROLES = {
    "auditor": "look at the snapshot, the screenshot and the live page as a professional WCAG auditor would, and decide whether each finding is a real failure of the criterion it names.",
    "skeptic": "look for concrete reasons each finding could be wrong (context the checker ignored, a technique that makes the element pass, a collector artefact, a stricter rule than WCAG's), and label a finding true_positive only when no such reason holds up.",
}

name, role = sys.argv[1], sys.argv[2]
with open(os.path.join(HERE, "packets", f"{name}.json"), encoding="utf-8") as f:
    packet = json.load(f)
with open(os.path.join(HERE, "scripts", "judge-prompt.txt"), encoding="utf-8") as f:
    text = f.read()
values = {
    # The Node.js the study ran with; it was not on PATH, so the judges were given its full path (NODE overrides).
    "NODE": os.environ.get("NODE") or shutil.which("node") or "/c/Users/<user>/AppData/Local/Programs/node-v24.21.0-win-x64/node.exe",
    "ROLE": role,
    "ROLE_TEXT": ROLES[role],
    "ROOT": ROOT.replace("\\", "/"),
    "NAME": name,
    "N": str(len(packet["findings"])),
    "URL": packet["page"],
    "SNAPSHOT": packet["snapshot"],
    "SCREENSHOT": packet["screenshot"],
    "COLLECTED": packet["collectedAt"],
    # Where the studies' full copies are kept, the second study's labels among them (BACKUPS overrides).
    "BACKUPS": os.environ.get("BACKUPS") or "C:/Users/guilh/dev/rampa-study-recordings",
}
if packet.get("run") == "probe":
    # Probe findings come from driving the page; a judge may drive it too, to check what the probe recorded.
    text = text.replace("\nDo not open anything else under", (
        "\nThese findings come from probes: Rampa drove the live page (Tab walks at 1280x800 and 390x844, 320 px reflow, "
        "text spacing, hover, states) and each finding's probeRecords say what it recorded. To check one, you may drive the "
        "live page yourself in headless Edge with playwright-core, which is installed in {ROOT}/node_modules (chromium.launch "
        "with channel 'msedge'); write such a script as a helper as said above, and run it with the node.exe above. "
        "The page may have changed since the probe ran.\n\nDo not open anything else under"), 1)
for key, value in values.items():
    text = text.replace("{" + key + "}", value)
sys.stdout.reconfigure(encoding="utf-8")
print(text)
