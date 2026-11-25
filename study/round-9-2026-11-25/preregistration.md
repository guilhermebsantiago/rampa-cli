# Ninth real-page study: pre-registration (2026-11-25)

Committed before Rampa ran on any of these pages, and pushed to GitHub `main` before any page is collected (the author
approved pushing this freeze; the results stay local until the author decides). Only the pre-screen in headless Edge
(`scripts/screen.mjs`, `data/screen-*.json`) and the link listing used to pick inner pages (`scripts/links.mjs`) have
loaded these pages. Nothing here changes after this commit; `run-log-notes.txt` records every decision of the run.

**Question.** A confirmatory measurement of the **published rampa-cli 0.1.3** for the thesis: on 36 held-out test pages
none of its code has seen, how often is what `rampa check --wcag 2.1` reports, by the judgment layer at the default
threshold, a real failure (the article's P2)? Beside it, on the same 72 pages: the 36 dev pages, fast mode (`--fast`) and
its precision on the test half, recall from a small audit of six test pages, time and model use per page in both modes
with the local model, and a hosted-cost estimate.

**Whose labels.** **AI-judged.** The reference is the final label of two Claude judge agents (an auditor and a skeptic), as
in rounds 3 to 8. No person labels any item of this round, and no human reviewer is involved. Recall rests on one further
Claude agent per audited page (section 6), also AI.

## 0. The deviations of rounds 6 to 8 this round avoids

The thesis article declared these deviations for rounds 6 to 8; this round is designed so that none of them applies:

| | Rounds 6 to 8 | This round |
| --- | --- | --- |
| (a) | fixes were derived from reading test-half errors | no fix at all: the code is the published 0.1.3, frozen; the test half is only counted |
| (b) | no dev half in rounds 7 and 8 | 36 dev and 36 test pages, stratified by block and stratum |
| (c) | pre-registrations kept local, published with the results | this file is pushed to GitHub `main` before any page is collected |
| (d) | everything compressed into about 21 h, rounds feeding fixes | one round on frozen code; nothing of it feeds a fix; the freeze is public before collection |
| (e) | rubric changes altered the use of "uncertain" between rounds | `judge-rubric.md` is the eighth study's file byte for byte (SHA-256 `c0de491aea33ba72b1e69c5b229c8cb37ff518a6623e7231e77e0a49eaa306ef`, also the seventh study's) |
| (f) | fast mode measured on 12 pages only, with no precision labels | `--fast` on all 72 pages; fast-mode precision labelled on the 36 test pages (section 5) |
| (g) | captures and model responses not published (plan, section 5.6) | still not published, by the author's decision, with the reason and a committed SHA-256 manifest (section 9) |
| (h) | recall not audited | a small AI-judged recall audit of six test pages (section 6) |

## 1. Code, frozen

**rampa-cli 0.1.3**: tag `v0.1.3` = `9e4fc69` ("Release 0.1.3", the npm package). The worktree's branch starts at `main`
`af1c105` (0.1.3 plus the merged study folders of rounds 6 to 8); `git diff --stat v0.1.3 HEAD -- src package.json
pnpm-lock.yaml` is empty. Built with `pnpm install --frozen-lockfile` and `pnpm build`; `node dist/cli.mjs --version`
prints `0.1.3`; the SHA-256 of every `dist/` file is in `data/build.json` (24 files, combined
`e755e857eb34124a7f2fd5ad86c8e20514ac2a4e68fb058a4b9de14a7a2c75f4`), and those 24 files are byte for byte the `dist/` of
the published tarball `rampa-cli-0.1.3.tgz` (compared in `data/build.json`). The run scripts stop unless `--version`
prints `0.1.3` and `dist/` matches `data/build.json` (`scripts/env.sh`). Node 24.21.0, Edge 158.0.4370.33, Ollama 0.40.3,
`gemma4:12b` (Q4_K_M) digest `6114515d63c17436a7c0417d82820ac65ad643e2806c5a3c89cb62846436ed0b`; no other model and no
hosted provider is used anywhere in this round (every `*_API_KEY` variable is unset in the shells that run Rampa).

**No change to the tool during the round.** A bug found during the round is recorded as a finding in `run-log-notes.txt`
and the round continues on the frozen code. One known issue is recorded now, before any page: in 0.1.3 the covered-image
rule (1.1.1, no crop of an image that is covered) also skips images that sit under a fixed cookie banner, so those images
get no crop and no 1.1.1 judgment (seen on gov.br on 2026-11-22). A page where it happens stays and is reported.

## 2. Pages

**Exclusions** (`scripts/exclusions.py`, `data/excluded-domains.json`, 3,796 registrable domains by the Public Suffix List
copy of 2026-11-21): the eighth study's list (rounds 1 to 7, the re-measure, the robustness study, every host the
repository named at `0bada65`, every host later lines and commit messages named, the human-review folder); the eighth
study's 60 pages and every site of its pools; every host any file of the sixth to eighth studies' folders names; every
host on a line added since `0bada65` on any ref, or in a commit message since; every host the main checkout's
`study/human-review-2026-10/` names (the human-review packages); and the demonstration hosts `www.gov.br`,
`meu.inss.gov.br`, `servicos.mte.gov.br`, `sso.acesso.gov.br`, `contas.acesso.gov.br` and `servicos.acesso.gov.br` (by
registrable domain: `www.gov.br`, `inss.gov.br`, `mte.gov.br`, `acesso.gov.br`). Look-alikes of the same organisation as
an excluded site or an earlier candidate were dropped by hand before any load (listed in `scripts/candidates.tsv`).

**Candidates: new pools**, as the eighth study built them: the agent running the study wrote 24 pools (12 strata x home
or inner), 30 sites each, from its own knowledge, in a fixed order, committed (`b38f741`) before any was checked or
loaded (`scripts/pools.tsv`). The exclusions removed 43 (every pool kept 24 or more) and the look-alikes 12 more. Dealt in written order to each
pool's three slots (`scripts/deal.py`), committed in `0384952` before any candidate loaded. Two slots exhausted every
candidate in the screen (all nine museum addresses of one did not resolve; all ten news sites of the other refused
headless Edge); each got a supplementary list written before any of its sites loaded (`scripts/pools-2.tsv`, `28aa63f`),
appended to that slot's backups only (`1683587`).

**Design.** 72 pages in three blocks of 24; in each block, each of the twelve strata (Brazil or international, times
government, education, news, e-commerce, health, culture or public services) has a home page and an inner page from two
sites; no site twice; Brazilian pages in Portuguese, the others in English (UK, Ireland, US). Inner pages by the sixth to
eighth studies' rules (`scripts/pick.py`): a Brazilian court's, prosecution service's or court of accounts' ombudsman
page; an international government search form (the pool names it); a university's undergraduate page; the first article
in the content of a news or health home page; a store's first product category; a cultural body's contact page.

**Split, seed `202611259`** (the date and the round), written in `scripts/deal.py` and `scripts/candidates.tsv` and drawn
by slot before any candidate loaded (`data/draws.json`): with `random.Random(202611259)`, for block 1, 2, 3 and, within a
block, each stratum in sorted order, one `random()`; below 0.5 the home page goes to dev and the inner page to test, else
the reverse. Each block and stratum therefore has one page in each half: **36 test pages, 36 dev pages**. The same
generator then draws the optional T4 subset (one slot per stratum) and the six recall-audit slots (section 6).

**Screen and selection** (2026-11-25, 01:11–01:34, before any Rampa run; `data/screen-1.json` to `screen-11.json`, kept
copies redacted by `scripts/redact.py`): the eighth study's rules, written in the header of `scripts/candidates.tsv`.
Slot by slot, candidates in order until one passes; a network failure or time-out is screened once more later. 28 of 72
slots went to a backup, mostly for HTTP 403 or bot checks (UK regional newspapers and some stores refuse headless Edge)
and for addresses that did not resolve. Every choice, with the candidates before it and every reading applied, is in
`scripts/selection.tsv`; the pages in `scripts/pages.tsv` and **`data/pages-input.json`** (page list, block, stratum,
split, T4 subset, audit flag; `scripts/design.py`, which draws the split again and checks it against `data/draws.json`).
Readings applied during the selection, before any Rampa run (each in `selection.tsv`): a redirect to the body that runs
the site (Amigos da Arte for Teatro Sérgio Cardoso, Fundação Energia e Saneamento for the Museu da Energia) or to the
organisation's own domain (Agência Lupa, Hospital Bom Samaritano, Hospital Japonês Santa Cruz) is cleared, and an inner
page is then picked from the listing at the redirect's target; a post in a site's news feed counts as an article
whatever its subject, while a document viewer, a reference page, an event page, a podcast episode or a sign-up does
not; "New In" and a store's Black Friday or Black November listings are not product categories; an open-day event page
and a second-degree programme are not the undergraduate page; a query string that chooses a level or a category is kept.

## 3. Method

The eighth study's, except as listed. Every `rampa check` runs with `--wcag 2.1`; each page runs with its own folder
under `C:/Users/guilh/dev/rampa-study-recordings/round-9/pages/<slug>/` as the working directory (out of git), with
`RAMPA_MODEL` and every API-key variable unset (`scripts/env.sh`). Pages run one at a time, in block order.

- **Main collection, no model call** (`scripts/collect.sh main`): `rampa check <url> --wcag 2.1 --model ollama:gemma4:12b
  --offline --locale en --min-confidence low --save <dir> --screenshots --timings`, Edge through playwright-core.
- **Fast collection, no model call** (`scripts/collect.sh fast`), every page, after the main collection: the same command
  with `--fast`, saving `fast-recording/`. It takes `--screenshots` so that the judges can see the capture of a
  fast-mode finding; the screenshot's own time is a `--timings` stage, reported apart (section 7).
- **Main judgment** (`scripts/run-judged.sh main`), once per page, from an empty cache: `rampa check <snapshot> --wcag 2.1
  --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --timings`, second pass on;
  Ollama at http://127.0.0.1:11434, temperature 0. Between pages the script waits while the GPU is above 83 °C or under
  2 GB of memory is free.
- **Fast judgment** (`scripts/run-judged.sh fast`), once per page, from an empty cache: the fast snapshot judged with the
  same command plus `--fast`.
- **No ablations** in this round (the article's P3 was measured in rounds 6 to 8; this round adds nothing to it).
- **Labels.** Main-mode packets for all 72 pages (`scripts/packets.py`): every judgment and rule finding of the main run at
  any confidence, in one form, shuffled with `random.Random("202611259:<slug>")`; no confidence, patch, suggestion quote
  or run name in a packet. The eighth study's pass sample, suggestion sample and X6 sample are not drawn (the recall
  audit replaces the pass sample). Fast-mode packets for the 36 test pages by the reuse rule (section 5). Two Claude judge
  agents per packet, an auditor and a skeptic, independent, with `judge-rubric.md` (byte for byte the eighth study's) and
  the eighth study's prompt with this round's paths (`scripts/judge_prompt.py`, `scripts/judge-prompt.txt`); three
  answers per item (`claimTrue`, `elementFails`, `captureDiffers`, each `yes`, `no` or `cannot_tell`) and the label that
  follows by the rubric's rule. **Final label: the one both judges gave, else `uncertain`**; a false positive's cause the
  one both named, else `disputed`. The prompts go to `judge-prompts/` with `index.json` (main and fast packets); the
  judges are launched from the main session; `scripts/check_labels.py` checks their files.
- **Order**: main collection (72), fast collection (72), main judgment (72), fast judgment (72), `compact.py`,
  `packets.py`, `judge_prompt.py --all`, `audit.py packets`; then, while the judges and auditors work, the optional T4
  (section 10); `hashes.py`; the analysis once every label and audit file exists and is checked.
- **Kept in git**: the compact reports and timing records (`scripts/compact.py`, `pages/<slug>/`), packets, prompts,
  labels and audits; captures, screenshots, caches and full reports stay out of git (section 9).
- **Analysis scripts.** `scripts/analyze.py` and `scripts/check_labels.py` are adapted from the eighth study's after this
  commit, tested on the eighth study's labels, and committed before the first label file of this round; they implement
  sections 4 to 8 as written here.

## 4. Primary measure (P2): the sixth study's rule, verbatim

Quoted from `study/round-6-2026-10-29/preregistration.md` as frozen in commit **`dae1522`**, section 4, unchanged:

> ## 4. Primary measure (P2)
>
> **Test-half precision per element at the default threshold over the judged criteria**: judgment findings of the eight
> default criteria, not experimental, medium confidence or above, from the main run on the 36 test pages; TP / (TP + FP),
> uncertain left out; the judges' final labels. **Wilson's 95% interval decides**; beside it, a page bootstrap (10,000
> resamples of the 36 test pages, `random.Random(20261029)`, a resample with no decided finding skipped and counted, the
> 2.5th and 97.5th percentiles), which does not decide. The reading, from the article (5.5):
>
> - **favourable**: precision at least 0.90 and Wilson's lower bound at least 0.80;
> - **inconclusive**: Wilson's lower bound under 0.80, whatever the precision;
> - **under the target**: precision under 0.90 and the lower bound at least 0.80.
>
> The article sizes the round for at least 70 decided test findings; **below 70, the count and the reading are reported
> as they come**, with no block added. The pooled 72 pages are a secondary measure. Every number is named AI-judged.

It applies to this round word for word: the eight default criteria are 1.1.1, 1.3.5, 2.4.2, 2.4.4, 2.4.6, 3.1.1, 3.1.2
and 3.3.2; the test pages are the 36 of section 2; the bootstrap keeps the quoted generator, `random.Random(20261029)`.
**The dev half's precision** (the same computation on the 36 dev pages) is reported beside it, and the pooled 72 pages as
the secondary measure the quote names. Every number is named AI-judged and held-out.

## 5. Fast mode (closes P4)

- **Population**: judgment findings of the eight default criteria, not experimental, medium confidence or above, from
  the fast run on the 36 test pages (`common.primary_judged`, the primary's definition applied to the fast run).
- **Reuse rule**: a fast-mode finding that is the same claim on the same element as a main-mode finding of the same page
  reuses that item's final label: same `fingerprint` (Rampa's key of criterion, element and subject) **and** the same
  claim kind (`claim`), matched against the main run's judgment items at any confidence (all labelled). Every other
  fast-mode finding of the population gets its own row in the page's fast packet (`packets/<slug>--fast.json`, built
  from the fast snapshot and the fast screenshot, shuffled with `random.Random("202611259:<slug>--fast")`), judged by the
  same two judges, rubric and prompt. The match of every fast finding is in `data/fast-reuse.json`; dev-half fast
  findings are counted, not labelled.
- **Measure**: TP / (TP + FP), uncertain left out, **Wilson's 95% interval**, the page bootstrap as in section 4, and the
  reading the section-4 rule would give (secondary: it does not decide). Beside it: how many labels were reused and how
  many judged anew, the fast run's finding counts on both halves, and the main-to-fast difference (Newcombe; exploratory).

## 6. Recall audit (small, AI-judged)

- **Pages**: six test pages, one per category (two strata each, Brazil and international), drawn by slot with the split's
  generator before any candidate loaded: `b2-in-culture-i` (Donmar Warehouse's contact page), `b2-in-edu-h` (Birmingham
  City University), `b3-br-gov-h` (Portal Roraima), `b3-in-health-h` (Nottingham University Hospitals), `b2-br-news-i` (an
  Agência Lupa report) and `b2-br-shop-h` (Artwalk).
- **Auditor**: one separate Claude agent per page (not a judge), with `scripts/audit-prompt.txt` (in this commit): it
  audits the captured document (the main snapshot, its screenshot and every image crop the snapshot holds; not the live
  page) for the eight default criteria, applies the rubric's readings (the 2.4.4 context, R1, R2), and lists every
  failure with the criterion, the element's ref, a description, the evidence and a certainty (`clear` or `borderline`).
  It never sees Rampa's findings. Packets and prompts: `scripts/audit.py packets` (`audit-packets/`,
  `audit-prompts/index.json`, the judge prompts' format); its output `audits/<slug>.audit.json`, checked by
  `scripts/audit.py check`.
- **Matching rule**: an audited failure is **reported by Rampa** when the main run of that page has, for the same
  criterion, a **finding at the default threshold** (medium confidence or above and not experimental, from any layer:
  axe-core, a rule or the judgment layer) **or a model suggestion** (a `needsReview` item from the model) whose ref is the
  failure's ref, or an ancestor or descendant of it at most three levels apart in the snapshot's tree; for 2.4.2 and
  3.1.1 (page-level), any such item of that criterion on the page. A failure whose ref is not in the snapshot stays in
  the denominator and is matched only by the page-level rule.
- **Measure**: recall = audited failures reported by Rampa / all audited failures, pooled over the six pages, with
  Wilson's 95% interval and a page bootstrap (10,000 resamples of the six pages, `random.Random(20261029)`); per
  criterion counts. Beside it: `clear` failures only; default-threshold findings only (no suggestions); any finding at
  any confidence or any review item; the judgment layer alone. No target. It is never called Rampa's recall without
  saying: six pages, one AI auditor per page, failures not checked by the judges.

## 7. Time and cost, both modes, all 72 pages

- **Time per page**: collection plus judgment, wall-clock from the run records (`run-*.json`), median and 90th percentile,
  per mode; beside it, the same without the full-page screenshot stage of the collection (`--timings`), which a run
  without `--screenshots` does not take. The article's target, median at most 2 minutes a page in fast mode, is read on
  both. Per-stage and per-criterion times from `--timings` are kept in the compact files.
- **Model use**: calls and input and output tokens per page from each judgment report's `usage`, median and total, per
  mode (the collection makes no model call).
- **Cost**: **R$ 0 locally** (no API; hardware and power not counted). **Hosted-cost estimate**, labelled as an
  estimate: tokens x the per-token prices in `docs/models.md` (USD per million tokens, in / out, checked 2026-10-07): the
  primary estimate at `openai:gpt-6-luna` (0.10 / 0.50, the author's hosted default), and the same for every other priced
  row of that table. Gemma's token counts stand in for each hosted model's tokenizer and image accounting, so the
  estimate is indicative only; it is given in USD, not converted.

## 8. Co-registered and other secondary measures

As in the eighth study, none decides, each named AI-judged and held-out: (c) the **page bootstrap** of the primary
(section 4); (d) **precision per same-name link set** (2.4.4 shared-text findings grouped by page and normalised link text,
one unit per set, majority label, a tie uncertain); (e) the **share of uncertain** among the primary findings (target at
most 15%); (f) **per criterion** TP, FP, uncertain and precision; the **axe-core overlap** (true primary findings
axe-core does not report on the same element and criterion, and on any criterion, Wilson). Also, computed from the same
labels: per group (6 or more findings of one claim on one page); per page; per block (exploratory); every finding at any
confidence; the "fails for any reason" reading; sensitivity (without the largest page; uncertain as true and as false);
experimental rules; false-positive causes by criterion and check (counted, not read for patterns); judge agreement (raw
and Cohen's kappa: consistency, not validity); and the comparison with the eighth study's test half (0.916, 120 of 131,
code `2f5f88f`, other pages: exploratory), Newcombe's interval and an unpaired page bootstrap, **went up** or **went down**
only when both lie on one side of 0.

## 9. Captures and model responses (plan, section 5.6)

The author decided **not to publish** the captures (snapshots, engine results, screenshots, image crops) and the model
responses (Rampa's judgment caches) of this round. They are **kept locally** in
`C:/Users/guilh/dev/rampa-study-recordings/round-9` (and the packets' copies, out of git). Reason: their size (several
hundred MB a round) and that they are copies of third-party page content. So that they can be verified later, a
**SHA-256 manifest** of every file a page's runs wrote (`scripts/hashes.py`, `data/captures-manifest.json`) is committed
with the results. The compact reports in `pages/<slug>/` (findings, suggestions, timings, usage) are committed.

## 10. T4 (optional)

Five uncached runs on the 12-page T4 subset (`data/pages-input.json`, `t4Subset`), as in the eighth study (`run-judged.sh
full2..full5` and `fast2..fast5`; the main and fast runs are the first of five; `scripts/t4.py`), **only if the machine is
free after the packets are built**, while the judges label. Whether it runs depends on time only, never on any result; if
it does not run, the report says so. If it runs, it is secondary (target 0.95 at the decision level).

## 11. Rules fixed now

- **Network drops**: an attempt that fails with a network error does not count; tried again once the connection answers,
  up to three more times.
- **Refusals**: a bot challenge, an HTTP 403, 429, 500 or 503 page, a rate-limit or sign-in page, or a crash that saves no
  snapshot: wait at least 10 minutes, try once more; refused again, the slot's next backup that passed the screen replaces
  it, keeping block, stratum and split (an inner slot's backup has its inner page picked by the slot's rule and screened
  before Rampa runs; a replaced recall-audit page is audited on its replacement). A server redirect loop counts as a
  refusal. Every attempt is logged. This applies to each collection (main and fast) separately; a page whose fast
  collection fails after these tries stays in the main measures and is counted as missing in fast mode.
- **An unstyled capture is not a refusal**: the page stays and is reported.
- **Once**: each page is collected and judged once per mode; nothing is redone because of what Rampa found; `src/` and
  `dist/` do not change.
- **Scripts**: every script that runs, lists, draws or builds packets is committed with this file; one changes after it only
  to fix a bug that stops it, never because of what Rampa found, and the change is logged in `run-log-notes.txt`.
- **What the person running the study sees**: capture notes (title, size, capture record) and counts. **The test half is
  only counted**: no test-half finding, label or judge rationale is read to change anything. The dev half may be read for
  diagnostics; nothing in the tool changes either way. Judges and auditors that stop or write a file with format problems
  are launched again from scratch.

## 12. Run time (estimate, `scripts/estimate.py`, from the eighth study's timings)

Main collection about 0.9 h, fast collection 0.3 h, main judgment 2.4 h, fast judgment 0.8 h: about 4.4 h of machine time
after the push. Judges: about 144 agents for the main packets (an auditor and a skeptic per page) plus two per test page
with new fast-mode findings; six recall auditors.

## 13. What changed from the eighth study

1. Code: the published 0.1.3 (`9e4fc69`; the eighth study's `2f5f88f` plus a 1.3.5 fix), frozen; nothing changes during
   the round.
2. Pages: 72 new pages, three blocks of 24, dev and test halves (36/36), seed 202611259, new pools; exclusions extended.
3. Primary measure and decision rule: the sixth study's section 4, verbatim (section 4 here).
4. Rubric: unchanged, byte for byte.
5. New: fast mode on every page with labelled test-half precision (section 5), the recall audit (section 6), time and
   model use in both modes with a hosted-cost estimate (section 7), the captures manifest (section 9).
6. Dropped: ablations, the pass, suggestion and X6 samples; T4 optional.
7. The pre-registration is pushed before collection.
