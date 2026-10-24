# Fourth real-page study: pre-registration (2026-10-24)

Committed before Rampa ran on any of these pages. Only the pre-screen in headless Edge (`scripts/screen.mjs`,
`data/screen-*.json`) and the link listing used to pick inner pages (`scripts/links.mjs`) have loaded them.

**Question.** On 24 pages none of it has seen, does the precision work merged into `main` today raise the precision
of what `rampa check` reports? The code is `main` at `6e0947a`, frozen: over `d23cfb5`, the code of the third study,
it adds the robustness fixes (bot walls, crashes, load handling), version 5 of 1.1.1 and narrower 2.4.4 facts, and
the precision probe's rules (docs/studies/notes-precision-probe.md, section 8): the capture guards
(`reach.stylesheets`, `reach.overlay`), claims moved to suggestions (a 2.4.6 label several fields share, a 3.3.2
claim on a collapsed or search field, a 2.4.4 address in a sentence), three small 1.1.1 facts, the 1.1.1 second
pass (`src/core/confirm.ts`: three one-word framings, a finding only when all three confirm and the lowest
probability of a confirming word is at least 0.9; `--no-confirm` turns it off), and destination reads through
undici 8 with per-origin pacing. Every number those notes give is in-sample; this study is the held-out measure.

**Pages.** `scripts/pages.tsv`: the third study's design, twelve strata (Brazil or international, times
government, education, news, e-commerce, health, culture or public services), a home page and an inner page each,
from two sites; Portuguese in Brazil, English elsewhere. No registrable domain of the first, second or third study,
the re-measure or the robustness study's 53 sites, and none that any file or commit message of the repository names
on any of its 8 branches (2,111 domains, the benchmark's among them; `data/excluded-domains.json`,
`scripts/exclusions.py`, Public Suffix List). Primaries and backups: `scripts/candidates.tsv`. Three primaries were
replaced at the screen (ufrj.br served its English site, bristol.ac.uk answered "Content blocked", ryman.co.uk and
hobbycraft.co.uk showed a challenge).

**Split.** `scripts/split.py`, seed 20261024: in each stratum a seeded coin sends the home or the inner page to dev
and the other to test (`data/pages-input.json`). No probe subset is drawn.

## Method

The third study's, with its scripts, rubric and judge prompt (including its one-line reply), except as listed here.

- **Collection, no model call.** `bash scripts/collect.sh main`: `rampa check <url> --model ollama:gemma4:12b
  --offline --locale en --min-confidence low --save <dir> --screenshots`, Edge through playwright-core, the build
  of `6e0947a` (`pnpm install --frozen-lockfile`, `pnpm build`).
- **Judgment.** `bash scripts/run-judged.sh default`: `rampa check <snapshot> --model ollama:gemma4:12b --locale en
  --min-confidence low --time-limit 900 --concurrency 2`, the second pass on (the default). Gemma 4 12B
  (`gemma4:12b`, digest `6114515d63c1`) on Ollama at http://127.0.0.1:11434.
- **The ablation.** `bash scripts/run-noconfirm.sh`: each snapshot judged again with the same flags plus `--offline
  --no-confirm`, from a fresh copy of the page's cache of the main run, so every first-pass answer is the same and
  only the second pass differs.
- **No probe run.** The merged work does not change the probes, and with at most two judge agents at a time the
  labelling goes to the judged criteria, the ablation and the suggestion sample. This is a difference from the third
  study, decided here.
- **Labels.** One packet per page (`scripts/packets.py`) holding, in a seeded shuffled order and in the same form,
  so that a judge cannot tell them apart: every judgment and rule finding of the main run at any confidence (as in
  the third study), every finding of the ablation that the main run does not have (the 1.1.1 claims the second pass
  denied or could not ask), and the page's drawn suggestions. Packets hold no `confidence` or `patch`, and a drawn
  suggestion holds no quote. Two Claude judges per packet, an auditor and a skeptic, with the third study's rubric and
  prompt (`scripts/judge_prompt.py`); at most two judge agents run at a time. A judge that stops before writing a
  complete label file is launched again from scratch with the same prompt, and a partial file is not kept. Final
  label: the label both gave, else `uncertain`; precision is TP / (TP + FP), uncertain left out, with 95% Wilson
  intervals; Cohen's kappa over the three labels.

## Primary measure

**Test-split precision at the default threshold over the judged criteria** (judgment findings of the eight default
criteria that are not experimental and have medium confidence or above: what `rampa check` shows and fails on),
from the main run, with its 95% Wilson interval.

**Comparison.** With the third study's test split, 0.24 (24 of 99, 0.17–0.34), and the second study's after the
2.4.4/2.4.6 change, 0.38 (12 of 32, 0.23–0.55). For each, the difference and its 95% interval by Newcombe's hybrid
score method (method 10, from the two Wilson intervals). The reading is fixed now: precision **went up** against a
reference when the difference's interval lies above 0, **went down** when it lies below, and otherwise shows **no
measurable change**. The notes' in-sample estimates, for reference only: 0.30 on the third study's test split (0.77
without ufpe.br), 0.77 on the second study's, 0.84 pooled on the findings the recordings could replay.

## Secondary measures

1. Dev-split precision at the default threshold, and both splits with every finding counted (`--min-confidence low`).
2. Precision per criterion, per split and threshold.
3. **The ablation:** the same measures for the `--no-confirm` run (the main run's findings plus the ablation-only
   ones), and the second pass's effect: the claims it denied or could not ask, their labels (true positives it moved
   to review, false positives it removed), and the precision difference between the two runs.
4. **The second pass's shares:** of the 1.1.1 reading claims (verified fails on which it runs), the share confirmed,
   denied, and not asked (no one-word answer, an offline miss, an error), per split, from the reports.
5. **Capture state of every page:** `reach.stylesheets` (linked, applied, failed, retried, unstyled), `reach.overlay`
   (selector, coverage, hidden), a load that timed out and a page cut at the element limit, from the snapshots; and
   whether the unstyled retry fired (`stylesheets.retried`).
6. **The 0.99 cut:** precision at the default threshold if the 1.1.1 findings whose lowest confirming probability is
   under 0.99 were left out, and the labels of the findings that cut would remove.
7. **Suggestion sample** (`scripts/sample_suggestions.py`): of the main run's suggestions (needsReview items that name
   a model) other than those the ablation labels in full, 20 per split, drawn with `random.Random(20261024)` after a
   fixed ordering, at most 3 from any one page (fewer if the pool is smaller). Reported: the share of true failures
   with its Wilson interval per split and pooled, and that share times the number of suggestions, as the true
   failures moved to review.
8. **Sensitivity:** each split without its page with the most default-threshold judged findings; uncertain counted as
   true and as false; and for the primary measure a page-level bootstrap (10,000 resamples of the 12 test pages with
   replacement, `random.Random(20261024)`, 2.5th and 97.5th percentiles), since findings cluster on pages.
9. Experimental rules (all below the threshold) per check, as in the third study; agreement between the judges.

## Rules fixed now

- **Network drops.** An attempt that fails with a network error (`net::ERR_*`, a DNS failure), or whose log shows
  one, does not count. It is tried again once the connection answers, up to three more times.
- **Refusals.** A bot challenge, an HTTP 403, 429 or 503 page, a rate-limit or sign-in page, or a crash that saves no
  snapshot: wait at least 10 minutes and try once more. Refused again, the page is replaced by its slot's next backup
  in `scripts/candidates.tsv` that passes the screen, keeping the slot's split; for an inner slot the backup site's
  inner page is picked by the slot's rule (the first article, the first category of the menu, an admissions or study
  page, a contact page) before Rampa runs on it. Every attempt is logged and set aside in `pages/<slug>/discarded-*`.
- **An unstyled capture is not a refusal**: a page whose snapshot says `reach.stylesheets.unstyled` stays, and is
  reported; that is what the guard is for.
- **Once.** Each page is collected and judged once; nothing is collected or judged again because of what Rampa
  found. `src/` is not changed. A script is changed after this commit only to fix a bug that stops it, and the change
  is logged.
- **Reading.** The test split's false positives are counted by check and cause, never read for patterns; the dev
  split's are described as candidates for future fixes. The test numbers are reported once.
