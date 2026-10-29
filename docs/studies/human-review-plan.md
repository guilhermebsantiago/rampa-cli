# Human review of the real-page labels: sampling rule, blindness and analysis (2026-10-29)

Every precision number of the real-page studies rests on labels by two Claude agents of one family (an auditor and a skeptic). Their agreement (kappa 0.82–0.92) measures consistency, not correctness. The [round-5 notes](notes-precision-round5.md#4-what-showing-09-or-more-would-take) and the [precision-fix notes](notes-precision-fixes.md#6-what-a-fifth-round-should-fix-in-advance) ask for a blind human sample before round 6, and the thesis article commits to one: about 100 findings labelled by the author, and 30 of them by a second person, with Cohen's kappa of 0.61 or more between the two. This note fixes how that sample is drawn, what the labellers see, and how the labels are compared with Claude's. Everything lives in [`study/human-review-2026-10/`](../../study/human-review-2026-10/).

This rule and its scripts were committed before the draw; the commit that adds the package comes after it.

## 1. What the sample is drawn from

From rounds 3, 4 and 5 (`study/round-3-2026-10-23`, `round-4-2026-10-24`, `round-5-2026-10-28`, each `data/findings.json` and `data/pages.json`):

| Part | Population | Size |
| --- | --- | ---: |
| J, default-threshold judged findings | origin `main` (round 3 has none), group `judged`, `shown`: what each study's precision counts, minus the three burst pages | 193 |
| B, burst pages | the same findings on round 3's `ufpe-br` (50), round 4's `toolstation-plumbing` (50) and `museudoamanha` (8) | 108 |
| S, suggestions | the items reported as needing review that rounds 4 and 5 already drew and had the judges label (origin `suggestion-sample`; 39 and 48) | 87 |

J and B together are the 301 findings behind the studies' default-threshold precision (round 3: 141, round 4: 95, round 5: 65).

## 2. The rule

Seed: `rampa-human-review-2026-10-29`. All ordering is by SHA-256, so the draw does not depend on a library's random generator: an item's draw key is SHA-256 of `seed|study|slug|key`, smallest first.

- **J, 66 items.** Strata: study × half (dev, test) × criterion × Claude final label (true, false, uncertain), 40 non-empty strata. Each stratum gets one item; the other 26 are shared in proportion to what is left in each stratum (N_h − 1), by largest remainder (ties: the larger stratum, then the stratum's name). Inside a stratum, the items with the smallest draw keys.
- **B, 24 items.** All 8 of `museudoamanha`. From each 50-finding page, 8: walk the page's findings by draw key and keep one when its link text has not been kept yet, until there are 8. The two pages repeat one claim (a link text shared by links to different places) 50 times; 8 different texts check the Claude label on the mechanism without spending a third of the sample on two pages. The rest of each page is represented through the weights (section 5).
- **S, 10 items.** 5 per study (rounds 4 and 5), strata Claude final label, allocated as in J.
- **The 30 for the second person.** The 100 sorted by part, Claude label, study, half, criterion and draw key; then every 100/30-th item from a seeded start (`seed|second-person-start`). Systematic sampling of a sorted list spreads the 30 over the strata in proportion to their share of the 100.
- **Order.** The package lists the items by SHA-256 of `seed|order|study|slug|key`.

The code is [`scripts/common.py`](../../study/human-review-2026-10/scripts/common.py); [`scripts/sample.py`](../../study/human-review-2026-10/scripts/sample.py) runs it and writes the packages.

## 3. Blindness

The labellers load a package folder (`pacote-100/` for the author, `pacote-30/` for the second person) in Rampa Lab's review mode, at <https://rampalab.guilhermebs.com.br/pt/>. What the Lab shows was read from its source (rampa-lab `README.md` "Review mode", `src/lib/review-input.ts`, `review-labels.ts`, `review.svelte.ts`, `src/components/ReviewItem.svelte`): for a study row, the claim (message), criterion, the check, the list it was reported in, confidence, maturity, element, fingerprint, the study folder and half, the evidence quote, the HTML, the suggested fix, and the judges' labels and rationales when "Mostrar os juízes do estudo" is on.

So a package row keeps only `slug`, `fingerprint`, `criterion`, `source`, `ruleId`, `message`, `evidence`, `ref` and `html`. It leaves out:

- the judges' labels, causes and rationales, the final label and cause, and whether the judges agreed;
- Rampa's `confidence`, its suggested fix (`patch`) and suggested text (`suggestionEvidence`), the second pass's probabilities (`confirmation`, `cut090`);
- `shown`, so every item reads "Achado" and none "Abaixo do limiar": the list would say how sure Rampa was, and which items are suggestions;
- the half (`split`), the origin, the sampling reason, the claim kind and `experimental`.

The studies' keys for suggestions start with `s`, which would also tell them apart, so each item gets a neutral fingerprint in the package: the first 12 hex digits of SHA-256 of `seed|fingerprint|study|slug|key`. [`data/sample.json`](../../study/human-review-2026-10/data/sample.json) maps it back and holds no Claude label (nor the stratum, which would name one). A side effect is that a label someone made on a study finding before, or imported from a study's label files, can never show up on a package item: the Lab keys labels by page address and fingerprint.

`sample.py` scans what it writes for the left-out keys, for the label values `true_positive` and `false_positive`, and for the opening of every judge's rationale in the three studies, and stops if one is there. [`scripts/check-lab.mjs`](../../study/human-review-2026-10/scripts/check-lab.mjs) then loads both packages with the Lab's own `readReviewFiles`, `mergeEntries`, `elementContext` and `orderEntries`, imported from the rampa-lab checkout as they are (the Lab is not changed, built or deployed), and checks that every item loads, with no judge, final label, half, confidence, fix or maturity shown, on the one list, with a snapshot that holds its element.

What blindness does not cover:

- The **order**. The Lab sorts items by criterion, then by page in the order the file first names them, then by file order. The seeded order sets the order of the pages and of the items on a page; it cannot interleave criteria without a change to the Lab.
- The **author** has read the studies' reports, which give aggregate counts (for example that the burst pages were labelled false). His labels are blind item by item, not to those aggregates. The second person is blind to both.
- The **claim** itself is shown, since it is what is being judged.

## 4. What the labellers see, and what is missing

- Each page's **snapshot**, cut down to the sampled elements, their ancestors and the destinations of their links (`snapshots/<slug>.snapshot.json`; the full snapshots are in the recordings backup, `rampa-study-recordings/<round>/pages/<slug>/recording/`). With it the Lab shows the element's crop as the model saw it, its role, accessible name, text, states, attributes and HTML, four ancestors, and where a link leads as Rampa read it.
- A **context image** per item, `contexto/<fingerprint>.jpg`: the element outlined in the page's full screenshot, with a margin. The Lab does not show the screenshot, so the image is opened beside it. An item has none when its element was off screen or had no size in the capture; `data/sample.json` lists them.
- The **live page**, one link away in the Lab. It may have changed since the run; the judges were told the same.

Missing, compared with the judges' packets: the nearby headings, the page's and the ancestors' `lang` (which matters for 3.1.1 and 3.1.2; the claim names the language Rampa read), and the full screenshot. Paragraphs (the 3.1.2 passages) have their text in the snapshot but no HTML; the Lab shows the text.

## 5. Labelling and analysis

The labels are the studies' rubric (`study/round-5-2026-10-28/judge-rubric.md`, the same text in rounds 3–5): true positive, false positive with one of five causes, or uncertain, and a note. The packages' `LEIA-ME.md` gives it in Brazilian Portuguese, with what WCAG says about each criterion in the sample; the short version for the second person is in `pacote-30/LEIA-ME.md`. Each person writes their name in "Quem rotula" and exports with "Exportar rótulos".

[`scripts/analyze.py`](../../study/human-review-2026-10/scripts/analyze.py) (`python -I`) takes one or two exports, joins each judgment to its finding through `data/sample.json` and to the Claude labels of its study, and reports:

- per person, agreement with the Claude final label and Cohen's kappa over the three labels, overall, by part, by criterion, by claim kind (read from the message's template, the same for every round) and by study; agreement with each judge; the causes where both say false; and the list of items where they differ;
- between the two people, on the 30, agreement and kappa (the target is 0.61 or more);
- for the author's labels, per study and half: the published Claude precision over every finding; Claude's and the person's precision on the sampled items (Wilson intervals; unweighted, so the over-sampled rare strata and burst pages count as drawn); a **stratified estimate** for every finding, each stratum's labelled share of true and false weighted by the stratum's size (N_h / n_h), with a Wilson interval at Kish's effective n; and the study's own count with the person's label in place of Claude's on the sampled items. All of these are estimates from a sample, and the report says so;
- the sampled suggestions, by Claude and by the person.

Labels outside the sample (the Lab exports every label in the browser) are counted and left out; a note identical to a judge's rationale is left out as copied. `--self-test` checks the arithmetic with Claude's own labels in the person's place: kappa 1, and the stratified estimate gives back each study's published precision exactly, since every stratum holds one Claude label. `check-lab.mjs --synthetic-out <dir>` writes two synthetic exports with the Lab's own `exportLabels`, for testing the script; they say "synthetic" in the labeller's name and note, the report prints a banner over them, and the script refuses to write them inside the study folder. No human label is in the repository until the labellers export theirs.

Where a human and the Claude label differ, the human label takes precedence in what the thesis reports, as the round-5 notes propose; if agreement on `1.1.1 wrong_content` or `2.4.4 shared_text` is under 0.8, the Claude labels on that claim are a pre-annotation only.

## 6. Reproduce

From the repository root:

```sh
python -I study/human-review-2026-10/scripts/sample.py                  # the draw and both packages (needs the recordings backup)
node study/human-review-2026-10/scripts/check-lab.mjs                   # the Lab reads both packages blind (needs a rampa-lab checkout)
python -I study/human-review-2026-10/scripts/analyze.py --self-test
python -I study/human-review-2026-10/scripts/analyze.py <author export> [<second person's export>] --out report.md
```

`sample.py` reads the recordings from `C:/Users/guilh/dev/rampa-study-recordings` (or `$RECORDINGS`, or `--recordings`) and needs Pillow for the context images; `check-lab.mjs` imports the Lab from `C:/Users/guilh/dev/rampa-lab` (or `$RAMPA_LAB`, or `--lab`) and needs its `node_modules` (zod).
