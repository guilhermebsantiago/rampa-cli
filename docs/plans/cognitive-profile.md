# Rampa cognitive accessibility profile (`--profile cognitive`): design plan

Date: 2026-10-09. Status (2026-10-15): wave 1 is built (merged on 2026-10-09), and all four of its checks are experimental: none has passed the gate in §4.2, because the evaluation tooling (WI-10) is not built. Of waves 2 and 3, the WCAG halves shared with the [coverage plan](wcag-coverage.md) are built, and so are four COGA checks that observe the live page (`coga/reduced-motion`, `coga/interruptions`, `coga/layout-shift`, `coga/paste-blocked`), all experimental. Where the code differs from the design below, the list that follows says so. Sources and their status are in Appendix B.

**Built and not built, as of 2026-10-15.** The rest of this plan is the design as written on 2026-10-09.

- **Advisory channel (WI-1): built.**
  - Built: `report.advisory`, routing, `--profile`, the `profiles` and `coga` config keys, `--fail-on advisory`, and waivers.
  - Where the code differs:
    - the types are in `src/advisory/types.ts`, not `src/core/types.ts`;
    - the checks are listed in `COGNITIVE_CHECKS` (`src/advisory/profile.ts`), not in a `registry.ts`;
    - each check implements `AdvisoryCheck` (`src/advisory/check.ts`). `Criterion` was not split into a `Judgment` interface.
  - Not built: `--advisory <id>`, and the `advisories: { include, exclude }` config key. Every check runs when the profile is on.
- **Maturity: changed on 2026-10-15** (§2.7). Experimental checks run with the profile, with their own confidence, and every output marks their advisories.
- **`--target wcag21-aa|wcag22-aa`: built differently.** It is `--wcag 2.1|2.2`, default 2.2, as A1 of the coverage plan, so it covers this plan's WI-9.
- **Reports (WI-2): built for pretty, JSON, Markdown and pull request comments, HTML and SARIF.** Every one marks experimental advisories.
  - Site report: built in part. It counts advisories per page; they are not grouped across pages.
  - API: built. `check(targets, { profiles })` and `checkSnapshot(…, { profiles })` add `report.advisory`.
  - Not built:
    - the MCP `profile` argument. The MCP tools never run the profile;
    - `toPassRampa({ advisories: true })`. `toPassRampa` ignores advisories;
    - the GitHub Action `profile` input. `args: --profile cognitive`, or `profiles` in `rampa.config.*`, turn the profile on in the Action.
  - The documentation is `docs/cognitive-profile.md`, not `docs/cognitive.md`.
- **Collector facts (WI-3): built.**
- **Checks that observe the live page: built on 2026-10-15, experimental.** A probe kind, `cognitive` (`src/probes/cognitive.ts`), loads the page twice at once, with `prefers-reduced-motion` off and on, watches it with no input for 8 s (3 s with `--fast`, `coga.observe` from the config), then dispatches the clipboard events. `--profile cognitive` turns it on for every web page Rampa loads, and its facts go into the snapshot, so a recording replays offline. Four checks read it, each with fail and pass fixtures:
  - `coga/reduced-motion` (o8p01; GAIA G09; WCAG 2.3.3 AAA as a beyond-target note);
  - `coga/interruptions` (o5p01; GAIA G09, G18), which includes WI-19's permission requests on load;
  - `coga/layout-shift` (o4p01);
  - `coga/paste-blocked` (o8p02, with o6p01 for password fields), the COGA half of WI-12. It dispatches synthetic events rather than a trusted paste, at medium confidence, and leaves a field with a 3.3.8 finding to that finding.
  - Not observed: `--crawl` pages, and `checkPage` from the Playwright integration. docs/cognitive-profile.md has the thresholds, the cost and the limits.
- **The four checks (WI-4, WI-5, WI-6, WI-8): built, experimental.**
  - Each has pass and fail fixtures with JSON sidecars, as §4.3 asks.
  - The curated abbreviation lists are in `src/advisory/abbreviations/lists.ts`, not `data/abbreviations/*.json`.
- **Text measurements (WI-7): built, with four differences** (§3.3):
  - English syllables come from a heuristic, not CMUdict;
  - the Portuguese syllable list has 200 words, not 300;
  - proper names and titles are not removed before the formulas;
  - there is no script for the ordering checks on OneStopEnglish and PorSimples (§4.3).
- **Evaluation (WI-10): not built.** None of these exists yet:
  - `rampa eval --suite coga`;
  - the COGA corruptors in `src/eval/pairs.ts`, and the `beforeLoad` hook;
  - the annotation export and import.
- **Wave 2:**
  - WI-11, the probe stage, is built as A6 of the coverage plan (`--probe`, `snapshot.observations`).
  - WI-12: 3.3.8 is built as B7 (`--probe auth`); `coga/paste-blocked` is built on the cognitive observation, with synthetic clipboard events (above).
  - WI-17: 3.3.1 and 3.3.3 from static error states are built as B8; the `coga/error-wording` advisory is not.
  - WI-19 is built as part of `coga/interruptions`.
  - WI-13 to WI-16 and WI-18 are not built.
- **Wave 3:**
  - The WCAG criteria are built on the coverage plan: 3.2.2, 3.2.6, 3.3.7, and 2.2.1 with a probe.
  - Of the COGA checks of the 1.4 table, `coga/layout-shift` and `coga/interruptions` are built; the others are not.

This plan builds on the COGA research and critique for Objectives 1–8, WCAG 2.2 and plain language. It also draws on the Rampa source as of 2026-10-09 (`main` at 611cb63, before the crawl branch was merged).

Where the critique corrected the research, this plan follows the critique. Every source quote below was checked on 2026-10-08 or 2026-10-09, either against the W3C pages or against local copies of the COGA Note, Lei 15.263/2025 and Martins et al. (1996).

---

## 0. Summary

**What the profile is.** `--profile cognitive` adds checks based on the W3C Cognitive and Learning Disabilities Accessibility Task Force guidance (COGA). They run on top of the normal WCAG A/AA run, and their results are a separate class called advisories. An advisory:

- is never a WCAG failure;
- never counts toward WCAG coverage;
- never changes the exit code unless the user passes `--fail-on advisory`.

The profile also reports WCAG criteria tied to cognition that fall outside the run's target. These are AAA criteria, and the 2.2-only A/AA criteria while the target is still WCAG 2.1. They appear as **beyond the target**: still WCAG, but outside the conformance check.

**First checks to ship (wave 1).** All of them are rules over the snapshot. None needs a probe, and only one makes an optional model call.

| # | Check id | Source | Why it goes first |
|---|---|---|---|
| 1 | `coga/input-formats` | COGA o4p08 Accept Different Input Formats (+ o4p07 for an example the field itself rejects) | Facts from attributes: `type="number"` on a CEP, phone or card field; a `pattern` or `maxlength` that rejects how people write the value; a hint whose example the field's own pattern rejects. High impact: "Dates, postal codes, and phone numbers are a particular nightmare" (COGA, Sam scenario). |
| 2 | `coga/visible-labels` | COGA o4p06 Use Clear Visible Labels | A field whose only on-screen label is its placeholder, which disappears once typing starts. The 3.3.2 module already counts the placeholder as visible, so this case falls through to the profile. No model. |
| 3 | `coga/preselected-cost` | COGA o4p03 Notify Users of Fees and Charges (Avoid 1) and o7p03 (Avoid 2) | A checkbox that is already checked at load and adds a price or a subscription. Deterministic and low risk of false positives; the harm is money. |
| 4 | `coga/abbreviations` | COGA o3p01 Use Clear Words; the rest of the abbreviations go to WCAG 2.2 3.1.4 (AAA), beyond the target; Lei 15.263/2025 art. 5º VIII as a reference | Detection and the absence of an expansion are deterministic. The model may only propose an expansion, and it is kept only if its initials match. High value on Brazilian public-sector pages. |
| – | Text measurements | (context, not a check) | Exact counts per block and per page, plus the validated formulas: Flesch–Kincaid for English, the Martins et al. (1996) Flesch adaptation for Portuguese. Shown as context, never as a verdict. |

The plumbing comes first and carries the risk the user named: an advisory must never read as a WCAG failure. It covers the advisory channel, routing, wording rules, the exit code, coverage, and a lint test that bans failure words from advisory messages.

**Next (wave 2).** These need a probe stage that writes observations into the snapshot:

- WCAG 2.2 3.3.8 Accessible Authentication, a WCAG finding the profile turns on, with `coga/paste-blocked` for sign-up fields;
- typing confirmation for input formats;
- required-field markers;
- status headings (o1p01);
- error-message wording;
- plain words from a curated lexicon;
- permission prompts on load;
- long text without structure.

**Never.** Verdicts on familiarity, logical menu categories, "too much content", reading level as pass or fail, rare words judged by frequency alone, idioms or sarcasm the model finds by itself, icon familiarity, voice menus, directions, and anything that clicks or submits on production. Section 1.5 lists them all.

---

## 1. Scope

### 1.1 Ground rules taken from the sources

- **COGA is supplemental guidance.** From the Note: "Following this guidance is not required for conformance to WCAG" (W3C Working Group Note, 29 April 2021, https://www.w3.org/TR/coga-usable/). The WAI pages list it under "Additional ways to improve accessibility, not required to meet WCAG" (https://www.w3.org/WAI/WCAG2/supplemental/). The Note defines no "COGA conformance", so Rampa never prints "meets COGA" and never marks a pattern as "passed".
- **AAA is outside the target.** WCAG 2.2: "It is not recommended that Level AAA conformance be required as a general policy for entire sites" (https://www.w3.org/TR/WCAG22/#cc1). AAA results are "beyond the target" and never mixed into A/AA findings.
- **Every check is tied to a sentence of a pattern.** Under §2.1.1 of the Note, a pattern "is probably applied" when a Use example is implemented and the Avoid examples are avoided. Each Rampa check names the exact Use, Avoid or "What to Do" sentence it screens, and quotes it in its metadata.
- **Pattern ids are the WAI slugs.** `o1p01-clear-purpose` … `o8p04-interface`: 58 patterns in 8 objectives, as listed on https://www.w3.org/WAI/WCAG2/supplemental/ on 2026-10-09. A check also records the source version, `coga-usable 2021-04-29`. The task force is rewriting the patterns, so ids may change; the source version keeps old reports readable.
- **Who decides what.** Deterministic rules decide whether a fact holds, and only rules may claim that something is absent ("no label", "no expansion"). The model may only:
  - classify text into a closed set, quoting it;
  - propose replacement text, which a rule then checks;
  - answer a yes/no question about a crop.
  
  It never judges familiarity, clarity for an audience, or "simple enough". This follows the project lesson that Gemma echoed self-check fields while deterministic facts in the context held up.
- **Absence claims need the whole page.** A check refuses to claim absence when `snapshot.truncated` is set (the 5000-node cap), or when it would have to read text beyond the collector's caps (`readingText` stops at 1000 characters, names at 300). Work item WI-3 raises those caps.

### 1.2 How checks were selected

A check ships first only when all five hold:

1. **Narrow claim.** One fact about one element, such as "the field's only label is its placeholder". Never a judgment about the page as a whole.
2. **Verifiable.** The claim can be recomputed from the snapshot, either by a rule or by checking the model's quote against it.
3. **Impact.** One of COGA's user stories describes the barrier, and the person loses the task, money or time because of it.
4. **Low false-positive risk.** The research and the critique agree the risk is low, and the spot checks found no flood on real pages, or the results can be grouped to avoid one.
5. **No interaction.** It works on today's snapshot plus small collector additions (WI-3). Checks that need probes go to wave 2, and checks that need a crawl or form submission go to wave 3.

### 1.3 Wave 1 checks

"Rule" means deterministic code with no model. Every check runs with `--no-llm`; the abbreviations check then skips only its model step.

| Check id | Source | What is decided, and by what | Evidence and verification | Patch | Languages |
|---|---|---|---|---|---|
| `coga/input-formats` | COGA o4p08 Accept Different Input Formats ([page](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p08-input-formats/)). Avoid: "Restricting entries to arbitrary lengths"; "Insisting on specific separator characters if they are not required and can be ignored"; "A credit number field that requires no spaces…"; "Telephone number field will not accept + codes or brackets". Claim (d) also maps to o4p07 Use Clear Step-by-step Instructions. | **Rule.** First the field's purpose, in this order: `autocomplete` token, then `type`/`inputmode`, then keywords in name, id or label (CEP, CPF, CNPJ, telefone, celular, phone, zip, cartão, card, data, date, nascimento). Then four claims: **(a)** `type="number"` on an identifier (postal code, phone, card, CPF, CNPJ, account); **(b)** the `pattern`, compiled as the HTML spec says (`v` flag, anchored as `^(?:…)$`), rejects at least one common way to write that purpose; **(c)** `maxlength` is shorter than a common written form; **(d)** a shown example (the placeholder when it looks like a value, or text after "Ex.:", "exemplo", "e.g.", "for example") is rejected by the field's own pattern. Claims (b)–(d) are skipped when the form has `novalidate` or the submit has `formnovalidate`. A pattern that is invalid under the `v` flag gives an info note only (browsers ignore it). | Start tag; how the purpose was derived; the compiled regex; each variant with its match or length result. All of it can be recomputed. Confidence: (a) high; (b)–(d) medium, because a script mask may rewrite the value before validation. Wave 2 raises (b)–(d) to high once a typing probe confirms. | (a) the start tag rewritten with `type="text" inputmode="numeric"` (`replace-element`, before and after). (b)–(d): fix text only, because the pattern is a design decision. | Variant tables: pt-BR (CEP, CPF, CNPJ, celular/telefone with and without +55, card numbers with spaces, dd/mm/aaaa) and en-US/en-GB (ZIP or postcode, phone, card, dates). Purpose keywords in EN and PT. Messages in EN and pt-BR. |
| `coga/visible-labels` | COGA o4p06 Use Clear Visible Labels ([page](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p06-clear-labels/)). What to Do: "be visible and next to the relevant control". How it Helps: "the label disappears when the focus is removed. The user cannot remember what the control is" (Note §4.5.6.3). Sam scenario §6.8.2: "the instructions disappear the minute he begins to type". | **Rule.** A visible, enabled text field (`input` text-like types, `textarea`) with a non-empty `placeholder`, and none of these: a shown `<label>` with text; `aria-labelledby` pointing to shown text; a shown legend or group name; short shown text right before the field (the 3.3.2 module's `surroundings`); a button beside it that labels it (G167, such as a search box with "Buscar"). | Start tag; the placeholder value; each label source checked and found empty. Recomputed from the snapshot. Confidence is high when the placeholder is the only name, and medium when an `aria-label` or `title` also exists, because COGA notes simple text-to-speech "often do[es] not read WAI-ARIA or titles". | When the placeholder reads as a label (no digits, `@` or mask characters), `<label for=id>{placeholder}</label>` before the field (`replace-element`). Otherwise fix text: keep the example as a hint linked with `aria-describedby`. | Detection works in any language. Messages in EN and pt-BR. Web only in wave 1. On Android, a hint inside Material `TextInputLayout` floats and stays visible, so native surfaces wait until that case is handled. |
| `coga/preselected-cost` | COGA o4p03 ([page](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p03-declared-charges/)), Avoid 1: "Final transactions that include new charges or hidden fees, that result in higher-than-expected total charges". COGA o7p03 ([page](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o7p03-supported-choice/)), Avoid 2: "Changing items from the original request without warning the user". **Honest mapping:** COGA never names pre-checked options. This is the narrowest reading of those two Avoid examples. | **Rule.** A visible, enabled checkbox or switch that is `checked` at load, whose name, label or row text has a non-zero money amount (R$, US$, $, €, £ followed by digits) or a recurring or trial commitment (`/mês`, `por mês`, `per month`, `assinatura`, `subscription`, `grátis por N dias`, `free for N days`, `trial`). Excluded: zero amounts, radio groups (a required choice always has one option selected), and consent checkboxes with no price. | The `checked` state recorded at load, and the label or row text quoted with the amount highlighted. Recomputed. Confidence high. | The start tag without `checked`, or with `aria-checked="false"` (`replace-element`). | Money and recurrence patterns for pt-BR and en. Messages in EN and pt-BR. |
| `coga/abbreviations` | COGA o3p01 Use Clear Words ([page](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o3p01-clear-words/)). What to Do: "Remove or explain uncommon acronyms, abbreviations, and jargon". Use: "explained the first time they are used, unless the abbreviation is more common than the full term". Avoid: "Abbreviations, acronyms, and jargon that the user may not know and are not explained". Tokens the COGA scope leaves out are reported as WCAG 2.2 **3.1.4 Abbreviations (AAA)**, beyond the target ([Understanding](https://www.w3.org/WAI/WCAG22/Understanding/abbreviations.html)). Related: Lei 15.263/2025 art. 5º VIII, "redigir o nome completo antes das siglas". | **Rules**, in four steps. **(1) Candidates:** tokens of 2–8 letters with at least 2 capitals and no run of 3 lowercase letters (CPF, NIS, CadÚnico), plus dotted abbreviations (nº, p. ex., e.g.). Excluded: all-caps words whose lowercase form is in the language's dictionary (ENTRAR), Roman numerals, Brazilian state codes, currency codes, units, file formats, text in code or URLs, and the project allowlist. **(2) Explained if** any occurrence has: `<abbr title>`; an adjacent long form matched by the Schwartz & Hearst (2003) algorithm, in either order, in parentheses or after a dash; `<dfn>`; a glossary link; or an entry in the project glossary. If only a later occurrence is explained, the result says "not at first use". **(3) Routing:** a token goes to COGA o3p01 when it is not on the curated per-locale list of abbreviations "more common than the full term" (CPF, CEP, RG, PDF, OK…). Tokens on that list go to WCAG 3.1.4, beyond the target, and are listed in one line per page. **(4) Model, optional:** proposes an expansion only when none is attested on the page, in the crawl or in the curated list. The proposal is kept only if its initials match the letters, and is shown as "suggestion to confirm" at low confidence, with no patch. | The token; the first-occurrence sentence (`verifyQuote` against the block); the occurrence count; each mechanism searched and not found; the snapshot is not truncated; where any expansion came from (page, list or model). The model never decides whether a token is explained or whether people know it. | `set-text` on the first occurrence, as "Número de Identificação Social (NIS)", only when the expansion is attested. Otherwise fix text. | pt-BR and en, which need a Hunspell dictionary (downloaded at run time and hashed, like the ACT data) and a curated list per locale. Off for other languages. Messages in EN and pt-BR. With `publicSector`, pt-BR messages add the Lei 15.263 reference. |

**Context, not a check:** text measurements (section 3).

**Beyond target in wave 1:**

- the 3.1.4 list from `coga/abbreviations`;
- a note added to the existing axe `meta-refresh` finding (2.2.1, A) that the same refresh also fails 2.2.4 and 3.2.5 at AAA (failure F41).

In axe-core 4.14.0, `meta-refresh-no-exceptions` fires only for delays over 20 hours, which is why the note goes on the 2.2.1 finding instead. Verified in the installed axe.

**Impact class of each wave-1 result.** Section 2.3 explains the scale. The class is fixed per check and scope, never chosen by the model.

| Check | Impact | User story behind it |
|---|---|---|
| `coga/input-formats` (a)–(d) | barrier | Sam §6.8.2: a form "requires a particular way of formatting information"; "Dates, postal codes, and phone numbers are a particular nightmare". |
| `coga/preselected-cost` | barrier | o4p03: users "surprise[d]… with the total cost", which the pattern ties to executive-function and memory impairments. |
| `coga/visible-labels` | hurdle | o4p06 How it Helps; Sam §6.8.2. |
| `coga/abbreviations` in labels, buttons, headings, legends and form text | hurdle | o3p01. Its Getting Started says to begin with headings, labels, navigation, instructions and error messages. |
| `coga/abbreviations` elsewhere, and the 3.1.4 list | suggestion | o3p01; WCAG 3.1.4 |

**De-duplication with WCAG findings** holds by construction:

- `coga/visible-labels` never fires where 3.3.2 reports `no_visible_label`. The 3.3.2 module only flags fields with no placeholder and no visible label.
- When `coga/input-formats` (b) and 3.3.2 `rule_not_explained` hit the same field, they describe different defects: the rule is restrictive, and the rule is unexplained. The advisory links the finding (`related: WCAG 3.3.2, id …`) and does not repeat it.
- An advisory is never emitted for a node and defect that a target finding already covers. For example, an inline link that fails axe `link-in-text-block` stays a 1.4.1 finding and gets no o1p05 advisory.

### 1.4 Waves 2 and 3

| Wave | Check | Source | Needs | Notes from the critique |
|---|---|---|---|---|
| 2 | **WCAG 2.2 3.3.8 Accessible Authentication (Minimum)** and `coga/paste-blocked` | 3.3.8 (AA, WCAG 2.2), F109, H100. COGA o6p01 Avoid "using a password and not allowing pasting"; o8p02 Enable APIs and Extensions. | Probe stage (WI-11), WCAG 2.2 target (WI-9) | Evidence comes from a **trusted** Ctrl+V. A synthetic `ClipboardEvent` falsely flags fields that trim a pasted value or spread a pasted code across boxes. Sign-up and `new-password` fields are out of scope for 3.3.8 ("It does *not* cover creation of a username or initiation of an account", [Understanding](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html), updated 06 Sep 2026), so they go to `coga/paste-blocked`. Other cases: a readonly password field filled only by an on-screen keypad (common in Brazilian banks); a "Sign in another way" link means cannot_tell. Reported as WCAG: beyond the target under 2.1, in the target under 2.2. |
| 2 | `coga/input-formats`, typing confirmation | o4p08 | Probe stage | Type each variant with real key events and read back the value and `validity`. Confirmed claims (b)–(d) become high confidence. |
| 2 | `coga/required-fields` | o4p04, What to Do: "Clearly indicating required fields" | `required` and `aria-required` kept by the collector (WI-3) | Only forms with 3 or more fields. A pass when any "(opcional)" marker or form-level note exists. One result per form. An asterisk with no programmatic `required` is a 1.3.1 candidate, not an advisory. |
| 2 | `coga/unexplained-disabled` | WCAG 3 draft "Disabled controls explained"; o7p04 | none | A disabled submit with no quoted explanation nearby or in `aria-describedby`. The model judges only the quoted nearby text. One result per form. |
| 2 | `coga/status-heading` | o1p01 Avoid: a page heading "Service not available"; "The user has to remember what the service relates to." | model | The model is called only when the main heading matches a status word list in EN and pt-BR (indisponível, erro, algo deu errado, 404…). The subject must be copied verbatim from the title or breadcrumb. The suggested heading must contain it. The site root is skipped. Generic headings stay with 2.4.6. |
| 2 | `coga/error-wording` with WCAG 3.3.1 and 3.3.3 | 3.3.1 (A), 3.3.3 (AA), ACT 36b590 (proposed); o4p04 user need "clear error messages" | model; static error states only | Errors already present in the snapshot (`aria-invalid`, `aria-errormessage` targets, `role=alert`, server-rendered errors) and the ACT fixtures. A generic message on an identified field passes 3.3.1, as Understanding says. Internal codes and jargon are advisory only. |
| 2 | `coga/plain-words` | o3p01; Lei 15.263 art. 5º IV and XIV ("evitar o uso de substantivos no lugar de verbos") | curated list | A curated list of substitutions (efetuar → fazer, efetivar → confirmar) and support-verb nominalisations ("efetuar o pagamento" → "pagar"), in button, link and field names and in instructions. The model writes the rewrite, and a rule checks it is shorter or uses the verb. Never a word-frequency verdict. |
| 2 | `coga/permission-on-load` | o5p01 Limit Interruptions; o7p07 Provide Reminders | init-script hook (WI-11) | `Notification.requestPermission`, geolocation or push subscribe called before any user activation. The hook must be read before Rampa's first `page.evaluate`, which itself gives the page user activation (measured). |
| 2 | `coga/long-text` with 2.4.10 (AAA) | o2p03, o3p08 ("In pieces of content with less than 300 words, headings can act as a summary"); WCAG 2.4.10 | full block text (WI-3); model | A prose run of more than 300 words with no heading and no summary marker. Reference lists, link directories, `dl`, tables, code and legal-act numbering are excluded. The model must cite at least 2 topic-change sentences, verified as substrings. One result per run, at low confidence until calibrated. |
| 3 | WCAG 3.3.7, and 3.3.1/3.3.3 with real submission; `coga/rule-only-in-error` (o4p07); `coga/feedback` (o4p10) | | form probe, only on allowlisted test origins (`--allow-submit=<origin>`) | Never on production. |
| 3 | WCAG 3.2.6 Consistent Help; `coga/help-reachable` (o7p05, o7p01) | | crawl merged; site-level stage | Pages are grouped by template, because the Understanding page says checkout pages without the shared navigation are not part of the set. Help is matched by destination, not by name. |
| 3 | WCAG 3.2.2 (select navigates on change); `coga/layout-shift` (o4p01); `coga/interruptions` (o5p01); WCAG 2.2.1 with a clock probe (o4p09); `coga/media-chapters` (o2p05); `coga/link-style` (o1p05); `coga/heading-fonts` (o1p03, font family only); `coga/ambiguous-dates` (o3p06, English pages only) | | probes, computed style | Each ships `experimental` first. |

### 1.5 Never: too subjective, or unsafe

| What | Pattern | Why not |
|---|---|---|
| "Unfamiliar layout or hierarchy" | o1p02 | COGA scopes its own examples to "an English site". Familiarity depends on culture, text direction, device and personal history, so there is no possible gold standard. |
| "Too much content" or "too many choices" verdicts | o5p03 | "Five or less main choices" is a design heuristic. At most, opt-in metrics with no threshold. |
| Whether menu categories are logical or menu terms familiar | o2p02 | Needs tree testing with users. A model's opinion is not evidence. |
| Reading level as pass or fail, or "simple enough" | 3.1.5, o3p01–o3p05 | Understanding 3.1.5: the working group "could not find a way to test whether this had been achieved" (updated 28 June 2026). Martins et al. (1996): formulas measure "readability and not the comprehensibility". 3.1.5 is listed as "needs a qualified reviewer". |
| Rare words judged by word frequency alone | o3p01 part B, 3.1.3 | wordfreq is frozen at about 2021 data (https://github.com/rspeer/wordfreq/blob/master/SUNSET.md). A Zipf cut-off flags Pix (2.70) and anexar (2.97), and misses COGA's own example "mode" (4.63). |
| Idioms, sarcasm or implied meaning the model finds without a lexicon match | o3p04, o3p12 | High false-positive risk, and agreement across runs does not remove the model's bias. Lexicon matches in instructions may come later. |
| Icon familiarity, icon clutter, "important instructions without icons" | o1p07 | No gold standard; the result depends on the audience. |
| Default advisories for "only a password sign-in" or "identifier-first sign-in" | o6p02, o6p03 | One design decision would produce three advisories, and identifier-first is the norm at gov.br and the big identity providers. Reported as facts in a sign-in options inventory at most. |
| Whether optional steps are necessary; fees across a checkout on production | o5p02, o4p03 flow | Business context. Only user-scripted flows on test environments, never a heuristic crawl that buys things. |
| Voice menus | o6p04 | A web checker cannot call a phone line. |
| Wayfinding directions | o7p06 | GPS and indoor navigation apps. |
| Whether help, a summary or instructions are "sufficient" or "clear enough" | o7p02, o7p04, o3p08 | Presence only, with quotes. Sufficiency needs people. |
| Busy backgrounds, white-space density, style consistency beyond font family | o3p10, o3p11, o1p03 | Thresholds without ground truth. 1.4.8 asks for a *mechanism*, so a computed line height below 1.5 is never a 1.4.8 failure. |
| Simple tense and voice in general prose | o3p02 | Detecting the Portuguese passive is unreliable. Lei 15.263 says "preferencialmente". |
| Personalisation and simplification semantics | o8p03, o8p04 | The WAI-Adapt spec now defines only `adapt-symbol`. |
| Any probe that clicks, submits or sends data on production | all | "Not an overlay": Rampa runs in development and CI. Submitting requires `--allow-submit=<origin>`. |

### 1.6 Not checked: needs testing with people

Every report with the profile on lists the patterns Rampa did not screen. That is 54 of the 58 in wave 1 (Appendix A). Even for the 4 screened patterns, the report says only part of the pattern was screened. The "Getting Started" sections of the COGA Note and its §5 usability testing are the next step that Rampa points to.

---

## 2. Reporting

### 2.1 Four classes of result

| Class | Where it lives | Counts toward | Label (EN / pt-BR) |
|---|---|---|---|
| WCAG failure inside the target (2.1 A/AA today; 2.2 A/AA with `--target wcag22-aa`) | `report.findings` (unchanged) | exit code, WCAG coverage | `WCAG 3.3.2 (A) — Labels or Instructions` (unchanged) |
| WCAG criterion outside the target: AAA, or 2.2-only while the target is 2.1 | `report.advisory.results` with `kind: 'beyond-target'` | nothing by default | "Beyond the target: WCAG 2.2 3.1.4 Abbreviations (AAA)" / "Além do alvo: WCAG 2.2 3.1.4 Abreviaturas (AAA)" |
| COGA advisory | `report.advisory.results` with `kind: 'advisory'` | nothing by default | "Advisory · COGA o4p06 Use Clear Visible Labels (not a WCAG requirement)" / "Recomendação · COGA o4p06 Use rótulos claros e visíveis (não é requisito da WCAG)" |
| Context: text measurements and inventories | `report.advisory.textMetrics` | nothing | "Text measurements (context, not findings)" / "Medidas do texto (contexto, não são achados)" |

Anything outside the run's conformance target lives outside `report.findings`. Every current reader of findings is therefore safe by construction:

- `failingFindings` in `src/cli/exit-code.ts`, where `confirmed` counts every finding;
- the site exit code (`src/core/site.ts` line 281);
- `toPassRampa` (`src/testing/format.ts`);
- the MCP summary (`src/mcp/format.ts`);
- the baseline (`src/adoption/baseline.ts`);
- the waivers CLI.

A flag on `Finding` would not be safe: one of these readers would miss it.

### 2.2 Data model

These are additive, optional fields, so **`schemaVersion` stays 1**. A reader that does not know `advisory` ignores it, which is the safe way for that reader to fail, because advisories never gate. Rampa Lab and `toPassRampa`, which checks `schemaVersion === 1`, keep working.

```ts
type Impact = 'barrier' | 'hurdle' | 'suggestion'

type Basis =
  | { framework: 'coga'; pattern: 'o4p06'; slug: 'o4p06-clear-labels'; title: Text; url: string;
      tr: string /* https://www.w3.org/TR/coga-usable/#use-clear-visible-labels-pattern */;
      statement: 'use' | 'avoid' | 'what-to-do' | 'how-it-helps'; quote: string; source: 'coga-usable 2021-04-29' }
  | { framework: 'wcag'; id: string; level: Level; version: '2.1' | '2.2'; outside: 'aaa' | 'wcag22' }
  | { framework: 'wcag3-draft'; requirement: string; url: string; draft: '2026-09-10' }

type Reference = { kind: 'law' | 'standard'; label: string /* 'Lei 15.263/2025, art. 5º, VIII' */; url: string }

interface Advisory {
  fingerprint: string            // fingerprint(check, ref, subject); the 'coga/…' prefix keeps the namespace apart
  check: string                  // 'coga/visible-labels'
  kind: 'advisory' | 'beyond-target'
  basis: Basis                   // primary basis
  related?: Array<Basis | Reference | { finding: string /* fingerprint of a WCAG finding */ }>
  impact: Impact                 // fixed per check and scope, never set by the model
  source: 'rule' | 'judgment' | 'engine' | 'probe'
  ref?: string; target?: string; html?: string
  message: string; evidence?: string; subject?: string
  facts?: Record<string, string | number | boolean>   // measured values: compiled regex, variant results…
  patch?: Patch; confidence: Confidence; agreement?: { votes: number; total: number }
  model?: string; location?: SourceLocation
}

interface AdvisorySection {
  profiles: string[]             // ['cognitive']
  results: Advisory[]
  belowThreshold: Advisory[]
  waived: Advisory[]
  checks: Array<{ check: string; version: string; maturity: 'stable' | 'experimental'; ran: boolean;
                  reason?: string /* 'no dictionary for fr', 'snapshot truncated' */; candidates: number; results: number }>
  coverage: {
    patterns: Record<string /* slug */, 'screened' | 'not-run' | 'not-checked'>
    beyondTarget: string[]       // WCAG ids checked beyond the target
    needsReview: string[]        // e.g. ['3.1.5'] with metrics attached
  }
  textMetrics?: TextMetrics      // section 3
}
// Report gets: advisory?: AdvisorySection; target?: 'wcag21-aa' | 'wcag22-aa'
```

A pattern is never marked `checked` or `passed`. `screened` means "some sub-checks ran", and the report lists which ones.

**Check interface.** Most checks here are rules, and the current `Criterion` always goes candidates → prompt → model. WI-1 adds:

```ts
interface Check {
  id: string; version: string; basis: Basis[]; maturity: 'stable' | 'experimental'
  surfaces: readonly Surface[]; needs: { model?: boolean; vision?: boolean; probes?: ProbeKind[]; dictionary?: boolean }
  /** Deterministic results; may also return candidates for an optional model step. */
  run(snapshot: A11ySnapshot, engine: EngineResults, ctx: CheckContext): { hits: Hit[]; candidates?: Candidate<unknown>[] }
  judge?: Judgment<unknown, JudgmentBase>   // the model half of today's Criterion: prompt, schema, verify, message, patch
  message(hit: Hit, locale: Locale): string
  patch?(hit: Hit, snapshot: A11ySnapshot): Patch | undefined
}
```

The model half of today's `Criterion` (`prompt`, `schema`, `verify`, `message`, `patch`) moves into a `Judgment` interface that `judgeCandidates` accepts. `Criterion` then becomes `Judgment` plus `id`, `level`, `act` and `engineRules`. Nothing about WCAG criteria changes.

**Code that currently assumes every id is a WCAG criterion** (WI-1 fixes each):

- `criterionLabel` (`src/wcag.ts`) prints `WCAG ${id}` for unknown ids, so `coga/x` would read "WCAG coga/x". Advisories get their own `basisLabel(basis, locale)`.
- `compareCriteria` gives NaN for non-numeric ids. Advisories are sorted by impact, then check, then page order.
- `judge.ts` builds `schemaName` as ``wcag_${id}_judgment``. For a check id it must replace `[^A-Za-z0-9_-]` with `_` and cap the name at 64 characters, the OpenAI response-format limit.
- `engineFindings` gives an engine rule outside the table `level: undefined` and still makes it a finding. Routing has to happen before any new axe tag or rule is enabled.

### 2.3 Impact scale for advisories

This is not a WCAG severity. It describes what the barrier does to the person, it is fixed per check and scope, and it is documented with the user story it rests on (table in 1.3).

| Value | EN | pt-BR | Meaning |
|---|---|---|---|
| `barrier` | may stop the task, or cost money or data | pode impedir a tarefa ou custar dinheiro ou dados | e.g. a CEP field that refuses "01310-100"; a pre-checked paid add-on |
| `hurdle` | makes the task harder or more error-prone | dificulta a tarefa ou leva a erros | e.g. a label that disappears while typing |
| `suggestion` | improves understanding | melhora a compreensão | e.g. an unexplained common abbreviation |

Confidence (high, medium, low) stays a separate axis. It says how sure Rampa is of the fact; impact says how much the fact matters. Pretty output never uses ✗ for an advisory: it uses `◇`. SARIF level is always `note`, with `properties.impact`.

### 2.4 Wording rules

1. Every advisory message starts with the fixed label in 2.1. The label comes from code, never from a check's own text.
2. Advisory text says what COGA recommends and what Rampa measured: "COGA recommends…", "A COGA recomenda…". It never says the page "fails", "violates" or "does not conform".
3. Beyond-target text may say "does not meet WCAG 2.2 3.1.4 (Level AAA)". It must add "AAA is beyond this run's A/AA target" and keep the W3C caveat about AAA in the coverage section.
4. **Banned words in advisory templates.** A test renders every message template of every check with fixture hits, strips the quoted page text, and fails on: `fail`, `failure`, `violat`, `non-conform`, `does not conform`, `falha`, `viola`, `não conform`, `reprov`, and `error` or `erro` used as a label.
5. COGA pattern titles in pt-BR are Rampa's own translation. The pt-BR documentation says so once ("tradução não oficial"); the English title and the URL always follow.
6. Patches on advisories are suggestions. MCP output tells coding agents that advisories are optional and that content wording belongs to the content owner.

Pretty output, English:

```
Advisories: cognitive accessibility (W3C COGA guidance, not WCAG requirements)
  ◇ Accept different input formats · COGA o4p08 · barrier
    #cep  The CEP field is type="number", so "01310-100" cannot be typed: number fields refuse
          the hyphen and drop a leading zero. COGA recommends accepting the ways people write
          a value.
      Evidence: <input type="number" id="cep" autocomplete="postal-code">; purpose from autocomplete
      Patch:  - <input type="number" id="cep" autocomplete="postal-code">
              + <input type="text" inputmode="numeric" id="cep" autocomplete="postal-code">
      confidence high · rule · id 3fa91c0e2b17
  ◇ Use clear visible labels · COGA o4p06 · hurdle · 3 fields in form#cadastro
    input[name=email]  The only thing on screen that says what this field asks for is its
          placeholder "Seu e-mail", which disappears once the person starts typing.
    …2 more (--verbose lists them)

Beyond the target (WCAG 2.2 AAA; not part of the A/AA check)
  ◇ 3.1.4 Abbreviations: 6 abbreviations have no expansion on this page: CPF ×4, CEP ×2, RG, …
```

pt-BR:

```
Recomendações de acessibilidade cognitiva (orientação COGA do W3C, não são requisitos da WCAG)
  ◇ Aceite diferentes formatos de entrada · COGA o4p08 · pode impedir a tarefa
    #cep  O campo CEP é type="number", então "01310-100" não pode ser digitado: campos numéricos
          recusam o hífen e apagam o zero à esquerda. A COGA recomenda aceitar os jeitos como as
          pessoas escrevem o valor.
Além do alvo (WCAG 2.2 AAA; fora da verificação A/AA)
  ◇ 3.1.4 Abreviaturas: 6 siglas sem o nome completo nesta página: CPF ×4, CEP ×2, RG, …
```

JSON (one result):

```json
{ "check": "coga/visible-labels", "kind": "advisory", "impact": "hurdle", "source": "rule",
  "basis": { "framework": "coga", "pattern": "o4p06", "slug": "o4p06-clear-labels",
             "url": "https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p06-clear-labels/",
             "statement": "how-it-helps", "quote": "the label disappears when the focus is removed",
             "source": "coga-usable 2021-04-29" },
  "ref": "form#cadastro input[name=\"email\"]", "confidence": "high",
  "facts": { "placeholder": "Seu e-mail", "labelElement": "none", "ariaLabelledby": "none", "textBefore": "none" } }
```

### 2.5 Every output format

| Output | Advisories |
|---|---|
| Pretty | A section after the WCAG findings, grouped by check, ordered by impact, at most 3 elements per check without `--verbose`. The text-measurements block comes next, then coverage. |
| Markdown and PR comment | A collapsed `<details>` section, "Advisories (not WCAG)", counted separately. The size-limit logic drops advisories before findings. |
| HTML | A section with its own heading, after the findings; each advisory links to the COGA pattern page and its TR anchor. |
| SARIF | Rules `coga/<check>` with `defaultConfiguration.level: 'note'` and `properties.tags: ['accessibility', 'coga', 'advisory', 'not-wcag']`. Beyond-target rules are tagged `wcag-aaa`. Results are always `note`. |
| JSON | `report.advisory` (2.2). |
| MCP (`check_page`) | New argument `profile: ['cognitive']`. A separate section, "Advisories (optional, not WCAG)". The summary counts advisories apart from findings. *Status 2026-10-15: not built; the MCP tools never run the profile.* |
| `toPassRampa` | Ignores advisories unless `{ advisories: true }` is passed. *Status 2026-10-15: it ignores advisories; the `advisories` option is not built.* |
| Site report | Advisories are grouped across pages like findings (shared-component signatures), in their own section. *Status 2026-10-15: built in part; the site view counts advisories per page, and each page's JSON report lists them.* |
| GitHub Action | `profile` input. *Status 2026-10-15: not built; `args: --profile cognitive` or `profiles` in the config turn the profile on.* |
| Every format | *Added 2026-10-15:* an advisory from an experimental check is marked: a notice at the top of the section and a tag on each advisory (pretty, Markdown, HTML), `maturity` on each result (JSON), and `maturity` and `experimental` on results and rules (SARIF). See 2.7. |

### 2.6 Exit code, waivers, baseline, volume

- **Exit code.** A new `--fail-on advisory` counts confirmed advisories in addition to confirmed findings. The other policies are unchanged and never see advisories. `exitCode` already returns 2 when every candidate of a criterion errors; that rule also applies to an advisory check's model step, but only under `--fail-on advisory`.
- **Waivers.** Fingerprints go in the same file as WCAG waivers; the `coga/` prefix keeps them apart.
- **Baseline.** Version 1 leaves advisories out. They never gate, so a baseline has nothing to hide.
- **Volume.** There is one result per subject (field, token, checkbox), so each can be waived on its own. Renderers group results per check and cap how many they show: 3 per check and 20 per page in pretty output, with the full list in JSON and SARIF. Abbreviations are one result per token per page, so 51 occurrences of "CPF" are one result.

### 2.7 Flag and configuration

```
--profile cognitive         run the profile's stable advisory checks, and the beyond-target checks tied to cognition
--advisory <id>             add a check by id, including experimental ones (repeatable); 'none' turns all off
--target wcag21-aa|wcag22-aa  conformance target (default wcag21-aa until the 2.2 list is evaluated)
--fail-on advisory          also fail on confirmed advisories
```

*Status 2026-10-15:* `--profile cognitive` and `--fail-on advisory` are built. `--advisory <id>` is not: the profile runs all its checks. `--target` is built as `--wcag 2.1|2.2` (default 2.2), on the coverage plan. In the configuration, `profiles` and `coga` are built; `advisories` and `target` are not (the version is `wcag`).

`rampa.config.ts`:

```ts
export default defineConfig({
  profiles: ['cognitive'],
  advisories: { include: ['coga/abbreviations'], exclude: ['coga/preselected-cost'] },
  target: 'wcag21-aa',
  coga: {
    abbreviations: { known: ['SUS', 'INSS'], glossaryUrl: '/glossario' },  // project allowlist and glossary
    publicSector: true,   // adds Lei 15.263/2025 references to pt-BR advisories; default: guessed from .gov.br, .leg.br, .jus.br, .mp.br
  },
})
```

**Maturity.** The design of 2026-10-09 said, in these words:

> - An **experimental** check runs only when named with `--advisory`, and its results are capped at low confidence, so they fall below the threshold by default.
> - A check becomes **stable**, and `--profile cognitive` turns it on, only after it passes its gate (section 4.2).

**Superseded on 2026-10-15** by the author's decision to keep what the code had done since wave 1 shipped:

- **Experimental checks run with the profile.** `--profile cognitive` runs every check, experimental or not. Their results keep the confidence each check gives them; none is capped at low.
- **Every output marks them.**
  - Each advisory carries its check's `maturity` (`Advisory.maturity`, copied from `AdvisoryCheck.maturity`).
  - Pretty, Markdown and HTML open the advisory section with one notice, in English and Portuguese. The notice says these advisories come from W3C COGA guidance (and GAIA where cited), are not WCAG requirements, are experimental (not yet measured on real pages or reviewed by people), and need a person's judgment.
  - The same three formats tag each advisory `experimental`.
  - SARIF gives results and rules `maturity` and `experimental`, and tags an experimental check's rule `experimental`.
  - JSON has `maturity` on each result and on each check.
- **Derived, not hard-coded.** The tag and the notice come from the check's maturity, so a check that passes its gate and becomes `stable` stops being marked.
- **The gate keeps one job.** Passing the gate (section 4.2) is what removes the experimental mark; it no longer decides whether the profile runs a check.
- **`--fail-on advisory` is unchanged.** It counts confirmed advisories, experimental ones included.

Each check has a `version`, which keys the cache and appears in coverage.

### 2.8 Coverage statements

**Profile on**, pretty output, English:

```
Coverage of this run
  Checked by axe-core (partial):   1.1.1, 1.3.1, …
  Judged with verified evidence:   1.1.1, 1.3.5, 2.4.2, …
  Not checked automatically:       23 of 50 WCAG 2.1 A/AA criteria (--verbose lists them)
  Cognitive profile (W3C COGA guidance; advisory, not WCAG conformance):
    Screened in part: 4 of 58 design patterns. o3p01 Use Clear Words (abbreviations),
    o4p03 Notify Users of Fees and Charges (pre-checked paid options),
    o4p06 Use Clear Visible Labels (placeholder-only labels), o4p08 Accept Different Input Formats.
    Not checked: 54 patterns, and the rest of these four (--verbose lists them).
    Beyond the A/AA target: WCAG 2.2 3.1.4 (AAA) checked; 3.1.5 Reading Level needs a qualified reviewer.
This report does not declare the page accessible.
What was not checked needs manual review and testing with people, including people with
cognitive and learning disabilities (COGA §5).
```

pt-BR:

```
  Perfil cognitivo (orientação COGA do W3C; recomendação, não é conformidade com a WCAG):
    Verificados em parte: 4 de 58 padrões de design. o3p01 Use palavras claras (siglas), …
    Não verificados: 54 padrões, e o restante destes quatro (--verbose lista).
    Além do alvo A/AA: WCAG 2.2 3.1.4 (AAA) verificado; 3.1.5 Nível de leitura exige revisão qualificada.
```

**Profile off.** One dim line under the coverage block:

- "Cognitive accessibility guidance (W3C COGA): not screened; `--profile cognitive` adds advisory checks."
- pt-BR: "Orientação de acessibilidade cognitiva (COGA do W3C): não verificada; `--profile cognitive` adiciona recomendações."

The one-sentence `coverageStatement()` used by Markdown, HTML and the PR comment gets one more clause with the same content. The i18n strings that hard-code "WCAG 2.1 A/AA" are `coverageNotCheckedCount`, `onPages`, `outsideLevels`, `coverageNotCheckedOf`, `sarifRuleDescription`, `wcagLink` and `agentNotCheckedList`. WI-9 changes them to take the target as a variable.

---

## 3. Readability: what to measure, and how to show it

### 3.1 Principle

Text measurements are **facts shown as context**. They never decide a finding, an advisory or a level. A number appears in two places:

- in the page's text-measurements block;
- as supporting evidence inside a result that has its own verified basis, such as a quoted long run without headings in `coga/long-text`.

3.1.5 Reading Level is listed in coverage as "needs a qualified reviewer", and the measurements are attached for that reviewer.

### 3.2 What to compute, per language

| Measure | Languages | Why it can be trusted | Shown as | Never used for |
|---|---|---|---|---|
| Words, sentences and paragraphs per block and per page; median, 90th percentile and maximum sentence length; the 3 longest sentences, quoted | en, pt-BR (other languages: counts only) | Exact counts once segmentation is pinned (3.3) | Context block | Any verdict |
| Paragraphs over 50 words | en only | COGA's own figure: "In English, if you have a paragraph of more than 50 words, try breaking it up" (Note §4.4.5) | A count, labelled with its source | A pt-BR threshold; no Portuguese figure has been validated |
| Sentences over 25 words; more than 2 conjunctions per sentence | en only | WCAG technique G153 (https://www.w3.org/WAI/WCAG22/Techniques/general/G153) | A count, labelled "G153 (English)" | pt-BR |
| Lists written as prose (3 or more items joined by commas, ending in and/or/e/ou) | en, pt-BR | Deterministic; COGA o3p05 asks for lists for "three or more things in a row" | A count, with spans | — |
| Flesch Reading Ease and Flesch–Kincaid Grade Level | en | Flesch (1948); Kincaid et al. (1975), fitted to comprehension scores of US Navy enlisted personnel (https://apps.dtic.mil/sti/pdfs/ADA006655.pdf) | Context, only on paragraph prose of at least 100 words, with its inputs | Microcopy, lists, tables, forms; a pass or fail |
| Flesch adapted to Portuguese (Martins, Ghiraldelo, Nunes & Oliveira Jr., 1996: +42 shift; bands 100–75 very easy, 75–50 easy, 50–25 fairly difficult, 25–0 very difficult) | pt-BR | Validated only as the *ordering* of textbook passages by school grade. The authors stress it measures "readability and not the comprehensibility" (https://repositorio.usp.br/item/000906089; local copy `coga-x7/martins.txt` lines 93 and 153) | Context, with that caveat printed every time, on prose of at least 100 words | Grade levels; a pass or fail |

**Deliberately not computed:**

- the ALT Portuguese formula: its coefficients could not be checked in its arXiv preprint;
- any pt-BR *grade*;
- NILC-Metrix: AGPL-3.0, so its code cannot go into MIT Rampa;
- model readability estimates: the published correlation is for English text and GPT-4 Turbo (TSAR 2024), and is untested for pt-BR and local 12B models;
- word frequency as a difficulty measure.

### 3.3 Segmentation and syllables

- **Sentences** use `Intl.Segmenter` with per-language abbreviation suppression. Node 24.21 with ICU 78.3 splits "O Sr. Silva mora na Av. Paulista, nº 1.000." and "See e.g. Fig. 3… The U.S. Navy" into too many sentences (measured). The suppression lists cover Sr., Sra., Dr., Av., art., nº, p. ex., e.g., i.e., U.S., Mr., St. and a.m., with guards for decimals, dates and URLs. Every result records `process.versions.icu` and the list version, and a test fails if an ICU update changes the fixture counts.
- **Words** use `Intl.Segmenter` with `isWordLike`.
- **Syllables:**
  - pt-BR uses a rule-based syllabifier: vowel groups with diphthong and hiatus rules. Hyphenation patterns are not syllables. It is tested on a hand-syllabified list of at least 300 words, with a target of at least 95% exact matches. *Status 2026-10-15: the list has 200 words (`test/fixtures/coga/syllables-pt.json`), and the rules match all of them. Words whose split depends on stress or a prefix are left out of it on purpose.*
  - en uses CMUdict, downloaded at run time and hashed, with a heuristic fallback. Counts that come from the fallback are flagged.
  - *Status 2026-10-15: no dictionary. English syllables are counted by the heuristic alone (`syllablesEn` in `src/text/syllables.ts`), and every formula result says so (`syllables: 'heuristic'`, and a line in the report).*
    - **How it compares.** It was measured against CMUdict on a sample of 943 words of 4 to 15 letters: every 20th word of the Tatoeba word list in `src/rules/words/en.ts` that has one count in CMUdict (`test/fixtures/coga/syllables-en.json`, built by `scripts/syllables-en-sample.py` from CMUdict at commit `74790861f652`).
      - The heuristic gives CMUdict's count for 806 of them (85.5%), and is within one syllable for 942.
      - In all it counts 2.4% fewer syllables. It drops a spoken -ed or -es, and reads some vowel pairs as one.
      - A test checks them.
    - **What that does to the formulas.** At that rate (0.055 syllables per word), Flesch Reading Ease reads about 4.7 points easier and the Flesch–Kincaid grade about 0.65 lower than with the dictionary. Prose with many short words moves less.
    - **Why the heuristic stays.** The formulas are context, never a verdict (3.1), and the report says how syllables were counted.
- **Input:** paragraph prose only, inside main or article, using the full block text (WI-3 removes the 1000-character cap there). Proper names and titles are removed with a capitalisation heuristic, as 3.1.5 allows (*status 2026-10-15: not built; they are counted like other words*). Each language that makes up at least 5% of the content gets its own result, as Understanding 3.1.5 asks.

### 3.4 Display

```
Text measurements (context, not findings) — main content, pt-BR
  1,240 words in 38 sentences and 14 paragraphs; median sentence 21 words, longest 74
  ("Para solicitar o benefício, o cidadão deverá comparecer…"); 2 lists written as prose.
  Flesch adapted to Portuguese (Martins et al., 1996): 31, band "fairly difficult" (50–25).
  Formulas count word and sentence length; they do not measure whether people understand the text.
```

In JSON, `report.advisory.textMetrics` holds:

- per block: ref, language, counts and spans;
- per page: the totals;
- `formula: { id: 'flesch-pt-martins-1996', value, band, inputs: { words, sentences, syllables } }`;
- the versions of the segmenter, syllabifier and ICU.

---

## 4. Evaluation

### 4.1 Questions for the thesis

- **RQ1.** How precise is deterministic COGA screening on real Brazilian and English pages? Is each stated fact true, and does the cited pattern apply?
- **RQ2.** Do accessibility specialists and plain-language editors agree with the advisories and their impact class?
- **RQ3**, a pilot. When paired versions of the same form differ only in what an advisory flags, do people with cognitive and learning disabilities complete the task with different success, errors, time or mood?

What the thesis can claim: the precision of facts (RQ1), agreement with specialists (RQ2), and qualitative evidence from users (RQ3). It cannot claim that a page is usable, or anything about "COGA conformance".

### 4.2 Gate for each check (experimental → stable)

1. **Fixtures:** 100% expected output on the deterministic parts. Every claim has a fail fixture and a pass twin.
2. **Corrupted pairs:** the verdict flips on at least 95% of pairs. The intact side produces 0 advisories from that check. Negative-control pairs, where the change does not touch the defect, must not flip.
3. **Real pages:** about 60 sampled advisories per check from the real-page set, labelled by 2 annotators.
   - Precision is the share where the fact is true *and* the pattern applies.
   - **Wilson 95% lower bound ≥ 0.85**, and **≥ 0.90 for `barrier` checks**. With 60 items, 58 correct gives a lower bound of about 0.89.
   - Report Cohen's κ, or Krippendorff's α for 3 or more raters. Labels count as gold only at ≥ 0.67, and headline numbers need ≥ 0.8.
4. **Scoring:** "no candidates" counts as **inapplicable**, never as a pass. This fixes the lesson of 2026-10-07, when `rampa eval` scored it as passed. Detector recall (did the check find the element?) is reported apart from judgment precision.
5. **Volume:** advisories per page on the real-page set are published. A check whose 90th percentile exceeds 10 per page needs better grouping before it ships.

### 4.3 Fixtures and corrupted pairs for wave 1

Fixtures live in `test/fixtures/coga/<check>/{pass,fail}/*.html`, each with a JSON sidecar listing the expected results by ref. Corruptors go in `src/eval/pairs.ts`, keyed `coga/<check>`. They need a new optional `beforeLoad` hook, either `addInitScript` or route rewriting, for cases that must exist at load. A corruptor never uses words that appear in a prompt.

| Check | Fail fixtures | Pass fixtures (must stay silent) | Corruptors (must flip) | Negative controls (must not flip) |
|---|---|---|---|---|
| `coga/input-formats` | `type=number` CEP, phone and card; `pattern="[0-9]{11}"` with `maxlength=11` on a phone; card `maxlength=16`; CPF hint "Ex.: 123.456.789-09" with a digits-only pattern; `pattern="[0-9]{8}"` CEP | permissive patterns; `novalidate` form; `inputmode=numeric` text field; GOV.UK-style `pattern="[0-9]*"` with server-side validation; a pattern invalid under `v` (info note only) | `number-identifier`, `restrict-format`, `example-contradicts` | `permissive-pattern` (widen the pattern to accept separators) |
| `coga/visible-labels` | placeholder only; placeholder plus `aria-label`; placeholder plus `title` | label plus placeholder; floating label that stays visible; search box with a "Buscar" button (G167); split phone number with a visible legend; a field with short text right before it | `label-to-placeholder` (move the label text into the placeholder and delete the label) | `add-placeholder` (keep the label, add a placeholder) |
| `coga/preselected-cost` | pre-checked "Seguro viagem + R$ 39,90"; pre-checked "Assinatura Premium: grátis por 7 dias, depois R$ 19,90/mês" | unchecked add-on; pre-checked "R$ 0,00"; a radio group with a default; a pre-checked newsletter with no price | `precheck-paid-addon` | `precheck-free-option` |
| `coga/abbreviations` | "Informe o NIS para continuar" with no expansion; expansion only at the 3rd occurrence; an expansion whose initials do not match | parenthetical at first use; `<abbr title>`; glossary link; "laser"/"radar"; ENTRAR in caps; "inciso VIII"; UF codes; ARFID with its expansion (WCAG 3 draft example) | `strip-expansion` ("Imposto Predial e Territorial Urbano (IPTU)" → "IPTU"; `abbr` titles removed), `expansion-mismatch` | `add-abbr-title` |
| Text measurements | — (exact-count unit tests) | — | — | Ordering checks: OneStopEnglish (CC BY-SA 4.0; elementary > intermediate > advanced on FRE in at least 80% of triples) and PorSimples original vs simplified (check the licence first). Reported as ordering agreement, not accuracy. |

### 4.4 Real-page set

The set reuses the pages of the real-pages study (branch `study/real-pages`). It is stratified by sector and language:

- pt-BR: gov.br services, state and municipal portals, banks, e-commerce, health, universities;
- en: GOV.UK, US federal sites, retail.

About 120 pages, 60 per language, with forms over-sampled because 3 of the 4 wave-1 checks look at fields. The pages are snapshotted once and replayed with `--offline`, so annotators and every model see the same input.

### 4.5 Human annotation, in three tiers

| Tier | Who | What they label | Needed for |
|---|---|---|---|
| A. Fact check | The author, plus a second annotator on 20% | Is the stated fact true? (The field is `type=number`; nothing on screen besides the placeholder names it; the checkbox is pre-checked and adds R$ 39,90.) | RQ1, deterministic checks. Expected agreement near 1.0; any disagreement is a bug, not a threshold to tune. |
| B. Specialists | At least 2 per item, plus adjudication: accessibility auditors; for abbreviations and words, plain-language editors; for impact, special-education teachers or speech-language therapists | Does the cited COGA pattern apply? Would you report it? Is the impact class right? For abbreviations: would the general public know it (yes / unsure / no)? | RQ2, the stable gate (4.2), and the curated "more common than the full term" list |
| C. People with cognitive and learning disabilities | 6–10 participants with diverse profiles (memory, attention, language, intellectual disability, dyslexia, aphasia), recruited through partner organisations: the university's accessibility office, APAEs, dyslexia and aphasia associations | Task-based sessions on **the corrupted pairs as stimuli**: placeholder vs visible label; CEP as `type=number` vs text; "NIS" vs "Número de Identificação Social (NIS)"; a pre-checked add-on vs an unchecked one. Within-subject, order counterbalanced. Measured: task success, errors including wrong clicks, time, and mood before and after on a 5-face scale (COGA §5.4). | RQ3, and checking that `barrier` and `hurdle` match what people experience. Reported descriptively and qualitatively. With 6–10 people, precision-style numbers are meaningless: 4 of 5 has a Wilson interval of about 0.38–0.96. |

**Only tier C needs real users.** These questions cannot be answered by specialists:

1. whether a flagged pattern is actually a barrier for the people COGA is about;
2. whether the impact scale ranks harm correctly;
3. which abbreviations and words people actually know. Tier B gives an estimate, which tier C should spot-check.

Everything else can be validated without participants.

**Ethics (Brazil), for tier C:**

- The study goes to a Comitê de Ética em Pesquisa through Plataforma Brasil under Res. CNS 466/2012 (https://conselho.saude.gov.br/resolucoes/2012/Reso466.pdf) and Res. CNS 510/2016 (https://conselho.saude.gov.br/resolucoes/2016/Reso510.pdf). Submit **now**, in parallel with WI-1 to WI-10: approval can take months of a TCC calendar.
- **Consent:**
  - an easy-read TCLE;
  - guardian consent plus the participant's assent (TALE) where legal capacity requires it;
  - the right to stop at any time without giving a reason;
  - breaks, a quiet room, and a companion who does not do the tasks (COGA §5.3–§5.4).
- **Payment.** COGA recommends paying participants. Res. 466/2012 allows no payment for taking part outside phase I and bioequivalence trials. Expenses of participants and companions, such as transport and food, must be reimbursed (*ressarcimento*). Budget for reimbursement and confirm with the CEP.
- **Data:** no recordings of faces or voices unless the CEP approves it; notes anonymised; only fixture pages, so no participant's personal data is ever typed into a real site.

### 4.6 Eval infrastructure (WI-10)

- `rampa eval --suite coga`: a runner for local fixtures, with gold per element from the sidecars, and scores per check (TP, FP, FN, inapplicable).
- An export of real-page advisories to CSV for annotation, and an import of the labels that computes precision with Wilson intervals and κ or α.
- The `Corruptor.beforeLoad` hook, and corruptor ids `coga/<check>/<name>`.
- `--no-verify` ablation for the one model step, the abbreviation expansion.

---

## 5. Implementation plan

Each work item is one branch that an agent can build and merge on its own. Effort: S is 2 days or less, M is a week or less, L is up to 3 weeks.

**Prerequisite:** the merge of `feat/crawl-and-browser-options` must land first. `main` currently has conflicts in `src/cli.ts`, `src/cli/commands/check.ts` and `src/surfaces/web.ts`, and WI-1, WI-2, WI-9 and WI-11 touch those files.

```
WI-1 advisory-channel ─┬─ WI-2 advisory-reports
                       ├─ WI-4 coga-visible-labels ──┐
WI-3 collector-facts ──┼─ WI-5 coga-input-formats ───┤
                       ├─ WI-6 coga-preselected-cost ┼─ WI-10 eval-advisories ─ (promote to stable)
WI-7 text-metrics ─────┴─ WI-8 coga-abbreviations ───┘
WI-9 wcag22-target (parallel; needed by WI-12)
Wave 2: WI-11 probe-stage ─ WI-12 accessible-authentication, WI-13 input-formats-probe, WI-19 permission-on-load
        WI-14 form-markers, WI-15 status-heading, WI-16 plain-words, WI-17 error-messages-static, WI-18 long-text
Non-code, start now: ETH-1 (CEP submission), ANN-1 (annotation guide and corpus)
```

### Wave 1

*Status 2026-10-15: WI-1 to WI-8 are built, WI-9 is built as A1 of the coverage plan, and WI-10 is not built. Where the code differs from the items below (file names, `--advisory`, the MCP and Action inputs, CMUdict), the list at the top of this plan says how.*

**WI-1 `feat/advisory-channel` (M).** Core types, routing and the exit code. No renderer work beyond what keeps pretty output from crashing.

- **Types and registry:**
  - in `src/core/types.ts`: `Basis`, `Impact`, `Advisory`, `AdvisorySection`, `Check`, and `Judgment` split out of `Criterion`, with `Report.advisory?` and `Report.target?`;
  - `src/advisory/coga.ts`: the catalogue of all 58 patterns, with slug, objective, English title, unofficial pt-BR title, WAI URL, TR anchor and source version. Read-only data checked against https://www.w3.org/WAI/WCAG2/supplemental/;
  - `src/advisory/registry.ts`: checks by id, with maturity and the profile set.
- **Running:** `src/core/check.ts` runs checks after the engine and criteria. It routes engine results by target (inside → findings; beyond target → advisory) and builds the coverage of patterns and checks.
- **Identifier fixes:** `basisLabel()`, no `compareCriteria` on check ids, and the `judge.ts` `schemaName` sanitised to `[A-Za-z0-9_-]{1,64}`.
- **Policies:** waivers apply to advisories; `--fail-on advisory` in `src/cli/exit-code.ts`.
- **CLI and config:** `--profile`, `--advisory` and config keys in `src/config.ts` and `src/cli/config-options.ts`.
- **Tests:**
  - a report holding only advisories exits 0 under `confirmed`, `any`, `A` and `AA`, and exits 1 under `advisory`;
  - advisories never appear in `coverage.engine`, `judged` or `notChecked`;
  - a lint test: COGA bases carry no `level`, and the banned-word list holds for every template in EN and pt-BR;
  - `schemaName` matches `^[a-zA-Z0-9_-]{1,64}$` for every registered id;
  - fingerprints are stable and live in their own namespace;
  - a version-1 report without `advisory` still loads in `toPassRampa` and in the waivers CLI.

**WI-2 `feat/advisory-reports` (M).** Every output format in section 2.5.

- Renderers: pretty (◇, grouping, caps, the impact label), Markdown and PR comment (collapsed section, dropped first when trimming for size), HTML, SARIF (`note` rules, tags), MCP (the `profile` argument and a separate section), `toPassRampa` (`advisories` option), site report grouping.
- i18n keys in EN and pt-BR; the coverage lines and `coverageStatement` clause from 2.8.
- Docs: `docs/cognitive.md`, covering what is screened, what never is, how to read an advisory, and how to give feedback; and a README principle, "COGA guidance is advisory, never WCAG conformance".
- Golden tests in both languages for each format. One SARIF test validates against `test/fixtures/sarif-schema-2.1.0.json`.

**WI-3 `feat/collector-form-facts` (S).** Changes to `src/surfaces/in-page.ts` only.

- `KEEP_ATTRS` gains: `maxlength`, `minlength`, `min`, `max`, `step`, `inputmode`, `required`, `aria-required`, `aria-invalid`, `aria-errormessage`, `novalidate`, `formnovalidate`, `onpaste`, `translate`, `aria-current`, `aria-haspopup` and `aria-controls`.
- Inside `main` and `article`, `readingText` keeps blocks up to 20,000 characters, and text-bearing `div` and `section` blocks are recorded, so word counts and the search for expansions see the whole text.
- A helper, `canClaimAbsence(snapshot)`, returns false when the snapshot is truncated.
- The snapshot schema does not change: attributes live in `native`. Tests: fixture snapshots are refreshed, and old recorded snapshots still replay.

**WI-4 `feat/coga-visible-labels` (S).** Depends on WI-1 and WI-3.

- Move `visibleLabelOf`, `surroundings`, `legendOf` and `shown` from `labels-or-instructions.ts` into `src/criteria/fields.ts`, shared by both modules with no change in behaviour (the existing 3.3.2 tests must pass unchanged).
- The check as in 1.3, with fixtures and corruptors as in 4.3.

**WI-5 `feat/coga-input-formats` (M).** Depends on WI-1 and WI-3.

- `src/advisory/formats/` holds the purpose detection, which shares tokens with `autofill.ts`, and the variant tables for pt-BR and en.
- A shared `compilePattern()` follows the HTML spec (`v` flag, anchored) and reuses the logic of `exampleOf`.
- Claims (a)–(d), the `novalidate` skip, and an info note for patterns invalid under `v`.
- A unit-test table with the same expected results as Chromium's `validity.patternMismatch` for at least 30 patterns, generated once with Playwright and stored.

**WI-6 `feat/coga-preselected-cost` (S).** Depends on WI-1. Money and recurrence regexes for pt-BR and en, the exclusions, the patch, fixtures and corruptors.

**WI-7 `feat/text-metrics` (M).** Depends on WI-3.

- `src/text/segment.ts` with suppression lists and the ICU version recorded.
- `src/text/syllables-pt.ts` and `src/text/syllables-en.ts`, the latter with CMUdict downloaded at run time and hashed. *Status 2026-10-15: built as one file, `src/text/syllables.ts`, with no CMUdict: English uses the heuristic (3.3).*
- `src/text/formulas.ts`: FRE and FKGL for en, Martins for pt-BR, with the bands.
- `report.advisory.textMetrics`, built whenever the profile is on, and the pretty and JSON output.
- Tests: exact counts on the segmentation fixtures; the syllabifier against a hand-syllabified list of at least 300 words; a script for the ordering checks.

**WI-8 `feat/coga-abbreviations` (M).** Depends on WI-1, WI-3 and WI-7 (segmentation).

- Candidates; Schwartz & Hearst (2003) long-form matching (https://psb.stanford.edu/psb-online/proceedings/psb03/schwartz.pdf).
- Hunspell dictionaries for pt_BR and en_US, downloaded at run time from LibreOffice's dictionaries and hashed. Without a dictionary the check reports `ran: false, reason` instead of guessing.
- `data/abbreviations/{pt-BR,en}.json`: tokens "more common than the full term", and attested expansions with their sources, for example siglas published on gov.br. Reviewed by a plain-language editor in ANN-1.
- The model step proposes an expansion; the initials check verifies it.
- Routing between COGA o3p01 and 3.1.4 beyond the target; the Lei 15.263 reference only with `publicSector`.
- Fixtures and corruptors.

**WI-9 `feat/wcag22-target` (M).** On the WCAG track, in parallel with the rest.

- `WCAG22_A_AA` in `src/wcag.ts`: 55 criteria, dropping 4.1.1 and adding 2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7 and 3.3.8. Names in EN and pt-BR, and WCAG22 Understanding URLs.
- `--target` and the `wcag22a`/`wcag22aa` axe tags; the only rule they add is `target-size` (verified in axe 4.14).
- Beyond-target routing for 2.2-only criteria under a 2.1 target.
- The F41 note on `meta-refresh`. `identical-links-same-purpose` reported as 2.4.9 needs-review, but only in the profile.
- The i18n strings from 2.8 take the target as a variable.

**WI-10 `feat/eval-advisories` (M).** Depends on WI-1 and on each check: the eval runner and annotation tooling from 4.6. It produces the numbers that promote each check to stable, with the gate from 4.2.

### Wave 2

| WI | Branch | Effort | Content |
|---|---|---|---|
| WI-11 | `feat/probe-stage` | L | Optional `snapshot.observations` field (zod and JSON schema; additive). Init scripts installed before navigation (`web.ts`). A network guard during probes: abort non-GET requests, block WebSockets, log each abort, and make any claim that depends on an aborted request cannot_tell. A browser-wide clipboard lock. A typing helper using `pressSequentially`. Probes run after the snapshot, in their own context. Offline replay: verification re-reads observations. |
| WI-12 | `feat/accessible-authentication` | M | WCAG 3.3.8 with trusted paste, F109 split codes, partial-character prompts, text and math CAPTCHAs, the alternatives inventory and the readonly-keypad case; `coga/paste-blocked` for sign-up and confirmation fields. Fixtures from the critique: trim-on-paste and a code that spreads across boxes (pass); a `beforeinput` blocker and a readonly keypad (fail). |
| WI-13 | `feat/coga-input-formats-probe` | S | Typing confirmation for (b)–(d); confidence becomes high when confirmed. Fixtures with mask libraries. |
| WI-14 | `feat/coga-form-markers` | S | `coga/required-fields` and `coga/unexplained-disabled`. |
| WI-15 | `feat/coga-status-heading` | S | o1p01, model gated by the status word list, reusing the 2.4.6 prompt machinery. |
| WI-16 | `feat/coga-plain-words` | M | A curated substitution and nominalisation lexicon for pt-BR, plus a seed list for en. The model writes the rewrite; a rule checks it. |
| WI-17 | `feat/error-messages-static` | M | 3.3.1 and 3.3.3 from static error states, ACT 36b590 added to `ACT_RULES`, and the COGA wording advisory. |
| WI-18 | `feat/coga-long-text` | M | o2p03, o3p08 and 2.4.10 (AAA), with exclusions and topic boundaries verified as substrings. |
| WI-19 | `feat/coga-permission-on-load` | S | The permission hooks from WI-11, read before the first `evaluate`. |

### Wave 3

These follow the order of the table in 1.4: the form probe for test origins only (3.3.7, 3.3.1/3.3.3 with submission, o4p07, o4p10); site-level checks after the crawl merge (3.2.6, o7p05 and o7p01 presence); then the remaining probes (3.2.2, o4p01, o5p01, 2.2.1 with a clock, o2p05) and computed-style checks (o1p05, o1p03 font family).

### Non-code items, starting now

- **ETH-1:** the CEP protocol for tier C (4.5): easy-read TCLE and TALE, reimbursement budget, partner letters, data plan. Submitted through Plataforma Brasil.
- **ANN-1:** an annotation guide for tiers A and B, with one page per check: questions, examples and edge cases. The real-page sample (4.4) and recruitment of specialist annotators. Review of the curated abbreviation and word lists.

---

## Appendix A. Coverage of the 58 COGA patterns after wave 1

As of 2026-10-15, wave 1 screens 4 patterns in part:

- o3p01 Use Clear Words (abbreviations only);
- o4p03 Notify Users of Fees and Charges (pre-checked paid options only);
- o4p06 Use Clear Visible Labels (placeholder-only labels only);
- o4p08 Accept Different Input Formats (static attributes only; o4p07 for an example the field rejects).

The checks that observe the live page, built on 2026-10-15, screen 4 more in part, when the page was observed:

- o4p01 Ensure Controls and Content Do Not Move Unexpectedly (layout shifts with no input);
- o5p01 Limit Interruptions (dialogs, layers, messages, alert boxes, windows, permission requests, sound and carousels with no input);
- o8p01 Let Users Control When the Content Moves or Changes (motion that keeps running with reduced motion on);
- o8p02 Enable APIs and Extensions (paste, copy, the context menu and text selection).

The other 50 are not checked, and they need review and testing with people. The table lists all 58, with what wave 1 screens, what waves 2 and 3 plan (section 1.4), and how each pattern could be checked at all.

**The checkability column** (added 2026-10-15) rates each pattern as a whole, from the research notes of that date:

- **D**: deterministic, from the DOM or computed CSS;
- **P**: a browser probe;
- **J**: a model, with evidence a rule verifies;
- **H**: only a person, or testing with users, can decide.

`D+J` means both are needed, for different parts of the pattern. `D/P` means either one would do. The first letter is the main one.

| Pattern | Section | Title | Wave 1 (built) | Planned in waves 2–3 | Checkability |
|---|---|---|---|---|---|
| o1p01 | §4.2.1 | Make the Purpose of Your Page Clear | not checked | W2 `coga/status-heading` (WI-15) | D+J |
| o1p02 | §4.2.2 | Use a Familiar Hierarchy and Design | not checked | not checked, by design | P+H |
| o1p03 | §4.2.3 | Use a Consistent Visual Design | not checked | W3 `coga/heading-fonts` (font family only) | D/P |
| o1p04 | §4.2.4 | Make Each Step Clear | not checked | not checked, by design | D+J |
| o1p05 | §4.2.5 | Clearly Identify Controls and Their Use | not checked | W3 `coga/link-style` | D |
| o1p06 | §4.2.6 | Make the Relationship Clear Between Controls and the Content They Affect | not checked | not checked, by design | D+J |
| o1p07 | §4.2.7 | Use Icons that Help the User | not checked | not checked, by design | J+H |
| o2p01 | §4.3.1 | Make it Easy to Find the Most Important Tasks and Features | not checked | not checked, by design | J+P/H |
| o2p02 | §4.3.2 | Make the Site Hierarchy Easy to Understand and Navigate | not checked | not checked, by design | P+J/H |
| o2p03 | §4.3.3 | Use a Clear and Understandable Page Structure | not checked | W2 `coga/long-text` (WI-18) | D+J |
| o2p04 | §4.3.4 | Make it easy to find the most important actions and information on the page | not checked | not checked, by design | P+J |
| o2p05 | §4.3.5 | Break Media into Chunks | not checked | W3 `coga/media-chapters` | P |
| o2p06 | §4.3.6 | Provide Search | not checked | not checked, by design | D+P |
| o3p01 | §4.4.1 | Use Clear Words | screened in part: `coga/abbreviations` | W2 `coga/plain-words` (WI-16) | J+D |
| o3p02 | §4.4.2 | Use a Simple Tense and Voice | not checked | not checked, by design | J |
| o3p03 | §4.4.3 | Avoid Double Negatives or Nested Clauses | not checked | not checked, by design | J |
| o3p04 | §4.4.4 | Use Literal Language | not checked | not checked, by design | J |
| o3p05 | §4.4.5 | Keep Text Succinct | not checked | text measurements only (context, lists written as prose) | D+J |
| o3p06 | §4.4.6 | Use Clear, Unambiguous Formatting and Punctuation | not checked | W3 `coga/ambiguous-dates` (English only) | D+J |
| o3p07 | §4.4.7 | Include Symbols and Letters Necessary to Decipher the Words | not checked | not checked, by design | H |
| o3p08 | §4.4.8 | Provide Summary of Long Documents and Media | not checked | W2 `coga/long-text` (WI-18) | D+J |
| o3p09 | §4.4.9 | Separate Each Instruction | not checked | not checked, by design | J |
| o3p10 | §4.4.10 | Use White Spacing | not checked | not checked, by design | D+P |
| o3p11 | §4.4.11 | Ensure Foreground Content is not Obscured by Background | not checked | not checked, by design | P+D |
| o3p12 | §4.4.12 | Explain Implied Content | not checked | not checked, by design | J |
| o3p13 | §4.4.13 | Provide Alternatives for Numerical Concepts | not checked | not checked, by design | D+J |
| o4p01 | §4.5.1 | Ensure Controls and Content Do Not Move Unexpectedly | not checked; since 2026-10-15 screened in part: `coga/layout-shift` (observed) | W3 `coga/layout-shift`: built | P |
| o4p02 | §4.5.2 | Let Users Go Back | not checked | not checked, by design | P |
| o4p03 | §4.5.3 | Notify Users of Fees and Charges at the Start of a Task | screened in part: `coga/preselected-cost` | — | J/H |
| o4p04 | §4.5.4 | Design Forms to Prevent Mistakes | not checked | W2 `coga/required-fields` (WI-14) | D+P |
| o4p05 | §4.5.5 | Make it Easy to Undo Form Errors | not checked | not checked, by design | H |
| o4p06 | §4.5.6 | Use Clear Visible Labels | screened in part: `coga/visible-labels` | — | D+P+J |
| o4p07 | §4.5.7 | Use Clear Step-by-step Instructions | not checked (a related basis of `coga/input-formats`) | W3 `coga/rule-only-in-error` | D+J |
| o4p08 | §4.5.8 | Accept different input formats | screened in part: `coga/input-formats` (static attributes) | W2 typing confirmation (WI-13) | P+D |
| o4p09 | §4.5.9 | Avoid Data Loss and “Timeouts” | not checked | W3 2.2.1 with a clock probe | P+D+J |
| o4p10 | §4.5.10 | Provide Feedback | not checked | W3 `coga/feedback` | P |
| o4p11 | §4.5.11 | Help the user stay safe | not checked | not checked, by design | H |
| o4p12 | §4.5.12 | Use Familiar Metrics and Units | not checked | not checked, by design | D+J |
| o5p01 | §4.6.1 | Limit Interruptions | not checked; since 2026-10-15 screened in part: `coga/interruptions` (observed) | W2 `coga/permission-on-load` (WI-19) and W3 `coga/interruptions`: built as one check | P |
| o5p02 | §4.6.2 | Make Short Critical Paths | not checked | not checked, by design | H |
| o5p03 | §4.6.3 | Avoid Too Much Content | not checked | not checked, by design | D+J |
| o5p04 | §4.6.4 | Provide Information So a User Can Complete and Prepare for a Task | not checked | not checked, by design | J |
| o6p01 | §4.7.1 | Provide a Login that Does Not Rely on Memory or Other Cognitive Skills | not checked (since 2026-10-15, a related basis of `coga/paste-blocked` for password fields) | W2 `coga/paste-blocked` (WI-12): built, under o8p02 | D+P |
| o6p02 | §4.7.2 | Allow the User a Simple, Single Step, Login | not checked | not checked, by design | P/J |
| o6p03 | §4.7.3 | Provide a Login Alternative with Less Words | not checked | not checked, by design | J |
| o6p04 | §4.7.4 | Let Users Avoid Navigating Voice Menus | not checked | not checked, by design | H |
| o6p05 | §4.7.5 | Do Not Rely on Users Calculations or Memorizing Information | not checked | not checked, by design | J/P/H |
| o7p01 | §4.8.1 | Provide Human Help | not checked | W3 `coga/help-reachable` | D (crawl) |
| o7p02 | §4.8.2 | Provide Alternative Content for Complex Information and Tasks | not checked | not checked, by design | D+J |
| o7p03 | §4.8.3 | Clearly State the Results and Disadvantages of Actions, Options, and Selections | not checked (a related basis of `coga/preselected-cost`) | not checked, by design | H |
| o7p04 | §4.8.4 | Provide Help for Forms and Non-standard Controls | not checked | W2 `coga/unexplained-disabled` (WI-14) | D+J |
| o7p05 | §4.8.5 | Make It Easy to Find Help and Give Feedback | not checked | W3 `coga/help-reachable` | D |
| o7p06 | §4.8.6 | Provide Help with Directions | not checked | not checked, by design | H |
| o7p07 | §4.8.7 | Provide Reminders | not checked | W2 `coga/permission-on-load` (WI-19) | H |
| o8p01 | §4.9.1 | Let Users Control When the Content Moves or Changes | not checked; since 2026-10-15 screened in part: `coga/reduced-motion` (observed) | `coga/reduced-motion`, motion under `prefers-reduced-motion: reduce`: built | P |
| o8p02 | §4.9.2 | Enable APIs and Extensions | not checked; since 2026-10-15 screened in part: `coga/paste-blocked` (observed) | W2 `coga/paste-blocked` (WI-12): built | D+P |
| o8p03 | §4.9.3 | Support Simplification | not checked | not checked, by design | H |
| o8p04 | §4.9.4 | Support a Personalized and Familiar Interface | not checked | not checked, by design | D+P |

**How the 58 split.**

- **By main rating:**
  - 24 lead with D and 13 with P, so 37 of 58 start from a fact a rule or a probe can measure;
  - 12 lead with J;
  - 9 are H alone: o3p07, o4p05, o4p11, o5p02, o6p04, o7p03, o7p06, o7p07 and o8p03.
- **Rules and probes alone:** only 18 could be screened with no judgment at all, rated D or P alone.
- **Judgment for some part:** 30 need a model for some part, and 15 need a person for some part.

**How to read a rating.**

- **It says what kind of evidence could decide a part of the pattern, not that Rampa should report it.** Section 1.5 keeps measurable patterns out for want of a threshold with ground truth: o3p10 and o3p11, white space and busy backgrounds.
- **A rule can still decide a narrow slice of a J or H pattern.** o4p03 is J/H as a whole, yet its pre-checked paid options are a rule.
- **No rating makes a pattern "met".** A check screens part of a pattern, as the wave-1 checks do.

o4p07 and o7p03 appear in wave 1 only as related bases. They stay "not checked" because no sub-check of their own runs.

The patterns marked "not checked, by design" stay so in waves 2 and 3. Some have research ideas in 1.4 and 1.5, and none ships without its own gate. Some of them are rated D or P, such as o3p10: the rating does not change the plan, and a pattern leaves that column only through a check with its own gate. o8p01 left it on 2026-10-15 with `coga/reduced-motion`, which reads one narrow fact (motion that keeps running when the operating system's reduce-motion setting is on), experimental like every check.

### GAIA recommendations, rated the same way

GAIA (Guia de Acessibilidade de Interfaces para Autismo, https://gaia.wiki.br/; Appendix B has its sources and caveats) has 28 recommendations. Each is rated on the same scale as the COGA patterns above.

**The mapping is Rampa's, not GAIA's.** GAIA states no WCAG mapping. The table maps each recommendation to the closest COGA pattern and WCAG criterion, or "none" where there is none, and "in part" where the match covers only part of the recommendation. The names are GAIA's, in Portuguese. The ratings and the mapping were made on 2026-10-15 from the text of each recommendation.

| GAIA | Name | COGA pattern | WCAG criterion | Checkability |
|---|---|---|---|---|
| G01 | Cores | o3p11 (in part) | 1.4.1 Use of Color (A); 1.4.3 Contrast (Minimum) (AA) | D+P+J |
| G02 | Textos | o3p01; o3p04 | 3.1.3 Unusual Words, 3.1.4 Abbreviations, 3.1.5 Reading Level (AAA), in part | J+H; D for abbreviations |
| G03 | Legibilidade | o3p10; o3p05; o2p03 | 1.4.8 Visual Presentation (AAA) | D+P |
| G04 | Compatibilidade com mundo real | o1p07; o3p04 | none | H |
| G05 | Customização visual | o8p04 | 1.4.4 Resize Text (AA), in part | H+P |
| G06 | Customização informacional | o8p03; o8p04 | 1.4.2 Audio Control (A), in part | H+P |
| G07 | Interfaces flexíveis | o8p03; o8p04 | none | H |
| G08 | Modo de leitura | o8p03 | none | H |
| G09 | Eliminar distrações | o5p01; o8p01 | 2.2.2 Pause, Stop, Hide (A); 1.4.2 Audio Control (A); 2.3.3 Animation from Interactions (AAA), in part | P+D+H |
| G10 | Interface minimalista | o5p03; o5p02 | none | H |
| G11 | Organização visual | o3p10 | none | P+H |
| G12 | Forneça instruções | o4p07; o3p08 | 3.3.2 Labels or Instructions (A), in part | J+H |
| G13 | Múltiplos formatos | o7p02 | none | J+H |
| G14 | Equivalentes textuais | o1p07; o4p06 | 1.1.1 Non-text Content (A), in part | D+P+J |
| G15 | Legendas | o7p02 | none | H |
| G16 | Múltiplas mídias | o7p02 | none | H |
| G17 | Ampliação de imagens | none | none | P+H |
| G18 | Evite sons perturbadores | o5p01 | 1.4.2 Audio Control (A), in part | P+H |
| G19 | Instruções de interação | o4p04; o4p07; o4p10; o7p04 | 3.3.1 Error Identification (A); 3.3.2 Labels or Instructions (A); 3.3.3 Error Suggestion (AA); 4.1.3 Status Messages (AA) | D+P+J |
| G20 | Reverter ações | o4p02; o4p05 | 3.3.4 Error Prevention (Legal, Financial, Data) (AA), in part | P+H |
| G21 | Número de tentativas | none | none | H |
| G22 | Consistência | o1p03; o1p05 | 3.2.4 Consistent Identification (AA); 3.2.5 Change on Request (AAA) for links that open a new window | D+J |
| G23 | Aparência clicável | o1p05 | 2.5.8 Target Size (Minimum) (AA), in part | D+P+J |
| G24 | Feedback de interação | o4p10; o4p07 | 3.3.2 Labels or Instructions (A), in part | P+J |
| G25 | Navegação simples | o2p02; o7p05 | 3.2.3 Consistent Navigation (AA); 2.4.5 Multiple Ways (AA); 3.2.6 Consistent Help (A); 2.4.8 Location (AAA) | D+J |
| G26 | Evitar redirecionamentos | o4p09; o8p01 | 2.2.1 Timing Adjustable (A); 3.2.5 Change on Request (AAA) | D+P |
| G27 | Confirmação de ações | o4p10 | 4.1.3 Status Messages (AA), in part | P+J/H |
| G28 | Sensibilidade adequada | none | 2.5.2 Pointer Cancellation (A), in part | P+H |

**How the 28 split.** By main rating:

- 8 lead with D: G01, G03, G14, G19, G22, G23, G25 and G26;
- 8 lead with P: G09, G11, G17, G18, G20, G24, G27 and G28;
- 3 lead with J: G02, G12 and G13;
- 9 are H: G04, G05, G06, G07, G08, G10, G15, G16 and G21.

Most of the H ones ask a site to offer something, rather than to avoid a defect: customization, a reading mode, more media, more attempts. A checker can find a defect; whether an offer helps, only people can tell.

Three recommendations match no COGA pattern: G17, G21 and G28. Ten match no WCAG criterion, even in part.

Since 2026-10-15 the observed checks cite G09 (`coga/reduced-motion` and `coga/interruptions`) and G18 (sound on load, in `coga/interruptions`), each for the part named in its advisory.

## Appendix B. Sources checked for this plan

- W3C, *Making Content Usable for People with Cognitive and Learning Disabilities*, Working Group Note, 29 April 2021: https://www.w3.org/TR/coga-usable/. Quotes from §4.4.1, §4.4.5, §4.5.4.2, §4.5.6.3 and §6.8.2, checked in a local copy.
  - *Its status, added 2026-10-15 and checked in a local copy of that date:*
    - It is not normative: "Following this guidance is not required for conformance to WCAG".
    - Its status section says: "It is inappropriate to cite this document as other than work in progress." This plan and Rampa's reports cite it as guidance, with the version each check was written against (`coga-usable 2021-04-29`), never as a requirement.
    - §5.1, on testing: "automated testing often cannot assess if people with a cognitive or learning disability can use the content. It is vital for people with cognitive and learning disabilities that development teams do not rely solely on automated accessibility testing." This is one reason the profile reports advisories and never failures (docs/cognitive-profile.md, "Why advisories, not failures").
- W3C, *Cognitive Accessibility User Research*, First Public Working Draft, 15 January 2015: https://www.w3.org/TR/coga-user-research/. It was never finished. Its status section says the same as the Note's: "It is inappropriate to cite this document as other than work in progress." It is background only; no check rests on it. *(Added 2026-10-15.)*
- GAIA, *Guia de Acessibilidade de Interfaces para Autismo*: https://gaia.wiki.br/, 28 recommendations, G01 to G28 (read on 2026-10-15). *(Added 2026-10-15.)*
  - **Sources.**
    - Talita Cristina Pagani Britto, *GAIA: uma proposta de guia de recomendações de acessibilidade web com foco em aspectos do autismo*, master's dissertation, Universidade Federal de São Carlos, 2016, advised by Ednaldo Brigante Pizzolato: https://repositorio.ufscar.br/handle/20.500.14289/8683.
    - Britto, T. C. P. and Pizzolato, E. B. (2018), "GAIA: uma proposta de um guia de recomendações de acessibilidade de interfaces Web com foco em aspectos do Autismo", *Revista Brasileira de Informática na Educação* 26(2), 102–123, doi:10.5753/RBIE.2018.26.02.102, https://doi.org/10.5753/RBIE.2018.26.02.102.
  - **Caveats, to state whenever it is cited:**
    - it targets autistic children and multitouch devices;
    - it was piloted with 6 IT professionals, not with autistic users;
    - 16 of its 28 recommendations cite WebAIM's WAVE cognitive checklist (counted on the site on 2026-10-15), so GAIA and WebAIM are related sources, not independent ones;
    - it states no WCAG mapping. The mapping in Appendix A is Rampa's.
  - **What it is.** GAIA is a set of recommendations, not a checker. Its `avaliador` repository is an unmodified fork of the W3C WCAG-EM Report Tool.
  - **License.** The site's source code is under GPL-2.0, and the website states no license for its text: quote it briefly, and link it.
- WebAIM, *Cognitive Disabilities* (https://webaim.org/articles/cognitive/) and *Evaluating Cognitive Web Accessibility* (https://webaim.org/articles/evaluatingcognitive/, last updated 5 August 2020), read on 2026-10-15. *(Added 2026-10-15.)*
  - It has no autism-specific guidance. It sorts barriers by function: memory, problem-solving, attention, reading and verbal comprehension, math, and visual comprehension.
  - On evaluation: "For the most part, cognitive web accessibility is one of those "you know it when you see it" things. Common sense, holistic evaluation, and user testing should predominantly guide cognitive web accessibility evaluation."
- CMUdict, the Carnegie Mellon University Pronouncing Dictionary: https://github.com/cmusphinx/cmudict, commit `74790861f652`, under a BSD-style license. It gives the syllable counts of the English sample in 3.3 (`test/fixtures/coga/syllables-en.json`); NOTICE credits it and copies its license. *(Added 2026-10-15.)*
- WAI Supplemental Guidance and the list of pattern slugs: https://www.w3.org/WAI/WCAG2/supplemental/ (fetched 2026-10-09). Pattern pages o4p06, o4p08, o4p03 and o7p03 under `https://www.w3.org/WAI/WCAG2/supplemental/patterns/` (fetched 2026-10-09).
- WCAG 2.2: https://www.w3.org/TR/WCAG22/ (conformance note on AAA at `#cc1`).
- Understanding 3.3.8 (updated 06 Sep 2026): https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html
- Understanding 3.1.5 (updated 28 June 2026): https://www.w3.org/WAI/WCAG22/Understanding/reading-level.html
- Understanding 3.1.4: https://www.w3.org/WAI/WCAG22/Understanding/abbreviations.html. Techniques: G153, https://www.w3.org/WAI/WCAG22/Techniques/general/G153; G97, https://www.w3.org/WAI/WCAG22/Techniques/general/G97.
- ACT rule 36b590 (proposed): https://www.w3.org/WAI/standards-guidelines/act/rules/36b590/proposed/
- HTML `pattern` attribute: https://html.spec.whatwg.org/multipage/input.html#the-pattern-attribute
- GOV.UK on number inputs: https://technology.blog.gov.uk/2020/02/24/why-the-gov-uk-design-system-team-changed-the-input-type-for-numbers/
- Lei nº 15.263/2025, art. 5º: https://www.planalto.gov.br/ccivil_03/_Ato2023-2026/2025/Lei/L15263.htm (local copy `coga-x7/lei15263.txt`).
- Martins, Ghiraldelo, Nunes & Oliveira Jr. (1996), *Readability Formulas Applied to Textbooks in Brazilian Portuguese*, Notas do ICMSC-USP nº 28: https://repositorio.usp.br/item/000906089 (local copy `coga-x7/martins.txt`).
- Kincaid et al. (1975): https://apps.dtic.mil/sti/pdfs/ADA006655.pdf
- Schwartz & Hearst (2003), PSB: https://psb.stanford.edu/psb-online/proceedings/psb03/schwartz.pdf
- wordfreq sunset notice: https://github.com/rspeer/wordfreq/blob/master/SUNSET.md
- Res. CNS 466/2012: https://conselho.saude.gov.br/resolucoes/2012/Reso466.pdf. Res. CNS 510/2016: https://conselho.saude.gov.br/resolucoes/2016/Reso510.pdf. That participants are not paid but are reimbursed is supported by secondary sources found on 2026-10-09, for example the Plataforma Brasil commitments document at https://unimontes.br/wp-content/uploads/2019/08/Compromissos-no-ato-de-envio-do-projeto-na-Plataforma-Brasil.pdf. Confirm with the CEP.
- axe-core 4.14.0 rule tags, read from the installed package on 2026-10-09:
  - `wcag2aaa` = color-contrast-enhanced, identical-links-same-purpose, meta-refresh-no-exceptions;
  - `wcag22aa` = target-size;
  - `label-title-only`, `heading-order`, `region`, `page-has-heading-one`, `aria-dialog-name` and `empty-heading` are best-practice;
  - `p-as-heading` is experimental.
