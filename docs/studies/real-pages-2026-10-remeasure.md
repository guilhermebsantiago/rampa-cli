# Re-measure on the held-out test pages (October 2026)

The [real-page study](real-pages-2026-10.md) split 24 public pages into a dev half and a test half. Its dev findings motivated a set of changes to the judgment layer, and those changes were merged. The test half was never used to choose or tune any of them. This document runs the current code once on the test pages, with the study's settings, and labels the findings with the study's method. It is the held-out measurement the study asked for: "After the changes are made, measure them once on the test split."

**In short.** On the 11 test pages that finished in both runs, precision of the judgment layer went from **0.12 to 0.38 at the default threshold**, which is what a user sees, and from **0.12 to 0.19 with low-confidence findings included**. The biggest single cause of the gain at the default threshold is that 2.4.4 and 2.4.6 claims about ordinary text now sit below the threshold, not better judgments: with low-confidence findings counted, 2.4.4 is still 0 of 27 and 2.4.6 still 0 of 19. 1.1.1 rose from 0.32 to 0.42. Of the 14 true positives of the first run, 13 are still reported. The one lost was dropped by a fix (a suggestion that was only the word "decorative"), every time the model was asked. Precision of 0.38 is still far from usable without a person checking each finding. The labels come from Claude agents, not from people, and the run is a single run.

## What changed since the first run

The first run used commit `46029c1`. This run used `cf7991a`, the head of `main` when it started.

**Changes motivated by dev findings only.** Each one implements a suggestion of the study, numbered as there.

| Commit | Change | Study suggestion |
| --- | --- | --- |
| `98d1436` | A judgment about a title, link text, heading or label that is not on a short list of generic texts is reported at low confidence, below the default threshold. Generic texts keep the model's confidence. | 2, 5 |
| `f1ad285` | 1.1.1 drops a failure whose suggested alternative is a label ("decorative", "none") or only rewords the current one. | 7 |
| `dc46786` | Spam honeypot fields are not candidates for 1.3.5 and 3.3.2. | 9 |
| `92cc902` | A 2.4.4 mismatch is kept only when it rests on a destination that was read and that tells it apart. | 3, 4 |
| `edd9aca` | Each image is captured from its own pixels (lazy images, stacked carousel slides, off-canvas elements), or the report says why it was not. | 8 |
| `05cc331`, `1622935`, `2b703eb` | A functional image (the only content of a link or button) is judged by what the control does. Its "wrong content" claim is dropped when the alternative names the link. A new claim says when the alternative "is all its link holds, and does not say where the link leads". | 6 |
| `c7fe9e3` | 2.4.6 judges headings with their parent heading and their siblings in a series, and labels as people see them. | 10 |
| `a0d3777` | A home page titled with its site's name passes 2.4.2 without a model (technique G88). | 11 |
| `12bcde0`, `5ed6a4d` | At most 50 candidates per criterion are judged on a page, generic texts first (`--max-candidates`), and `--time-limit` writes a partial report. | 12 |

Suggestion 1, which was to make 2.4.4 and 2.4.6 experimental and off by default, was not adopted. Both still run by default, and suggestion 2's confidence change hides most of their findings instead.

**Other changes merged since, which also reach the judged criteria.** These were not chosen from the study:

- more page context in the judged criteria's prompts (`2239c30`);
- text hidden only from assistive technology now read as part of a visible label, and no `p` treated as a heading (`20ae564`);
- a language identifier guarding 3.1.1 and 3.1.2 (`db1885b`);
- open shadow roots and same-origin frames collected (`7d4401c`, `87bcd5c`);
- a wait for the page to settle after `load` (`8c66183`);
- axe-core run in every frame (`7660d60`).

**New checks, reported apart below.**

- A rule stage with deterministic rules: placeholder alternatives, default titles and placeholder text (`8c11b46`), structure rules for 1.3.1 and 4.1.2 (`6decf94`), and a 2.5.3 check on form fields (`0f73230`).
- Rules that measure from pixels: 1.4.3 text contrast that axe-core cannot decide, and placeholder contrast (`1e18577`), 1.4.11 icon contrast (`9bff9ed`), and whether a label that 3.3.2 relies on shows its text (`11b4979`).
- A 1.1.1 judgment of images hidden from assistive technology, ACT rule e88epe (`6555f8c`).

All of these are experimental, so their findings sit below the default threshold. Probes (`--probe`) are off by default and were not run.

## Method

### Pages and run

- **Pages.** The 12 test pages of the study (`study/scripts/pages-input.json`), with the same URLs, including adafruit.com, which timed out in the first run.
- **Command.** `rampa check <url> --model ollama:gemma4:12b --locale en --criteria 1.1.1,1.3.5,2.4.2,2.4.4,2.4.6,3.1.1,3.1.2,3.3.2`. These are the study's model, locale and criteria. The criteria are the defaults, and they are given explicitly here. `--min-confidence` was left at the default (`medium`), as in the study, and there was one run per page with no `--runs`.
- **Time budget.** The study gave each page 900 s. Here that budget went to Rampa as `--time-limit 900`, so a long page writes a partial report instead of being killed, with a hard stop at 1000 s. No page reached the limit: they took 92 to 290 s (median 167 s), against 240 to 736 s (median 386 s) in the first run. `--max-candidates` was left at its new default of 50.
- **Setup.** The browser was Edge, through playwright-core. Each page had a fresh judgment cache, and the pages ran one at a time on the shared local GPU on 2026-10-09, from 22:22 to 22:56 (UTC−3). The first run was earlier the same day.
- **Retries.** As in the study, a page that failed to run was retried once with the same command. padocadomani.com.br did not reach `load` within 30 s on the first attempt; the second attempt finished. The same page needed a retry in the first run.
- **Saved.** Each page's report, snapshot and engine results (`--save`), screenshot and console output.

A report keeps the findings at or above the threshold in `findings` and the rest in `belowThreshold`, so one run gives both numbers. **Default threshold** means the findings a user sees: `findings`. **All findings** adds `belowThreshold`. In the first run every judgment finding said `high`, so the two were the same there.

### Matching and labels

- **Judgment findings only, as in the first run.** Engine (axe-core) findings were not labelled.
- **Reusing labels.** A new finding reuses the first run's two labels when it is on the same page, for the same criterion, and on the same element. Matching tries the fingerprint first, then the ref, then the quoted subject (alt text, link text, heading or title), one old finding to one new finding at most. 73 of the 96 like-for-like findings matched: 72 by fingerprint and one by subject (a g1.globo.com link whose ref had changed).
- **Matches whose claim changed.** Three matched findings now make a different claim about the same element. The method reuses the first run's label for them. They were also labelled again, as a sensitivity check (see below).
- **Labelling the rest.** Every unmatched finding was labelled as the study did. For each page, two independent Claude agents were spawned: an **auditor**, which looks at the snapshot, the screenshot and the live page and decides whether the finding is a real failure, and a **skeptic**, which looks for concrete reasons the finding could be wrong.
  - Each judge got the rubric and an evidence packet for that page's findings, and nothing else. The packet holds the finding as reported, the element from the snapshot with its ancestors, nearby headings and the destination Rampa read, and the image crop the model saw. The judge could also use the page's snapshot, its screenshot and the live page.
  - The judges did not see the first run's labels, each other's labels, or any other page. They were told not to open them.
  - The first run did not save its judge prompts. The rubric used here (`study/remeasure-2026-10-09/judge-rubric.md`) is rebuilt from the study's method section and from its labels' rationales.
  - This took 20 judge agents: an auditor and a skeptic for each of the 9 pages with unmatched findings, and one more pair for the three changed claims.
- **Final label and agreement.** As in the first run, the final label is the label both judges gave. When they differ it is `uncertain`, and a false positive's cause is `disputed` when the judges named different causes. Precision is TP / (TP + FP), with uncertain findings left out, and intervals are 95% Wilson intervals.

### Why a finding of the first run is gone

Three replays explain what happened to each first-run finding.

- **Each candidate's fate in this run** (`scripts/candidates.ts`). The run was replayed offline from the page's own judgment cache. This gives every candidate's status: failed, passed, discarded by verification and why, past the cap, or not judged.
- **The first run's code on today's page** (`scripts/old-code.ts`). The judgment code of commit `46029c1` was run on today's snapshot for each element the first run reported, with one fresh model call each (temperature 0).
  - If the old code still fails the element, its disappearance is due to the code changes.
  - If the old code no longer fails it either, the cause is in the input or the model: the page changed, the new collector reads it differently, or the model answered differently.
- **Fresh answers for the lost true positive** (`scripts/rejudge.ts`). The current code asked the model five more times, with no cache.

## Results

All 12 test pages produced a report, adafruit.com included. The like-for-like comparison uses the 11 pages that finished in both runs. adafruit.com is reported apart.

### Precision before and after

**Test split, 11 pages, judgment findings of the study's criteria.**

| Criterion | Before (first run) | After, default threshold | After, all findings |
| --- | --- | --- | --- |
| 1.1.1 Non-text Content | 12 TP / 25 FP / 7 unc: **0.32** (0.20–0.48) | 15 / 21 / 2: **0.42** (0.27–0.58) | 15 / 21 / 2: **0.42** (0.27–0.58) |
| 1.3.5 Identify Input Purpose | 2 / 3 / 0: 0.40 (0.12–0.77) | 2 / 3 / 0: 0.40 (0.12–0.77) | 2 / 3 / 0: 0.40 (0.12–0.77) |
| 2.4.2 Page Titled | 0 / 3 / 0: 0.00 (0.00–0.56) | no findings | no findings |
| 2.4.4 Link Purpose (In Context) | 0 / 34 / 1: 0.00 (0.00–0.10) | 0 / 3 / 0: 0.00 (0.00–0.56) | 0 / 27 / 4: 0.00 (0.00–0.12) |
| 2.4.6 Headings and Labels | 0 / 32 / 1: 0.00 (0.00–0.11) | no findings | 0 / 19 / 1: 0.00 (0.00–0.17) |
| 3.1.2 Language of Parts | no findings | no findings | 0 / 0 / 1: – |
| 3.3.2 Labels or Instructions | 0 / 1 / 0: 0.00 (0.00–0.79) | 0 / 1 / 0: 0.00 (0.00–0.79) | 0 / 1 / 0: 0.00 (0.00–0.79) |
| **All** | **14 / 98 / 9: 0.12** (0.08–0.20), 121 findings | **17 / 28 / 2: 0.38** (0.25–0.52), 47 findings | **17 / 71 / 8: 0.19** (0.12–0.29), 96 findings |

**Sensitivity checks.**

- **The three changed claims.** Labelled again, both judges called the mit.edu image "colorful cell" a true positive under its new claim: the image is the only content of a link and its alternative does not say where the link leads. The other two kept their labels. With these labels, precision is 0.40 at the default threshold (18 of 45) and 0.20 with all findings (18 of 88).
- **One site.** python.org.br holds 17 of the 47 findings at the default threshold, all of them false positives: user-group logos whose alternative is the group's name. The study already marked these as debatable. Without this page, precision at the default threshold is 17 of 28 (0.61).
- **adafruit.com.** It finished this time, judging 50 of its 336 link candidates and 50 of 158 heading candidates. It adds 6 findings at the default threshold and 7 in all, every one a false positive. Six are 1.1.1 "wrong content" claims about accurate product-photo alternatives. With it, precision over the 12 pages is 0.33 (17 of 51) at the default threshold and 0.18 (17 of 95) with all findings.

The units and caveats of the first study still apply. The findings on one page are correlated, and the intervals assume they are not.

### Findings per page

| Page | Before | After, default | After, all | New-check findings | Seconds before → after |
| --- | ---: | ---: | ---: | ---: | --- |
| www.ibge.gov.br | 20 | 14 | 15 | 2 | 672 → 196 |
| www.usa.gov/state-consumer | 8 | 3 | 6 | 1 | 311 → 92 |
| www.bbc.com (article) | 13 | 0 | 3 | 0 | 485 → 147 |
| g1.globo.com/ciencia | 2 | 0 | 9 | 0 | 279 → 171 |
| docs.python.org (pt-BR tutorial) | 21 | 3 | 21 | 0 | 736 → 163 |
| www.mit.edu | 10 | 7 | 12 | 0 | 386 → 172 |
| www.nhs.uk/conditions/asthma | 4 | 1 | 1 | 0 | 479 → 290 |
| www.accessnow.org/contact-us | 1 | 0 | 1 | 0 | 240 → 147 |
| python.org.br | 33 | 17 | 21 | 2 | 652 → 206 |
| www.padocadomani.com.br/contato | 7 | 2 | 6 | 0 | 292 → 106 (retried) |
| mwpt.com.br/acessibilidade-digital | 2 | 0 | 1 | 0 | 344 → 119 |
| **11 pages** | **121** | **47** | **96** | **5** | |
| www.adafruit.com/category/17 | timeout | 6 | 7 | 1 | 913 (timeout) → 226 |

"Before" counts every judgment finding of the first run, all `high`. "After" counts the judgment findings of the study's criteria. The new checks are counted apart.

**Candidates judged.** Across the 11 pages, 2.4.4 judged 486 of 707 candidates and 2.4.6 judged 217 of 243; the cap left the rest unjudged, 221 and 26. In the first run every candidate was judged: 684 for 2.4.4 and 241 for 2.4.6. The model reported 31 links and 20 headings as failing, against 35 and 33. 2.4.2 decided 3 of 11 titles without a model and failed none, where it had failed 3.

### What happened to the first run's findings

Fate of the 121 judgment findings the first run reported on the 11 pages, by their first-run label:

| Fate in this run | True positive (14) | False positive (98) | Uncertain (9) |
| --- | ---: | ---: | ---: |
| Still reported at the default threshold | 13 | 25 | 0 |
| Still reported, below the threshold | 0 | 33 | 2 |
| Not reported, because of a code change | 1 | 26 | 7 |
| Not reported, and the first run's code no longer reports it either | 0 | 13 | 0 |
| Not reported, element gone from the page | 0 | 1 | 0 |

**False positives.** 73 of the 98 are gone from what a user sees, and 40 are gone from the report entirely.

- **Below the threshold: 33.** All are 2.4.4 and 2.4.6 claims about non-generic text, such as the docs.python.org keyword links, form labels and python.org.br group headings. They stay in the report. `--verbose` or `--min-confidence low` shows them.
- **Gone because of a code change: 26.** The first run's code still fails each of these elements on today's page.
  - The candidate cap: 9. Links and headings on long pages that fell outside the 50 judged, so they were not judged at all.
  - The model now passes the element under the current prompt: 10. Headings judged with their parent and siblings, such as nhs.uk "Do" and "Don't", ibge.gov.br "IndústriaPIM-PF", and the python.org.br "GruPy-RP" and "PyTche". Links judged with their context, such as docs.python.org "while" and mit.edu "Healthier aging" and "Visit". Two linked logos are now judged as functional images: python.org.br "Python Brasil 2026" and the mwpt.com.br logo.
  - The home-page title rule (G88): 3. These were all of the test split's 2.4.2 findings: ibge.gov.br, mit.edu and python.org.br.
  - A 2.4.4 mismatch without a destination that was read: 3. mit.edu "Benefits for all Americans", python.org.br "Slack" and padocadomani.com.br "eventos".
  - A functional image's alternative that names its link: 1. The usa.gov logo.
- **Gone, and the first run's code would not report them today either: 13.**
  - The model passes them under the old prompt too: 8.
  - The cap removed them, but the old code passes them as well: 3.
  - The old code's own verification drops it: 1. The nhs.uk search label.
  - It is no longer a candidate: 1. The usa.gov "Information" icon, which the new collector marks as off screen.

  These 13 are what a re-run would have changed anyway: the page, the collector or the model. They are not evidence for or against the fixes.
- **Element gone: 1.** A g1.globo.com listing item that was no longer on the page.

**Uncertain findings.** The seven BBC lazy-load placeholders ("image unavailable") are gone. The model still fails them, but it suggests a label as the alternative, and the label-only fix drops that. The other two uncertain findings are below the threshold.

### True positives lost

One of the 14 is not reported. This is a recall proxy only: real failures that neither run reported are not counted.

- **What it is.** On ibge.gov.br, the fifth "imagem banner" card icon (`#section_banners … div:nth-of-type(5) > a > div:nth-of-type(1) > img`).
- **Why it is gone.** The model still fails it, with the problem `wrong_content` and the suggested alternative `decorative`. The label-only fix (`f1ad285`) then drops the failure. The first run's code still fails it on today's page.
- **Not variance, not the cap.** Asked five more times with no cache, the model gave the same answer every time, and the fix dropped it every time. The cap was not involved, since the page had only 19 image candidates.

The fix behaved as designed: a "decorative" suggestion would have become `alt="decorative"`. But here the image does fail 1.1.1. Its alternative is the placeholder "imagem banner", the same as on the 11 cards that are still reported. Dropping the patch but keeping the failure, which the study's suggestion 7 named as an option ("drop a failure, or at least its patch"), would have kept it.

The other 13 true positives are still reported at the default threshold: 11 "imagem banner" icons on ibge.gov.br and the two padocadomani.com.br fields without `autocomplete`.

### New findings in the study's criteria

23 like-for-like findings on the 11 pages matched nothing in the first run. The judges labelled 4 true positives, 13 false positives and 6 uncertain.

- **mit.edu, the new functional-image claim: 4 TP and 2 uncertain, all at the default threshold.** These are linked photos whose alternative describes the picture, such as "Kilian Court at MIT" and "77 Massachusetts Avenue in fall", and is all the link holds. Both judges cited H30: an image that is the only content of a link needs an alternative that names the destination. 1.1.1 now has 15 true positives: the 11 ibge.gov.br icons it kept, and these 4.
- **The same claim elsewhere: 1 FP at the default threshold.** The ibge.gov.br header logo, "Logo do IBGE", leads to the home page, which the judges took as a well-established convention.
- **g1.globo.com: 5 FP and 3 uncertain, below the threshold.** These are links inside an advertisement ("TikTok for Business", "Abrir") that the collector now reaches. The five claims that a text is shared by links leading to different places are false positives: every link leads to the same advertiser page. The three lone "Abrir" buttons split the judges.
- **Two more at the default threshold, both false positives.**
  - "Saiba mais" on ibge.gov.br is on the generic list, so it keeps its confidence. The text before it names its section.
  - "PythOnRio" on python.org.br, the site's placeholder Python logo with the group's name as its alternative, like the first run's false positives on that page.
- **The rest, below the threshold.**
  - 2.4.4: "Earth" on bbc.com, "if" and "for" on docs.python.org, and the pagination link "2" on mwpt.com.br, all false positives.
  - 2.4.6: "Buscar Buscar" on ibge.gov.br, a false positive.
  - 3.1.2: an English code string marked as pt-BR on docs.python.org, uncertain.

**The generic list has false positives of its own.** Three of the 2.4.4 findings shown at the default threshold are on the list and all three are false positives:

- "Saiba mais";
- "continue" in the docs.python.org sentence about `break` and `continue`, a keyword link that "continue" matches in the English list;
- "www.asthmaandlung.org.uk", an address that names the organization it links to.

### New checks

These findings come from checks added after the first run. They are labelled the same way and kept out of the comparison above. All are experimental, so none is shown at the default threshold.

| Check | Findings | TP / FP / unc | Notes |
| --- | ---: | --- | --- |
| `rampa/language-switcher-lang` (3.1.2) | 2 | 2 / 0 / 0 | "English" on ibge.gov.br and "Español" on usa.gov without `lang` |
| `rampa/placeholder-contrast` (1.4.3) | 1 | 1 / 0 / 0 | The "Buscar" placeholder on ibge.gov.br |
| `rampa/placeholder-alt` (1.1.1) | 2 | 0 / 2 / 0 | python.org.br logos whose alternative matches the file name, because the file is named after the group; the alternative is the logo's own wordmark. The rule also failed six more elements there, which became one finding each with the judgment that failed them too. |
| `rampa/no-visible-label` (3.3.2) | 1 | 0 / 1 / 0 | adafruit.com search field, labelled by its magnifier button |
| **All** | **6** | **3 / 3 / 0: 0.50** (0.19–0.81) | |

Several new checks produced no findings:

- **Pixel contrast** (`rampa/pixel-contrast`, 1.4.3) measured 87 elements on 8 pages and sent 20 to review.
- **Icon contrast** (`rampa/icon-contrast`, 1.4.11) measured 57 and sent 6 to review.
- **Hidden images** (1.1.1, ACT e88epe): the model judged 4 and failed none that held up.
- **The rest:** the 2.5.3 field rule and the structure rules reported nothing on these pages.

Review items are not failures, and they were not labelled. Six findings are too few to say anything about precision.

### Agreement between the judges

| Set | Findings | Observed agreement | Cohen's kappa |
| --- | ---: | ---: | ---: |
| All newly labelled | 36 | 0.89 | 0.78 |
| Judgment findings of the study's criteria (12 pages) | 30 | 0.87 | 0.73 |
| New checks | 6 | 1.00 | 1.00 |

This is close to the first run's test split, where kappa was 0.76. The judges disagreed on 4 findings, and each became `uncertain`:

- three "Abrir" advertisement buttons on g1.globo.com: the auditor said true positive, the skeptic said uncertain twice and false positive once;
- one mit.edu photo link: the auditor said true positive, the skeptic said uncertain.

Both judges agreed on all three changed claims. On why a finding is wrong they agree less, as before: a cause kappa of 0.40 on the 23 findings both called false positives.

## Caveats

- **One run.** Ollama runs at temperature 0, and five fresh calls about the lost true positive all gave the same answer. But a different GPU load, collector timing or page state still changes what the model is asked, and 13 first-run false positives vanished for such reasons. The first run was also one run.
- **LLM-judge labels, pending human review.** Every label, reused or new, comes from Claude agents. 73 of the 96 like-for-like findings reuse the first run's labels as they are, and the judges here may be a different Claude model from the first run's. The rubric is rebuilt, because the first run did not save its judge prompts. The labels are a pre-annotation, as in the study, and need human review before anyone relies on them.
- **Reuse can carry an old label onto a new claim.** Three matched findings changed their claim. One of them, mit.edu "colorful cell", flips from false positive to true positive when labelled again. The headline numbers keep the reused label, as the method says. The sensitivity check gives the other figure.
- **The pages may have changed.** The first run's snapshots and screenshots were kept out of git, and no content hashes were saved. Only three page titles survive, as 2.4.2 findings, and all three are unchanged.
  - **Refs.** Of the 121 first-run findings, 116 point at a ref that is still in today's snapshot.
  - **What clearly changed.** The g1.globo.com listing (neither of its two old elements is there) and some BBC related-story items.
  - **Advertisements.** g1.globo.com showed an advertisement this time that produced eight new findings.
  - **The collector.** The new collector reads frames, shadow roots and images differently, so today's snapshot differs from the first run's even where the page did not change. The old-code replay separates the judgment code from these input changes. It does not separate the collector from the page.
- **Fewer candidates judged.** The cap left 221 link candidates and 26 heading candidates unjudged on the 11 pages. That removed 9 false positives, but any real failure among those candidates is now unreported too. The first run found no true positive for 2.4.4 or 2.4.6 on the test split, so this measurement cannot show that cost.
- **Small numbers, concentrated.** One site, python.org.br, holds about a third of the default-threshold findings. 1.3.5, 2.4.4 at the default threshold and 3.3.2 have from 1 to 5 decided findings each.
- **The test split is now spent.** These findings have been read. Changes chosen from them would no longer be measured on held-out data. The next measurement needs fresh pages.

## Data and reproduction

All paths are under `study/remeasure-2026-10-09/`.

**Running and labelling.**

- `scripts/run-test-pages.sh` runs the pages, from `scripts/test-pages.tsv`.
- `run-log.txt` and `pages/<slug>/run-*.json` record each attempt: its time, how long it took and its exit code.
- `pages/<slug>/report.json` and `console.txt` are the raw reports.
- `scripts/match.py` matches the findings to the first run's labels and writes `data/matches.json`. It also writes the judges' evidence packets, `packets/<slug>.json`, and `packets/<slug>--claim-changed.json` for the changed claims.
- `judge-rubric.md` is the rubric each judge received.
- `scripts/judge-prompt.txt` and `scripts/judge_prompt.py` give the exact prompt each judge received.
- `labels/<slug>.auditor.json` and `labels/<slug>.skeptic.json` hold both judges' labels and rationales.

**Explaining what disappeared.**

- `scripts/candidates.ts` writes `data/candidates/<slug>.json`, every candidate's fate in the run.
- `scripts/old-code.ts` and `scripts/old-code-all.sh` write `data/old-code/<slug>.json`, the first run's code on today's snapshots.
- `scripts/rejudge.ts` writes `data/rejudge.json`, the fresh answers for the lost true positive.

**Rebuilding the numbers.**

- `scripts/analyze.py` rebuilds every number in this document: `python -I study/remeasure-2026-10-09/scripts/analyze.py`.
- It writes `data/findings.json` (one row per finding with its labels), `data/fates.json` (one row per first-run finding), `data/pages.json` and `data/summary.json`.

**Kept out of git.** As in the first study, the snapshots, engine results, screenshots, image crops and judgment caches are not committed. They are what `candidates.ts`, `old-code.ts` and `match.py` read, and their outputs are committed.
