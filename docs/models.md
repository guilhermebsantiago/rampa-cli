# Choosing a model

Rampa asks a model only what axe-core cannot decide, one WCAG criterion at a time, and keeps a claim only when its evidence checks out against the page. A model that judges alt text well can still misjudge link purpose, and a cheap model can be the right choice for one criterion and the wrong one for another. Generic benchmarks do not tell you which. Measuring does: `rampa eval` scores a model on the W3C ACT test cases and on corrupted pairs, and `rampa compare` puts several runs side by side, criterion by criterion.

## Measure, then compare

Run the evaluation once per model, plus once without a model for the baseline:

```sh
rampa eval --no-llm                                   # axe-core alone
rampa eval --model ollama:gemma4:12b
rampa eval --model ollama:qwen3-vl:8b-instruct
rampa compare .rampa/runs/<baseline-run> .rampa/runs/<gemma-run> .rampa/runs/<qwen-run>
```

Each `rampa eval` prints the directory it wrote, such as `.rampa/runs/2026-10-08T03-06-22-openai-gpt-6-luna`; `rampa compare` takes those directories (or any file inside them) in the order you want the columns: A, B, C…

```sh
rampa compare <run> <run> --markdown models.md   # the same tables as Markdown, for a README or a paper
rampa compare <run> <run> --markdown             # Markdown on stdout instead of the terminal view
rampa compare <run> <run> --json results.json    # everything, for your own analysis
```

To make the runs comparable:

- **Same test cases.** Every run records the SHA-256 of the ACT file it used, and `compare` warns when they differ. Do not pass `--refresh` between the runs you want to compare.
- **Same criteria and settings.** `compare` warns when two runs evaluated different cases for a criterion; their `n` will differ. A text-only model cannot judge 1.1.1: evaluate it with `--criteria 2.4.2,2.4.4,2.4.6,3.1.1,3.1.2`, and `compare` shows 1.1.1 as not evaluated by that run.
- **Fresh calls for speed.** Judgments are cached by prompt, image, model and settings, so a second run of the same model is free and has no latency to report (`all cached`). To time a model, give the run its own cache: `rampa eval --model … --cache-dir .rampa/cache-timing`.
- **Settings that change answers** (`--runs`, `--no-verify`) show next to each run. `--reasoning` is part of the cache key but is not written to the run's summary yet, so keep such runs apart yourself, for example with `--out-dir .rampa/runs-reasoning`.

`--limit n` keeps only the first n test cases of each criterion, in the ACT file's order; for 1.1.1, 2.4.4 and 3.1.2 those are all syntax-rule pages. That is a quick check that a model works with Rampa, not a measure of its judgment.

## Reading `rampa compare`

This is the comparison of two real runs from 2026-10-08, cut to WCAG 3.1.2 (the test fixtures in `test/fixtures/runs`):

```text
WCAG 3.1.2 (AA) — Language of Parts
  set                         run   n  precision (95% CI)  recall (95% CI)     F1
  ACT de46e4 (syntax)         A    19  1.00 (0.70–1.00)    1.00 (0.70–1.00)  1.00
                              B    19  1.00 (0.70–1.00)    1.00 (0.70–1.00)  1.00
  ACT off6ek (semantic)       A    13  0.75 (0.30–0.95)    0.75 (0.30–0.95)  0.75
                              B    13  0.75 (0.30–0.95)    0.75 (0.30–0.95)  0.75
  pairs (intact + corrupted)  A    10  0.83 (0.44–0.97)    1.00 (0.57–1.00)  0.91
                              B    10  0.83 (0.44–0.97)    1.00 (0.57–1.00)  0.91

  pair discrimination  run  corrupted copies told apart
  lang-swap            A    4/5 (0.38–0.96)
                       B    4/5 (0.38–0.96)

  judgment  run  candidates  discarded by verification  cannot tell  calls (new + cached)  s per new call
            A            26                          0            0  26 + 0                           3.8
            B            26                          0            0  26 + 0                           2.6
...
Paired comparison of A and B on 37 shared cases
  criterion  shared  both right  only A right  only B right  both wrong  McNemar p (exact)
  3.1.2          37          34             1             1           1              1.000

  Verdicts that differ (2)
  3.1.2  ACT off6ek (semantic)  Passed Example 4 · expected passed · A failed ✗ · B passed ✓
  3.1.2  ACT off6ek (semantic)  Passed Example 5 · expected passed · A passed ✓ · B failed ✗
```

A is `ollama:gemma4:12b` on a local GPU, B is `openai:gpt-6-luna`. Reading it from the top:

- **Sets.** A *syntax* set measures what axe-core decides; the judgment layer should not make it worse. A *semantic* set is where the model earns its place: axe-core has recall 0 there. *Pairs* are passing pages next to copies broken on purpose (an `alt` becomes `img-1`, a `lang` becomes another valid language); a tool that is not judging gives both the same verdict.
- **Scores are per page.** A page fails when axe-core or a verified judgment fails it, as in `rampa eval`. Precision is how often a failed page really fails; recall is how many failing pages were caught. Rampa treats false positives as a constraint, so read precision first: a noisy model is one teams switch off.
- **Intervals are wide on purpose.** The 95% Wilson interval for 0.75 on 13 pages runs from 0.30 to 0.95. When two runs' intervals overlap this much, these pages cannot rank them; the difference has to show up again on more, and fresh, pages.
- **Pair discrimination** counts corrupted copies whose intact page passed while the copy failed.
- **Judgment.** *Discarded by verification* counts claims whose evidence did not match the snapshot: a model that misquotes or invents loses those claims, and a discarded fail never reaches a report, so a high count lowers recall. *Cannot tell* counts abstentions. *Seconds per new call* is the model time of fresh calls only.
- **All criteria, per run** adds tokens and cost. The cost is the one the eval recorded with its price table (`rampa models` lists the prices and their date); a local model shows "local model, no API cost", which leaves out your hardware and power.
- **Paired comparison**, for exactly two runs, matches the runs case by case on the pages both evaluated. *Only A right* and *only B right* are the cases where they disagree, and McNemar's exact test asks whether that split could be a coin flip. Here it is 1 against 1, p = 1.000: these pages cannot tell the two models apart. A large p means exactly that, not that the models are equally good. With six criteria there are six tests and no correction, so one small p among them can be chance.
- **Verdicts that differ** lists those cases with a link to each ACT page. Open them: they show what the models disagree about better than any score.

## Agreeing is not being right

Two models that give the same verdict are not thereby correct. The paired table counts *both wrong* separately because no comparison between two models can reveal those errors; only the reference can.

- In the run above, Gemma and gpt-6-luna agree on 35 of 37 pages, and on one of those 35 both are wrong. The README's evaluation notes that, on 1.1.1 and 3.1.2, the model errors of the two fell on the same bilingual sentence.
- In the smoke tests of 2026-10-08 below, `gemma4:12b`, `qwen3-vl:8b-instruct` and `ministral-3:14b`, three model families, all failed the same passing ACT page, `<button role="link">Click me for WAI!</button>`, as a generic link text. The ACT case expects a pass, and the text does say where the link goes. `qwen3.5:9b` made the same claim; verification dropped it for another reason. Four models agreeing would have looked like certainty.
- Models share training data and habits, so their errors correlate. A majority of models is not ground truth, and a rule such as "report only what two models agree on" trades recall for precision; measure it with `rampa eval` before you rely on it.
- The same holds within one model: `--runs 5` with all five votes agreeing is consistency, not correctness.

The reference is the ACT expected outcome or a person. That is also why every Rampa report ends with what was not checked.

## Choosing per criterion

1. Look at the semantic sets and the pairs of each criterion, precision first, with the intervals in mind.
2. Among models the data cannot separate, prefer the one with fewer discards and abstentions, then the cheaper or faster one, or the one that keeps pages on your machine.
3. Check the differing cases yourself before you trust a difference.

Rampa uses one model per run. To use different models for different criteria, run `check` once per group; each report states its own coverage:

```sh
rampa check site/ --criteria 1.1.1 --model ollama:qwen3-vl:8b-instruct
rampa check site/ --criteria 2.4.2,2.4.4,2.4.6,3.1.1,3.1.2 --model ollama:gemma4:12b
```

## Local models on a 16 GB GPU

These Ollama models take images, follow Rampa's JSON schemas and fit a 16 GB GPU at Q4. They were pulled and smoke-tested on 2026-10-08 with Ollama 0.40.1 on an RTX 5060 Ti 16 GB; none of the new ones has been through a full `rampa eval` yet, so this is a list of models that work with Rampa, not a ranking.

| Model | On disk | VRAM, 4k context | Thinking mode | Generation, fastest seen | One 1.1.1 judgment | Store example: planted problems found |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| `ollama:gemma4:12b` | 8.0 GB | about 8.5 GiB | yes, off in Rampa | 85 tokens/s | about 1.5 s | 8 of 8, nothing discarded |
| `ollama:qwen3.5:9b` | 6.6 GB | 5.2 GiB | yes, off in Rampa | 58 tokens/s | about 2 s | 6 of 8, 2 claims discarded |
| `ollama:qwen3-vl:8b-instruct` | 6.1 GB | 5.4 GiB | none | 63 tokens/s | about 2.3 s | 7 of 8, 1 claim discarded |
| `ollama:ministral-3:14b` | 9.1 GB | 8.1 GiB | none | 45 tokens/s | about 2.5 s | 8 of 8, nothing discarded |

- **VRAM** is what Ollama allocated with its default 4,096-token context, read from `/api/ps` (for Gemma, `/api/ps` reports 1.0 GiB on Ollama 0.40.1, so the figure comes from the buffers in the server log). Two of these models fit on the GPU together only if their sum stays under about 14 GiB; otherwise Ollama unloads one to load the other.
- **Speed** is Ollama's own timing for one 1.1.1 judgment with an image, the model already loaded: generation rate and the time of the whole judgment. On a GPU shared with other jobs, the end-to-end time of a run is dominated by waiting and by models swapping in and out (during these tests the same model took from about 2 s to several minutes per judgment), so time your own runs on your own machine with a fresh cache.
- **Thinking.** Gemma 4 and Qwen 3.5 think by default in Ollama. Rampa turns reasoning off for local models, which keeps a judgment to a few seconds; `--reasoning` turns it back on, and `rampa eval` measures whether it helps.
- **Image tokens differ.** With the same 400 × 300 image, a 1.1.1 prompt was about 570 tokens for Gemma, 600 for Qwen 3.5, 680 for Ministral and 1,500 for Qwen3-VL, which turns an image into more tokens. Loading a model took 8 to 19 s, longer when another model had to be unloaded first.

### What the smoke tests showed

Two commands per model, on 2026-10-08:

```sh
rampa eval --limit 8 --criteria 1.1.1,2.4.4,3.1.2 --model ollama:<model>
rampa check examples/store/before.html --model ollama:<model> --verbose
```

- **The store example** plants eight problems for the judgment layer: three alt texts (`IMG_2034.jpg`, "Ceramic coffee mug" on an umbrella, "product" on a plant), the title "Untitled document", a "Click here" link, the heading "Section 2", the label "Field 1" and Dutch text marked `lang="es"`; an accurate alt and a correctly marked Portuguese quote must pass. No model flagged anything outside those eight, and every miss was a claim that verification dropped: Qwen 3.5 twice gave a fail verdict with no suggested text, and Qwen3-VL suggested a heading longer than the limit.
- **Quotes copied with their delimiters.** Qwen 3.5 and Ministral sometimes copy a quote with the quotation marks or the tag the prompt shows it in, such as `"product"` or `<title>Untitled document</title>`. Verification used to drop those claims: Qwen 3.5 found 4 of 8 and Ministral 6 of 8 on the first runs. Rampa now tries such a claim once more without one or two layers of quotation marks or a matching tag, and still drops it if the quote does not match; replayed from the same cached answers, they find 6 and 8. A claim that held as written is never changed.
- **Thinking on.** With `--reasoning provider-default`, Qwen 3.5 thinks as Ollama has it by default. It then found 7 of 8 with nothing discarded, but it wrote about 20 times more tokens (20.7k output tokens for the page against 1.0k), the check took 11 minutes instead of 32 seconds on the same shared GPU, and 2 of its 13 calls ended without an answer ("No output generated"), which is where the eighth problem went.
- **The evaluation smoke test** ran the first eight ACT test cases of each criterion, all syntax-rule pages, so it says that a model works with Rampa, not how well it judges. All four completed. Gemma, Qwen3-VL and Ministral failed the same passing page (see *Agreeing is not being right*). Three pages of the Qwen3-VL run failed to load during a network drop and were left out.

Candidates found on ollama.com but not tried here: `minicpm-v4.5` (8B, 6.1 GB, 40K context), the smaller Gemma 4 `e4b` and `e2b`, and `granite3.2-vision:2b` for documents. Mistral Small (24B) and the 27B Qwen models need about 15 to 17 GB at Q4 before the context, too much for a 16 GB GPU that also drives a desktop. `clef-flash` is a decision model with its own API, not a chat model, so it cannot answer Rampa's schemas.

To add a model to `rampa models`, check its id and image input on the provider's own page and add it to `src/providers/models.ts` (see CONTRIBUTING.md); keep the recommendation for what `rampa eval` and `rampa compare` show.
