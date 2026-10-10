"""Print the prompt given to one judge agent for one page: python -I judge_prompt.py <slug> <auditor|skeptic>"""

import json
import os
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
# A packet named <slug>--claim-changed holds the matched findings whose claim changed; its labels go to a file of its own.
text = text.replace("packets/{SLUG}.json", "packets/{NAME}.json").replace("labels/{SLUG}.{ROLE}.json", "labels/{NAME}.{ROLE}.json")
values = {
    "ROLE": role,
    "ROLE_TEXT": ROLES[role],
    "ROOT": ROOT.replace("\\", "/"),
    "NAME": name,
    "SLUG": packet["slug"],
    "N": str(len(packet["findings"])),
    "URL": packet["page"],
    "SNAPSHOT": packet["snapshot"],
    "COLLECTED": packet["collectedAt"],
}
for key, value in values.items():
    text = text.replace("{" + key + "}", value)
sys.stdout.reconfigure(encoding="utf-8")
print(text)
