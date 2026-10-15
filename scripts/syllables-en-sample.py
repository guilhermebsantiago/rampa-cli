"""Builds test/fixtures/coga/syllables-en.json: English words with their syllable count from CMUdict.

Rampa counts English syllables with a heuristic (src/text/syllables.ts, syllablesEn), not with a
pronouncing dictionary. This sample measures how often the heuristic agrees with one: a test reads it
(test/advisory-unit.test.ts), and docs/cognitive-profile.md reports the agreement.

Words: every STEP-th word of src/rules/words/en.ts, the 20,000 most frequent English forms of 4 to 15
letters in Tatoeba's sentences (see NOTICE). Words of one to three letters are left out: the heuristic
counts them as one syllable, and most are.

Counts: the Carnegie Mellon University Pronouncing Dictionary (CMUdict), https://github.com/cmusphinx/cmudict,
at a pinned commit and SHA-256. A word's count is the number of vowel phonemes (those with a stress
digit) in its pronunciation. A word with pronunciations of different counts (every: EH1 V ER0 IY0 and
EH1 V R IY0) is left out, and so is a word CMUdict does not list. CMUdict is under a BSD-style license,
copied into the fixture.

Usage (Python 3, standard library only):
    python -I scripts/syllables-en-sample.py <download dir>
The download dir keeps cmudict.dict between runs; run it from the repository root.
"""

import hashlib
import json
import os
import re
import sys
import urllib.request

COMMIT = '74790861f652b15e4ac49015a90074ad62a27690'
DICT_URL = f'https://raw.githubusercontent.com/cmusphinx/cmudict/{COMMIT}/cmudict.dict'
DICT_SHA256 = '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22'
LICENSE_URL = f'https://raw.githubusercontent.com/cmusphinx/cmudict/{COMMIT}/LICENSE'
WORDS = 'src/rules/words/en.ts'
OUTPUT = 'test/fixtures/coga/syllables-en.json'
STEP = 20


def download(url, path):
    if not os.path.exists(path):
        with urllib.request.urlopen(url) as response, open(path, 'wb') as out:
            out.write(response.read())
    with open(path, 'rb') as file:
        return file.read()


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    folder = sys.argv[1]
    os.makedirs(folder, exist_ok=True)
    data = download(DICT_URL, os.path.join(folder, f'cmudict-{COMMIT[:12]}.dict'))
    digest = hashlib.sha256(data).hexdigest()
    if digest != DICT_SHA256:
        sys.exit(f'cmudict.dict has SHA-256 {digest}, expected {DICT_SHA256}')
    license_text = download(LICENSE_URL, os.path.join(folder, f'cmudict-{COMMIT[:12]}.LICENSE')).decode('utf-8')

    counts = {}
    for line in data.decode('utf-8').splitlines():
        line = line.split('#')[0].strip()
        if not line:
            continue
        head, *phones = line.split()
        word = re.sub(r'\(\d+\)$', '', head)
        counts.setdefault(word, set()).add(sum(1 for phone in phones if phone[-1].isdigit()))

    with open(WORDS, encoding='utf-8') as file:
        listed = [word for word in file.read().split('`')[1].split('\n') if word]
    sample = listed[STEP // 2 :: STEP]
    words = {}
    ambiguous = []
    missing = []
    for word in sample:
        found = counts.get(word)
        if found is None:
            missing.append(word)
        elif len(found) > 1:
            ambiguous.append(word)
        else:
            words[word] = next(iter(found))

    header = {
        'source': (
            f'Syllable counts from the CMU Pronouncing Dictionary (CMUdict), {DICT_URL} '
            f'(SHA-256 {DICT_SHA256}): the number of vowel phonemes, those with a stress digit.'
        ),
        'selection': (
            f'Every {STEP}th word of {WORDS} (Tatoeba, see NOTICE), starting at the {STEP // 2 + 1}th: '
            f'{len(sample)} words, of which {len(words)} have one count in CMUdict. '
            f'Left out: {len(ambiguous)} with pronunciations of different counts, {len(missing)} not in CMUdict. '
            'Built by scripts/syllables-en-sample.py.'
        ),
        'license': license_text.strip().split('\n'),
        'ambiguous': ambiguous,
        'missing': missing,
    }
    # Ten words a line, as in syllables-pt.json.
    pairs = [f'{json.dumps(word)}: {count}' for word, count in words.items()]
    rows = [', '.join(pairs[start : start + 10]) for start in range(0, len(pairs), 10)]
    lines = ['{'] + [f'  {json.dumps(key)}: {json.dumps(value, ensure_ascii=False)},' for key, value in header.items()]
    lines += ['  "words": {', ',\n'.join(f'    {row}' for row in rows), '  }', '}']
    with open(OUTPUT, 'w', encoding='utf-8', newline='\n') as out:
        out.write('\n'.join(lines) + '\n')
    print(f'{OUTPUT}: {len(words)} words ({len(ambiguous)} ambiguous and {len(missing)} missing left out)')


if __name__ == '__main__':
    main()
