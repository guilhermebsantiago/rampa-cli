# Third real-page study: pre-registration (2026-10-23)

Committed before Rampa ran on any of these pages. Only the pre-screen in headless Edge (`scripts/screen.mjs`,
`data/screen-*.json`) and the link listing used to pick inner pages (`scripts/links.mjs`) have loaded them.

**Question.** On 24 pages it has never seen, how often is a failure Rampa reports real? The code is `main` at
`d23cfb5`, unchanged. Since the second study, four changes were chosen from that study's dev pages only (1.1.1
verification facts, `rampa/link-color-only`, the text-field caret as a focus indicator, `rampa/placeholder-text`),
and none has been measured on pages it was not tuned on. The fact-backed rule for 2.4.4 and 2.4.6, designed on
the first study's dev split, was measured only on the second study's saved snapshots ("After the 2.4.4/2.4.6
change"), never on newly collected pages. Other commits since then touch `src/` too (`git log 4fd54fc..d23cfb5 -- src`).

**Pages.** `scripts/pages.tsv`: twelve strata (Brazil or international, times government, education, news,
e-commerce, health, culture or public services), a home page and an inner page each, from two sites; Portuguese
in Brazil, English elsewhere. No registrable domain of the first study, its re-measure or the second study, and
none that any file or commit message of the repository names on any branch (`data/excluded-domains.json`,
`scripts/exclusions.py`). Primaries and backups: `scripts/candidates.tsv`.

**Split.** `scripts/split.py`, seed 20261023: in each stratum a seeded coin sends the home or the inner page to
dev and the other to test, then the same generator draws the 8 pages of the probe run, two Brazilian and two
international from each half (`data/pages-input.json`).

**Method.** The second study's, with its scripts: collect each page once with no model call, save it, judge the
saved snapshot with `--model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900`, collect the
probe subset again with `--probe all`; two Claude judges per packet (an auditor and a skeptic) with the second
study's rubric and prompt. Decided before the run, the differences:

- `--concurrency 2` when judging (the second study's main run used the default, 4), since the GPU may be shared.
- The judges' packets leave out Rampa's `confidence` and `patch` for each finding (an audit named them an anchor);
  the rubric says so. The judge prompt also names the pages' reports and the recordings backup as off limits.
- `scripts/dump_fp.py` prints only counts for the test split.

**Outcomes.** Precision, TP / (TP + FP) with uncertain findings left out, with 95% Wilson intervals, for dev and
test separately, at the default threshold and with every finding counted (`--min-confidence low`): for the
judged criteria overall and per criterion, for the experimental rules and judgments, and for the probes. Final
label: the label both judges gave, else uncertain. Agreement: Cohen's kappa over the three labels.

**Comparison.** The second study's numbers after the 2.4.4/2.4.6 change, judged criteria: test 0.38 at the
default threshold and 0.38 with all findings, dev 0.49 and 0.48; and its experimental rules and probes from its
own run. Per criterion, what moved. No threshold for success is set: the numbers are reported as they come.

**Patterns.** False positives are read for patterns on the dev split only, and listed as candidates for future
fixes. On the test split they are counted, by check and cause, and not described. The test half is reported
once; no change to Rampa is to be chosen from it.
