# Eighth real-page study: pre-registration (2026-11-21)

Committed before Rampa ran on any of these pages. The freeze is a **local** commit on the branch `study/round-8-run`; it
was **not pushed** (the author's rule of 2026-11-21: nothing goes to `main` until the tool improves), so its timestamp is
local only. Its commit SHA and the SHA-256 of this file and of `judge-rubric.md` are in `run-log-notes.txt`. Only the
pre-screen in headless Edge (`scripts/screen.mjs`) and the link listing used to pick inner pages (`scripts/links.mjs`)
have loaded these pages; the screen and the picks were made before this commit, as section 2 says. Nothing here changes
after the freeze.

**Question.** The seventh study measured rampa-cli at `385fe13` on 60 held-out test pages: 0.74, AI-judged (69 true, 24 false,
12 uncertain; Wilson 0.65–0.82), inconclusive by the thesis article's rule; without judged 2.4.4 its findings were 63
true, 0 false and 10 uncertain. Seven more precision fixes were then written from its pages and the sixth study's (`2f5f88f`). **The sixth
and seventh studies informed this code, so they are in-sample for it**: an offline replay gives the seventh study's
labelled findings 69 true, 0 false and 12 uncertain, and the sixth study's test half 53, 11 and 33 (in-sample, two
Claude judges). This round is the **held-out test of `2f5f88f`**: on 60 new pages none of that code has seen, how often
is what `rampa check --wcag 2.1` reports, by the judgment layer at the default threshold, a real failure? Beside it: the
same number without judged 2.4.4, the cost of the new shared-text proof rule, verdict stability over five uncached runs,
time per page with a local model, true findings axe-core does not report, and recall among judged candidates for 1.1.1
and 2.4.4.

**Whose labels.** **AI-judged.** The reference is the final label of two Claude judge agents (an auditor and a skeptic),
as in rounds 3 to 7. No person labels any item of this round (the author's decision). The blind human review of rounds
3 to 5 is reported beside the result, as in the sixth and seventh studies; no number of it is in this file.

## 1. Code, frozen

**`2f5f88f`**, the head of the local branch `fix/round-7` ("changelog: the seventh study's precision fixes, under
Unreleased"): the seventh study's code (`385fe13`: rampa-cli 0.1.2, `df32363`, plus the sixth study's seven fixes) plus
seven commits. It is not the published 0.1.2: `node dist/cli.mjs --version` still prints `0.1.2`, because the version
was not bumped. Built in the worktree of this branch with `pnpm install --frozen-lockfile` and `pnpm build`; `git diff
2f5f88f HEAD -- src` is empty at the freeze, and the SHA-256 of every file of `dist/` is in `data/build.json`; the run
scripts stop unless `--version` prints `0.1.2` and `dist/` matches `data/build.json` (`scripts/env.sh`). Node 24.21.0,
Edge 158.0.4370.33 (the seventh study ran 157.0.4341.60; Edge updated itself in between), Ollama 0.40.3, `gemma4:12b`
(Q4_K_M) digest `6114515d63c17436a7c0417d82820ac65ad643e2806c5a3c89cb62846436ed0b`; no other model is installed or used.

The seven fixes (CHANGELOG, Unreleased, "Precision fixes from the seventh real-page study"), on top of every rule the
seventh study's pre-registration lists for `385fe13`:

| Commit | Change | Where |
| --- | --- | --- |
| `97cfef5` | 2.4.4: a link inside an element the browser's tree ignores as inert is no candidate | `link-purpose.ts`, `shared.ts` |
| `8e8277e` | 2.4.4: an unread link takes the place of a read link to the same address under another spelling; the collector no longer records an element with `display: contents` as hidden | `link-purpose.ts`, `in-page.ts` |
| `eb0ad61` | 2.4.4: a generic text under a heading that shares a word with the title or main heading read at its address is a suggestion | `link-purpose.ts` |
| `d4926a4` | 2.4.4: a toggle followed by a block of two links or more opens a submenu | `link-purpose.ts` |
| `b544d9b` | 2.4.4: a part that holds only a heading is read as that heading's section | `link-purpose.ts` |
| `ae2d5be` | 2.4.4: a shared-text claim is a finding only when its pair was read at both ends; otherwise it is the model's suggestion (**X6**, the shared-text proof rule) | `link-purpose.ts` |
| `46204eb` | 1.3.2 (experimental `rampa/css-reading-order`): a price, a number or a control set larger is no heading | `reading-order.ts` |

## 2. Pages

**Exclusions** (`scripts/exclusions.py`, `data/excluded-domains.json`). The seventh study's list (2,723 registrable
domains: rounds 1 to 6, the re-measure, the robustness study, every host the repository named at `0bada65`, the sixth
study's pages and files, lines added since `0bada65`, the human-review folder), extended with: the seventh study's 60
pages; every site of the sixth study's 24 pools (the seventh study dealt all their leftovers); every host any file of
the sixth and seventh studies' folders names (candidate lists and screens included, and the seventh study's label files
in its own worktree, read only); every host on a line any commit added since `0bada65` on any ref, outside the sixth to
eighth studies' folders, and in every commit message since (the seventh study's fix commits among them); and every host
the main checkout's `study/human-review-2026-10/` names (the human-review packages and the reviewers' files). 3,180
domains in all. Registrable domains by the Public Suffix List fetched on 2026-11-21 (the seventh study's copy; SHA-256 in
the JSON). Candidates whose first label an excluded domain shares were looked at by hand: two of the same organisation
dropped, the rest kept (`scripts/candidates.tsv`).

**Candidates: new pools.** The sixth study's pool leftovers were all dealt to the seventh study's slots, so new candidates
were found the way the sixth study found its own: the person running the study (an agent) wrote 24 pools, one per stratum and
slot type, 24 sites each, from its own knowledge of public sites of each kind, in an order fixed as written, before any
of them was checked against the exclusions or loaded (`scripts/pools.tsv`, committed in `b04e51d`). The exclusions then
removed 184 of the 576; for the eleven pools left with fewer than 16 sites, a second list of 12 to 16 sites each was
written the same way, still before any load, and appended to those pools (`scripts/pools-2.tsv`, committed in
`d562d8e`; only the survivor counts were read before it was written). Dealt in written order (`scripts/deal.py`): 191
excluded, one duplicate registrable domain and two look-alikes dropped, 541 candidates, 5 to 14 a slot
(`scripts/candidates.tsv`, committed in `8aff965` before any candidate loaded).

**Design.** 60 pages, **all test** (no dev half), five blocks of 12: one page per stratum in each block, over the sixth
and seventh studies' twelve strata (Brazil or international, times government, education, news, e-commerce, health,
culture or public services), so 5 pages per stratum, no site twice; Brazilian pages in Portuguese, the others in
English. The generator `random.Random(202611218)` (**seed 202611218**, the date and the round, written in
`scripts/deal.py` and committed in `8aff965` before any candidate loaded) drew six home-heavy strata (br-edu, br-gov,
br-health, br-shop, in-edu, in-news: home pages in blocks 1, 3 and 5, inner pages in 2 and 4; the other six the reverse),
so each block has 6 home and 6 inner pages and the study 30 and 30. Inner pages follow the sixth and seventh studies'
rules (`scripts/pick.py`): a Brazilian court's, prosecution service's or court of accounts' ombudsman or contact page;
an international government search form (the pool names it); a university's undergraduate page; the first article in
the content of a news or health home page; a store's first product category; a cultural body's contact page.

**Screen** (`scripts/screen.mjs`, `scripts/screen_pass.py`, `data/screen-*.json`): the sixth and seventh studies' rules,
written in the header of `scripts/candidates.tsv` with the seventh study's readings. Slot by slot, candidates in order
until one passes (every candidate before a slot's choice is screened); a network failure or time-out is screened once
more later. For an inner slot, the site's home page is screened, the inner page picked from its link listing and
screened again. Client addresses and query strings are redacted from the kept screen files (`scripts/redact.py`). The
choice of each slot, with the candidates before it that failed, is in `scripts/selection.tsv`, and the pages in
`scripts/pages.tsv` and `data/pages-input.json` (`scripts/design.py`).

**Selection** (2026-11-21, 17:18–17:45, before any Rampa run; `data/screen-1.json` to `screen-6.json`, 190 screen rows; link
listings in `DATA/links/`, out of git). 22 of the 60 slots went to a backup. 25 candidates failed before a chosen one: 14
answered an HTTP error (12 of them 403), 8 did not load in two tries, 1 showed a bot check, 1 showed almost nothing and 1
declared another language. On three inner sites the page could not be taken: two theatres linked no contact page (one
after a redirect to the site it shares with another venue) and one health charity linked no story in its content.
Readings applied during the selection, before any Rampa run, as in the seventh study (each in `scripts/selection.tsv`):
a seasonal collection, a store's sale and a season's collection are not product categories; a tuition and aid page, a
newsletter sign-up, a library document and a programme page are not the page the rule asks for; a fragment or a
tracking query string is dropped, a query string that chooses a level or a mode is kept, and an inner page that
redirects is taken at its target; a site's menu that headless Edge sees outside a `nav` element is not its content
(iG); a member's story is a story (Down Syndrome Ireland, past `pick.py`'s slug rule). Two article pages timed out once
and passed when screened again; one site's link listing timed out once and was taken again. Flags cleared by a look: a
site with Portuguese text and no `lang` attribute; two redirects to the same organisation's own domain (`iu.edu`,
`kilkennydesign.com`); five first-label look-alikes, different organisations.

**T4 subset**: after the pages were fixed, the same generator (after the six-strata draw) drew one page per stratum, in
sorted stratum order, from its five pages sorted by slot (`scripts/design.py`, `t4Subset`): the Medical Council's register search, the Leicester Mercury, PUC-Campinas's undergraduate page, TJRJ's
ombudsman page, a news story of the Brazilian endocrinology society, Syracuse's undergraduate programmes, Barnes & Noble,
Sala São Paulo's contact page, a MetSul article, Cantão's dresses category, Pavilion Theatre's contact page and Down
Syndrome Ireland's member story.

## 3. Method

The seventh study's, except as listed. Every `rampa check` runs with `--wcag 2.1`; each page runs with its own folder
under `C:/Users/guilh/dev/rampa-study-recordings/round-8/pages/<slug>/` as the working directory (out of git, short
paths: long paths are off on this PC), with `RAMPA_MODEL` and every API-key variable unset (`scripts/env.sh`). Pages run
one at a time, in block order. No Rampa or Ollama run of another study runs at the same time (the seventh study's T4
ended at 17:12, before the screen).

- **Collection, no model call** (`scripts/collect.sh main`): `rampa check <url> --wcag 2.1 --model ollama:gemma4:12b
  --offline --locale en --min-confidence low --save <dir> --screenshots --timings`, Edge through playwright-core.
- **Main judgment** (`scripts/run-judged.sh main`), once per page, from an empty cache: `rampa check <snapshot> --wcag 2.1
  --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --timings`, second pass on;
  Ollama at http://127.0.0.1:11434, temperature 0. No hosted model anywhere. Between pages the script waits while the
  GPU is above 83 °C or under 2 GB of memory is free.
- **Ablations: counts only**, as in the seventh study: `--offline --no-verify`, `--offline --no-confirm` (each on a fresh
  copy of the main cache) and `--no-llm` on every snapshot after the main run (minutes, no model call); reported as the
  findings each adds or removes at the default threshold, not labelled. `scripts/packets.py` reads the first two only to
  word a drawn held-back or discarded pass-sample claim.
- **Five uncached runs (T4), after the main run and the packets**, as in the seventh study. On the T4 subset, at
  `--concurrency 2`: full mode, the main command four more times, each from its own empty cache (the main run is the
  first of five); then fast mode, one live `--fast` collection judged five times with `--fast`, each from an empty cache.
  A page counts in a mode only when all five runs finished. The judges may label while T4 runs (T4 touches neither
  `packets/` nor `labels/`).
- **Labels.** One packet per page (`scripts/packets.py`), items in one form, shuffled with
  `random.Random("202611218:<slug>")`: every judgment and rule finding of the main run at any confidence; the chosen
  suggestions (every 2.4.2 and 3.3.2 suggestion and every suggestion on a page read as unstyled, then 12 drawn per block
  with `random.Random(202611218)`, at most 3 a page; `scripts/sample_suggestions.py`); the pass sample (below); and the
  X6 sample (section 5, measure h). No confidence, patch, suggestion quote or run name in a packet. Two Claude judge
  agents per packet, an auditor and a skeptic, independent, with **the seventh study's rubric, unchanged**
  (`judge-rubric.md`, byte for byte the seventh study's file, R1 and R2 included, so that the two rounds are comparable;
  its title still names the seventh study) and the seventh study's prompt with this round's paths
  (`scripts/judge_prompt.py`, `scripts/judge-prompt.txt`); three answers per item (`claimTrue`, `elementFails`,
  `captureDiffers`, each `yes`, `no` or `cannot_tell`) and the label that follows by the rubric's rule. Final label: the
  one both judges gave, else `uncertain`; a false positive's cause the one both named, else `disputed`. The prompts are
  written to `judge-prompts/` with `index.json` (entries `{file, packet, role, findings, labels}`, largest packets
  first); the judges are launched from the main session, apart from the runs; `scripts/check_labels.py` checks their
  files.
- **Pass sample (secondary)**, the seventh study's design on all 60 pages: 1.1.1 and 2.4.4 judged candidates that are not
  findings, in three strata (passed, discarded, held back); 60, 20 and 20 per criterion (all when fewer); ascending
  SHA-256 of `rampa-round-8-passes|<slug>|<criterion>|<ref>` (`scripts/pass_list.ts`, which stops unless each page's
  listing matches the main run's report; `scripts/pass_draw.py`). A passed row has no claim and is labelled on
  `elementFails` and `captureDiffers` only.
- **Order**: collection, main judgment, ablations, `compact.py`, `pass_list.ts`, `pass_draw.py`, `x6_draw.py`,
  `sample_suggestions.py`, `packets.py`, `judge_prompt.py --all`, then T4 (full, then fast), `compact.py`, `hashes.py`
  and `t4.py`.
- **Kept in git**: the compact reports (`scripts/compact.py`, `pages/<slug>/*.judged.json`), timing records, packets and
  prompts; recordings, screenshots, caches and full reports stay out of git, hashed in `data/recordings.json`.

## 4. Primary measure and decision rule (unchanged)

**Precision per element at the default threshold over the judged criteria, all 60 pages (test)**: judgment findings of
the eight default criteria (1.1.1, 1.3.5, 2.4.2, 2.4.4, 2.4.6, 3.1.1, 3.1.2, 3.3.2), not experimental, medium confidence
or above, from the main run; TP / (TP + FP), uncertain left out (the decided items); the judges' final labels. The
thesis article's target, unchanged:

- **favourable**: precision ≥ 0.90 **and** Wilson 95% lower bound ≥ 0.80;
- **inconclusive**: Wilson lower bound < 0.80, whatever the precision;
- **under the target**: precision < 0.90 and lower bound ≥ 0.80.

The article sizes a round for at least 70 decided findings; **below 70, the count and the reading are reported as they
come**, with no page added. Every number is named AI-judged and held-out.

## 5. Pre-registered secondary measures

None of these decides. Each is reported with the primary, named AI-judged and held-out:

- **(a) The primary measure without judged 2.4.4**: the same population and computation with every judged 2.4.4 finding
  left out, read by the same rule (precision, Wilson, the 70-decided note). Registered now so that the number is not
  post hoc: the author will decide later whether judged 2.4.4 stays in the default.
- **(b) Judged 2.4.4 alone**: TP, FP, uncertain, precision and Wilson of the primary's 2.4.4 findings.
- **(c) Page bootstrap** of the primary precision (and of a and b): 10,000 resamples of the 60 pages,
  `random.Random(202611218)`, a resample with no decided finding skipped and counted; 2.5th and 97.5th percentiles.
- **(d) Precision per same-name link set**: 2.4.4 shared-text findings (claim `ambiguous`, "is shared by") grouped by
  page and normalised link text; one unit per set, its label the majority of its members' final labels (a tie
  `uncertain`); every other primary finding one unit.
- **(e) Share of uncertain** among the primary findings, target ≤ 15%.
- **(f) Per criterion**: TP, FP, uncertain and precision per criterion.
- **(g) T4 stability at the decision level**, target ≥ 0.95, per mode (full, fast): five uncached runs on the 12-page T4
  subset; for each judged candidate of the eight criteria (the population: `criteria[].candidates` of the first run),
  Rampa's decision in each run, one of *default-threshold finding*, *finding below the threshold*, *suggestion* or
  *nothing*, read from the reports by criterion and element; the share of candidates with the same decision in all five
  runs, with Wilson's interval (`scripts/t4.py`). Beside it: the prompt-level share and the share of default-threshold
  findings present in all five reports.
- **(h) The cost of the shared-text proof rule (X6)**: the shared-text claims the rule moved to suggestions in the main
  run, counted (`scripts/pass_list.ts` marks a 2.4.4 claim `ambiguous` held back as ungrounded only because its pair was
  not read at both ends: `grounded` accepts it once the `sameTextUnread` fact is taken away), in all and at the
  confidence they would have had (medium or above: the default threshold). Of those at the default threshold, up to 20
  are drawn (ascending SHA-256 of `rampa-round-8-x6|<slug>|<ref>`, `scripts/x6_draw.py`) and put in the packets as
  suggestion rows in Rampa's own words (an item already in a packet is marked, not repeated). Reported: the counts, the
  drawn claims' labels (TP, FP, uncertain, the share true with Wilson's interval) and the estimate of real failures the
  rule moved, that share times the count at the default threshold, with the Wilson bounds times the count. The rule also
  changes which links are judged first under the cap of 50; that effect is not counted.

Secondary, as in the seventh study: true findings axe-core does not report on the same element and criterion (Wilson);
per group (6 or more findings of one claim on one page, one unit); per page; per block (exploratory); every finding at
any confidence; the "fails for any reason" reading (`elementFails` `yes`); sensitivity (without the largest page;
uncertain as true and as false); experimental rules; the suggestion sample; false-positive causes by criterion and check
(counted, not read for patterns); judge agreement (raw and Cohen's kappa: consistency, not validity); time per page
(median and 90th percentile, collection plus judgment, full and fast); the ablation counts; recall among judged
candidates (1.1.1, 2.4.4, the sixth study's estimator); and the comparison with the seventh study (0.742, 69 of 93
decided, the code before its fixes, other pages: exploratory), Newcombe's interval and an unpaired page bootstrap,
**went up** only when both lie above 0.

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
  `scripts/analyze.py` and `scripts/check_labels.py` were adapted and run before this commit on a copy of the seventh
  study's folder with its labels (outside the repository): they give that study's primary count (69 true, 24 false, 12
  uncertain, Wilson 0.645–0.820, "inconclusive"), judge kappa 0.935, its recall and axe-core numbers, and 0 label
  problems; measure (h) was run on synthetic rows.
- **What the person running the study sees**: capture notes (title, size, capture record) and counts. No finding, label
  or judge rationale of this round is read before the counts are reported; false positives are counted by check, cause
  and stratum, never read for patterns. Every number is named held-out, exploratory or in-sample.

## 7. Run time (estimate, `scripts/estimate.py`, from the seventh study's timings)

Collection about 0.5 h; main judgment about 1.8 h; ablations a few minutes; T4 about 1.4 h (full) plus 0.7 h (fast).
About 4.4 h of machine time after the freeze. Judges: about 120 agents (an auditor and a skeptic per packet).

## 8. What changed from the seventh study

1. Code: `2f5f88f` (the seventh study's seven fixes added); the sixth and seventh studies are in-sample for it, this
   round is held-out.
2. Pages: 60 new pages, all test, five blocks of 12, seed 202611218, from new pools written for this round; exclusions
   extended with the seventh study's pages and files and the sixth study's pools.
3. Rubric: the seventh study's, unchanged (R1 and R2 included).
4. Decision rule: unchanged.
5. Pre-registered secondary measures (a) to (h) in section 5: (a), (b) and (h) are new; the comparison is with the seventh
   study.
6. No human labels; the same two Claude judges, three answers, final label by agreement.
