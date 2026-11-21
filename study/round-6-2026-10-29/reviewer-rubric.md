# Reviewer rubric: sixth real-page study

For a person labelling Rampa's findings in Rampa Lab. Each item is a claim Rampa made about one element of a real web
page; the item's title is the claim. Answer the three questions, choose the label that follows from your answers, and
write a short note. The judges' rubric (judge-rubric.md) states the same rules.

## The three questions

Each has three answers: yes, no or cannot tell (in the exported file: `yes`, `no`, `cannot_tell`). The examples are
invented.

1. **Is the claim, as worded, true of the captured document?** (`claimTrue`) The captured document is the snapshot
   Rampa read: what the Lab shows as the evidence, the crop and "In the snapshot". Check the sentence, not WCAG.
   *Example:* the claim says "The field asks for the user's email address and has no autocomplete attribute". The
   snapshot shows a field labelled "Your email" with no `autocomplete`: yes. With `autocomplete="email"`, it would be no.
2. **Does the element fail this criterion on the page users receive, for any reason?** (`elementFails`) The page users
   receive is the page at that address as a person's browser shows it, with its styles and scripts. Judge the element,
   not the claim's wording. *Example:* the claim says "The link text 'Read more' does not say where the link leads".
   The link ends a paragraph that names the article it opens, and WCAG counts that paragraph as the link's context: no,
   though the claim's sentence about the link's text is true.
3. **Does the capture differ from the page users receive in a way that matters for this claim?** (`captureDiffers`)
   For instance: it was captured without its style sheet, the site sent a version made for automated browsers, content
   is hidden on the real page, or the page changed since. Open the page in your browser to compare. *Example:* the
   snapshot's page is titled "Loading…", but people who open the address get the full page, titled "Spring timetable –
   City Library". For the claim "The page title does not describe the page": yes.

## The label

- **True positive**: the element fails (question 2 is yes), and the claim, read in good faith, names that failure.
- **False positive**: the element does not fail (question 2 is no), or it fails this criterion for a reason the claim
  does not name; say which in the note.
- **Uncertain**: you cannot tell whether the element fails (question 2 is cannot tell), or competent auditors would
  reasonably disagree.

Questions 1 and 3 do not decide the label; they say why it is what it is. The third example is a false positive
although its claim is true of the capture. *Read in good faith*: a claim that points at the real defect in imperfect
words names it (an alternative said to "describe something the image does not show" when it leaves out most of what
the image conveys); a claim that points at something else does not.

## Links (2.4.4): what counts as context

A link's purpose must be clear from its text alone, or from its text together with its context. The context is:

- the link's text and accessible name (`aria-label`, `aria-labelledby`), and its description (`title`,
  `aria-describedby`);
- the programmatically determined link context of WCAG's definition: the same sentence, paragraph, list item, or table
  cell as the link, with the table's header cells for that cell;
- the heading just before the link (technique H80);
- in a nested list, the list item that the link's list sits under (technique H81).

A visual label that is neither a heading nor inside those, such as a column or card title that is only a styled
paragraph, does not count (failure F63). When such a label is a link's only context, answer by this rule and start the
note with `[visual context]`.

## What "Uncertain" is for

Two cases: you cannot see what users receive (the page is gone or blocks you, and the capture may not be what people
get), or you see two readings a competent auditor could defend. Say in the note which case it is. It is not for an
item you have not looked at.

## The note

Say what you checked, in a sentence or two; for instance: "Opened the live page: it has its styles and the same title
as the capture. The alternative names the logo, not where the link leads." The cause of a false positive is optional.
