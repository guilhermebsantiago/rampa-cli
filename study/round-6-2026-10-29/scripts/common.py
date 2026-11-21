"""Paths shared by the sixth study's Python scripts.

HERE is this study's folder (in git); DATA is the folder out of git where each page ran (recordings, screenshots, caches,
full reports and consoles), C:/Users/guilh/dev/rampa-study-recordings/round-6 unless RECORDINGS says otherwise (the run
scripts' env.sh uses the same rule).
"""
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("RECORDINGS") or "C:/Users/guilh/dev/rampa-study-recordings/round-6"


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
