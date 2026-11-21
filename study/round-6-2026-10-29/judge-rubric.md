# Labelling rubric for the sixth real-page study

This is the rubric given to each judge agent. It differs from the fifth study's
(study/round-5-2026-10-28/judge-rubric.md) in three ways: each finding gets three answers before its label, and the
label follows from them by a stated rule; what counts as a link's context for 2.4.4 is listed; and the target is WCAG
2.1. In the blind human review of rounds 3 to 5, one label per finding hid what a disagreement was about: whether a
labeller judged the captured document or the page people receive, the claim's sentence or the element, and which
context of a link counts. WCAG 2.1 is the target because every run of this round uses `rampa check --wcag 2.1`; the
eight judged criteria are the fifth study's, and all eight are in WCAG 2.1, with the same text as in WCAG 2.2.

The causes and the two roles are the fifth study's. The evidence is too, but for probe records: no run of this round
drives the page. One kind of row is new: a row with no claim (below, "Rows with no claim").

## The task

Rampa, an accessibility checker, reported the findings below on a real public web page. Most come from its judgment
layer: a language model (Gemma 4 12B) judged one WCAG 2.1 success criterion for one element (1.1.1, 1.3.5, 2.4.2,
2.4.4, 2.4.6, 3.1.1, 3.1.2 or 3.3.2). Some come from Rampa's deterministic rules (`source: "rule"`), such as contrast
measured from pixels. For each finding, give the three answers below and the label that follows from them. Judge by
WCAG 2.1 as it defines the criterion (the normative text, its Understanding document, and the sufficient techniques
and documented failures), and by this rubric where it fixes a reading (the 2.4.4 context below).

A finding's message is its claim. The packet does not say how confident Rampa was, what fix it suggested, or which run
reported the finding: decide from the evidence.

## The three answers

Each answer is `yes`, `no` or `cannot_tell`.

- **`claimTrue`**: is the claim, as worded, true of the captured document (the snapshot Rampa read)? Read the message
  as a sentence about the element and check it against the snapshot: the element's role, name, text, attributes, HTML,
  context and image crop as captured. `yes` when what the sentence states holds there, `no` when some part of it does
  not, `cannot_tell` when the snapshot does not show it. This answer is about the sentence and the capture, not about
  WCAG: a sentence can be true of the capture and name no failure.
- **`elementFails`**: does the element fail this criterion on the page users receive, for any reason? The page users
  receive is the page at that address as an ordinary browser loads it for a person, with its style sheets and scripts.
  Judge the element, not the claim: `yes` when it fails the finding's criterion, for the claim's reason or for any
  other; `no` when it meets that criterion (if it fails another one, name it in the rationale); `cannot_tell` when the
  evidence cannot show what users receive, or whether the element fails there.
- **`captureDiffers`**: does the capture differ from the page users receive in a way that matters for this claim? For
  instance: the page was captured without its style sheet; the server sent a version made for automated browsers;
  content the snapshot holds is hidden on the real page; the page changed since Rampa read it. `yes` when such a
  difference touches this claim; `no` when you compared and found none that does; `cannot_tell` when you could not
  compare (the live page does not load, say).

When the live page has changed since Rampa read it, judge `elementFails` on what users received when Rampa read it,
from the capture, unless something suggests the capture differed from that too; when you cannot tell what they
received, answer `cannot_tell`.

## The label

The label follows from the answers:

- `true_positive`: `elementFails` is `yes`, and the claim, read in good faith, names that failure.
- `false_positive`: `elementFails` is `no`; or the element fails this criterion for a reason the claim does not name
  (say which in the rationale).
- `uncertain`: `elementFails` is `cannot_tell`, or competent auditors would reasonably disagree (about whether the
  element fails, or about whether the claim names its failure).

`uncertain` takes precedence: when competent auditors would reasonably disagree, the label is `uncertain` even where
your own answers lean one way.

`claimTrue` and `captureDiffers` do not decide the label; they record why it is what it is. A claim that is true of the
capture is a false positive when the element does not fail on the page users receive, and a claim worded imperfectly
is a true positive when it points at the element's real failure.

**Read in good faith.** A claim that points at the real defect in imperfect words names it: an alternative said to
"describe something the image does not show" when it leaves out most of what the image conveys. A claim that points at
something else does not name it, however true its sentence is of the capture.

## 2.4.4: what counts as a link's context

The criterion: "The purpose of each link can be determined from the link text alone or from the link text together
with its programmatically determined link context, except where the purpose of the link would be ambiguous to users in
general." In this round, a link's context is:

- the link's text and its accessible name (which `aria-label` and `aria-labelledby` set: techniques ARIA8 and ARIA7);
- its accessible description: a `title` attribute (technique H33, sufficient "when used for providing a supplemental
  description of the purpose of a link") or `aria-describedby` (which the test of failure F63 names);
- its programmatically determined link context, which WCAG 2.1 defines as "additional information that can be
  programmatically determined from relationships with a link, combined with the link text, and presented to users in
  different modalities"; in HTML, the definition's example and note name the same sentence, paragraph, list item, or
  table cell as the link, and the table header cells associated with that cell;
- the heading just before the link: the nearest `h1` to `h6` element, or element with the role `heading`, that comes
  before it in document order (technique H80);
- for a link in a nested list, the list item under which its list is nested (technique H81).

Nothing else counts. A visual label that is neither a heading nor inside those, such as a column or card title that is
a styled paragraph, does not count; nor does text in a neighbouring paragraph or layout-table cell. F63 is the failure
"due to providing link context only in content that is not related to the link". Where the link leads (the packet's
`destination`) tells you what its purpose is; it is not context.

Understanding 2.4.4 lists H80 as an advisory technique, not a sufficient one, and F63's description does not name a
heading. This round counts the preceding heading as context all the same, as a fixed rule, so that every labeller reads
it the same way.

When the only context that would explain a link is such a visual label, answer by this rule, and start the rationale
with `[visual context]`; these items are reported apart.

## Rows with no claim

Some rows have `"message": null`: Rampa judged the element for that criterion and reported nothing on it, and the row
asks whether it fails all the same. Give `elementFails` and `captureDiffers` only (no `claimTrue`: there is no claim),
judged as above, and the label that follows: `true_positive` when `elementFails` is `yes` (the element fails the
criterion, and Rampa missed it), `false_positive` when it is `no`, `uncertain` when it is `cannot_tell` or competent
auditors would reasonably disagree. The cause is `none`. For 2.4.4, the context rule above applies.

## Cause (false positives only; `none` otherwise)

- `context_missing`: the checker lacked context it needed (a destination it never read, text around the element it
  was not given).
- `model_error`: it had the context and judged wrongly. For a rule finding: the rule had the right data and decided
  wrongly.
- `criterion_misapplied`: it applied a stricter or different rule than the criterion requires.
- `collector_error`: the snapshot gave it wrong data (a wrong crop, a wrongly computed name, an element that is not
  what the snapshot says).
- `other`: none of these; say what.

A false positive whose only reason is a capture that differs from the page users receive (`captureDiffers` is `yes`)
is a `collector_error`.

## Roles

There are two judges per batch, and they work independently: neither sees the other's labels.

- The **auditor** looks at the snapshot, the screenshot and the live page, as a professional WCAG auditor would, gives
  the three answers and the label that follows from them.
- The **skeptic** looks for concrete reasons the finding could be wrong (context the checker ignored, a technique that
  makes the element pass, a capture that differs from the page users receive, a collector artefact, a stricter rule
  than WCAG's) and labels a finding `true_positive` only when no such reason holds up.

Both give all three answers for every finding.

## Evidence

Each finding comes with an evidence packet: the finding as reported (criterion, message, evidence quote), the element
from Rampa's snapshot (role, accessible name, text, states, bounds, attributes, HTML), its ancestors and nearby
headings, where a link leads when Rampa read it, and the image crop the model saw when there is one. The page's full
snapshot, its screenshot and the live URL are also given.

Open the live page to answer `captureDiffers`, and whenever the snapshot is not enough for `elementFails`. Signs that a
capture differs: a screenshot in default fonts with no layout, a page much shorter than the live one, a page that asks
to turn on scripts or to prove the visitor is a person, content in the snapshot that the live page does not show.
Your own fetch is automated too and may get the same version Rampa got; say so when that leaves an answer open.

## Output

One JSON file per judge and page:

```json
{
  "page": "<url>",
  "labeler": "auditor | skeptic",
  "judgments": [
    { "fingerprint": "<id from the packet>",
      "answers": { "claimTrue": "yes | no | cannot_tell", "elementFails": "yes | no | cannot_tell",
                   "captureDiffers": "yes | no | cannot_tell" },
      "label": "true_positive | false_positive | uncertain",
      "cause": "context_missing | model_error | criterion_misapplied | collector_error | other | none",
      "rationale": "A few plain sentences: what the element is, what you checked for each answer, why the label." }
  ]
}
```

Every finding in the packet gets exactly one judgment, with all three answers (a row with no claim: `elementFails` and
`captureDiffers` only), and its label follows from them by the rule above. When a 2.4.4 link's only context is a visual label, the rationale starts with `[visual context]`.
