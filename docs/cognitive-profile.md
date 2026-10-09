# Cognitive accessibility profile (`--profile cognitive`)

`--profile cognitive` adds checks based on the W3C guidance for people with cognitive and learning disabilities: the Working Group Note *Making Content Usable for People with Cognitive and Learning Disabilities* (COGA, 29 April 2021, https://www.w3.org/TR/coga-usable/), whose design patterns the WAI lists as supplemental guidance (https://www.w3.org/WAI/WCAG2/supplemental/).

The Note says it plainly: "Following this guidance is not required for conformance to WCAG". So the profile's results are a class of their own, called **advisories**. An advisory:

- is never a WCAG failure, and never counts toward WCAG coverage;
- never changes the exit code, unless you pass `--fail-on advisory`;
- always carries a fixed label that says so: "Advisory · COGA o4p06 Use Clear Visible Labels (not a WCAG requirement)", or in Portuguese "Recomendação · COGA o4p06 Use rótulos claros e visíveis (não é requisito da WCAG)".

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
  confidence high · rule · id e3ae41a608ea
```

- **The label** comes from code, never from the check's text, and says what the advisory rests on.
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
  ◇ 3.1.4 Abbreviations: 2 abbreviations have no expanded form on this page: CPF ×2, CEP
```

AAA is beyond the A/AA target of a run, and W3C does not recommend requiring it for whole sites.

## Text measurements

The profile also measures the paragraph prose of the page, inside `main` or `article` when the page has them. The numbers are **context, never a verdict**: no advisory, no level, no pass or fail rests on them.

- Exact counts: words, sentences and paragraphs, the median and longest sentence (quoted), and lists written as prose (three or more items joined by commas, which COGA o3p05 asks to make a list). Sentences are split with `Intl.Segmenter`, without breaking after abbreviations such as "Sr.", "Av.", "e.g." or "U.S."; the ICU version is recorded with every result.
- English: paragraphs over 50 words (COGA §4.4.5) and sentences over 25 words (WCAG technique G153), then Flesch Reading Ease and the Flesch–Kincaid grade, on 100 words of prose or more. English syllables are estimated by rule, and the report says so.
- Portuguese: the Flesch adaptation of Martins, Ghiraldelo, Nunes and Oliveira Jr. (1996), with its four bands (100–75 very easy, 75–50 easy, 50–25 fairly difficult, 25–0 very difficult), on 100 words of prose or more. It was validated only as an ordering of textbook passages by school grade, and its authors say it measures "readability and not the comprehensibility": the report prints that caveat every time. No Portuguese grade level is computed. Syllables are counted by rule, with the hiatus convention schools teach (his-tó-ri-a).
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

## In each output

| Output | Advisories |
| --- | --- |
| Terminal | Their own section after the WCAG findings, grouped by check and ordered by impact, at most 3 elements per check and 20 per page without `--verbose`; then the text measurements; then the profile's lines in the coverage. Marked ◇, never ✗. |
| JSON | `report.advisory`: `results`, `belowThreshold`, `waived`, `checks` (what ran and why not), `coverage.patterns` (all 58, by slug), `notes`, `textMetrics`. `schemaVersion` stays 1: a reader that does not know `advisory` ignores it. |
| Markdown | A collapsed section, "Advisories (not WCAG requirements)", counted apart from the findings. When a pull request comment must fit its size limit, advisories are dropped first. |
| HTML | A section with its own heading after the findings; each group links to the COGA pattern page and its section of the W3C Note. |
| SARIF | Rules `coga/<check>` (and `wcag-aaa/3.1.4` beyond the target) at level `note`, tagged `not-wcag`; every result is a `note`, whatever its confidence. |
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
- **Not yet validated.** The four checks are marked `experimental` in `report.advisory.checks`: they have fixtures and corrupted-pair tests, but not yet the evaluation on real pages labelled by annotators that the plan requires before a check is called stable (docs/plans/cognitive-profile.md §4.2). Please report what looks wrong.

## Known limits

- Web pages only, in Portuguese and English. Text in other languages is counted but not screened for abbreviations.
- Rampa does not type into fields: a mask that reformats "01310-100" before validation makes a pattern advisory moot, which is why those are medium confidence. Wave 2 adds a typing probe.
- Abbreviations: dotted abbreviations (nº, p. ex., e.g.) and camel-case names outside the list are not screened. The curated lists are a seed, pending review by a plain-language editor. An abbreviation is reported once per page, at its first use.
- A long block the collector cut (over 20,000 characters) lowers confidence to medium: an explanation could sit past the cut. A page with more than 5,000 elements is not screened for abbreviations at all.
- The Portuguese pattern titles are Rampa's own, unofficial translation; the English title and the link go with them.

## Sources

- W3C, *Making Content Usable for People with Cognitive and Learning Disabilities*, Working Group Note, 29 April 2021: https://www.w3.org/TR/coga-usable/; pattern pages under https://www.w3.org/WAI/WCAG2/supplemental/patterns/.
- WCAG 2.2 Understanding 3.1.4 Abbreviations: https://www.w3.org/WAI/WCAG22/Understanding/abbreviations.html; 3.1.5 Reading Level: https://www.w3.org/WAI/WCAG22/Understanding/reading-level.html; technique G153: https://www.w3.org/WAI/WCAG22/Techniques/general/G153.
- HTML, the pattern attribute (compiled with the `v` flag): https://html.spec.whatwg.org/multipage/input.html#the-pattern-attribute.
- GOV.UK Design System on number inputs: https://technology.blog.gov.uk/2020/02/24/why-the-gov-uk-design-system-team-changed-the-input-type-for-numbers/.
- Schwartz, A. S. and Hearst, M. A. (2003), A simple algorithm for identifying abbreviation definitions in biomedical text: https://psb.stanford.edu/psb-online/proceedings/psb03/schwartz.pdf.
- Martins, Ghiraldelo, Nunes and Oliveira Jr. (1996), Readability Formulas Applied to Textbooks in Brazilian Portuguese, Notas do ICMSC-USP nº 28: https://repositorio.usp.br/item/000906089.
- Kincaid et al. (1975): https://apps.dtic.mil/sti/pdfs/ADA006655.pdf.
- Lei nº 15.263/2025, art. 5º, VIII: https://www.planalto.gov.br/ccivil_03/_Ato2023-2026/2025/Lei/L15263.htm.
- The design plan: [docs/plans/cognitive-profile.md](plans/cognitive-profile.md).
