# Labelling rubric for the re-measure

This is the rubric given to each judge agent. It restates the method of the first run
(docs/studies/real-pages-2026-10.md, "Labels"); the first run's judge prompts were not saved, so
this text is a reconstruction from that method section and from the rationales in study/labels/.

## The task

Rampa, an accessibility checker, reported the findings below on a real public web page. Most come
from its judgment layer: a language model (Gemma 4 12B) judged one WCAG 2.2 success criterion for one
element. Some come from Rampa's deterministic rules (`source: "rule"`), such as contrast measured
from pixels. For each finding, decide whether it is a **real failure of the criterion it names**, on
that page, as WCAG 2.2 defines the criterion (the normative text, its Understanding document, and the
sufficient techniques and documented failures).

Judge the finding **as reported**: its message is the claim. When the element fails the criterion
for a different reason than the one the finding gives, say so in the rationale; label it
`true_positive` only if the finding's claim, read fairly, still names a real failure. A weak or wrong
suggested fix (patch) does not by itself make a real failure a false positive, and a good patch does
not make a passing element fail; mention the patch only when it matters.

## Labels

- `true_positive`: the element fails the criterion, as the finding says.
- `false_positive`: it does not fail this criterion, or what the finding describes is not a failure
  of this criterion (it may be a failure of another criterion: name it in the rationale).
- `uncertain`: the evidence cannot settle it, or competent auditors would reasonably disagree.

## Cause (false positives only; `none` otherwise)

- `context_missing`: the checker lacked context it needed (a destination it never read, text
  around the element it was not given).
- `model_error`: it had the context and judged wrongly. For a rule finding: the rule had the right
  data and decided wrongly.
- `criterion_misapplied`: it applied a stricter or different rule than the criterion requires.
- `collector_error`: the snapshot gave it wrong data (a wrong crop, a wrongly computed name, an
  element that is not what the snapshot says).
- `other`: none of these; say what.

## Roles

There are two judges per batch, and they work independently: neither sees the other's labels.

- The **auditor** looks at the snapshot, the screenshot and the live page, as a professional WCAG
  auditor would, and decides whether the finding is a real failure of the criterion.
- The **skeptic** looks for concrete reasons the finding could be wrong (context the checker
  ignored, a technique that makes the element pass, a collector artefact, a stricter rule than
  WCAG's) and labels a finding `true_positive` only when no such reason holds up.

## Evidence

Each finding comes with an evidence packet: the finding as reported (criterion, message, evidence
quote, suggested patch, confidence), the element from Rampa's snapshot (role, accessible name, text,
states, bounds, attributes, HTML), its ancestors and nearby headings, where a link leads when Rampa
read it, and the image crop the model saw when there is one. The page's full snapshot, its
screenshot and the live URL are also given. Open the live page when the snapshot is not enough;
it may have changed since the run, and a judge says so when that matters.

## Output

One JSON file per judge and page:

```json
{
  "page": "<url>",
  "labeler": "auditor | skeptic",
  "judgments": [
    { "fingerprint": "<id from the packet>", "label": "true_positive | false_positive | uncertain",
      "cause": "context_missing | model_error | criterion_misapplied | collector_error | other | none",
      "rationale": "A few plain sentences: what the element is, what you checked, why the label." }
  ]
}
```

Every finding in the packet gets exactly one judgment.
