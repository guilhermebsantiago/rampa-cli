# Seventh real-page study: pre-registration (2026-11-21)

Committed before Rampa ran on any of these pages. The freeze is a **local** commit on the branch `study/round-7-run`; it
was **not pushed** (the author's rule of 2026-11-21: nothing goes to `main` until the tool improves), so its timestamp is
local only. Its commit SHA and the SHA-256 of this file and of `judge-rubric.md` are in `run-log-notes.txt`. Only the
pre-screen in headless Edge (`scripts/screen.mjs`) and the link listing used to pick inner pages (`scripts/links.mjs`)
have loaded these pages. Nothing here changes after the freeze.

**Question.** The sixth study measured rampa-cli 0.1.2 on 36 held-out test pages: 0.61 (60 true, 39 false, 44
uncertain; Wilson 0.51–0.70), inconclusive by the thesis article's rule. Seven precision fixes were then written from its
test half (in-sample: an offline replay removes the fact behind 16 of its 39 false findings and no true one). This round
asks the article's P2 again on 60 pages none of that code has seen: how often is what `rampa check --wcag 2.1` reports,
by the judgment layer at the default threshold, a real failure? Beside it: true findings axe-core does not report,
verdict stability over five uncached runs, time per page with a local model, and recall among judged candidates for
1.1.1 and 2.4.4.

**Whose labels.** **AI-judged.** The reference is the final label of two Claude judge agents (an auditor and a skeptic),
as in rounds 3 to 6. No person labels any item of this round (the author's decision). The blind human review of rounds
3 to 5 is reported beside the result, as in the sixth study; no number of it is in this file.

## 1. Code, frozen

**`385fe13`**, the head of the local branch `fix/round-6` ("changelog: the sixth study's precision fixes, under
Unreleased"): rampa-cli 0.1.2 (`df32363`) plus seven commits. It is not the published 0.1.2: `node dist/cli.mjs
--version` still prints `0.1.2`, because the version was not bumped. Built in the worktree of this branch with `pnpm
install --frozen-lockfile` and `pnpm build`; `git diff 385fe13 HEAD -- src` is empty at the freeze, and the SHA-256 of
every file of `dist/` is in `data/build.json`; the run scripts stop unless `--version` prints `0.1.2` and `dist/` matches
`data/build.json` (`scripts/env.sh`). Node 24.21.0, Edge 157.0.4341.60, Ollama 0.40.3, `gemma4:12b` (Q4_K_M) digest
`6114515d63c17436a7c0417d82820ac65ad643e2806c5a3c89cb62846436ed0b`; no other model is installed or used.

The seven fixes (CHANGELOG, Unreleased), on top of every rule the sixth study's pre-registration lists for 0.1.2:

| Commit | Change | Where |
| --- | --- | --- |
| `b08e8e8` | 2.4.4: an address fragment of parameters (`#intid=…`) makes no other place | `link-purpose.ts` |
| `d2faabf` | 2.4.4: a link's `title` tells links that share a text apart (H33) | `link-purpose.ts` |
| `3269686` | 2.4.4: a heading that holds the link, a `div` of up to 500 characters with words of its own, and the line of a block split by `<br>` (recorded by the collector) are context | `link-purpose.ts`, `in-page.ts` |
| `e8e1e2b` | 1.1.1: a claim that reads the picture of the only image of a link or button with its own `aria-label` is a suggestion | `non-text-content.ts` |
| `542a55f` | 3.1.2: text that is `aria-hidden` and out of sight has no language | `language-of-parts.ts`, `in-page.ts` |
| `faf1344` | 2.4.4: links that share a text and lead to different addresses have their destinations read first, whole groups, in half of the 40-address budget | `destinations.ts`, `link-purpose.ts` |
| `c35714f` | 1.1.1: no crop of an image covered at its centre or near a corner by another layer, nor of a `role="img"` whose `img` never loads | `image-capture` path, `image-skips.ts` |

## 2. Pages

**Exclusions** (`scripts/exclusions.py`, `data/excluded-domains.json`). The sixth study's list (2,437 registrable
domains: rounds 1 to 5, the re-measure, the robustness study and every host the repository named at `0bada65`), extended
with: every page the sixth study chose at any point (76: its 72 and the four it replaced); every host the sixth study's
own files name outside the files that list its candidates and screen results; every host on a line any commit added
since `0bada65` on any ref, outside the sixth and seventh studies' folders, and in every commit message since; and every
host the main checkout's `study/human-review-2026-10/` names (the human-review packages and the reviewers' files).
Registrable domains by the Public Suffix List fetched on 2026-11-21 (SHA-256 in the JSON). Domains a candidate's first
label shares with an excluded one were looked at by hand and kept (`scripts/candidates.tsv`).

**Design.** 60 pages, **all test** (no dev half), five blocks of 12: one page per stratum in each block, over the sixth
study's twelve strata (Brazil or international, times government, education, news, e-commerce, health, culture or
public services), so 5 pages per stratum, no site twice; Brazilian pages in Portuguese, the others in English. The
generator `random.Random(20261121)` (**seed 20261121**, written in `scripts/deal.py` and committed in `851bc15` before any
candidate loaded) drew six home-heavy strata (br-edu, br-gov, br-news, br-shop, in-gov, in-news: home pages in blocks 1,
3 and 5, inner pages in 2 and 4; the other six the reverse), so each block has 6 home and 6 inner pages and the study 30
and 30. Inner pages follow the sixth study's rules (`scripts/pick.py`): a Brazilian court's, prosecution service's or
court of accounts' ombudsman or contact page; an international government search form; a university's undergraduate
page; the first article in the content of a news or health home page; a store's first product category; a cultural
body's contact page.

**Candidates.** The sixth study's 24 pools (480 sites written on 2026-10-29 before anything loaded), in their written
order, without the excluded sites (95, the sixth study's 76 pages among them), dealt round robin to each pool's two or
three slots here (`scripts/deal.py`, `scripts/candidates.tsv`, 385 candidates, 4 to 9 a slot). The sixth study's leftover
candidates are unseen: no Rampa run, finding or label touched them. No new candidate was needed.

**Screen** (`scripts/screen.mjs`, `scripts/screen_pass.py`, `data/screen-*.json`): the sixth study's rules, written in the
header of `scripts/candidates.tsv`. Slot by slot, candidates in order until one passes (every candidate before a
slot's choice is screened); a network failure or time-out is screened once more later. For an inner slot, the site's
home page is screened, the inner page picked from its link listing and screened again. Client addresses and query
strings are redacted from the kept screen files (`scripts/redact.py`). The choice of each slot, with the candidates
before it that failed, is in `scripts/selection.tsv`, and the pages in `scripts/pages.tsv` and `data/pages-input.json`
(`scripts/design.py`).

**Selection** (2026-11-21, 12:06–12:30, before any Rampa run; `data/screen-1.json` to `screen-12.json`, 240 screen
rows; link listings in `DATA/links/`, out of git). 42 of the 60 slots went to a backup. 74 candidates failed before a
chosen one: 50 answered an HTTP error (nearly all 403 bot walls), 14 did not load in two tries, 4 declared another
language, 3 showed almost nothing and 3 redirected to an excluded domain. On eight inner sites the page could not be
taken: six linked no page by the stratum's rule (three Brazilian culture sites in one slot), one inner page showed a bot
check and one under 200 characters. Readings fixed during the selection, before any Rampa run, as in the sixth study: an
article is a story or post in the page's content (reference, campaign, service and event pages are not); a category is
a product category (gift occasions, brands, seasonal or "new" collections, offers and search shortcuts are not); a menu
link that headless Edge sees without text still counts when it is the menu's first product category; a wall phrase is
read in context (a label on one item of a list, a newsletter sign-up). Each case is written in `scripts/selection.tsv`
(`scripts/build_selection.py`).

**T4 subset**: after the pages were fixed, the same generator (after the six-strata draw) drew one page per stratum,
in sorted stratum order, from its five pages sorted by slot (`scripts/design.py`, `t4Subset`): Orquestra Ouro Preto's
contact page, UEL, MPMG's ombudsman page, Hospital Infantil Sabará, Chester Beatty, Purdue, ND+, Pernambucanas,
Alzheimer Society of Ireland's story, Heal's lighting category, the Morning Star article and Galway City Council.

## 3. Method

The sixth study's, except as listed. Every `rampa check` runs with `--wcag 2.1`; each page runs with its own folder
under `C:/Users/guilh/dev/rampa-study-recordings/round-7/pages/<slug>/` as the working directory (out of git, short
paths: long paths are off on this PC), with `RAMPA_MODEL` and every API-key variable unset (`scripts/env.sh`). Pages run
one at a time, in block order.

- **Collection, no model call** (`scripts/collect.sh main`): `rampa check <url> --wcag 2.1 --model ollama:gemma4:12b
  --offline --locale en --min-confidence low --save <dir> --screenshots --timings`, Edge through playwright-core.
- **Main judgment** (`scripts/run-judged.sh main`), once per page, from an empty cache: `rampa check <snapshot> --wcag 2.1
  --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --timings`, second pass on;
  Ollama at http://127.0.0.1:11434, temperature 0. No hosted model anywhere. Between pages the script waits while the
  GPU is above 83 °C or under 2 GB of memory is free.
- **Ablations: counts only.** `--offline --no-verify`, `--offline --no-confirm` (each on a fresh copy of the main cache)
  and `--no-llm` run on every snapshot after the main run and before the packets (minutes, no model call); reported as
  the findings each adds or removes at the default threshold. `scripts/packets.py` reads the first two only to word a
  drawn held-back or discarded pass-sample claim, as in the sixth study. **Their extra findings are not labelled** (to save judge time), so no ablation
  precision is measured; the P2-off build and the P1 facts replay are not run.
- **Five uncached runs (T4), after the main run and the packets.** On the T4 subset, at `--concurrency 2`: full mode,
  the main command four more times, each from its own empty cache (the main run is the first of five); then fast mode,
  one live `--fast` collection judged five times with `--fast`, each from an empty cache. A page counts in a mode only
  when all five runs finished.
- **Labels.** One packet per page (`scripts/packets.py`), items in one form, shuffled with
  `random.Random("20261121:<slug>")`: every judgment and rule finding of the main run at any confidence; the chosen
  suggestions (every 2.4.2 and 3.3.2 suggestion and every suggestion on a page read as unstyled, then 12 drawn per block
  with `random.Random(20261121)`, at most 3 a page; `scripts/sample_suggestions.py`); and the pass sample (below). No
  confidence, patch, suggestion quote or run name in a packet. Two Claude judge agents per packet, an auditor and a
  skeptic, independent, with this round's rubric (`judge-rubric.md`: the sixth study's plus R1 and R2, section 8) and
  prompt (`scripts/judge_prompt.py`, `scripts/judge-prompt.txt`); three answers per item (`claimTrue`, `elementFails`,
  `captureDiffers`, each `yes`, `no` or `cannot_tell`) and the label that follows by the rubric's rule. Final label: the
  one both judges gave, else `uncertain`; a false positive's cause the one both named, else `disputed`. The prompts are
  written to `judge-prompts/` with `index.json` (entries `{file, packet, role, findings}`, largest packets first); the
  judges are launched from the main session, apart from the runs; `scripts/check_labels.py` checks their files.
- **Pass sample (secondary)**, the sixth study's design on all 60 pages: 1.1.1 and 2.4.4 judged candidates that are not
  findings, in three strata (passed, discarded, held back); 60, 20 and 20 per criterion (all when fewer); ascending
  SHA-256 of `rampa-round-7-passes|<slug>|<criterion>|<ref>` (`scripts/pass_list.ts`, which stops unless each page's
  listing matches the main run's report; `scripts/pass_draw.py`). A passed row has no claim and is labelled on
  `elementFails` and `captureDiffers` only.
- **Order**: collection, main judgment, ablations, `compact.py`, `pass_list.ts`, `pass_draw.py`,
  `sample_suggestions.py`, `packets.py`, `judge_prompt.py --all`, then T4 (full, then fast), `compact.py`, `hashes.py`
  and `t4.py`.
- **Kept in git**: the compact reports (`scripts/compact.py`, `pages/<slug>/*.judged.json`), timing records, packets and
  prompts; recordings, screenshots, caches and full reports stay out of git, hashed in `data/recordings.json`.

## 4. Primary measure and decision rule

**Precision per element at the default threshold over the judged criteria, all 60 pages (test)**: judgment findings of
the eight default criteria (1.1.1, 1.3.5, 2.4.2, 2.4.4, 2.4.6, 3.1.1, 3.1.2, 3.3.2), not experimental, medium confidence
or above, from the main run; TP / (TP + FP), uncertain left out (the decided items); the judges' final labels. The
thesis article's target, unchanged:

- **favourable**: precision ≥ 0.90 **and** Wilson 95% lower bound ≥ 0.80;
- **inconclusive**: Wilson lower bound < 0.80, whatever the precision;
- **under the target**: precision < 0.90 and lower bound ≥ 0.80.

The article sizes a round for at least 70 decided findings (the sixth study's threshold); **below 70, the count and the
reading are reported as they come**, with no page added. Every number is named AI-judged and held-out.

## 5. Other measures

Co-registered (reported with the primary):

1. **Page bootstrap** of the primary precision: 10,000 resamples of the 60 pages, `random.Random(20261121)`, a resample
   with no decided finding skipped and counted; 2.5th and 97.5th percentiles. It does not decide.
2. **Precision per same-name link set**: 2.4.4 shared-text findings (claim `ambiguous`, "is shared by") grouped by page
   and normalised link text; one unit per set, its label the majority of its members' final labels (a tie
   `uncertain`); every other primary finding one unit.
3. **Share of uncertain** among the primary findings, target ≤ 15%.
4. **Per-criterion counts**: TP, FP, uncertain and precision per criterion.
5. **T4 stability at the decision level**, target ≥ 0.95, per mode (full, fast): for each judged candidate of the eight
   criteria (the population: `criteria[].candidates` of the first run), Rampa's decision in each run, one of
   *default-threshold finding*, *finding below the threshold*, *suggestion* or *nothing* (passed, discarded, cannot tell,
   capped), read from the reports by criterion and element; the share of candidates with the same decision in all five
   runs, with Wilson's interval. Beside it: the sixth study's prompt-level measure (the same answer to each cached prompt
   in all five runs) and the share of default-threshold findings present in all five reports.

Secondary, as in the sixth study: true findings axe-core does not report on the same element and criterion (Wilson);
per group (6 or more findings of one claim on one page, one unit); per page; per block (exploratory); every finding at
any confidence; the "fails for any reason" reading (`elementFails` `yes`); sensitivity (without the largest page;
uncertain as true and as false); experimental rules; the suggestion sample; false-positive causes by criterion and check
(counted, not read for patterns); judge agreement (raw and Cohen's kappa: consistency, not validity); time per page
(median and 90th percentile, collection plus judgment, full and fast); the ablation counts; recall among judged
candidates (1.1.1, 2.4.4, the sixth study's estimator); and the comparison with the sixth study's test half (0.606, 60 of
99), Newcombe's interval and an unpaired page bootstrap, **went up** only when both lie above 0.

## 6. Rules fixed now

- **Network drops**: an attempt that fails with a network error does not count; tried again once the connection
  answers, up to three more times.
- **Refusals**: a bot challenge, an HTTP 403, 429, 500 or 503 page, a rate-limit or sign-in page, or a crash that saves
  no snapshot: wait at least 10 minutes, try once more; refused again, the slot's next backup that passed the screen
  replaces it, keeping its block and stratum (an inner slot's backup has its inner page picked by the slot's rule and
  screened before Rampa runs). A server redirect loop counts as a refusal. Every attempt is logged and set aside.
- **An unstyled capture is not a refusal**: the page stays and is reported.
- **Once**: each page is collected and judged once in the main run; nothing is redone because of what Rampa found; `src/`
  and `dist/` do not change.
- **Scripts**: every script that runs, lists, draws or builds packets is committed with this file; one changes after it
  only to fix a bug that stops it, never because of what Rampa found, and the change is logged in `run-log-notes.txt`.
  `scripts/analyze.py`, `scripts/check_labels.py` and `scripts/t4.py` were adapted and run on a copy of the sixth study's
  folder before this commit: they give that study's primary count (60 true, 39 false, 44 uncertain on its test half),
  judge kappa 0.87 and prompt-level T4 shares 0.949 and 0.961, and they are committed with this file.
- **What the person running the study sees**: capture notes (title, size, capture record) and counts. No finding, label
  or judge rationale of this round is read before the counts are reported; false positives are counted by check, cause
  and stratum, never read for patterns. Every number is named held-out, exploratory or in-sample.

## 7. Run time (estimate, `scripts/estimate.py`, from the sixth study's timings)

Collection about 0.4 h; main judgment about 2.1 h; ablations a few minutes; T4 about 1.8 h (full) plus 0.8 h (fast).
About 5 h of machine time after the freeze. Judges: about 120 agents (an auditor and a skeptic per packet).

## 8. What changed from the sixth study

1. Pages: 60, all test, five blocks of 12, seed 20261121, from the sixth study's pool leftovers; exclusions extended.
2. Rubric R1 (2.4.4, links that share a name): scored by the expectation of ACT rule fd3a94 (a proposed rule on w3.org,
   mapped to 2.4.4): a pair of same-name, same-context links fails when they lead to non-equivalent resources and
   something visible tells them apart; every link of a failing pair fails, including the correctly named one when the
   other carries the wrong name.
3. Rubric R2 (image links whose alternative describes the picture): for 2.4.4 a `title` (H33, sufficient) cures it, and a
   neighbouring text link to the same address only when it is in the image link's listed context (F63, F89, H2); for
   1.1.1 neither cures it (H30 under Situation C, G82, the "linked thumbnail" example).
4. Decision rule: the article's (precision ≥ 0.90 and Wilson lower bound ≥ 0.80), on all 60 pages.
5. Co-registered measures listed in section 5; the ablations are counts only, without labels; no P2-off build, no P1
   replay.
6. No human labels; the same two Claude judges, three answers, final label by agreement.
