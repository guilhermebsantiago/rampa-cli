# 1.1.1: an identifier or an absence text is a placeholder; a short alternative "names a label" (2026-11-09)

Two changes to 1.1.1, both in `src/criteria/non-text-content.ts`. (a) The placeholder pattern also matches an alternative that is an upper-case identifier joined by underscores ("HOME_GERAL_TV1_ALTO_VERAO") or that only says a resource is absent ("not found", "404"). (b) A "describes something the image does not show" answer on an alternative of one or two words that may not be a name is worded "names a label, not what the image conveys here". Part (b) changes messages only. Part (a) changes what happens after the model answers fail on such an alternative: the message, the second pass, `verify`'s facts and groundedness. On the recorded pages it changed no list of findings or suggestions. These notes record the evidence, the two rules, a count on the studies' dev halves, an offline replay and the W3C ACT cases.

**What each number is.** Every number below is on the dev halves of the second to fifth real-page studies (12 pages each, 48 pages), the pages the rules were written on: **in-sample** and **counted**. No cache, snapshot, report or finding of a test page was opened. The labels are the studies' two Claude judges, not people.

## 1. The evidence

The evidence comes from the dev pages, counted and classified by hand, with the two Claude judges' labels. After the earlier "leaves out" change, 20 1.1.1 findings on the dev pages are worded "describes something the image does not show": 16 labelled true and 4 false (the replay of section 4 recounts them). Of the 16 true ones, 14 have an alternative that is a label, a marker or an identifier, not a description of something else: "payment" (7, www.hering.com.br's payment logos), "Banner padrão", "Patrocinador", "not found", "Contraste", "Rodapé 2", and two that start `HOME_GERAL_`. Of the 4 false ones, 3 have an alternative that describes a picture ("Imagem de alunos no Campus da PUC-Rio" twice, "Ilustração SVG demonstrativa cachorro"). So for a label put where a description belongs, the sentence "describes something the image does not show" is the wrong claim. Claims worded as a placeholder have an in-sample record of 20 true and 0 false, and are not asked of the second pass. In the blind human review, two of the six disagreements that can be read were "the claim's sentence against a real failure".

The rules below were written after reading those pages. They were fixed before the count and the replay, and neither changed them. Only the sentence of part (b) was reworded after a first replay, for the reason given in section 2, and it now reaches the same answers. After review, part (b) was narrowed once more, to leave out an alternative that may be a name (rule 3 of section 2): on length alone it reworded "Lula" on a photo of someone else, a short description that names the wrong person. Sections 4 and 6 are the replay and the evaluation with that final rule.

## 2. The rules

**Part (a), `looksLikePlaceholder`.** After the existing patterns, on the trimmed alternative:

1. **Identifier** (`isIdentifierAlt`): one token with no white space, made of upper-case letters and digits in runs joined by underscores, with at least one underscore, starting with a letter: `/^\p{Lu}[\p{Lu}\p{N}]*(?:_[\p{Lu}\p{N}]+)+$/u`, case-sensitive. "HOME_GERAL_BANNER_01" matches; "Home_Geral", "home_banner", "COVID-19", "UFC" and "PLANO DE SAÚDE" do not. The reason: prose does not join upper-case words with underscores. Lower-case and mixed-case identifiers are left out (section 5 lists the ones on the dev pages).
2. **Absence text** (`isAbsenceAlt`): the alternative, as `altWords` reads it (lower case, accents removed), is exactly one phrase of a closed set. Each phrase only says a resource is absent, and is made of an optional subject and a predicate:
   - subjects: none; English `image`, `file`, `page`; Portuguese `imagem`, `arquivo`, `pagina`; Spanish `imagen`, `archivo`, `pagina`;
   - predicates: English `not found`, `not available`, `unavailable`; Portuguese `nao encontrado`, `nao encontrada`, `nao disponivel`, `indisponivel`; Spanish `no encontrado`, `no encontrada`, `no disponible`; a subject goes only before a predicate of its own language;
   - fixed phrases: `404`, `404 not found`, `error 404`, `erro 404`, `no image`, `sem imagem`, `sin imagen`.

   "not found", "Imagem não encontrada" and "404" match; "Error", "Produto indisponível" and "Page not found illustration" do not.
3. No word or phrase seen in the count or the replay was added to this set, to `GENERIC_WORDS`, to `LABEL_WORDS` or to any other list. "payment", "banner", "patrocinador" and the like are in none.

The model is still asked about the image, so a pass stays a pass. When the model answers fail and the pattern matches: the message says "is a file name or a placeholder"; the second pass is not asked; the facts in `verify` that discard a claim do not apply; and the claim stays grounded. So a fail that was a suggestion, or that verification discarded, can become a finding.

**Part (b), the message.**

1. `isShortAlternative(alt)`, exported: true when `altWords(alt)`, without the tokens that are all digits, has one or two words. "payment", "Rodapé 2", "Banner padrão" and "Lula" are short; "Alerta de Golpe" (three words) is not. The rule is on length because a list of label words cannot be closed: "payment", "Patrocinador", "Contraste" and "Rodapé 2" have nothing in common but their length.
2. `claimText` takes `{ extension, short }`. With `short`, the reason is "names a label, not what the image conveys here" ("dá um rótulo, não o que a imagem comunica aqui") when all of these hold: after the placeholder and generic patterns the problem is `wrong_content`, the image is not a functional one, the "leaves out" wording does not apply, the alternative is short, and it may not be a name (rule 3). The order of precedence is: a placeholder or a generic word, then the functional image's wording, then "leaves out", then "names a label", then the model's problem.
3. `mayBeName(alt)`, exported: true when every word of the alternative starts with an upper-case letter followed by a lower-case one and none is a number ("Lula", "Jair Bolsonaro", "Patrocinador"; not "payment", "Banner padrão", "Rodapé 2", "W3C"). Such an alternative may name whom or what the image should show, and then "describes something the image does not show" is the right sentence, so it keeps the model's wording. A capitalised common word ("Patrocinador", "Contraste") cannot be told from a name by its letters, and keeps it too. The word lists of the letter-spaced words rule cannot tell them either: "visa" is listed in English, Portuguese and Spanish, "patrocinador" in none.
3. The message calls `claimText` with both options on. The second pass calls it with both off, so it asks the same question as before and its cached answers still hit.

**Why this sentence.** The plan worded this reason "does not describe the image". Technique G94 says a text alternative need not describe the image: its test is that nothing is lost when the image is replaced by its alternative. So "does not describe the image" could read as a demand WCAG does not make. The sentence used is about what the image conveys, like the existing "leaves out what the image conveys here". It replaced the plan's sentence after a first replay with that sentence, on that reading of G94 and not on any result. The after side of section 4 was then replayed again with it. The change is to the text only, not to which answers take it: both replays changed the same 16 messages.

**What does not change.** `verify` changes only through `looksLikePlaceholder`. Also unchanged: `output.problem` (so a finding's JSON `claim` is still `wrong_content`), the prompt, `version` (`'5'`), `confirmVersion` (`'1'`), the fingerprint, the patch, and the stricter deterministic rule `rampa/placeholder-alt` (`src/rules/content.ts`).

## 3. How often the rules apply (dev halves, in-sample, counted)

`study/notes-alt-labels/count.ts` reads the judgment caches of the P3/P4 replay (`rampa-study-recordings/notes-precision-p3p4-2026-10-29/caches-after/<study>/<slug>/cache`) for the dev pages of each study (`data/pages.json`, `split == "dev"`). It works on the distinct (page, alternative) of the cached answers about an image with an alternative. The cache holds no file name, so the existing file-name rule is not applied here. "Placeholder before" is the pattern at the branch's tip before this change.

| Study | Dev pages | Cached answers | Alternatives | Identifier | with a pass / a fail | Absence text | with a pass / a fail | Placeholder before |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s2 (fresh-2026-10-11) | 12 | 270 | 126 | 0 | 0 / 0 | 0 | 0 / 0 | – |
| s3 (round-3-2026-10-23) | 12 | 234 | 106 | 0 | 0 / 0 | 0 | 0 / 0 | – |
| s4 (round-4-2026-10-24) | 12 | 87 | 84 | 0 | 0 / 0 | 0 | 0 / 0 | – |
| s5 (round-5-2026-10-28) | 12 | 82 | 63 | 2 | 0 / 2 | 1 | 0 / 1 | 0 of 3 |
| all | 48 | 673 | 379 | 2 | 0 / 2 | 1 | 0 / 1 | 0 of 3 |

The three matches are www.hering.com.br's two hero banners, "HOME_GERAL_TV1_TUDO_COM_60" and "HOME_GERAL_TV1_ALTO_VERAO", and www.ms.gov.br's "not found". Each was cached with one answer, a fail (`wrong_content`), and each is a finding labelled true.

Among the 103 alternatives with a cached fail answer of problem `wrong_content`, 47 are short. Of those, 3 keep the placeholder wording, which wins ("not found", and "logo" on two pages). The new wording can apply to the other 44, unless the image is a functional one, the answer is worded "leaves out", or verification discards the claim. The cache does not say which, so the replay does. `data/count.json` lists the 47 with their labels.

## 4. The replay (offline, dev pages, 1.1.1 only)

`study/notes-alt-labels/replay.sh` is the earlier `notes-alt-extension/replay.sh` with its output folder changed to `.rampa/alt-labels/`. It runs `rampa check` on each dev page's recorded snapshot with `--model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --offline --criteria 1.1.1`, on a fresh copy of that page's cache from the same caches as section 3, each page in its own work directory, with every API key variable unset. `--offline` asks no model. **Before** is `dist` built at the branch's tip before this change (`ee96338`, which has the "leaves out" wording); **after** is this change's build. `compare.ts` compares the two reports of each page (`data/compare.json`) and joins each changed element to the study's `data/findings.json` (dev rows, same page and `ref`, any origin) for its label.

| Study | Pages | Identical sets | Misses before / after | Model calls before / after | Place or confirmation changes | Message changes | Other differences |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s2 | 12 | 12 / 12 | 0 / 0 | 0 / 0 | 0 | 1 | 0 |
| s3 | 12 | 12 / 12 | 0 / 0 | 0 / 0 | 0 | 1 | 0 |
| s4 | 12 | 12 / 12 | 0 / 0 | 0 / 0 | 0 | 3 | 0 |
| s5 | 12 | 12 / 12 | 0 / 0 | 0 / 0 | 3 | 14 | 11 |

- **The sets are identical on all 48 pages**: findings, below-threshold findings (by criterion, ref, fingerprint and source) and suggestions (by criterion, ref and rule). There were no cache misses and no model calls on either side.
- **Part (a): no element changes list.** No suggestion or discarded claim becomes a finding. The three matches of section 3 were already findings, each confirmed by all three framings of the second pass. Now they are findings with no second pass, and so no `confirmation`:

  | Study | Page | Alternative | Rule | Before | After | Claude label |
  | --- | --- | --- | --- | --- | --- | --- |
  | s5 | ms-gov-br | not found | absence | finding, 3 framings, min 1.000 | finding, no second pass | true |
  | s5 | hering | HOME_GERAL_TV1_TUDO_COM_60 | identifier | finding, 3 framings, min 0.997 | finding, no second pass | true |
  | s5 | hering | HOME_GERAL_TV1_ALTO_VERAO | identifier | finding, 3 framings, min 1.000 | finding, no second pass | true |

- **Messages: 17 change, on pages whose sets are identical.** 14 take the part (b) wording: 10 findings ("Banner padrão" true, "fullepisode" false, "Rodapé 2" true, "payment" ×7 true) and 4 suggestions ("Autor avatar", "BHF logo", "ico login", "ico search", each labelled false, suggestions in both runs). 3 take the placeholder wording of part (a), on the three findings above. Each is listed with its label in `data/compare.json`.
- **The 11 other differences all follow from part (a), on the same two pages.** They are the three `confirmation` fields; each page's `confirmed` count (3 to 2, 9 to 7); and the cached calls and tokens of the second-pass questions that are no longer asked (15 to 12 cached calls on ms-gov-br, 63 to 57 on hering: 3 framings per claim). Nothing else in the 48 reports differs, field by field (`createdAt` aside).

**The 20 findings worded "describes something the image does not show" before, by their wording after:**

| Wording after | True | False | Uncertain | Unlabelled |
| --- | --- | --- | --- | --- |
| "is a file name or a placeholder" (part a) | 3 | 0 | 0 | 0 |
| "names a label, not what the image conveys here" (part b) | 9 | 1 | 0 | 0 |
| "leaves out what the image conveys here" | 0 | 0 | 0 | 0 |
| unchanged, "describes something the image does not show" | 4 | 3 | 0 | 0 |

The unchanged findings are osesp's "Patrocinador" and ms.gov.br's "Contraste" (true, both one capitalised word that may be a name, rule 3), cnj.jus.br's "Botão Rybená LIBRAS" (true), cobasi's "Ilustração SVG demonstrativa cachorro" (one copy true, one false) and puc-rio's "Imagem de alunos no Campus da PUC-Rio" (two copies, false). The false finding newly worded "names a label" is pbs.org's "fullepisode", one word.

## 5. Cases the rules do not reach

These were reported and not added to any list or pattern.

- **Longer labels.** "Botão Rybená LIBRAS" (three words, true) and one copy of "Ilustração SVG demonstrativa cachorro" (four words, true) keep "does not show". The rule on length stops at two words.
- **Lower-case and mixed-case identifiers that are not their image's file name.** On the dev pages, with `wrong_content` or `missing_information` answers: pucrs.br's icons "fi-book-open-cover-dark-80x80", "fi-tr-benefit-porcent-dark-80x80" and "fi-tr-piggy-bank-dark-80x80" (suggestions worded "does not show" in both runs) and "fi-tr-percent-50-dark-80x80" (discarded, "only rewords"); infomoney's "Logo_Infomoney_Branco_transparente" (discarded, "only rewords"); toolstation's "-plumbing-c15-ts-image" and hering's "social-media" (discarded, they name their link's purpose). Other alternatives of this shape on those pages ("thumb_certificaoes_estudos", "logo-museu", "flavio-lula-vertical"…) were already placeholders by the file-name rule. The identifier rule is case-sensitive by design, so it reaches none of these.

## 6. The W3C ACT cases

`node <dist>/cli.mjs eval --criteria 1.1.1 --model ollama:gemma4:12b --concurrency 2 --offline --cache-dir <copy of notes-precision-p3p4-2026-10-29/eval-cache> --out-dir .rampa/alt-labels/eval-<before|after>` ran with both builds. Each build had its own copy of the cache, and the ACT test-case file and link destinations were copied from the main checkout's `.rampa/`. It ran offline: 0 new model calls and 44 cached on each side. All 56 rows (54 ACT test cases and 2 corrupted pages) have the same outcome with both builds: precision and recall 1.00 on 23a2a8, qt1vmo and e88epe, and both pairs discriminated. Only three messages differ, on qt1vmo's failed examples: "ERCIM logo", "W3C" and "HTML 5 logo" now read "names a label, not what the image conveys here". In one row, a run read another cached answer for a prompt of the same size, with the same outcome: e88epe Passed Example 3 read a 67-token answer in the first before run and a 65-token one in the after run and in a second before run. It passes, and no message is built for a pass, so it does not reach the changed code. The after run with the rule on length alone, before rule 3, differed the same way there and also on qt1vmo Inapplicable Examples 2 and 7 (54- and 58-token answers before, 67-token ones after), both passes too. So these differences are between runs, in which cached answer a page's live capture keyed, not between the builds (`data/eval.json`).

## 7. Limits

- **The rules were written on these dev pages.** Every number here is in-sample. Most of the 14 true alternatives that motivated part (b) are the ones it rewords, so the table of section 4 measures how faithfully the rule was implemented, not how well it generalises.
- **The labels are the two Claude judges'**, given to the sentence "describes something the image does not show". No one labelled the new sentence. That a label stays true under "names a label" is a reading, not a measurement.
- **The second pass still asks the old sentence.** For a short alternative it is asked whether the alternative "describes something the image does not show", so a finding's message can differ from the question that confirmed it. Asking the new sentence would change the second pass's questions and cache keys, and take new model calls.
- **Part (a) can add findings with no label.** On these pages it added none: its three matches were already true findings, and they now go without a second pass. On other pages, a fail on an identifier or an absence text that the second pass would have denied, or that a fact in `verify` would have discarded, becomes a finding no one has labelled.
- **Later rounds read the kind of a claim from its message.** `claim_kind` (`study/human-review-2026-10/scripts/common.py`, not edited here) reads a finding's kind from its message's template. "names a label, not what the image conveys here" and "leaves out what the image conveys here" match none of its 1.1.1 needles and read as `1.1.1 other`. The widened placeholders read as `1.1.1 placeholder`. It needs two needles, `("names a label, not what the image conveys here", "wrong_content")` and `("leaves out what the image conveys here", "wrong_content")`, for these two wordings to be read as the claim they still make (the report's `claim` field is `wrong_content` for both). A "leaves out" message on a model's own `missing_information` answer would then also read as `wrong_content`; reading `claim` instead of the message would tell them apart.
- **Part (b) is a rule on length and letter case.** It cannot tell a label from a short description that names the wrong thing unless the description is capitalised as a name: "Lula" on a photo of someone else keeps "describes something the image does not show", and so do labels written as one capitalised word ("Patrocinador", "Contraste", true), which lose the new wording. A short description in lower case ("cachorro" on a photo of a cat) would still be worded "names a label".

## 8. Data and reproduction

All paths are under `study/notes-alt-labels/`. Run from the repository root with the recordings in `C:/Users/guilh/dev/rampa-study-recordings` (`RECORDINGS`) and Node 24 on `PATH`.

- Build the branch's tip before this change (`pnpm build`) and copy `dist` to `.rampa/alt-labels/dist-before`. Build this change and copy `dist` to `.rampa/alt-labels/dist-after` (`.rampa/` is ignored by git).
- `node count.ts` prints the tables of section 3 (data in `data/count.json`). It reads the before build for the "placeholder before" column.
- `bash replay.sh before .rampa/alt-labels/dist-before` and `bash replay.sh after .rampa/alt-labels/dist-after`: the full reports, consoles and cache copies go to `.rampa/alt-labels/`, out of git.
- `node compare.ts before after` prints the tables of section 4 (data in `data/compare.json`).
- The evaluations of section 6, run from the repository root with `.rampa/act/testcases.json` and `.rampa/destinations` in place: the before build into `.rampa/alt-labels/eval-before` and again into `eval-before-2`, the after build into `eval-after`, each with a copy of the evaluation cache (`--offline` writes nothing to it). Then `node eval.ts before after before-2` prints the comparison (data in `data/eval.json`).
