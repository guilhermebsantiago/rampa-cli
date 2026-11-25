"""Paths shared by the ninth study's Python scripts (the eighth study's common.py with this study's folder).

HERE is this study's folder (in git); DATA is the folder out of git where each page ran (recordings, screenshots, caches,
full reports and consoles), C:/Users/guilh/dev/rampa-study-recordings/round-9 unless RECORDINGS says otherwise (the run
scripts' env.sh uses the same rule).
"""
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("RECORDINGS") or "C:/Users/guilh/dev/rampa-study-recordings/round-9"
DEFAULT_CRITERIA = ("1.1.1", "1.3.5", "2.4.2", "2.4.4", "2.4.6", "3.1.1", "3.1.2", "3.3.2")
LEVELS = {"low": 0, "medium": 1, "high": 2}


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data, indent=2):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
        f.write("\n")


def pages():
    return read_json(os.path.join(HERE, "data", "pages-input.json"))["pages"]


def page_dir(slug):
    return os.path.join(DATA, "pages", slug)


def snapshot_file(directory):
    if not os.path.isdir(directory):
        return None
    return next((os.path.join(directory, n) for n in sorted(os.listdir(directory)) if n.endswith(".snapshot.json")), None)


def shown_by_default(f):
    """What `rampa check` shows at its default threshold: medium confidence or above, and not from an experimental check."""
    return LEVELS.get(f.get("confidence"), 0) >= LEVELS["medium"] and not f.get("experimental")


def primary_judged(f):
    """A finding of the primary population (pre-registration, section 4): a judgment finding of the eight default criteria,
    not experimental (nor a hidden-image subject, which Rampa marks experimental in its text), at medium confidence or above."""
    return (f.get("source") == "judgment" and f.get("criterion") in DEFAULT_CRITERIA and not f.get("experimental")
            and not (f.get("subject") or "").startswith("hidden ") and LEVELS.get(f.get("confidence"), 0) >= LEVELS["medium"])
