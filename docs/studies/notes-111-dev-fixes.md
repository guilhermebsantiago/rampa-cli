# 1.1.1: the fresh-page study's dev false positives, and the facts that refute them

The [fresh-page study](real-pages-2026-10-fresh.md) found 1.1.1 (Non-text Content) right on 7 of the 26 findings its judges decided on the **dev** pages (0.27), all of them at the default threshold. Its section "False positives, dev split only" sorted the 19 false positives into patterns. These notes take four of them, add to verification a fact Rampa computes for each, and measure what the facts remove on the dev pages and on the W3C ACT test cases. No prompt changed, so the model's answers are the same before and after: only what verification keeps differs.

**In short.** On the dev pages, the 1.1.1 findings went from 30 (7 true positives, 19 false positives, 4 uncertain; precision 0.27, 95% Wilson 0.14–0.46) to 13 (7 / 3 / 3; 0.70, 0.40–0.89). No dev true positive was lost. Of the 16 false positives removed, 14 are the four patterns below and 2 are another of the study's patterns, which one of the same rules reaches. On the ACT test cases and pairs of 1.1.1 nothing changed: precision and recall stay 1.00 on every set, and no claim was dropped. **Only the dev split was used; these numbers are measured on the pages the fixes were chosen from, so they are optimistic. The test split must be re-measured, ideally on fresh pages, before any claim about how the fixes generalise.**

## Data and scope

- **Used:** the fresh-page study's dev split only. Its false positives were read with `python -I study/fresh-2026-10-11/scripts/dump_fp.py dev 1.1.1` (with `--uncertain` and `--tp` for the other labels), which keeps only rows whose `split` is the one asked for. The recordings of the twelve dev pages were copied from the study's backup and checked against `data/recordings.json` (24 of 24 files match their SHA-256), with each page's judgment cache from the study's run.
- **Not used:** the test split. No false positive, label, page or recording of it was read; every script here filters on `split == "dev"` before it reads a row. The first real-page study was not used either.
- **Labels:** the study's two Claude judges (an auditor and a skeptic), a pre-annotation and not ground truth; see the study's caveats. Nothing was relabelled.

## The patterns and their facts

Each fact is computed from the snapshot or the model's own answer, and none is sent to the model. Each drops a claim only of the kind it refutes. The facts of items 2, 4 and 5 never speak for an alternative that the placeholder pattern or the generic-word list flags ("img-1", `image.png`, "logo", "product"), and that guard now covers the older "names the link's purpose" rule too; item 1 only changes how the words of an alternative are counted.

| Pattern (item of the study's dev section) | Dev findings | What the model said | The fact | Dev findings removed |
| --- | ---: | --- | --- | ---: |
| 1. A logo's name with "logo" glued to it | 7 FP | rijksmuseum.nl "Instagramlogo", "Facebooklogo", "Youtubelogo", "Tiktoklogo", "Linkedinlogo", "Ministry of Education, Culture and Sciencelogo", "ING - Engelslogo" "describe something the image does not show"; the suggestions were "Instagram", "YouTube"…, "ING logo" | A kind word ("logo", "icon", "imagem", "img", "foto", "banner") or "link" glued to a word of at least three letters is split off: "Instagramlogo" is "Instagram" and "logo". The existing rule "the suggestion only removes or reorders words" then sees that "Instagram" only removes "logo" | 7 of 7 |
| 2. An image that repeats the text of its link | 3 FP | ce.gov.br's 32 px service pictograms, each with the alternative "Emitir o licenciamento anual do veículo (CRLV)" and the like, the same words the link shows; the suggestions described the icon ("Ícone de veículo") | The visible text of the link or button the image sits in, without the image (`controlText`). A claim that the alternative describes something the image does not show, or leaves out what it conveys, is dropped when the image is not all the control holds and its alternative is that text or a run of its words: redundant at worst (technique H2 would make it empty), not a missing alternative | 3 of 3 |
| 4. A linked image that "does not say where the link leads" when it does | 4 FP, and 1 uncertain | unicamp.br "Imagem aérea da área da saúde com o selo Nova Saúde Unicamp" to `/novasaude/`; rijksmuseum.nl "ANBIlogo" to `/en/support/donate/anbi-information`; medlineplus.gov "X" in its share row; fiocruz.br "Tour 360º" | For an image that is all its link holds, it names the destination when: it holds every word of a part of the destination's title or heading that is not the site's own name (a part of the page's own title, or one read at two addresses or more, such as "Portal Unicamp"); it holds every word of a part of the address (the path's last segment, or a label of another host), also glued ("novasaude" is "Nova Saúde", "museudavida" is "Museu da Vida"); its own words, the site's name aside, are at least half of such a part ("ANBI" of "anbi-information"); or it names a service (X, Facebook, YouTube…) whose host the link leads to, or the link leads to no service's host (a share script's `#`) and sits in a short row whose text names two other services | 3 of 4 FP ("Tour 360º" stays), and the uncertain "Pirâmide científica do Museu da Vida…" to museudavida.fiocruz.br |
| 5. A person's name read as a file name | 1 FP | poder360.com.br `alt="Lula"` from `Lula.png`, reported as "a file name or a placeholder". The model had said "wrong_content"; the label came from Rampa's own pattern, because the alternative equals the file's name. Its suggestion was "Lula com um selo de 16%" | Two facts. The file's name makes an alternative a placeholder only when it looks like a file name: no space, and a separator or a digit ("Tarja-Especiais-Site-Interna-1", "foto_capa"), not a word or a proper name. And a claim that the alternative describes something the image does not show is dropped when the suggestion keeps every word the alternative names: the model's own answer still names it | 1 of 1 |
| 3. A short alternative that is true, called wrong (not targeted) | 4 FP | unicamp.br "Imagem do campus", "Capa da edição 751"; fiocruz.br "Boletim InfoGripe"; pinacoteca.org.br "Pinacoteca" | The "suggestion keeps the alternative" rule of item 5 reaches two: "Imagem do campus" became "Entrada do campus da UNICAMP com flores…", "Pinacoteca" became "Pinacoteca de São Paulo" | 2 of 4 |

What the patterns had in common: in each, the model's own answer, or the page, already held the fact that refuted the claim. The rijksmuseum.nl answers said "A white outline of the Instagram logo" and suggested "Instagram"; the ce.gov.br icons sat next to the words of their alternative; the destination's address or title held the alternative's words; the suggestion for "Lula" began with "Lula".

## Before and after on the dev pages

**Method.** Each of the twelve dev snapshots was judged by the build before this change (`2779b3f`) and by this branch with the study's flags: `rampa check <snapshot> --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2`, each run with a fresh copy of the page's cache from the study's run. Both runs used `--offline`: every one of the 160 1.1.1 judgments of the study was read back from that cache (no offline miss on any page), so asking the model would have read the same answers and the two runs differ only in verification. 2.4.4 and 2.4.6 have new versions since the study, so their candidates were left unjudged by `--offline`; this change does not touch them, and no finding of another criterion differs between the two runs.

| 1.1.1 on the dev pages, default threshold | Findings | TP / FP / uncertain | Precision (95% Wilson) |
| --- | ---: | --- | --- |
| Before (the study's run, replayed) | 30 | 7 / 19 / 4 | 0.27 (0.14–0.46) |
| After | 13 | 7 / 3 / 3 | **0.70 (0.40–0.89)** |

Every 1.1.1 finding of the study sits at the default threshold, and the study's other runs read 1.1.1 from the same cache, so the change can be carried into the dev totals by taking out these 17 findings (16 false positives and 1 uncertain):

| All judged criteria on the dev pages | Before | With this change |
| --- | --- | --- |
| The study's run, default threshold | 18 / 25 / 4: 0.42 (0.28–0.57) | 18 / 9 / 3: 0.67 (0.48–0.81) |
| After the 2.4.4/2.4.6 change, default threshold | 20 / 21 / 4: 0.49 (0.34–0.64) | 20 / 5 / 3: 0.80 (0.61–0.91) |
| After the 2.4.4/2.4.6 change, all findings | 21 / 23 / 4: 0.48 (0.34–0.62) | 21 / 7 / 3: 0.75 (0.57–0.87) |

**What is left.** Three false positives: "Capa da edição 751" and "Boletim InfoGripe", true short alternatives the model called wrong (its description is in English and the alternatives in Portuguese, so no word check meets them), and "Tour 360º", the words drawn in the picture, on a link to a page titled "Castelo: Patrimônio da ciência" that embeds the 360° tour (the judges disagreed on why it is wrong). Three uncertain: "Ceará em Destaque", a photo under a heading of the same words; "Arte transmissões da Fiocruz" and "Capa AFN", linked images whose alternative half names the destination.

**The 7 true positives, and why no fact touches them.** "Tarja-Especiais-Site-Interna-1" is a file name (the placeholder pattern, so no fact speaks for it). "Selo comemorativo" names no part of its address, `60anos.unicamp.br` (its destination was not read). The reused news caption about QR code plates, and "Banner padrão", get suggestions that drop their words. "Advertisement" names no part of the ad's address. "Mapa do Brasil" and "Mulher de touca e luva fita tubo de ensaio" share no word with "Unidades e escritórios" and "Inscrições abertas para estágio na Fiocruz".

## ACT test cases and corrupted pairs

`rampa eval --criteria 1.1.1 --model ollama:gemma4:12b` on ACT `a9a1483e`, with one judgment cache for both runs; the run before this change asked 3 judgments the cache did not have, and the run after read all 32 from it.

| Set | n | Before: P / R / F1 | After: P / R / F1 |
| --- | ---: | --- | --- |
| 23a2a8 (syntax) | 18 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| qt1vmo (meaning) | 16 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| e88epe (meaning) | 20 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| Pairs (alt-placeholder, alt-swap) | 3 | 2 of 2 told apart | 2 of 2 told apart |

The same as the last recorded run in [models.md](../models.md) (2026-10-10). 32 candidates, 0 claims dropped by verification before or after. These sets are small (3 failed examples on qt1vmo, 5 on e88epe), so they show that the facts drop no ACT failure, not that they never would.

## What must still fail

The unit tests (`test/non-text-content.test.ts`, "1.1.1 facts that refute a claim") pin each fact with the claims it must keep:

- "img-1", `image.png` and "logo" alone keep a placeholder, "describes something else" or "leaves out" claim even inside a link to a page whose title holds the same words, and whatever the suggestion repeats.
- "Instagramlogo" on a picture the model says is Facebook's logo, with "Facebook" suggested, is kept: the glued name is the wrong one.
- An icon whose alternative names something else than its link's text ("Carro vermelho" in a link "DAE para pagamento de IPVA") is kept, and so is a "decorative" claim on an icon that repeats its link.
- A linked "Mapa do Brasil" to "Unidades e escritórios", an alternative that names only the site ("Portal Example em destaque"), "Brasil" for a seven-word slug that contains it, and the site's own name for a news slug are kept.
- An "X" that closes a dialog, and "Facebook" on a link to instagram.com, are kept.
- "Lula" with "Jair Bolsonaro" suggested is kept, and so is a "leaves out what the image conveys" claim whose suggestion keeps the alternative ("Lula sorrindo, com 45% dos votos"), as "Chart" can rightly become "Chart of sales by quarter".
- An informative chart with `alt=""` is still asked the hidden-image question, and its claim kept: none of these facts applies to it.

## Demo and versions

- **No prompt changed**, so 1.1.1 keeps version 4 and its cache keys. Every recorded answer of the demo is read back, and the six recorded pages (`demo/recorded/*.snapshot.json`) give the same findings and patches before and after, with no offline miss. Nothing was re-recorded.
- `looksLikePlaceholder`, exported by the library, no longer flags an alternative only because it equals a file named in words ("dog" from `dog.png`); its earlier test said the opposite and was changed with the reason. `rampa/placeholder-alt` already required a file name to look like one, and is unchanged.

## Limits

- **Dev only, and tuned on it.** The facts were chosen by reading these dev false positives, so the dev numbers above are the best case. The fresh study's test half has not been read for patterns and was not used here; it must be re-measured on fresh pages, as the study's own caveat says, before these fixes can be said to generalise.
- **Small numbers.** 26 decided dev findings before, 10 after, on 8 pages; one page (rijksmuseum.nl) held 8 of the 16 removed false positives.
- **The facts can hide a real failure.** An address can be stale, as the first study found for 2.4.4; here an address can only drop a claim, never make one, so a stale slug that holds the alternative's words would hide a real "does not say where the link leads". A suggestion that keeps the alternative's words and adds the right ones drops a claim that, in rare cases, was right to say the alternative names something the image does not show (an alternative "W3C logo" on the WAI logo, suggested "W3C WAI logo"). Neither happened on the dev pages or the ACT cases.
- **Hand-written lists.** The glued words (in English and Portuguese) and the services are short lists; a name glued to another word ("Rijksmuseumamsterdam") is not split.
- **Not fixed here.** The study's other 1.1.1 dev patterns: a crop that other elements paint over (the "16%" over Lula's photo, a collector issue) and "Capa da edição 751"-like readings. Nor the other criteria's dev patterns (2.4.4 toggles, 3.3.2 hidden search fields, `rampa/link-color-only`, the text caret).
- **Labels from Claude agents**, as in the study: they need human review.

## Reproduction

From the repository root, after `pnpm build`, with the dev pages' recordings and caches in `study/fresh-2026-10-11/pages/<slug>/` (kept out of git; check them against `data/recordings.json`):

- `bash study/notes-111/run.sh dev before .rampa/dist-before/cli.mjs` and `bash study/notes-111/run.sh dev after` judge the twelve dev snapshots offline, each from a fresh copy of its study cache (the "before" CLI is a build of the commit before this change).
- `bash study/notes-111/run.sh compare before after` lists the 1.1.1 findings removed or added, with the study's dev labels, and the precision of each run (`compare.py` reads only dev rows).
- `bash study/notes-111/run.sh act` runs `rampa eval` on 1.1.1.
