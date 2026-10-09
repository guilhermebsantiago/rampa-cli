# WCAG 2.2, and what a report says it checked

Rampa checks against **WCAG 2.2 levels A and AA** by default: 55 success criteria. Pass `--wcag 2.1` when a contract cites WCAG 2.1, such as EN 301 549 V3.2.1. A report then states coverage against the 50 criteria of WCAG 2.1.

Content that conforms to WCAG 2.2 also conforms to 2.1, so 2.2 is the safer default. Under either version, no report ever says a page is accessible.

## Choosing the version

| Where | How |
|---|---|
| `rampa check`, `rampa baseline`, `rampa eval` | `--wcag 2.1` or `--wcag 2.2` (the default) |
| `rampa mcp` | `--wcag` sets the server's default; each `check_page` and `check_html` call can pass `wcag: "2.1"` |
| `rampa.config.*` | `wcag: '2.1'` |
| `check()`, `checkPage()` and the test matchers | `wcag: '2.1'` in the options |
| GitHub Action | `args: --wcag 2.1` |

The command line wins over the config file, as for every other option.

## What changes between the two

- **Six criteria are new in 2.2:** 2.4.11 Focus Not Obscured (Minimum), 2.5.7 Dragging Movements, 2.5.8 Target Size (Minimum), 3.2.6 Consistent Help, 3.3.7 Redundant Entry and 3.3.8 Accessible Authentication (Minimum).
- **axe-core rules.** Under 2.2 Rampa also runs axe-core's `wcag22aa` rules. In axe-core 4.14 that adds a single rule, `target-size`, for 2.5.8.
- **4.1.1 Parsing is never counted.** WCAG 2.2 removed it. Under 2.1 the report says it is satisfied by definition for HTML and XML (WCAG 2.1, Note 1); under 2.2 it says the criterion is not listed. The problems 4.1.1 used to cover, such as duplicate ids that break names, are reported under 4.1.2.
- **Beyond the target.** A 2.1 run never runs the 2.2 rules. When a recording made under 2.2 is checked with `--wcag 2.1`, findings on 2.2-only criteria go to `beyondTarget`. They are reported, but they are not findings and do not change the exit code.

The JSON report records the target in `wcagTarget`: `wcag22-aa` or `wcag21-aa`. A report without the field was written before Rampa knew WCAG 2.2, and targeted 2.1.

## 2.5.8 Target Size (Minimum)

A target smaller than 24 by 24 CSS pixels fails unless it has room. Room means that a circle 24 pixels across, centered on the target, overlaps no other target and no circle of another small target. axe-core's `target-size` rule measures that. Rampa then applies two exceptions that axe-core does not:

- **User agent control.** A native control the author did not restyle, such as a default checkbox or date field, is exempt. Rampa compares the control with a copy in an empty frame, where no author style applies. The padding, borders, font size and appearance must match, and the control must not be smaller than the copy.
- **Equivalent.** A link is exempt when another link to the same address is at least 24 by 24 pixels.

An exempt target is kept in the engine results as a pass with `exempt: "user-agent-control"` or `exempt: "equivalent-target"`, so anyone can audit the exception.

On iOS snapshots, the same spacing test runs on the element bounds, which are in points, as WCAG applied to non-web software. Android dumps give bounds in screen pixels and no screen density, so 2.5.8 is not measured there.

**The check is experimental.** Its findings have low confidence, below the default threshold, until it passes Rampa's evaluation gate. They do not change the exit code by default. To see them, pass `--verbose` (or `--min-confidence low` to report them).

These still need a person: presentation that is essential or legally required, other equivalent controls on the page, and targets inside canvas or SVG maps.

## What the coverage of a report means

A report puts every criterion of its target in one of these groups:

| Line | Meaning |
|---|---|
| Checked by axe-core (partial) | A rule that can report a failure decided at least one element for this criterion. |
| Judged with verified evidence | A model judged candidates, and each claim it kept was checked against the page. |
| Needs review only | The only automated results are ones a person must look at. |
| Not checked automatically | Nothing automated reported a decision for this criterion. |

Some axe-core rules can never report a failure. Their checks return "needs review" instead: `bypass` (2.4.1), `video-caption` (1.2.2), `no-autoplay-audio` (1.4.2), `th-has-data-cells` (1.3.1), `form-field-multiple-labels` (3.3.2) and `duplicate-id-aria` (4.1.2). Such a rule never makes a criterion count as checked. If it is the only rule that applied, the criterion needs review.

### Needs review

When axe-core cannot decide an element, the report lists it under **Needs review**, with axe-core's reason. Examples are text over a background image (1.4.3), a page with no heading, landmark or skip link (2.4.1), and a video with no captions track (1.2.2). These items are never findings, they never change the exit code, and waivers and baselines ignore them. In JSON they are in `needsReview`.

### Each criterion

`coverage.criteria` gives each criterion of the target a status and the methods behind it:

| Status | Meaning |
|---|---|
| `failures` | Some check reported a confirmed failure. |
| `needs-review` | A person must look at something: an undecided element, a finding below the confidence threshold, a case where the model abstained, or a criterion that only a review-only rule touched. |
| `no-failure-found` | A check that can fail ran on applicable content and found nothing. This covers only what was checked. |
| `no-applicable-content` | The checks ran but found nothing to apply to, such as no video for 1.2.2. |
| `not-checked` | Nothing automated ran. |
| `satisfied-by-definition` | 4.1.1, under WCAG 2.1 only. |

Rampa never marks a criterion as passed. Each record also carries `manual`, the part of the criterion that a person still has to review or test, in the report's language.

Each method in a record has a `kind`: `axe` (an axe-core rule), `rule` (a Rampa rule; also `rampa/language-id`, what the language identifier decided for 3.1.1 and 3.1.2 without a model, and `rampa/home-page-title`, a home page titled with its site's name that 2.4.2 passed without a model), `judgment` (a model, with verified evidence), `site` (a comparison across a crawl's pages, 3.2.3 and 3.2.6) or `probe` (a rule over what a probe measured with `--probe`, with the probe, its conditions and any note in `probe`; see [Probes](probes.md)). Each has these fields:

- `ran`: false when the method applied but did not run: a judgment with `--no-llm`, or a probe that was skipped.
- `applicable`: how many elements the method applied to. Passing elements count up to 200 per rule.
- `failures`: how many elements failed.
- `review`: how many elements a person must review.
- `reviewOnly`: set for rules that can never report a failure.
- `maturity`: `stable` or `experimental`.

### In each format

- **Terminal.** Undecided elements are grouped by criterion and rule. `--verbose` lists each element, then every criterion with its status, methods and manual part.
- **Markdown.** A "Needs review" section and the coverage rows. A folded table lists each criterion's status, unless the comment's size limit leaves no room for it.
- **HTML.** The same, with the manual part of each criterion.
- **SARIF.** Undecided elements are not results, because code scanning would show them as alerts. `runs[0].properties.coverage` lists them for each page as `needsReview`, together with `needsReviewOnly`, `criteria` and `wcagTarget`.
- **MCP.** A check result has `needs_review`, `summary.needs_review`, `coverage.needs_review_only`, `coverage.criteria` and `wcag_target`.

## Evaluation

`rampa eval` now counts an axe-core violation only for the ACT rule that the violating rule implements, through axe-core's `actIds`. Before this change, `html-lang-valid` failed the test pages of ucwvc8 (the page language matches its content), a rule it does not test. Rescoring the recorded runs removes four of ucwvc8's five false positives and changes no other set.
