"""Redact client addresses and tokens from a screen file before it is kept.

The screen writes its raw file outside the repository; this writes the copy git keeps. In every string it replaces
IPv4 and IPv6 addresses with "[redacted]"; and a final address on another registrable domain than the candidate's,
or on a page that showed a challenge, loses its query string and fragment (a bot check's redirect carries tokens and
the client's address there, as camicado.com.br's did in the fifth study). It prints what it changed, without the values.

  python -I redact.py <public_suffix_list.dat> <raw screen.json> <kept screen.json>
"""

import json
import os
import re
import sys
from urllib.parse import urlsplit, urlunsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exclusions import PSL  # noqa: E402

IPV4 = re.compile(r"(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])")
IPV6 = re.compile(r"(?<![0-9a-f:])(?:[0-9a-f]{1,4}:){2,7}(?::|[0-9a-f]{1,4})(?![0-9a-f:])", re.I)


def scrub(value, counts, field):
    if isinstance(value, str):
        out = IPV4.sub("[redacted]", value)
        out = IPV6.sub(lambda m: "[redacted]" if sum(c.isdigit() for c in m.group(0)) and m.group(0).count(":") >= 3 else m.group(0), out)
        if out != value:
            counts[field] = counts.get(field, 0) + 1
        return out
    if isinstance(value, list):
        return [scrub(v, counts, field) for v in value]
    if isinstance(value, dict):
        return {k: scrub(v, counts, k) for k, v in value.items()}
    return value


def main():
    psl = PSL(sys.argv[1])
    rows = json.load(open(sys.argv[2], encoding="utf-8"))
    counts = {}
    stripped = []
    for row in rows:
        final = row.get("finalUrl")
        if final:
            own = psl.registrable(urlsplit(row["url"]).hostname or "")
            parts = urlsplit(final)
            there = psl.registrable(parts.hostname or "")
            if (there != own or row.get("challenge")) and (parts.query or parts.fragment):
                row["finalUrl"] = urlunsplit((parts.scheme, parts.netloc, parts.path, "[redacted]" if parts.query else "", ""))
                stripped.append(row["slot"])
    rows = scrub(rows, counts, "")
    with open(sys.argv[3], "w", encoding="utf-8", newline="\n") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{len(rows)} rows; addresses redacted in fields {counts or 'none'}; query strings removed for {stripped or 'none'}")


if __name__ == "__main__":
    main()
