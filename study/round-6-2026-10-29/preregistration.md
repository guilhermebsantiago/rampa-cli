# Sixth real-page study: pre-registration (2026-11-21)

Committed, and pushed to `main`, before Rampa ran on any of these pages. Only the pre-screen in headless Edge
(`scripts/screen.mjs`, `data/screen-*.json`, on 2026-10-29 and once more on 2026-11-21) and the link listing used to
pick inner pages (`scripts/links.mjs`) have loaded them. The draft was written from 2026-10-29 to 2026-11-09 on four
branches (`study/round-6`, `study/round-6-plan`, `study/round-6-passes`, `study/round-6-rubric`); they are merged here,
and the author's decisions of 2026-11-21 settle its open items (section 9). Nothing here changes after this commit.

**Question.** This is the final evaluation the thesis article commits to (`~/dev/tcc/notas/atividade-08-proposta-de-avaliacao.md`,
section 5: T2 and the real-page parts of T3 and T4). Its main question is the article's P2: on 36 pages none of the
frozen code has seen, how often is what `rampa check --wcag 2.1` reports, by the judgment layer at the default
threshold, a real failure? Beside it, on the same pages: how many true findings axe-core does not report (P1, real
pages), what each component contributes and how much verdicts repeat (P3), time per page with a local model (P4), and,
for 1.1.1 and 2.4.4, recall among the candidates Rampa judged, from a seeded sample of what it did not report.

**Whose labels.** The primary measure is **AI-judged**. Its reference is the final label of two Claude judge agents (an
auditor and a skeptic), as in rounds 3 to 5. No person labels any item of this round. How far such judges agree with
people was checked only on an earlier sample of 15 items of rounds 3 to 5, labelled blind by two specialists and,
reported apart, by students ([human-review-plan](../../docs/studies/human-review-plan.md); its analysis is not done);
that check is reported beside this round's result, and no number of it is in this file.

**What it builds on.** The [fifth study](../../docs/studies/real-pages-2026-10-round5.md): 0.83 on its test half (20 of
24 decided; Wilson 0.64–0.93) and 0.81 over both halves (51 of 63). The notes after it project 0.84–0.92 once P1 and P2
ship, and show that a 24-page round cannot show 0.9; this round is three blocks of the fifth study's design.

## 1. Code, frozen

**rampa-cli 0.1.2**: tag `v0.1.2` = `df32363` ("Release 0.1.2", the published npm package), built in a worktree of that
tag with `pnpm install --frozen-lockfile` and `pnpm build`; `node dist/cli.mjs --version` prints `0.1.2`, and the run
scripts stop unless it does. `src/` is not touched. The code is the definition; the rules and constants that decide what
a finding is, checked at `df32363`:

| Rule | Value | Where |
| --- | --- | --- |
| The fifth study's rules | H81 nesting (120 characters), default body look, no author style, 150-element floor, old-recording fallback, self-link correction, second pass at 0.99, 2.4.2 and 3.3.2 grounding, burst group of 6 or more ([its pre-registration](../round-5-2026-10-28/preregistration.md)) | `link-purpose.ts`, `look.ts`, `page-look.ts`, `reach.ts`, `confirm.ts`, `page-titled.ts`, `labels-or-instructions.ts`, `groups.ts` |
| P1, card heading (H80) | a generic link text takes the nearest named heading before it as context when both share an ancestor at most 2 levels up (`CARD_DEPTH`) holding at most 300 characters (`CARD_TEXT`); the prompt gains "Heading of the card the link sits in"; not when the heading is itself generic (`genericCardHeading`) | `link-purpose.ts`, `cardHeadingOf` |
| P1, disclosure toggle | a generic link text whose `href` leads nowhere and whose list item holds a list after it is not grounded as generic | `link-purpose.ts`, `menuToggleOf` |
| P2, identical claims | second-pass claims on one page with the same criterion, normalised subject and verdict are confirmed together when the pass confirms one ("C-any"), unless the denied claim's own lowest probability is under 0.05 (`CONFIRM_TOGETHER_MIN_PROBABILITY`) | `confirm.ts`, `identicalClaimKey`, `confirmTogether` |
| P3, social icon | a 1.1.1 fail on an image that is all of a link to one of the listed services, whose alternative names the service or is within 2 edits of a host label of 4 or more letters, is the model's suggestion | `non-text-content.ts`, `namesNetworkOfLink` |
| P4, destination name | a 2.4.4 shared-text claim on a link whose text (3 or more letters or digits) is the destination's main heading or one part of its title is the model's suggestion | `link-purpose.ts`, `namesOwnDestination` |
| 1.1.1 placeholders and wordings | an identifier or "image missing" alternative is a placeholder; a claim on an extended or a one- or two-word alternative is worded "leaves out…" / "does not describe…" (wording only) | `non-text-content.ts`, `looksLikePlaceholder`, `extendsAlternative`, `claimText` |
| Reports only | the capture record, a stub report for a target that fails to load (exit 2), technique citations | `capture.ts`, `check.ts` (CLI), `techniques.ts` |
| `--no-verify` | keeps a fail claim whose quote is not on the page, as if verified; nothing else changes (a P3 or ungrounded claim stays a suggestion; a 1.1.1 claim still goes through the second pass) | `src/core/check.ts`, `claimsFail`, `heldBack` |

## 2. Pages

**Exclusions.** No registrable domain of any earlier study (160, the fifth study's 24 among them), none of the 2,425
that the files of the repository's branches, tags and `origin/main` or its commit messages name, and none of 12 more
named only on lines the history added: `scripts/exclusions.py`, `data/excluded-domains.json`, built on 2026-10-29 at
`0bada65`. Not rebuilt (this study's files name every candidate). On 2026-11-21 the 72 domains were checked against every line added
since `0bada65` outside this folder, and every commit message, on the 32 refs that moved since: 2,724 domains named,
none of the 72 (`scripts/recheck_domains.py`; registrable domains by a suffix rule, since the Public Suffix List file
of 2026-10-29 is no longer on disk, plus a plain substring search).

**Design and selection.** Three blocks of the fifth study's design: twelve strata (Brazil or international, times
government, education, news, e-commerce, health, culture or public services), each a home page and an inner page from
two sites; no site twice; Brazilian pages in Portuguese, the others in English. Inner pages: a Brazilian court's,
prosecution service's or court of accounts' ombudsman or contact page; an international government search form; a
university's undergraduate page; the first article of a news or health home page; a store's first product category;
a cultural body's contact page. 480 sites in 24 pools were written before anything loaded (`scripts/pools.tsv`), 19
excluded, the rest dealt to the slots with the screen's rules and the split seed (`scripts/deal.py`,
`scripts/candidates.tsv`, committed in `b4c77c5` before the screen). Every candidate was screened once in headless Edge
(`data/screen-1.json` to `screen-5.json`; network failures once more). On 2026-10-29, 30 of the 72 slots went to a backup (47
candidates failed before a chosen one: 28 refused with HTTP 403 or 404 or a bot challenge, 11 did not load twice, 8
for other reasons); `scripts/selection.tsv` and `scripts/pages.tsv` name each. Readings fixed during the selection,
before any Rampa run: an article is the first story in the page's content and a category the first of the main menu
(`scripts/pick.py`); a listing that times out twice is a failed load; a redirect's target is the page's address,
tracking query strings dropped; a wall phrase is read in context (SBOC's "matéria exclusiva" is in a list of older
posts); client addresses and query strings are redacted from the kept screen files (`scripts/redact.py`).

**Screened again on 2026-11-21**, because three weeks passed (`scripts/rescreen.tsv`, `data/screen-6.json`): 70 of 72
passed as before. Two were refused twice, 10 minutes apart (`data/screen-7.json`), and replaced by section 6's rule,
keeping slot, block and split, before any Rampa run: block 2's international news article (calmatters.org, a bot check;
test) went to its slot's next backup that had passed the screen, lbc.co.uk, whose first article in the home page's
content is the page; block 3's international culture contact page (rsc.org.uk, HTTP 403; dev) went to lso.co.uk's
contact page (youngvic.org, the first backup, had failed the screen). Both inner pages passed (`scripts/candidates-inner-3.tsv`,
`data/screen-8.json`); `scripts/pages.tsv`, `scripts/selection.tsv` and `data/pages-input.json` hold them (the coins and
the T4 subset are unchanged); neither domain is excluded or named since `0bada65`.

**Split.** `scripts/split.py`, `random.Random(20261029)`, seed written before any page loaded: per block and stratum a
coin sends the home or the inner page to dev (`data/pages-input.json`). Test: 36 pages (14 home, 22 inner); dev: 36.
**T4 subset**, drawn after the split with the same generator, one page per stratum (12): gosh.nhs.uk, museum.wales,
Ultrafarma's category, the Migalhas article, Unicap's undergraduate page, the SBPT article, OSU's undergraduate site,
Instituto Tomie Ohtake, rn.gov.br, Cork City Council, The Denver Post and The White Company (`t4Subset`).

## 3. Method

The fifth study's, except as listed. Every `rampa check` runs with `--wcag 2.1` (axe-core's WCAG 2.0 and 2.1 A/AA rules;
a WCAG 2.2 finding is listed in `beyondTarget` and never counted; the eight judged criteria have the same text in 2.1
and 2.2). Each page runs with its own folder under `C:/Users/guilh/dev/rampa-study-recordings/round-6/pages/<slug>/` as
the working directory (out of git; a short path, so the longest recording name, SBPT's, stays at 246 characters), with
`RAMPA_MODEL` and every API-key variable unset (`scripts/env.sh`). Pages run one at a time, in block order.

- **Collection, no model call** (`scripts/collect.sh main`): `rampa check <url> --wcag 2.1 --model ollama:gemma4:12b
  --offline --locale en --min-confidence low --save <dir> --screenshots --timings`, Edge through playwright-core.
- **Main judgment** (`scripts/run-judged.sh main`), once per page, from an empty cache: `rampa check <snapshot> --wcag 2.1
  --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --timings`, the second
  pass on. Gemma 4 12B (`gemma4:12b`, Q4_K_M, digest `6114515d63c1`) on Ollama 0.40.3 at http://127.0.0.1:11434,
  temperature 0. No other model and no hosted provider is used anywhere in this round. Between pages, the script waits
  while the GPU is above 83 °C or under 2 GB of memory is free; no setting changes.
- **Ablations, offline, no model call** (`scripts/run-ablation.sh`), each on the same snapshot, from a fresh copy of the
  main cache where it reads one: (1) **verification off**, `--offline --no-verify` (a 1.1.1 claim verification had
  discarded that now needs a second-pass answer the cache lacks stays the model's suggestion, counted in the report's
  offline misses); (2) **the judgment layer off**, `--no-llm`; (3) **the second pass off**, `--offline --no-confirm`;
  (4) **P2 off**, `--offline` with a copy of the build whose one call of `confirmTogether` returns each claim's own
  outcome, checked to differ from the build in that one line; (5) **P1 as facts** (`scripts/p1_facts.ts`): for every
  2.4.4 candidate of each snapshot, whether the generic fact (`groundedLink('generic', …)`) holds with the candidate's
  facts and without its `cardHeading` and `menuToggle`; listed: the links where it differs, and the main run's findings
  and suggestions on them (without P1 the prompt and the cap order change, so no counterfactual verdict is read).
- **Five uncached runs (T4), secondary, only after the main run, the ablations and the packets, if the night leaves
  time.** On the T4 subset, at `--concurrency 2`: *full mode*, the main command four more times, each from its own
  empty cache (the main run is the first of five); *fast mode*, one more live collection with `--fast` and that
  snapshot judged five times with `--fast`, each from an empty cache. Local model only. Pages run in the subset's
  order; a page counts only when all its runs of a mode finished, and the report says how many did.
- **Labels.** One packet per page (`scripts/packets.py`), items in one form and in an order shuffled with
  `random.Random("20261029:<slug>")`: every judgment and rule finding of the main run at any confidence; every finding
  of the `--no-confirm` and `--no-verify` runs at the default threshold that the main run lacks (all); the chosen suggestions
  (the fifth study's rule: every 2.4.2 and 3.3.2 suggestion and every suggestion on a page read as unstyled, then 20 a
  split per block drawn with `random.Random(20261029)`, at most 3 a page; `scripts/sample_suggestions.py`); and, on the
  test half, the pass sample (below). An item in two of these is labelled once and counts in each. No confidence,
  patch, quote of a suggestion or run name in a packet. Two Claude judge agents per packet, an auditor and a skeptic,
  each told not to read the other's work, with this round's rubric ([`judge-rubric.md`](judge-rubric.md)) and prompt
  (`scripts/judge_prompt.py`, `scripts/judge-prompt.txt`, its reply giving counts only). Each item gets three answers,
  `yes`, `no` or `cannot_tell`: `claimTrue` (is the claim true of the captured document?), `elementFails` (does the
  element fail the criterion on the page users receive, for any reason?) and `captureDiffers` (does the capture differ
  from that page in a way that matters here?). The label follows by the rubric's rule: `true_positive` when
  `elementFails` is `yes` and the claim names that failure; `false_positive` when it is `no`, or the element fails for
  a reason the claim does not name; `uncertain` otherwise. The final label is the one both judges gave, else
  `uncertain`; a false positive's cause the one both named, else `disputed`. Pacing as in the fifth study (up to 8
  judges at once, largest packets first; a judge that stops is launched again from scratch; `scripts/check_labels.py`).
  The judges' prompts are written to `judge-prompts/` with an index; the judges run after the packets, apart from
  this night's runs.
- **What Rampa passed, a seeded sample (secondary).** *Population*: the test half's main run, 1.1.1 and 2.4.4; per
  criterion, judged candidates that are not findings at any confidence, in three strata: **passed** (verdict pass,
  kept by verification), **discarded** (verdict fail, discarded by verification), **held back** (a verified fail that is
  the model's suggestion: not confirmed by the second pass, no checked fact behind it, a P3 claim, or a page read
  unstyled). Discarded passes, `cannot_tell`, errors and candidates past the cap or the time limit are counted, never
  drawn. *Sizes*: 60 passed, 20 discarded, 20 held back per criterion, all when fewer. *Draw*: within a stratum, over
  the 36 pages pooled, ascending SHA-256 of `rampa-round-6-passes|<slug>|<criterion>|<ref>`, the first *n*
  (`scripts/pass_list.ts` lists every candidate with its outcome offline from the main cache, and stops unless each
  page matches the main run's own report; `scripts/pass_draw.py` draws). *Labels*: in the page's packet, by the same two
  judges and rubric. A passed row has no claim (it cannot pass for a finding): it takes `elementFails` and
  `captureDiffers` only, and is `true_positive` (a failure Rampa missed) when `elementFails` is `yes`, `false_positive`
  when `no`, else `uncertain`. Discarded and held-back rows carry the model's claim and are labelled as findings.
- **Kept in git**: the part of each report the analysis reads (`scripts/compact.py`, `pages/<slug>/*.judged.json`), the
  timing records, the packets and the prompts; recordings, screenshots, caches, full reports and consoles stay in the
  folder above, hashed in `data/recordings.json` (`scripts/hashes.py`). Each packet's snapshot, screenshot and crops are
  copied next to it, out of git (`packets/<slug>/`), so that no judge opens the recordings folder.

## 4. Primary measure (P2)

**Test-half precision per element at the default threshold over the judged criteria**: judgment findings of the eight
default criteria, not experimental, medium confidence or above, from the main run on the 36 test pages; TP / (TP + FP),
uncertain left out; the judges' final labels. **Wilson's 95% interval decides**; beside it, a page bootstrap (10,000
resamples of the 36 test pages, `random.Random(20261029)`, a resample with no decided finding skipped and counted, the
2.5th and 97.5th percentiles), which does not decide. The reading, from the article (5.5):

- **favourable**: precision at least 0.90 and Wilson's lower bound at least 0.80;
- **inconclusive**: Wilson's lower bound under 0.80, whatever the precision;
- **under the target**: precision under 0.90 and the lower bound at least 0.80.

The article sizes the round for at least 70 decided test findings; **below 70, the count and the reading are reported
as they come**, with no block added. The pooled 72 pages are a secondary measure. Every number is named AI-judged.

## 5. Other measures

1. **Not reported by axe-core (P1).** Of the true default-threshold judged findings on the test half, the share axe-core
   does not report on the same element and criterion on the same snapshot (Wilson), also on any criterion, and the
   criteria with a true finding ([notes-added-over-axe](../../docs/studies/notes-added-over-axe.md)).
2. **Ablations (P3)**, each against the main run, per half and pooled, with each changed claim's label: precision with
   verification off (the article expects a fall), with the judgment layer off (rule findings left, true judged findings
   lost), with the second pass off, without P2, and P1's facts. Each difference with Newcombe's interval and a paired
   page-bootstrap interval; **went up** or **went down** only when both lie on one side of 0, else **no measurable
   change**. What a component costs is counted as true findings lost or gained.
3. **Five uncached runs (P3, secondary, if run).** The share of judged candidates whose verdict (fail, pass, cannot
   tell, discarded; for 1.1.1 the second pass's outcome too), read from each run's cache, is the same in all five runs,
   with Wilson's interval, per mode and criterion; a candidate judged in one run and not another differs. Target 0.95.
   Also the share of default-threshold findings present in all five.
4. **Time (P4).** Per page and mode: median and 90th percentile of collection plus judgment time (`--timings`, run
   logs), model calls, tokens. Target: median at most 2 minutes a page in fast mode; no external cost (local model).
   No hosted model is run, so the article's hosted comparison is not measured in this round.
5. **The fifth study's secondary measures**: per group (6 or more findings of one claim on one page, one unit); per page;
   the dev half, both halves, every finding; per criterion; per block (exploratory); the suggestion sample; bursts (every
   page with 6 or more findings, suggestions or ablation findings of one claim, its mechanism described from the dev
   half only); sensitivity (each half without its largest page; uncertain as true and as false); experimental rules;
   the "fails for any reason" reading (`elementFails` is `yes`); the comparison with the fifth study's test half and both
   halves, with its two-interval reading.
6. **Agreement.** The two judges' raw agreement and Cohen's kappa over the three labels, and over the causes, as in the
   fifth study: consistency, not validity. Validity against people rests only on the earlier 15-item human review
   (above, "Whose labels"), reported beside the primary measure.
7. **Recall among the candidates Rampa judged, 1.1.1 and 2.4.4** (AI-judged, secondary). Per criterion and stratum *h* of
   size *N_h*, the failing share *p_h* among decided drawn items (Wilson); estimated misses Σ *N_h p_h* plus the
   below-threshold findings labelled true; recall = true default-threshold findings over those plus the misses.
   Interval: 10,000 resamples of the 36 test pages (`random.Random(20261029)`); in a resample, *N_h* is the resampled
   pages' stratum population and *p_h* the failing share among their drawn decided items, or the full sample's *p_h*
   when they have none. Sensitivity: uncertain as failing and as not. No target. Stated beside it every time: images
   with no crop, candidates past the cap or the time limit, `cannot_tell`, discarded passes, errors, elements never
   candidates, and the other six criteria are not covered; it is never called "Rampa's recall".

## 6. Rules fixed now

- **Network drops.** An attempt that fails with a network error, or whose log shows one, does not count; it is tried
  again once the connection answers, up to three more times.
- **Refusals.** A bot challenge, an HTTP 403, 429 or 503 page, a rate-limit or sign-in page, or a crash that saves no
  snapshot: wait at least 10 minutes, try once more; refused again, the slot's next backup that passed the screen
  replaces it, keeping block and split (for an inner slot, the backup site's inner page is picked by the slot's rule
  before Rampa runs). Every attempt is logged and set aside.
- **An unstyled capture is not a refusal**: the page stays and is reported.
- **Once.** Each page is collected and judged once in the main run; nothing is redone because of what Rampa found. `src/`
  does not change. A run script changes after this commit only to fix a bug that stops it, logged.
- **Scripts.** Every script that runs, lists, draws or builds packets is committed with this file; one changes after it
  only to fix a bug, never because of what Rampa found, and the change is logged (`run-log-notes.txt`). The analysis
  scripts are adapted from the fifth study's after this commit and committed before the first label file.
- **What the person running the study sees of the test half**: capture notes (title, size, the report's capture record) and
  counts. No test finding, label or judge rationale is read before the counts are reported; the test half's false
  positives and misses are counted by check, cause and stratum, never read for patterns. The test numbers are reported
  once. Every number is named held-out, exploratory or in-sample.

## 7. The article's targets (Quadro 3)

| Question | Target | Here |
| --- | --- | --- |
| P1, real pages | true findings axe-core does not report | section 5, item 1 |
| P2 | precision ≥ 0.90; inconclusive when Wilson's lower bound < 0.80 | section 4 |
| P3 | ≥ 95% identical verdicts in five runs; precision falls without verification | section 5, items 2 and 3 |
| P4 | median ≤ 2 min a page in fast mode; no external cost locally | section 5, item 4 (no hosted model) |
| Labels | kappa ≥ 0.61, human labels below it | not applied: the labels are AI-judged, checked against people only on the earlier 15-item sample |

## 8. Run time on this PC (estimate, `scripts/estimate.py`)

Collection 0.6 h; main judgment 3.1 h (median 145 s a page in the fifth study); ablations a few minutes; T4 on the
subset about 3.1 h. Judge agents: 144 (an auditor and a skeptic per packet), the pass sample adding about 200 items.

## 9. Decisions resolved (2026-11-21)

1. Primary measure counts the judgment layer's findings of the eight criteria (draft).
2. Reference labels: the two Claude judges' final labels; no new human labels; specialist reference, adjudication, partial-sample rule and "fewer than 60 specialist items" rule removed (author).
3. Wilson's interval decides "inconclusive" (lower bound 0.80); the page bootstrap is reported beside it (author).
4. Below 70 decided test findings: reported as they come, no extra block (author).
5. Test half primary, pooled secondary (author).
6. Agreement statistic: no specialist pair, so AC1, its floor and the per-claim rule are removed; judge kappa is consistency only (author's decision 1).
7. Model swap: dropped; no hosted model at all (author).
8. Hosted T4 and hosted cost: dropped (author).
9. T4: local only, the 12-page subset, secondary, after the main run if time allows (author); the main run counts as the first of five, concurrency 2 throughout, one live `--fast` collection (draft).
10. Pass sample: in, AI-judged, same judges and rubric; no specialist subset (author).
11. Pass-sample bootstrap: resample pages; *N_h* and *p_h* from the resampled pages, the full sample's *p_h* for an empty stratum (draft TO FIX, resolved here).
12. Pass-sample tooling: `study/notes-pass-sample/list.ts` adapted as `scripts/pass_list.ts` (test half, main run) and `draw.py` as `scripts/pass_draw.py` (draft TO FIX).
13. `--no-verify` ablation: offline on a copy of the main cache, no new model call (draft).
14. `--no-verify` and `--no-confirm` extras: all labelled (draft's first option).
15. P1 replay: facts only, from each candidate's `cardHeading` and `menuToggle` (draft TO FIX, resolved here).
16. `--no-confirm` and the P1/P2 replays kept as secondary ablations (draft).
17. Three answers per item, derived label primary, "fails for any reason" beside it (draft).
18. Section 1 rows confirmed at `df32363`; every tool branch the draft listed is merged (draft TO CONFIRM).
19. Per-claim template rule for `1.1.1 wrong_content`: moot without a specialist agreement measure (draft TO FIX).
20. Domains checked again against branches since `0bada65` before this commit (draft); pages screened once more (draft).
21. Reviewer guides for people (`reviewer-rubric*.md`) removed from this folder: no person labels this round (they stay on `study/round-6-rubric`).
