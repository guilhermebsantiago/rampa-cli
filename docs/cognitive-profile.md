# Cognitive accessibility profile (`--profile cognitive`)

`--profile cognitive` adds checks based on the W3C guidance for people with cognitive and learning disabilities: the Working Group Note *Making Content Usable for People with Cognitive and Learning Disabilities* (COGA, 29 April 2021, https://www.w3.org/TR/coga-usable/), whose design patterns the WAI lists as supplemental guidance (https://www.w3.org/WAI/WCAG2/supplemental/).

The Note says it plainly: "Following this guidance is not required for conformance to WCAG". So the profile's results are a class of their own, called **advisories**. An advisory:

- is never a WCAG failure, and never counts toward WCAG coverage;
- never changes the exit code, unless you pass `--fail-on advisory`;
- always carries a fixed label that says so: "Advisory · COGA o4p06 Use Clear Visible Labels (not a WCAG requirement)", or in Portuguese "Recomendação · COGA o4p06 Use rótulos claros e visíveis (não é requisito da WCAG)".

**Every check is experimental so far, and every report says so.** A check stays experimental until it passes the evaluation the [plan](plans/cognitive-profile.md) sets (§4.2): it has fixtures, but it has not yet been measured on real pages or reviewed by people. Experimental checks run whenever the profile is on. In the terminal, Markdown and HTML reports, the advisory section opens with one notice, and each advisory from an experimental check carries the tag `experimental`; JSON and SARIF give each result its `maturity`. The notice reads:

> These advisories come from W3C COGA guidance (and GAIA where cited) and are not WCAG requirements. The ones marked experimental come from checks that have not yet been measured on real pages or reviewed by people, so each one needs a person's judgment.

In Portuguese: "Estas recomendações vêm da orientação COGA do W3C (e do GAIA, quando citado) e não são requisitos da WCAG. As marcadas como experimentais vêm de verificações que ainda não foram medidas em páginas reais nem revisadas por pessoas, então cada uma precisa do julgamento de uma pessoa." The tag comes from each check's maturity, so a check that passes its evaluation stops being marked. `--fail-on advisory` counts experimental advisories like any other.

The WCAG A/AA check runs exactly as without the profile: same findings, same coverage, same exit code.

```sh
rampa check examples/cognitive/cadastro.html --profile cognitive
rampa check https://example.gov.br/form --profile cognitive --locale pt-BR
rampa check site/ --profile cognitive --fail-on advisory   # advisories also fail the run
```

In `rampa.config.ts`:

```ts
export default defineConfig({
  profiles: ['cognitive'],
  coga: {
    abbreviations: { known: ['SUS', 'SEI'], glossaryUrl: '/glossario' }, // never reported; links to the glossary explain
    publicSector: true, // adds Lei 15.263/2025 to the abbreviation advisories; default: guessed from .gov.br, .leg.br, .jus.br, .mp.br
  },
})
```

From code, `check(targets, { profiles: ['cognitive'] })` and `checkSnapshot(snapshot, engine, { …, profiles: ['cognitive'] })` add `report.advisory`.

`examples/cognitive/cadastro.html` is a sign-up page in Portuguese with one case of each check, and a checked newsletter box that must stay silent.

## What is checked

Four checks, each tied to a sentence of a COGA pattern, and each screening only part of that pattern. Rules decide every fact; a model never decides whether something is a problem.

| Check | COGA pattern | What it looks for | Impact | Patch |
| --- | --- | --- | --- | --- |
| `coga/input-formats` | o4p08 Accept different input formats (o4p07 for an example the field refuses) | (a) `type="number"` on an identifier: postal code (CEP, ZIP, postcode), phone, card, CPF, CNPJ or account number; (b) a `pattern` that refuses a common way to write the value; (c) a `maxlength` shorter than a common way to write it; (d) an example shown with the field ("Ex.: 123.456.789-09", or a placeholder that looks like a value) that the field's own pattern or length refuses | barrier | (a) `type="text" inputmode="numeric"` (`type="tel"` for a phone) |
| `coga/preselected-cost` | o4p03 Notify Users of Fees and Charges; o7p03 Clearly State the Results and Disadvantages | A checkbox or switch checked when the page loads whose own text names a price above zero (R$, US$, $, €, £) or a commitment that costs later (a free trial, automatic renewal, a paid plan) | barrier | the start tag without `checked` |
| `coga/visible-labels` | o4p06 Use Clear Visible Labels | A text field whose only text on screen is its placeholder, which disappears once the person types | hurdle | a `<label>` with the placeholder's words, when they read as a label |
| `coga/abbreviations` | o3p01 Use Clear Words | An abbreviation (CPF, NIS, CNPJs, CadÚnico) with no explanation on the page: no `<abbr title>`, no `<dfn>`, no glossary link, and no full term next to it in brackets or after a dash, or explained only after its first use | hurdle in labels, buttons, headings, legends, navigation and forms; suggestion elsewhere | the first use written out, "Número de Identificação Social (NIS)", in a short element, only with an expansion the page or Rampa's list attests |

What stays silent, on purpose:

- **Input formats**: patterns that accept the common forms (`[0-9]{5}-?[0-9]{3}`); forms with `novalidate` or a submit with `formnovalidate`, which are checked by script, often with a mask; text fields with `inputmode="numeric"`; quantities in number fields; a PO box ("caixa postal"), a health card ("Cartão SUS"); a field that may hold two kinds of value ("CPF ou CNPJ"); a `pattern` that is not valid in the `v` mode browsers compile it with (browsers ignore it, so the report only notes it).
- **Pre-selected cost**: unchecked options, zero amounts, radio groups (a required choice always has one option selected), consent with no price ("Quero receber novidades por e-mail"), and the price of a product in the same table row as a gift-wrap box.
- **Visible labels**: a label on screen, tied to the field or right before it; a legend or group name; short text right before the field; a button with a name on the same line (WCAG technique G167, a search box and its "Buscar" button or magnifying glass).
- **Abbreviations**: words written in capitals (ENTRAR, SERVIÇOS: a dictionary knows them), Roman numerals (inciso VIII), Brazilian state codes (SP), currencies and units next to a number, file formats and names (PDF, IMG_2034.jpg), text in `code`, `pre` or `kbd`, addresses, and the abbreviations of your project (`coga.abbreviations.known`). An expansion Rampa's list attests counts next to the token even when it is a translation: "Perguntas Frequentes (FAQ)".

The profile works on web pages, in Portuguese and English. Android, iOS and images are not screened yet.

## Reading an advisory

```
◇ Advisory · COGA o4p08 Accept different input formats (not a WCAG requirement) · barrier
  #cep
  The postal code field is type="number", made for quantities: it refuses "01310-100" as people usually
  write it (the hyphen), and the arrow keys or the mouse wheel can change the value. COGA recommends
  accepting the ways people write a value: a text field with inputmode="numeric" shows the same keypad.
  Evidence: <input id="cep" name="cep" type="number" autocomplete="postal-code">
  Patch:
    - <input id="cep" name="cep" type="number" autocomplete="postal-code">
    + <input id="cep" name="cep" type="text" autocomplete="postal-code" inputmode="numeric">
  confidence high · experimental · rule · id e3ae41a608ea
```

- **The label** comes from code, never from the check's text, and says what the advisory rests on.
- **experimental** in the last line says the check that wrote the advisory has not passed its evaluation yet (see the notice at the top of this page). It comes from the check's maturity, `maturity` in the JSON and SARIF reports.
- **Impact** says what the barrier does to the person, fixed per check and never chosen by a model. It is not a WCAG severity.

  | Impact | Means | Example |
  | --- | --- | --- |
  | barrier | may stop the task, or cost money or data | a CEP field that refuses "01310-100"; a pre-checked paid add-on |
  | hurdle | makes the task harder or more error-prone | a label that disappears while typing |
  | suggestion | improves understanding | an unexplained abbreviation in a paragraph |

- **Confidence** says how sure Rampa is of the fact: high for what the attributes say alone; medium for a `pattern` or a `maxlength` (a script may reformat what is typed, and Rampa does not type), for a field with a name nobody sees, or when the collector cut a long block of text. Advisories below `--min-confidence` are left out like findings, and `--verbose` shows them.
- **Evidence and facts** let anyone recompute the claim: the start tag, the compiled pattern and each value it refuses, the label or row text with the amount in « », the sentence of the first use and what was searched. The JSON report has all the facts.
- **Patches are suggestions.** The words on a page belong to whoever writes them; an expansion of an abbreviation is proposed only when the page itself or Rampa's list attests it.
- **Related**: a WCAG finding on the same element is linked by its id, never repeated.

### The model's one step

With a model (the default when one is available, or `--model`), and only for an abbreviation that neither the page nor the list expands, a model proposes what it stands for. The proposal is kept only when the initials of its words spell the abbreviation, and it is shown as "Suggestion to confirm", with the model's name and no patch. The model never decides whether an abbreviation is explained or whether people know it. Syllable acronyms (DETRAN, PRONATEC, REDESIM) never pass the initials check, so they never get a proposal. With `--no-llm` the step is skipped and the rest runs as usual.

### Beyond the target

Abbreviations more common than their full term (CPF, CEP, RG, ZIP, PIN; the list is in `src/advisory/abbreviations/lists.ts`) are not COGA advisories: the Note asks to explain an abbreviation "unless the abbreviation is more common than the full term". WCAG 3.1.4 Abbreviations (Level AAA) still asks for a way to find their expanded form, so they are reported in one line, beyond the target:

```
Beyond the target (WCAG 2.2 AAA; not part of the A/AA check)
  ◇ 3.1.4 Abbreviations: 2 abbreviations have no expanded form on this page: CPF ×2, CEP · experimental
```

AAA is beyond the A/AA target of a run, and W3C does not recommend requiring it for whole sites.

## Text measurements

The profile also measures the paragraph prose of the page, inside `main` or `article` when the page has them. The numbers are **context, never a verdict**: no advisory, no level, no pass or fail rests on them.

- Exact counts: words, sentences and paragraphs, the median and longest sentence (quoted), and lists written as prose (three or more items joined by commas, which COGA o3p05 asks to make a list). Sentences are split with `Intl.Segmenter`, without breaking after abbreviations such as "Sr.", "Av.", "e.g." or "U.S."; the ICU version is recorded with every result.
- English: paragraphs over 50 words (COGA §4.4.5) and sentences over 25 words (WCAG technique G153), then Flesch Reading Ease and the Flesch–Kincaid grade, on 100 words of prose or more. English syllables are counted by a heuristic, not by a pronouncing dictionary, and the report says so (`syllables: "heuristic"` in the JSON). The heuristic counts vowel groups, less a silent final e and the -es and -ed endings it takes to be silent.
  - **How close it is.** It was compared with the CMU Pronouncing Dictionary on 943 words of 4 to 15 letters, sampled from Rampa's English word list (`test/fixtures/coga/syllables-en.json`, built by `scripts/syllables-en-sample.py`; a test checks these numbers):
    - it gives the dictionary's count for 806 of them (85.5%);
    - it is within one syllable for 942;
    - it counts 2.4% fewer syllables in all. It counts too few in 94 words, more than half of them by dropping a spoken -ed or -es (crowded, blushes), most of the rest by reading two vowels as one (being, video). It counts too many in 43, mostly compounds with a silent e inside (timeline, lifelong).
  - **What that does to the formulas.** Fewer syllables make Flesch Reading Ease read a little easier and the grade a little lower. At this sample's rate, 0.055 syllables fewer per word, that is about 4.7 points of reading ease and 0.65 of a grade. Running prose moves less: the sample has no words under four letters, which the heuristic counts as one syllable, and most are.
  - **Context, not a verdict.** This is one more reason Flesch–Kincaid is shown as context: no advisory and no level rests on it.
- Portuguese: the Flesch adaptation of Martins, Ghiraldelo, Nunes and Oliveira Jr. (1996), with its four bands (100–75 very easy, 75–50 easy, 50–25 fairly difficult, 25–0 very difficult), on 100 words of prose or more. It was validated only as an ordering of textbook passages by school grade, and its authors say it measures "readability and not the comprehensibility": the report prints that caveat every time. No Portuguese grade level is computed. Syllables are counted by rule, with the hiatus convention schools teach (his-tó-ri-a). The rules match a hand-counted list of 200 words (`test/fixtures/coga/syllables-pt.json`), which leaves out on purpose the words whose split depends on stress or a prefix.
- Other languages: counts only.

WCAG 3.1.5 Reading Level is listed in the coverage as needing a qualified reviewer, with these measurements attached for that reviewer.

## Coverage

Every report with the profile on says what was screened and what was not:

```
Cognitive profile (W3C COGA guidance; advisory, not WCAG conformance):
  Screened in part: 4 of 58 design patterns: o3p01 Use Clear Words (abbreviations), o4p03 Notify Users of Fees and
  Charges at the Start of a Task (pre-checked paid options), o4p06 Use Clear Visible Labels (placeholder-only labels),
  o4p08 Accept different input formats (static field attributes).
  Not checked: 54 patterns, and the rest of the ones screened in part (--verbose lists them).
  Beyond the A/AA target: WCAG 2.2 3.1.4 Abbreviations (AAA) checked; 3.1.5 Reading Level needs a qualified reviewer.
Testing with people should include people with cognitive and learning disabilities (COGA §5).
```

A pattern is never marked "passed" or "met": the Note defines no conformance, and "screened" means only that some sub-checks ran. With the profile off, a web report says in one line that COGA guidance was not screened.

These lines come after the WCAG coverage of the run (the coverage rows and each criterion's status, described in [WCAG 2.2](wcag-2-2.md)), in every format. The profile adds no method to a WCAG criterion and changes no criterion's status: its 3.1.4 and 3.1.5 are AAA, outside the A/AA target of a run whether it targets WCAG 2.2 or 2.1. Its `needsReview` (3.1.5) is a list of criteria, apart from the report's `needsReview`, which lists elements axe-core or Rampa's rules could not decide.

## In each output

| Output | Advisories |
| --- | --- |
| Terminal | Their own section after the WCAG findings, grouped by check and ordered by impact, at most 3 elements per check and 20 per page without `--verbose`; then the text measurements; then the profile's lines in the coverage. Marked ◇, never ✗. The section opens with the experimental notice, and each advisory of an experimental check is tagged `experimental`, as is the beyond-target line. |
| JSON | `report.advisory`: `results`, `belowThreshold`, `waived`, `checks` (what ran and why not, with each check's `maturity`), `coverage.patterns` (all 58, by slug), `notes`, `textMetrics`. Each result has the `maturity` of its check. `schemaVersion` stays 1: a reader that does not know `advisory` ignores it. |
| Markdown | A collapsed section, "Advisories (not WCAG requirements)", counted apart from the findings, with the same notice and tags as the terminal. When a pull request comment must fit its size limit, advisories are dropped first. |
| HTML | A section with its own heading after the findings, with the same notice and tags as the terminal; each group links to the COGA pattern page and its section of the W3C Note. |
| SARIF | Rules `coga/<check>` (and `wcag-aaa/3.1.4` beyond the target) at level `note`, tagged `not-wcag`; every result is a `note`, whatever its confidence. Results and rules carry `maturity` and `experimental` in their properties, and an experimental check's rule is also tagged `experimental`. |
| Exit code | Only `--fail-on advisory` counts them, together with the confirmed findings. |
| Waivers | Same file and command as findings: `rampa waive <id>`. The `coga/` prefix keeps the ids apart. |
| Baseline, `toPassRampa`, MCP | Unaffected: they read findings only. The MCP tools do not run the profile yet. |
| `--crawl` | Each page's JSON report has its advisories; the site view counts them per page. |

## Dictionaries

To tell a word in capitals (ENTRAR) from an acronym (CPF), the abbreviation check reads the Hunspell dictionaries for pt-BR (VERO) and en-US (SCOWL). Like the ACT test cases of `rampa eval`, they are downloaded at run time from LibreOffice's dictionary repository at a pinned commit, checked against pinned SHA-256 hashes, kept in `.rampa/dictionaries`, and never redistributed with Rampa. Without a dictionary (no network on the first run, say), the check says it did not run for that language and why, instead of guessing; the other checks run as usual. An entry written in capitals in the dictionary (NASA) stays an acronym. Some acronyms are also words or names (SUS, NIS, DETRAN): the curated list wins over the dictionary for them, and the rest are missed rather than flagged.

## What the profile is not

- **Not COGA conformance.** There is none. Four of 58 patterns are screened, each only in part; the rest needs review and testing with people.
- **Not a reading-level verdict.** Formulas count word and sentence length; they do not measure whether people understand a text.
- **Not a judgment of clarity or familiarity.** No check says a word is hard, a layout unfamiliar or a text "simple enough": those depend on the audience, and a model's opinion is not evidence.
- **Not an overlay.** It reads the page and never clicks, types or submits.
- **Not yet validated.** The checks are marked `experimental`, in `report.advisory.checks`, on each result and in every output. Each has pass and fail fixtures (`test/fixtures/coga/<check>/`) with the results they must give. The rest of the gate the plan requires before a check is called stable (docs/plans/cognitive-profile.md §4.2) is not built yet: the corrupted pairs, and the evaluation on real pages labelled by annotators (work item WI-10). Please report what looks wrong.

## Known limits

- Web pages only, in Portuguese and English. Text in other languages is counted but not screened for abbreviations.
- Rampa does not type into fields: a mask that reformats "01310-100" before validation makes a pattern advisory moot, which is why those are medium confidence. Wave 2 adds a typing probe.
- Abbreviations: dotted abbreviations (nº, p. ex., e.g.) and camel-case names outside the list are not screened. The curated lists are a seed, pending review by a plain-language editor. An abbreviation is reported once per page, at its first use.
- A long block the collector cut (over 20,000 characters) lowers confidence to medium: an explanation could sit past the cut. A page with more than 5,000 elements is not screened for abbreviations at all.
- The Portuguese pattern titles are Rampa's own, unofficial translation; the English title and the link go with them.

## Sources

### The guidance the profile draws on

None of these sources is a WCAG requirement, and none defines a conformance that a page could meet.

- **W3C, *Making Content Usable for People with Cognitive and Learning Disabilities* (COGA Content Usable).** Working Group Note, 29 April 2021: https://www.w3.org/TR/coga-usable/.
  - Its 58 design patterns are also published as WAI supplemental guidance (https://www.w3.org/WAI/WCAG2/supplemental/), with one page per pattern under https://www.w3.org/WAI/WCAG2/supplemental/patterns/.
  - It is not normative. Its abstract says: "Following this guidance is not required for conformance to WCAG".
  - Its status section says: "It is inappropriate to cite this document as other than work in progress." The task force is rewriting the patterns, so every advisory records the version it was written against (`coga-usable 2021-04-29`).
- **W3C, *Cognitive Accessibility User Research*.** First Public Working Draft, 15 January 2015: https://www.w3.org/TR/coga-user-research/.
  - It was never finished, and it too must not be cited "as other than work in progress".
  - It is background for this profile: no check rests on it.
- **GAIA, *Guia de Acessibilidade de Interfaces para Autismo*.** https://gaia.wiki.br/: 28 recommendations, G01 to G28. It is a guide, not a checker.
  - It comes from Talita Cristina Pagani Britto's master's dissertation: *GAIA: uma proposta de guia de recomendações de acessibilidade web com foco em aspectos do autismo*, Universidade Federal de São Carlos (UFSCar), 2016, advised by Ednaldo Brigante Pizzolato, https://repositorio.ufscar.br/handle/20.500.14289/8683.
  - It was published as Britto, T. C. P. and Pizzolato, E. B. (2018), "GAIA: uma proposta de um guia de recomendações de acessibilidade de interfaces Web com foco em aspectos do Autismo", *Revista Brasileira de Informática na Educação* 26(2), 102–123, doi:[10.5753/RBIE.2018.26.02.102](https://doi.org/10.5753/RBIE.2018.26.02.102).
  - Read it with its limits:
    - it is written for autistic children, and for multitouch devices;
    - it was piloted with 6 IT professionals, not with autistic users;
    - 16 of its 28 recommendations cite WebAIM's WAVE cognitive checklist, so GAIA and WebAIM are related sources, not independent ones;
    - it gives no mapping to WCAG. Where the plan maps a GAIA recommendation to a WCAG criterion or a COGA pattern (its Appendix A), the mapping is Rampa's, not GAIA's.
- **WebAIM's cognitive series.** *Cognitive Disabilities* (https://webaim.org/articles/cognitive/) and *Evaluating Cognitive Web Accessibility* (https://webaim.org/articles/evaluatingcognitive/).
  - It has no guidance specific to autism. It sorts barriers by function rather than by diagnosis: memory, problem-solving, attention, reading and verbal comprehension, math, and visual comprehension.
  - On evaluation it says: "For the most part, cognitive web accessibility is one of those "you know it when you see it" things. Common sense, holistic evaluation, and user testing should predominantly guide cognitive web accessibility evaluation."

### Why advisories, not failures

The sources themselves rule out a pass or fail. COGA Content Usable is outside WCAG conformance, and it warns against leaning on tools (§5.1): "automated testing often cannot assess if people with a cognitive or learning disability can use the content. It is vital for people with cognitive and learning disabilities that development teams do not rely solely on automated accessibility testing." WebAIM says that evaluation is mostly "you know it when you see it". So each check reports a fact anyone can recompute, such as a field's type, a pre-checked price or a label that is only a placeholder. It names the sentence of the pattern that fact touches, and leaves the judgment to a person. The coverage lists what was not screened, and the profile points to testing with people, including people with cognitive and learning disabilities (COGA §5).

### Other references

- WCAG 2.2 Understanding 3.1.4 Abbreviations: https://www.w3.org/WAI/WCAG22/Understanding/abbreviations.html; 3.1.5 Reading Level: https://www.w3.org/WAI/WCAG22/Understanding/reading-level.html; technique G153: https://www.w3.org/WAI/WCAG22/Techniques/general/G153.
- HTML, the pattern attribute (compiled with the `v` flag): https://html.spec.whatwg.org/multipage/input.html#the-pattern-attribute.
- GOV.UK Design System on number inputs: https://technology.blog.gov.uk/2020/02/24/why-the-gov-uk-design-system-team-changed-the-input-type-for-numbers/.
- Schwartz, A. S. and Hearst, M. A. (2003), A simple algorithm for identifying abbreviation definitions in biomedical text: https://psb.stanford.edu/psb-online/proceedings/psb03/schwartz.pdf.
- Martins, Ghiraldelo, Nunes and Oliveira Jr. (1996), Readability Formulas Applied to Textbooks in Brazilian Portuguese, Notas do ICMSC-USP nº 28: https://repositorio.usp.br/item/000906089.
- Kincaid et al. (1975): https://apps.dtic.mil/sti/pdfs/ADA006655.pdf.
- Lei nº 15.263/2025, art. 5º, VIII: https://www.planalto.gov.br/ccivil_03/_Ato2023-2026/2025/Lei/L15263.htm.
- The design plan: [docs/plans/cognitive-profile.md](plans/cognitive-profile.md).
