"""Print the prompt given to one judge agent for one packet: python -I judge_prompt.py <packet name> <auditor|skeptic>

The fifth study's judge_prompt.py with this round's folder and rubric (judge-rubric.md: three answers per finding, and a
label that follows from them), and without the probe paragraph, since no run of this round drives the page.

Not ready to give to a judge yet: this round's packets/ do not exist (packets.py is still to be adapted from the fifth
study's), and neither does the crop script the prompt names, scripts/crop.mjs (the fifth study's, still to be copied
here).

python -I judge_prompt.py --self-test renders the prompt for a made-up packet held in memory, for both roles, and checks
that every {PLACEHOLDER} was replaced and that the three answer names and their values are in the text.
"""

import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(HERE))
ROLES = {
    "auditor": "look at the snapshot, the screenshot and the live page as a professional WCAG auditor would, give each finding the rubric's three answers, and label it by the rubric's rule.",
    "skeptic": "look for concrete reasons each finding could be wrong (context the checker ignored, a technique that makes the element pass, a capture that differs from the page users receive, a collector artefact, a stricter rule than WCAG's), and label a finding true_positive only when no such reason holds up.",
}
# The rubric's three answers and their values (judge-rubric.md); the Lab and the analysis use the same names.
ANSWERS = ("claimTrue", "elementFails", "captureDiffers")
VALUES = ("yes", "no", "cannot_tell")


def render(name, role, packet):
    with open(os.path.join(HERE, "scripts", "judge-prompt.txt"), encoding="utf-8") as f:
        text = f.read()
    values = {
        # The Node.js the study runs with; it is not on PATH, so the judges are given its full path (NODE overrides).
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
        # Where the studies' full copies are kept, the earlier studies' labels among them (BACKUPS overrides).
        "BACKUPS": os.environ.get("BACKUPS") or "C:/Users/guilh/dev/rampa-study-recordings",
    }
    for key, value in values.items():
        text = text.replace("{" + key + "}", value)
    return text


def self_test():
    # A made-up packet: no page, finding or label of any study.
    packet = {
        "page": "https://example.org/timetable",
        "slug": "example-org-timetable",
        "run": "default",
        "snapshot": "pages/example-org-timetable/snapshot.json",
        "screenshot": "pages/example-org-timetable/main-screenshot.png",
        "collectedAt": "2026-11-01T12:00:00.000Z",
        "findings": [{"key": "made-up-1"}, {"key": "made-up-2"}],
    }
    problems = []
    for role in ROLES:
        text = render(packet["slug"], role, packet)
        left = sorted(set(re.findall(r"\{[A-Z_]+\}", text)))
        if left:
            problems.append(f"{role}: placeholders not replaced: {', '.join(left)}")
        problems += [f"{role}: the answer name {a} is not in the prompt" for a in ANSWERS if a not in text]
        problems += [f'{role}: the value "{v}" is not in the prompt' for v in VALUES if f'"{v}"' not in text]
        rubric = f"{ROOT}/study/{os.path.basename(HERE)}/judge-rubric.md".replace("\\", "/")
        if rubric not in text or not os.path.isfile(rubric):
            problems.append(f"{role}: the prompt does not name this round's rubric, or {rubric} does not exist")
    if problems:
        print("self-test failed:", *problems, sep="\n  ", file=sys.stderr)
        sys.exit(1)
    print(f"self-test passed: both roles rendered, no placeholder left, {', '.join(ANSWERS)} and {', '.join(VALUES)} in the text")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return
    if len(sys.argv) != 3 or sys.argv[2] not in ROLES:
        sys.exit("usage: python -I judge_prompt.py <packet name> <auditor|skeptic>, or --self-test")
    name, role = sys.argv[1], sys.argv[2]
    with open(os.path.join(HERE, "packets", f"{name}.json"), encoding="utf-8") as f:
        packet = json.load(f)
    print(render(name, role, packet))


if __name__ == "__main__":
    main()
