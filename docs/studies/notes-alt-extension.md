# 1.1.1: a suggestion that extends the alternative is worded "leaves out" (2026-11-09)

A 1.1.1 answer that says the alternative "describes something the image does not show", while the model's own suggestion keeps every word of the alternative (one of them only in another number) and adds to it, is now reported with the wording of the "leaves out" claim: "The text alternative "…" leaves out what the image conveys here." No finding, suggestion or below-threshold finding is added or removed, and `verify` returns what it returned before for every answer; only that message changes. These notes record the case, the rule, a count of the pattern on the studies' dev halves, and an offline replay.

**What each number is.** Every number below is on the dev halves of the second to fifth real-page studies (12 pages each, 48 pages), the pages the rule was written on: **in-sample** and **counted**. No cache, snapshot, report or finding of a test page was opened. The labels are the studies' two Claude judges, not people, except the one specialist label of section 1.

## 1. The case

One item, on the third real-page study's dev half: www.hcor.com.br's home-page banner (`hcor-com-br`), with `alt="Alerta de Golpe"` (scam alert), present twice in the carousel (the active slide and its clone). The model answered `wrong_content` and suggested "Alerta de segurança: Evite golpes. O Hcor não faz ligações para solicitar pagamentos antecipados."; its description of the image (`imageShows`) is a security alert banner (the caches hold it in English, from the version before 5, and in Portuguese, from version 5).

- **The two Claude judges** labelled both copies false: the sentence "describes something the image does not show" is false, since the image does show a scam alert. Both wrote that the alternative leaves out the banner's warning sentence, and called that a different claim from the one reported.
- **A specialist who reviewed it blind** labelled it true, because the alternative leaves out the banner's message.
- **Why `verify` did not drop it.** `keepsAlternative` compares exact words: the alternative names "alerta" and "golpe", the suggestion has "golpes". Had it matched, `verify` would have discarded the claim ("the suggested alternative keeps every word of the current one"), not reworded it.
- **What the shipped pipeline does with it** (`main` at `f3d20e7`, replayed in section 4): both copies are suggestions, not findings. The second pass denied the claim ("rules: fail (1.00), claim: no (0.00), reversed: no (1.00)").

This is one item. The change makes no claim on precision: the item is no finding today, and one label pair on one banner says nothing about other pages.

## 2. The rule

In `src/criteria/non-text-content.ts`:

- **`sameWordInNumber(a, b)`**, exported: two words of one text, as `altWords` and `tokens` read them (lower case, accents off), are the same word in another number when they are equal, or when neither holds a digit, the shorter has **4** letters or more, and the longer is the shorter plus `s` or `es` ("golpe"/"golpes" and "flor"/"flores" yes; "sol"/"sois", "gas"/"gases", "new"/"news" and "751"/"7515" no). Nothing wider: no gender, no "ão"/"ões", no English "y"/"ies". The evidence is one plural.
- **`keepsAlternative(answer, current, { forms })`**: without the third argument it is exactly as before. With `forms: true`, a word the alternative names is kept when the answer holds it in either number.
- **`extendsAlternative(suggested, current)`**, exported: `keepsAlternative(suggested, current, { forms: true })` holds and the suggestion has at least one word (as `purposeWords` reads them) that is no word of the alternative in either number.
- **The message.** After the placeholder and generic patterns, as before: an answer with problem `wrong_content` whose suggestion extends the alternative takes the `missing_information` sentence ("leaves out what the image conveys here", "deixa de fora o que a imagem comunica aqui"), unless one of `verify`'s two exact checks holds (the suggestion, or the description with the suggestion, keeps every word exactly). Those are the answers `verify` discards, so the rewording reaches only the case that differs by number, and a run without verification (`--no-verify`) reads as before. The functional-image wording ("is all its link holds, and does not say where the link leads") still wins for an image that is all its link or button holds.

**What does not change.** `verify`: its two exact checks stay exact, so a suggestion that keeps every word exactly is still discarded, and one that differs by number is still kept. `output.problem` is not rewritten, so groups (`claimOf` reads the problem), `groundedImage`, the prompt, `version` (`'5'`), `confirmVersion` (`'1'`), the fingerprint and the patch are as before. **The second pass asks about the claim as before**: it built its question from the message, so the message text is now built by one function (`claimText`) that the message calls with the new wording and the second pass calls without it. Its questions, and so their cache keys, are the same, and the judgment cache keeps hitting (section 4).

## 3. How often the pattern occurs (dev halves, in-sample, counted)

`study/notes-alt-extension/count.ts` reads the judgment caches of the P3/P4 replay (`rampa-study-recordings/notes-precision-p3p4-2026-10-29/caches-after/<study>/<slug>/cache`) for the dev pages of each study (`data/pages.json`, `split == "dev"`). Among the distinct (page, alternative, suggestion) of the cached answers with verdict `fail` and problem `wrong_content`, each item is put in the first class that holds, in the order `verify` reads them: (a) the suggestion keeps every word of the alternative exactly (discarded); (c) the description and the suggestion together keep it exactly (discarded); (b) the suggestion keeps it only with `forms`; (d) the description and the suggestion keep it only with `forms`; (e) none. An item cached with several descriptions takes the first class any of them reaches.

| Study | Dev pages | Cached answers | Items | (a) suggestion keeps it exactly | (b) suggestion keeps it only with forms | (c) description and suggestion keep it exactly | (d) (c) only with forms | (e) none |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s2 (fresh-2026-10-11) | 12 | 46 | 33 | 14 | 0 | 0 | 0 | 19 |
| s3 (round-3-2026-10-23) | 12 | 54 | 40 | 4 | 1 | 6 | 0 | 29 |
| s4 (round-4-2026-10-24) | 12 | 17 | 17 | 1 | 0 | 1 | 0 | 15 |
| s5 (round-5-2026-10-28) | 12 | 45 | 45 | 3 | 1 | 0 | 0 | 41 |
| all | 48 | 162 | 135 | 22 | 2 | 7 | 0 | 104 |

No item of (c) has a suggestion that would also keep the alternative with `forms`, so no item counted in (c) hides one of (b). The two items of (b), both with a suggestion that also adds words (the new wording applies), and none in (d):

| Study | Page | Alternative | Suggestion | Claude final label | In the replay (section 4) |
| --- | --- | --- | --- | --- | --- |
| s3 | hcor-com-br | Alerta de Golpe | Alerta de segurança: Evite golpes. O Hcor não faz ligações para solicitar pagamentos antecipados. | false, false (the two copies) | two suggestions; the message changes |
| s5 | hering | Vestidos | Mulher usando vestido de alças com estampa abstrata | no finding | discarded before and after: "the alternative repeats the visible text of the link or button it sits in" |

The caches keep answers that earlier builds asked for as well (the Hcor item is cached with the description of two versions), so these are counts of cached answers, not of what one build asks. The replay of section 4 is what one build does with them.

## 4. The replay (offline, dev pages, 1.1.1 only)

`study/notes-alt-extension/replay.sh` runs `rampa check` on each dev page's recorded snapshot with `--model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 --offline --criteria 1.1.1`, a fresh copy of that page's cache from the same caches as section 3, each page in its own work directory, every API key variable unset. `--offline` asks no model. **Before** is `dist` built at `main` (`f3d20e7`); **after** is this branch's build at its code commit (`a576b5e`). `compare.ts` compares the two reports of each page (`data/compare.json`).

| Study | Pages | Identical sets | Misses before / after | Model calls before / after | Message changes | Other differences |
| --- | --- | --- | --- | --- | --- | --- |
| s2 | 12 | 12 / 12 | 0 / 0 | 0 / 0 | 0 | 0 |
| s3 | 12 | 12 / 12 | 0 / 0 | 0 / 0 | 2 | 0 |
| s4 | 12 | 12 / 12 | 0 / 0 | 0 / 0 | 0 | 0 |
| s5 | 12 | 12 / 12 | 0 / 0 | 0 / 0 | 0 | 0 |

- **The sets are identical on all 48 pages**: findings, below-threshold findings (by criterion, ref, fingerprint and source) and suggestions (by criterion, ref and rule). There was no cache miss on either side, and no model call.
- **The only differences are two messages**, on the Hcor banner's two copies, both suggestions: "describes something the image does not show" became "leaves out what the image conveys here". Field by field, nothing else in the 48 reports differs (`createdAt` aside), the second pass's answers included.
- The second item of (b), hering's "Vestidos", is discarded by an earlier fact in both runs, so no message shows it.

## 5. Limits

- **One dev item.** The rule was written on one banner, labelled false by the two Claude judges and true by one specialist. Today that item is a suggestion, not a finding, so the change moves no number of the studies.
- **The second pass still asks about the original claim.** It is asked whether the alternative "describes something the image does not show", which on Hcor it denied. A claim the pass confirms in that wording would be shown as "leaves out", a claim it was never asked about. Asking it about the new wording would change its questions, and so its cache keys, and take new model calls.
- **A known inconsistency, left for later labels to settle.** A suggestion that keeps every word of the alternative exactly is still discarded (`verify`), while one that keeps a word only in another number is reported, now as "leaves out". The same shape of answer is dropped or reported depending on one plural.
- **Later rounds will read such a finding as another kind of claim.** The studies' `claim_kind` (`study/human-review-2026-10/scripts/common.py`, not edited here) reads a finding's kind from its message's template; "leaves out what the image conveys here" is none of its 1.1.1 templates, so a finding worded this way reads as "1.1.1 other", not "wrong_content".
- **Only plurals in "s" or "es"** of words of 4 letters or more. Gender, "ão"/"ões" and English "y"/"ies" are left out on purpose: no dev item asked for them.

## 6. Data and reproduction

All paths under `study/notes-alt-extension/`. Run from the repository root with the recordings in `C:/Users/guilh/dev/rampa-study-recordings` (`RECORDINGS`) and Node 24 on `PATH`.

- `node count.ts` prints the tables of section 3 (data in `data/count.json`, with each item of (b) and (d) and its findings rows).
- Build `main` (`pnpm build`) and copy `dist` to `.rampa/alt-extension/dist-before`; build this branch and copy `dist` to `.rampa/alt-extension/dist-after` (`.rampa/` is ignored by git).
- `bash replay.sh before .rampa/alt-extension/dist-before` and `bash replay.sh after .rampa/alt-extension/dist-after`: the full reports, consoles and cache copies go to `.rampa/alt-extension/`, out of git.
- `node compare.ts before after` prints the tables of section 4 (data in `data/compare.json`).
