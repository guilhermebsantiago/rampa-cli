# Labelling rubric for the seventh real-page study

This is the rubric given to each judge agent. It is the sixth study's (study/round-6-2026-10-29/judge-rubric.md) with
two readings added where its judges split in the sixth study and the rubric was silent: how links that share a name are
scored for 2.4.4 (section "2.4.4: links that share a name", R1), and whether a `title` or a neighbouring text link
cures an image link whose alternative describes the picture (section "Image links whose alternative describes the
picture", R2). Both are decided from W3C documents read on w3.org on 2026-11-21, quoted where they apply. Everything
else is unchanged: three answers per finding and a label that follows from them, the listed 2.4.4 context, the causes,
the two roles, the evidence, and WCAG 2.1 as the target (every run of this round uses `rampa check --wcag 2.1`; the
eight judged criteria have the same text in WCAG 2.1 and 2.2). No run of this round drives the page, so there are no
probe records.

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
your own answers lean one way. Where this rubric fixes a reading (the 2.4.4 context, R1 and R2 below), apply it: that
auditors could read the point differently is then not a reason for `uncertain`.

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

## 2.4.4: links that share a name (R1)

Some 2.4.4 findings say that a link shares its text (its accessible name) with other links that lead elsewhere. This
round scores them by the expectation of the ACT rule fd3a94, "Links with identical accessible names and same context
serve equivalent purpose" (https://www.w3.org/WAI/standards-guidelines/act/rules/fd3a94/proposed/). On w3.org it is a
proposed rule (agreed by the ACT Task Force, not yet approved by the Working Group; ACT rules are informative). Its
mapping: 2.4.4 Link Purpose (In Context), Level A, "Any failed outcomes: success criterion is not satisfied"; 2.4.9 is
a secondary requirement. Its expectation, verbatim:

> For each pair of links in each target set, one of the following is true:
> both links resolve to the same resource; or
> both links resolve to equivalent resources; or
> there is no visual information within the web page to let users know that both links resolve to non-equivalent
> resources.

**The set.** The links of the page that are in the accessibility tree, whose accessible names match (ignoring letter
case and runs of white space), and whose context, as the section above lists it, does not tell them apart: the same
context, or identical contexts (the rule's background: "Links with identical name that are in identical (but not the
same) contexts also fail 2.4.4 Link Purpose (In Context)"). Links that their `title` or `aria-describedby`, their
sentence, paragraph, list item or table cell, the heading just before them, or their parent list item tell apart are
not in one set. The set is formed with this rubric's context list, not the rule's glossary (which takes the closest
block container and takes neither a `title` nor a heading), so that the context rule stays the sixth study's.

**Same and equivalent resources.** The same resource: the same page after instant redirects, including an address that
differs only by a fragment of parameters (`#intid=...`, tracking), or by what the server ignores. Equivalent resources,
in the rule's glossary: "Non-identical resources can still be equivalent resources by equally complying to the
expectation formed by the user when navigating to them, thus serving an equivalent purpose. This would usually involve
that the advertised key content is the same." The same post published at two addresses is an example. Open the
destinations when the packet's `destination` does not settle it.

**Visual information.** Anything a sighted user sees on the page that tells the links apart: a card or column title, an
image, an icon, the position under a visual label. When nothing visible tells them apart, the links are ambiguous to
users in general, the criterion's exception (the rule's Passed Example 9), and the pair meets the expectation.

**How each link of a pair is scored** (`elementFails` for 2.4.4, on this ground):

- `yes` when the link and at least one other link of its set resolve to non-equivalent resources and visual information
  tells them apart. The rule's outcome belongs to the whole set ("The test target for this rule is the full set of link
  elements that share the same matching accessible name and programmatically determined link context"), so every link
  of a failing pair gets `yes`. That includes a link whose own name is accurate when the other link of the pair carries
  the wrong name (an `aria-label` copied onto the wrong link, say): the rule assumes that a link's name "can only
  accurately describe one resource ... Thus, if two or more links have the same accessible name but resolve to
  different resources, at least one of them does not accurately describe its purpose", and a user who hears the name
  cannot tell which link is which. Say in the rationale which link's name is the wrong one.
- `no` when every other link of its set resolves to the same or an equivalent resource, when nothing visible tells them
  apart, or when no other link shares its name and context.
- `cannot_tell` when a destination cannot be opened or compared and the packet does not settle it.

A shared-text claim names this failure when `elementFails` is `yes` on this ground, even when the number of links or
places it states is off. When the visual information that tells the pair apart is the only thing that would explain the
link, start the rationale with `[visual context]`, as above.

## Image links whose alternative describes the picture (R2)

This section is about an image that is all a link holds, whose text alternative describes what the picture shows (a
photo caption) instead of where the link leads; and about two things that may give the destination: a `title` on the
link, or a text link beside it to the same address (a headline, say).

**First, the alternative itself.** Replace the image with its alternative (the test of G82, the 1.1.1 technique for
controls: "Check that the purpose of the non-text content is clear - even if function is lost"). When the alternative,
read as the link's text in its context, lets users tell where the link goes (it names the story's subject, the product
or the page), it describes the link's purpose and the link passes both criteria on this point. Understanding 2.4.4: "it
is not required to use the name of the document or web application; other things may also describe the purpose of the
link." What follows applies when the alternative does not.

**2.4.4.**

- A `title` on the link that, with the alternative, describes the purpose makes the link pass. H33 ("Supplementing link
  text with the title attribute") is a sufficient technique for 2.4.4 "when used for providing a supplemental
  description of the purpose of a link", and its test reads: "For each anchor element that has a title attribute, check
  that the title attribute together with the link text describes the purpose of the link." H33 warns about the support
  for `title` in user agents; Understanding 2.4.4 still lists it as sufficient, so it counts here.
- A text link beside it to the same address makes it pass only when that link's text is in the image link's context as
  listed above (the same sentence, paragraph, list item or table cell, the heading just before the image link, or the
  parent list item). Elsewhere it does not: that is F63's failure, "providing link context only in content that is not
  related to the link"; the technique for such a pair is H2, "Combining adjacent image and text links for the same
  resource" (advisory for 2.4.4); and F89 says its failure "also applies when both text and images are used separately
  on a page to link to the same target". Start the rationale with `[visual context]` when the headline is the only
  thing that would explain the image link.

**1.1.1.** Neither makes it pass. An image that is the only content of a link is non-text content that is a control,
and 1.1.1 requires that a control "has a name that describes its purpose". Understanding 1.1.1 lists H30 under
Situation C ("If non-text content is a control or accepts user input"), and H30 reads: "When an image is the only
content of a link, the text alternative for the image describes the unique function of the link." Its example "A linked
thumbnail image" gives the alternative "Smallville Times", the destination's name, not a description of the thumbnail.
A `title` on the link is the link's description: it is neither the image's alternative nor the link's name (the
alternative is the name), and no 1.1.1 technique uses it. A neighbouring link is another control. The way W3C documents
for such a pair is H2, sufficient for 1.1.1: one link holding both, the image's alternative null or supplementing the
link text.

So a 1.1.1 claim that such an alternative does not say where the link leads is `true_positive` when the alternative
does not identify the destination, whether or not the link has a `title` or a headline beside it; a 2.4.4 claim on the
same link is `true_positive` only when neither its `title` nor an in-context text link gives the purpose.

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
