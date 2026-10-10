# Choosing a model

Rampa asks a model only what axe-core cannot decide, one WCAG criterion at a time, and keeps a claim only when its evidence checks out against the page. A model that judges alt text well can still misjudge link purpose, and a cheap model can be the right choice for one criterion and the wrong one for another. Generic benchmarks do not tell you which. Measuring does: `rampa eval` scores a model on the W3C ACT test cases and on corrupted pairs, and `rampa compare` puts several runs side by side, criterion by criterion.

## Four local models, measured

On 2026-10-10, four local models ran the full default evaluation on the same machine and the same commit, one after another, each from an empty cache. The two best ran a second time.

**In short.** `gemma4:12b` stays the default. On the meaning sets it failed 42 of the 44 failing pages with 6 false positives (F1 0.91), it told apart 71 of 79 corrupted pairs, verification dropped 6 of its claims, it had no model error, and it was the fastest. `ministral-3:14b` comes second (F1 0.84, 64 of 79 pairs) and takes more GPU memory than Gemma, so it does not help on a smaller GPU. Neither model that fits in about 7 GB replaces Gemma. `qwen3.5:9b` made no false positive on a meaning set or a pair, but it leaves the suggested text empty in most 2.4.2, 2.4.4 and 2.4.6 fails, verification drops those claims, and 2.4.4 goes unchecked (0 of 21 pairs). `qwen3-vl:8b-instruct` passes too much (recall 0.68 on the meaning sets, 37 of 79 pairs) and had the only invalid JSON. With about 7 GB, use `qwen3.5:9b` for 1.1.1, 1.3.5, 3.1.1, 3.1.2 and 3.3.2 only, where it scored close to Gemma. The prompts were tuned on Gemma's errors on these same pages, so Gemma plays at home; read the caveats below.

### Method

- **Code and data.** Commit `9293eb4`, axe-core 4.14.0, WCAG 2.2 rules, W3C ACT test cases `a9a1483e` (the file of 2026-10-07 the README's numbers use).
- **Command**, per model: `node dist/cli.mjs eval --model ollama:<model> --locale en --cache-dir .rampa/cache-models/<run>-<model>`. That is the eight default criteria (1.1.1, 1.3.5, 2.4.2, 2.4.4, 2.4.6, 3.1.1, 3.1.2, 3.3.2) with their corrupted pairs, verification on, one judgment per candidate, the default concurrency (4 pages at a time, up to 2 calls each) and links followed on the W3C host. 1.4.5 and 3.3.1 are not in the default set and were not run.
- **Settings as the provider sets them.** Rampa's Ollama provider sent temperature 0, `reasoning_effort: "none"` and the criterion's JSON schema as `response_format` on every call. The two models with a thinking mode, Gemma 4 and Qwen 3.5, returned no reasoning text. Ollama kept its default context of 4,096 tokens. No model needed a flag.
- **Vision.** All four take images (`ollama show` lists vision), and each answered all 29 calls that carried one, so every model judged 1.1.1. A text-only model would be run without 1.1.1 (`--criteria 1.3.5,2.4.2,…`), and `rampa compare` would show 1.1.1 as not evaluated by that run, not as missed.
- **Independent runs.** Each run had its own empty `--cache-dir`. Within a run, a prompt asked twice (the same test page under two sets) is answered once and counted as cached.
- **Machine.** RTX 5060 Ti 16 GB that also drives the desktop, Ryzen 5 7600X, Windows 11, Ollama 0.40.2, the Q4_K_M weights Ollama ships. The GPU is shared with other jobs that sometimes call `gemma4:12b`. Read every 15 s, Ollama's `/api/ps` showed no other model loaded during the runs, except `gemma4:12b` in the first reading of the two runs that came right after a Gemma run.
- **Measured around the CLI, which was not changed** ([scripts](models/scripts)). A preload logs every HTTP call to Ollama: status, time, finish reason, and whether the answer parses as JSON. `/api/ps` and `nvidia-smi` are read every 15 s, and the run is timed from start to exit. Wall time includes loading every test page in Chromium and following links.
- **Raw data.** Each run's `summary.json` and `results.jsonl` are in [models/runs](models/runs), so `rampa compare` can read them again. [models/runs.json](models/runs.json) has the timings, call errors and memory read during each run, and [models/memory.json](models/memory.json) the memory of each model loaded alone.

Models in the tables: Gemma is `gemma4:12b`, Qwen3-VL `qwen3-vl:8b-instruct`, Qwen 3.5 `qwen3.5:9b`, Ministral `ministral-3:14b`.

### Scores per criterion

Each cell is precision / recall / F1 over the pages of the set; n counts pages. A *syntax* set measures what axe-core decides, a *meaning* set what only judgment can, and *pairs* are passing pages next to copies broken on purpose. The axe-core column is the baseline on the same pages, the same in every run. "—" means the run failed no page of the set, so precision and F1 have nothing to divide.

#### 1.1.1 Non-text Content

| Set | n | axe-core | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | ---: | :---: | :---: | :---: | :---: | :---: |
| 23a2a8, syntax | 18 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| qt1vmo, meaning | 16 | — / 0.00 / — | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| e88epe, meaning | 20 | — / 0.00 / — | 1.00 / 1.00 / 1.00 | 1.00 / 0.80 / 0.89 | 1.00 / 0.80 / 0.89 | 1.00 / 0.80 / 0.89 |
| pairs | 3 | — / 0.00 / — | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |

#### 1.3.5 Identify Input Purpose

| Set | n | axe-core | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | ---: | :---: | :---: | :---: | :---: | :---: |
| 73f2c2, syntax | 30 | 1.00 / 1.00 / 1.00 | 0.83 / 1.00 / 0.91 | 1.00 / 1.00 / 1.00 | 0.83 / 1.00 / 0.91 | 1.00 / 1.00 / 1.00 |
| pairs | 25 | — / 0.00 / — | 1.00 / 0.88 / 0.93 | 1.00 / 0.63 / 0.77 | 1.00 / 0.88 / 0.93 | 1.00 / 0.50 / 0.67 |

#### 2.4.2 Page Titled

| Set | n | axe-core | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | ---: | :---: | :---: | :---: | :---: | :---: |
| 2779a5, syntax | 12 | 1.00 / 1.00 / 1.00 | 0.50 / 1.00 / 0.67 | 0.60 / 1.00 / 0.75 | 1.00 / 1.00 / 1.00 | 0.50 / 1.00 / 0.67 |
| c4a8a4, meaning | 6 | — / 0.00 / — | 1.00 / 1.00 / 1.00 | 1.00 / 0.33 / 0.50 | 1.00 / 0.33 / 0.50 | 1.00 / 1.00 / 1.00 |
| pairs | 6 | — / 0.00 / — | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |

#### 2.4.4 Link Purpose (In Context)

| Set | n | axe-core | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | ---: | :---: | :---: | :---: | :---: | :---: |
| c487ae, syntax | 28 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 0.92 / 1.00 / 0.96 | 1.00 / 1.00 / 1.00 | 0.92 / 1.00 / 0.96 |
| 5effbb, meaning | 18 | — / 0.00 / — | 1.00 / 1.00 / 1.00 | 0.40 / 0.33 / 0.36 | — / 0.00 / — | 0.67 / 0.33 / 0.44 |
| fd3a94, meaning | 24 | — / 0.00 / — | 0.58 / 0.88 / 0.70 | 0.78 / 0.88 / 0.82 | — / 0.00 / — | 0.55 / 0.75 / 0.63 |
| pairs | 34 | — / 0.00 / — | 1.00 / 0.95 / 0.98 | 0.78 / 0.67 / 0.72 | — / 0.00 / — | 0.91 / 0.95 / 0.93 |

#### 2.4.6 Headings and Labels

| Set | n | axe-core | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | ---: | :---: | :---: | :---: | :---: | :---: |
| cc0f0a, meaning | 16 | — / 0.00 / — | 1.00 / 0.83 / 0.91 | 1.00 / 1.00 / 1.00 | — / 0.00 / — | 1.00 / 1.00 / 1.00 |
| b49b2e, meaning | 12 | — / 0.00 / — | 0.80 / 1.00 / 0.89 | — / 0.00 / — | 1.00 / 0.75 / 0.86 | 0.80 / 1.00 / 0.89 |
| pairs | 18 | — / 0.00 / — | 0.90 / 1.00 / 0.95 | 1.00 / 0.33 / 0.50 | 1.00 / 0.22 / 0.36 | 0.90 / 1.00 / 0.95 |

#### 3.1.1 Language of Page

| Set | n | axe-core | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | ---: | :---: | :---: | :---: | :---: | :---: |
| bf051a, syntax | 6 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| b5c3f8, syntax | 5 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| ucwvc8, meaning | 14 | — / 0.00 / — | 1.00 / 1.00 / 1.00 | 1.00 / 0.60 / 0.75 | 1.00 / 0.80 / 0.89 | 1.00 / 1.00 / 1.00 |
| pairs | 8 | — / 0.00 / — | 1.00 / 1.00 / 1.00 | 1.00 / 0.50 / 0.67 | 1.00 / 0.75 / 0.86 | 1.00 / 1.00 / 1.00 |

#### 3.1.2 Language of Parts

| Set | n | axe-core | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | ---: | :---: | :---: | :---: | :---: | :---: |
| de46e4, syntax | 19 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| off6ek, meaning | 13 | — / 0.00 / — | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| pairs | 15 | — / 0.00 / — | 1.00 / 0.60 / 0.75 | 1.00 / 0.50 / 0.67 | 1.00 / 0.60 / 0.75 | 1.00 / 0.70 / 0.82 |

#### 3.3.2 Labels or Instructions

| Set | n | axe-core | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | ---: | :---: | :---: | :---: | :---: | :---: |
| pairs | 21 | — / 0.00 / — | 1.00 / 1.00 / 1.00 | 1.00 / 0.29 / 0.44 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |

#### All criteria, pooled

Pages of every set of a kind added up, with 95% Wilson intervals:

| | axe-core | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | :---: | :---: | :---: | :---: | :---: |
| meaning sets (139 pages, 44 failing): precision | — | 0.88 (0.75–0.94) | 0.86 (0.71–0.94) | 1.00 (0.83–1.00) | 0.84 (0.71–0.92) |
| meaning sets: recall | 0.00 | 0.95 (0.85–0.99) | 0.68 (0.53–0.80) | 0.43 (0.30–0.58) | 0.84 (0.71–0.92) |
| meaning sets: F1 | — | **0.91** | 0.76 | 0.60 | 0.84 |
| pairs (130 pages): precision / recall / F1 | — / 0.00 / — | 0.99 / 0.91 / **0.95** | 0.91 / 0.54 / 0.68 | 1.00 / 0.56 / 0.72 | 0.96 / 0.85 / 0.90 |
| syntax sets (118 pages): precision / recall / F1 | 1.00 / 1.00 / 1.00 | 0.86 / 1.00 / 0.92 | 0.91 / 1.00 / 0.95 | 0.96 / 1.00 / 0.98 | 0.88 / 1.00 / 0.93 |
| cases right, of all 343 | 220 | **320** | 283 | 281 | 310 |

- **Syntax sets.** Judgment can only add failures there, and the false positives are the scoring artifacts [criteria.md](criteria.md) describes: 2779a5's passing pages are titled "Title of the page.", and two inapplicable pages of 73f2c2 have `autocomplete=""` on a username field, a real 1.3.5 failure the rule leaves out. A higher score there is not better judgment. Qwen 3.5's 1.00 on 2779a5 comes from claims that failed those titles without a suggested title, which verification dropped.
- **Where another model beat Gemma.** Qwen3-VL on fd3a94 (F1 0.82 against 0.70), and Qwen3-VL and Ministral on cc0f0a, where both found the failing label Gemma passed. Ministral also caught one more `lang-drop` copy.
- **All four wrong.** 7 cases, all misses. Four are cases criteria.md argues Rampa is right to pass: "Partner's email address" with its token removed or swapped (someone else's data, twice), and "Paul put dire comment on tape" with its `lang` removed (English and French at once, twice). One, "Bonne année !", is too short for the language identifier to nominate, so no model was asked. The other two are 2.4.4 pages.

#### Corrupted pairs told apart

A pair counts when the intact page passes and the corrupted copy fails.

| Criterion | Corruption | Pairs | axe-core | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.1.1 | `alt-placeholder` | 1 | 0 | 1 | 1 | 1 | 1 |
| 1.1.1 | `alt-swap` | 1 | 0 | 1 | 1 | 1 | 1 |
| 1.3.5 | `autocomplete-drop` | 9 | 0 | 8 | 6 | 8 | 4 |
| 1.3.5 | `autocomplete-swap` | 7 | 0 | 6 | 4 | 6 | 4 |
| 2.4.2 | `title-generic` | 3 | 0 | 3 | 3 | 3 | 3 |
| 2.4.4 | `link-generic` | 11 | 0 | 11 | 5 | 0 | 9 |
| 2.4.4 | `link-mismatch` | 10 | 0 | 9 | 3 | 0 | 9 |
| 2.4.6 | `heading-generic` | 9 | 0 | 8 | 3 | 2 | 8 |
| 3.1.1 | `html-lang-swap` | 4 | 0 | 4 | 2 | 3 | 4 |
| 3.1.2 | `lang-swap` | 5 | 0 | 5 | 5 | 5 | 5 |
| 3.1.2 | `lang-drop` | 5 | 0 | 1 | 0 | 1 | 2 |
| 3.3.2 | `label-hidden` | 7 | 0 | 7 | 2 | 7 | 7 |
| 3.3.2 | `label-unseen` | 7 | 0 | 7 | 2 | 7 | 7 |
| all | | 79 | 0 | **71** | 37 | 44 | 64 |

### Judgment, errors, time and memory

| | Gemma | Qwen3-VL | Qwen 3.5 | Ministral |
| --- | ---: | ---: | ---: | ---: |
| candidates | 292 | 292 | 292 | 292 |
| model calls, new + cached | 271 + 18 | 268 + 19 | 270 + 19 | 273 + 16 |
| discarded by verification | **6** | 13 | 103 | 26 |
| cannot tell | 0 | 0 | 0 | 3 |
| invalid JSON | 0 | 2 of 270 | 0 | 0 |
| HTTP errors, timeouts | 0 | 1 (retried) | 0 | 0 |
| wall time | **7 min 05 s** | 7 min 43 s | 9 min 23 s | 9 min 22 s |
| median / p90 s per call | 3.6 / 9.2 | 3.6 / 9.4 | 5.5 / 17.0 | 5.7 / 15.8 |
| tokens in / out | 217k / 22.5k | 236k / 20.6k | 216k / 27.2k | 227k / 22.2k |
| GPU memory, loaded alone | 8.6 GiB | 6.8 GiB | 6.1 GiB | 8.9 GiB |
| VRAM in Ollama's `/api/ps` | 1.0 GiB (wrong) | 5.4 GiB | 5.2 GiB | 8.1 GiB |
| API cost | none | none | none | none |

- **Discarded by verification.** A model that does not fill in what Rampa checks loses its claims, and a dropped fail lowers recall.
  - *Qwen 3.5* left the suggested text empty in every 2.4.4 fail (61 of 61 distinct answers), in 12 of its 15 on 2.4.6 and in 6 of its 10 on 2.4.2. Verification requires a suggestion that differs from the current text, so those claims are dropped: 64 of the 102 candidates on 2.4.4, and no 2.4.4 page failed by judgment at all. A report would show 2.4.4 as judged with nothing found. The smoke test below saw the same on the store example.
  - *Ministral* lost 14 of the 28 candidates on 1.3.5. In 9 of its 22 distinct fail answers there, the same answer calls the field someone else's data or not personal; a 1.3.5 fail must be about the user's own data, so verification drops it, and on a corrupted copy that is a miss.
  - *Qwen3-VL* lost few claims; it made fewer. It failed 10 headings and labels on 2.4.6 and 8 fields on 3.3.2, where Gemma failed 19 and 14 (distinct answers).
- **Model errors.** Only Qwen3-VL had any. Twice it repeated itself until the 4,096-token context was full: a suggested alternative text that ran to 10,000 characters, and an excerpt followed by `\n` over and over. Neither answer was JSON, so a 1.1.1 candidate and a 3.1.1 candidate went unjudged, 2 of its 270 answers. Once Ollama stopped it with HTTP 500 "token repeat limit reached", and the AI SDK's retry got an answer. No model had a timeout or an answer outside the schema.
- **Time.** With up to eight requests in flight, the seconds per call include waiting in Ollama's queue; compare them across models, not with the single-call speeds further down. Qwen 3.5 and Ministral took about a third longer than Gemma over the same pages.
- **Memory.** `nvidia-smi` with each model loaded alone after one short call, the desktop's own use subtracted; during the runs the peak was up to 0.8 GiB above that. `/api/ps` reports 0.8 to 1.4 GiB less than `nvidia-smi`, and for Gemma 4 it still reports 1.0 GiB on Ollama 0.40.2.

### Run to run

Gemma and Ministral ran a second time, again from empty caches. Every page got the same verdict as in the first run, so every score above holds for both runs. Below the page level, temperature 0 is not exactly repeatable with requests running side by side: of the 255 prompts both runs share, Gemma worded 71 answers differently without changing a verdict, and Ministral worded 24 differently and changed one, a link "About us" that passed and then failed, on a page whose verdict did not change. Discards moved by one (Gemma 6 then 5, Ministral 26 then 27). The second runs took 7 min 40 s and 9 min 33 s.

The paired comparison of the two (`rampa compare`) on 343 cases: Gemma alone right on 15, Ministral alone on 5, both wrong on 18, McNemar p = 0.041, the same split in both runs. Most of the gap is 2.4.4 (8 against 1) and 1.3.5, where Gemma's 6 are corrupted copies and Ministral's 2 the inapplicable `autocomplete=""` pages. Against either Qwen model, Gemma's split is 46 to 9 and 51 to 12 (p < 0.001). Run noise is not what limits these numbers; the number of pages is.

### Recommendation

- **Default: `gemma4:12b`.** The highest recall on the meaning sets, with precision inside the others' intervals; the most pairs told apart, the fewest discards, no model error, the shortest run; about 9 GB of GPU memory.
- **Second opinion: `ministral-3:14b`.** Close on most criteria, better on cc0f0a, weaker on 2.4.4 and on the 1.3.5 pairs, a third slower, and slightly larger than Gemma. When it agrees with Gemma, that is not proof (see *Agreeing is not being right*).
- **About 7 GB free: `qwen3.5:9b`, on part of the criteria.** On 1.1.1, 1.3.5, 3.1.1, 3.1.2 and 3.3.2 it made no false positive on a meaning set or a pair, and it missed three pages Gemma found (one each on e88epe, ucwvc8 and the 3.1.1 pairs). Leave 2.4.2, 2.4.4 and 2.4.6 out of its runs, so the report says they were not checked instead of judging them through dropped claims:

  ```sh
  rampa check site/ --model ollama:qwen3.5:9b --criteria 1.1.1,1.3.5,3.1.1,3.1.2,3.3.2
  ```

  `--reasoning provider-default` lets it think. On the store example that left no claim to discard, at about 20 times the output tokens and the time (below); it was not run on the evaluation.
- **Not recommended: `qwen3-vl:8b-instruct`.** Lower recall on most criteria and the only invalid JSON, although it scored best of the four on fd3a94.

### Caveats

- **Gemma plays at home.** Every prompt and verification rule was revised after reading Gemma 4 12B's errors on these same ACT pages ([criteria.md](criteria.md)). The other models' habits, such as Qwen 3.5's empty suggestions and Ministral's contradictory 1.3.5 answers, were never seen while tuning, and they are the kind a prompt change could fix. This ranks the models with Rampa's current prompts, not the models themselves.
- **ACT pages are small.** A test page has a handful of candidates and short context, written to test one rule. Real pages have more candidates, longer context and harder calls. Time per call and memory carry over roughly; scores do not.
- **Real pages are noisier.** With Gemma, the [real-page study](studies/real-pages-2026-10.md) found a precision of 0.12 for the judgment layer, and the [re-measurement](studies/real-pages-2026-10-remeasure.md) 0.38 at the default threshold. No other model has been measured on real pages, and this ranking may not hold there.
- **Small sets.** Precision intervals on the pooled meaning sets overlap for all four models; Gemma's lead is in recall and in 2.4.4. The repeated runs show that the verdicts are stable, not that the gap would hold on other pages.
- **One machine.** A shared GPU, Ollama's default parallelism and Q4_K_M weights. Other quantizations and runtimes (LM Studio, llama.cpp) can differ, structured output above all.

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

These Ollama models take images, follow Rampa's JSON schemas and fit a 16 GB GPU at Q4. They were pulled and smoke-tested on 2026-10-08 with Ollama 0.40.1 on an RTX 5060 Ti 16 GB. This section is what those first tests showed; the full evaluation of all four, which ranks them, is in [Four local models, measured](#four-local-models-measured).

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
