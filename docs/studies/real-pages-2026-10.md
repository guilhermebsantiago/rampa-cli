# False positives of the judgment layer on real pages (October 2026)

Rampa runs axe-core first. A model then judges, one WCAG criterion at a time, what the rules cannot decide, and a claim is kept only when its evidence checks out against the page snapshot. Rampa's evaluation on the W3C ACT test cases measures that layer on small, purpose-built pages. This study asks how often it is wrong on real ones.

**In short.** With Gemma 4 12B on a local GPU, the judgment layer's findings on 19 real pages were mostly false positives. On the held-out test pages, no finding for 2.4.4 (0 of 34) or 2.4.6 (0 of 32) was a real failure, and 12 of 37 decided findings for 1.1.1 were. 1.3.5 was the only criterion whose findings were mostly right on the dev pages (8 of 9). That is far below the precision the same model reaches on the ACT test cases for 2.4.4, 2.4.6 and 1.1.1. The labels come from two Claude agents, not from people. Read them as a pre-annotation that still needs human review.

The held-out re-measure of the test split, after the changes the dev split suggested, is in [real-pages-2026-10-remeasure.md](real-pages-2026-10-remeasure.md).

## Question

When Rampa's judgment layer reports a failure on a real page, how often is the failure real? The question is asked per criterion, and it is about precision only. Pages that pass were not labeled, so recall is out of scope.

## Method

### Pages and split

24 public pages were chosen across ten categories: government, news, e-commerce, documentation, university, health, NGO, open source, small business and accessibility. They cover four page types (home pages, articles, listings and forms) and two languages, Portuguese (pt-BR) and English. Before any page was run, they were split into a **dev** half, which may be studied to improve Rampa, and a **test** half, which is only measured. The two halves mirror each other: each has the same twelve pairings of category and page type, with six pages in Portuguese and six in English.

| Split | Page | Category | Language | Type | Run | Judgment findings |
| --- | --- | --- | --- | --- | --- | ---: |
| dev | https://www.gov.br/pt-br | government | pt-BR | home | ok | 8 |
| dev | https://www.gov.uk/find-local-council | government | en | form | ok | 0 |
| dev | https://agenciabrasil.ebc.com.br/cultura/noticia/2026-10/exposicao-em-sp-propoe-novo-olhar-sobre-historia-do-brasil | news | pt-BR | article | timeout | – |
| dev | https://www.npr.org/sections/science/ | news | en | listing | timeout | – |
| dev | https://www.estantevirtual.com.br/biografias | e-commerce | pt-BR | listing | timeout | – |
| dev | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a | documentation | en | article | timeout | – |
| dev | https://www.ufc.br/pt | university | pt-BR | home | ok | 23 |
| dev | https://drauziovarella.uol.com.br/atividade-fisica/o-que-acontece-no-corpo-durante-uma-caminhada/ | health | pt-BR | article | ok (retried) | 6 |
| dev | https://www.sosma.org.br/contato | NGO | pt-BR | form | ok | 10 |
| dev | https://www.debian.org/ | open source | en | home | ok | 9 |
| dev | https://www.barebones.com/contact/technical.html | small business | en | form | ok | 4 |
| dev | https://webaim.org/techniques/alttext/ | accessibility | en | article | ok | 21 |
| test | https://www.ibge.gov.br/ | government | pt-BR | home | ok | 20 |
| test | https://www.usa.gov/state-consumer | government | en | form | ok | 8 |
| test | https://www.bbc.com/news/articles/c3j4790elkx7o | news | en | article | ok | 13 |
| test | https://g1.globo.com/ciencia/ | news | pt-BR | listing | ok | 2 |
| test | https://www.adafruit.com/category/17 | e-commerce | en | listing | timeout | – |
| test | https://docs.python.org/pt-br/3/tutorial/controlflow.html | documentation | pt-BR | article | ok | 21 |
| test | https://www.mit.edu/ | university | en | home | ok | 10 |
| test | https://www.nhs.uk/conditions/asthma/ | health | en | article | ok | 4 |
| test | https://www.accessnow.org/contact-us/ | NGO | en | form | ok | 1 |
| test | https://python.org.br/ | open source | pt-BR | home | ok | 33 |
| test | https://www.padocadomani.com.br/contato/ | small business | pt-BR | form | ok (retried) | 7 |
| test | https://mwpt.com.br/acessibilidade-digital/ | accessibility | pt-BR | article | ok | 2 |

### Run

- Rampa at commit `46029c1`, `rampa check <url> --model ollama:gemma4:12b --locale en`, with the default criteria: 1.1.1, 1.3.5, 2.4.2, 2.4.4, 2.4.6, 3.1.1, 3.1.2 and 3.3.2. 1.4.5 is off by default and was not run.
- Gemma 4 12B through Ollama, one run per page (no `--runs`), on a local GPU that other jobs were also using. Each page had a 900 s limit.
- `--locale en` sets the language of the report's messages. The texts Rampa suggests follow the page's own language, so Portuguese pages got Portuguese suggestions.
- Pages were run on 2026-10-09. Each page's report, snapshot, screenshot and console output were kept.

### Labels

Only judgment findings were labeled. Engine findings (axe-core violations) were not. Each judgment finding was labeled on its own by two judges:

- an **auditor**, which looked at the snapshot, the screenshot and the live page and decided whether the finding is a real failure of the criterion;
- a **skeptic**, which looked for concrete reasons the finding could be wrong.

Each judge gave a label (`true_positive`, `false_positive` or `uncertain`), a cause for false positives and a rationale. The causes are `context_missing` (the model lacked context it needed), `model_error` (it had the context and judged wrongly), `criterion_misapplied` (it applied a stricter or different rule than the criterion), `collector_error` (the snapshot gave it wrong data) and `other`. **The final label is the label both judges gave. When they differ, the final label is `uncertain`.** A false positive's cause is the one both judges gave; when they named different causes it counts as *disputed*.

**Both judges are Claude agents, which are language models.** Their labels are a pre-annotation, not ground truth, and they need human review before anyone relies on them. The judges can be wrong themselves, and since both are the same family of model, their errors are probably correlated. They also saw the live page some hours after Rampa's snapshot, so a page that changed in between can make a judge disagree with what Rampa saw.

### Analysis

`study/scripts/analyze.py` rebuilds the final labels from the two judges' files and writes `study/data/pages.json`, `findings.json` and `summary.json`. Precision is TP / (TP + FP), with uncertain findings left out and counted separately. Intervals are 95% Wilson intervals. Agreement between the judges is Cohen's kappa over the three labels.

## Results

19 of 24 pages finished: 8 dev pages and 11 test pages. They produced 202 judgment findings, 81 on dev and 121 on test. One dev page (gov.uk) finished with no judgment finding.

### Precision per criterion

**Dev** (8 pages, 81 findings)

| Criterion | True positive | False positive | Uncertain | Precision | 95% Wilson |
| --- | ---: | ---: | ---: | ---: | --- |
| 1.1.1 Non-text Content | 1 | 23 | 7 | 0.04 | 0.01–0.20 |
| 1.3.5 Identify Input Purpose | 8 | 1 | 0 | 0.89 | 0.56–0.98 |
| 2.4.2 Page Titled | 0 | 2 | 0 | 0.00 | 0.00–0.66 |
| 2.4.4 Link Purpose (In Context) | 0 | 21 | 2 | 0.00 | 0.00–0.15 |
| 2.4.6 Headings and Labels | 0 | 13 | 2 | 0.00 | 0.00–0.23 |
| 3.3.2 Labels or Instructions | 0 | 1 | 0 | 0.00 | 0.00–0.79 |
| All | 9 | 61 | 11 | 0.13 | 0.07–0.23 |

**Test** (11 pages, 121 findings)

| Criterion | True positive | False positive | Uncertain | Precision | 95% Wilson |
| --- | ---: | ---: | ---: | ---: | --- |
| 1.1.1 Non-text Content | 12 | 25 | 7 | 0.32 | 0.20–0.48 |
| 1.3.5 Identify Input Purpose | 2 | 3 | 0 | 0.40 | 0.12–0.77 |
| 2.4.2 Page Titled | 0 | 3 | 0 | 0.00 | 0.00–0.56 |
| 2.4.4 Link Purpose (In Context) | 0 | 34 | 1 | 0.00 | 0.00–0.10 |
| 2.4.6 Headings and Labels | 0 | 32 | 1 | 0.00 | 0.00–0.11 |
| 3.3.2 Labels or Instructions | 0 | 1 | 0 | 0.00 | 0.00–0.79 |
| All | 14 | 98 | 9 | 0.12 | 0.08–0.20 |

3.1.1 and 3.1.2 judged 18 and 3 candidates on these pages and reported nothing, so they have no precision here. Even in the best case, with every uncertain finding counted as a true positive, 1.1.1 rises only to 0.26 on dev and 0.43 on test, and 2.4.4 and 2.4.6 stay at or below 0.13.

Most findings came from a few pages: python.org.br has 33, www.ufc.br 23, webaim.org and docs.python.org 21 each. Findings on one page tend to repeat one mistake, so they are not independent. The Wilson intervals assume they are, which makes them narrower than they should be.

### How often the model flags

Every finding the model reported said its confidence was `high`, all 202 of them, including the 159 false positives.

| Split | Criterion | Candidates judged | Reported as failing | Share |
| --- | --- | ---: | ---: | ---: |
| dev | 1.1.1 | 67 | 31 | 46% |
| dev | 2.4.4 | 501 | 23 | 4.6% |
| dev | 2.4.6 | 120 | 15 | 12.5% |
| test | 1.1.1 | 72 | 44 | 61% |
| test | 2.4.4 | 684 | 35 | 5.1% |
| test | 2.4.6 | 241 | 33 | 13.7% |

For links, the share flagged is small. But most links on real pages are fine, so even a 5% false alarm rate produces more false findings than there are real failures.

### Agreement between the judges

| Set | Findings | Observed agreement | Cohen's kappa |
| --- | ---: | ---: | ---: |
| All | 202 | 0.91 | 0.69 |
| Dev | 81 | 0.86 | 0.61 |
| Test | 121 | 0.93 | 0.76 |

By criterion, kappa is 0.55 for 1.1.1, 0.39 for 2.4.4, 0.65 for 2.4.6 and 1.00 for 1.3.5. For 2.4.2 and 3.3.2 it is undefined, because every label was a false positive. The judges disagreed on 19 findings:

- seven BBC lazy-load placeholders labelled "image unavailable";
- the four "More..." links and headings on debian.org;
- four "example image" alternatives on webaim.org;
- two illustrations on drauziovarella.uol.com.br;
- one icon on www.ufc.br;
- one tile on python.org.br.

**On why a finding is wrong, they agree much less.** Of the 159 findings both judges called false positives, they named the same cause for 91, a cause kappa of 0.33. Almost every disagreement was between `model_error` and `criterion_misapplied`: 59 of the 68. The cause counts below are therefore soft.

| Cause of the false positive | Dev (61) | Test (98) |
| --- | ---: | ---: |
| criterion_misapplied | 15 | 18 |
| model_error | 13 | 26 |
| context_missing | 5 | 2 |
| collector_error | 4 | 8 |
| disputed (judges named different causes) | 24 | 44 |

### Run failures

- **Five pages timed out** at 900 s during the judgment phase and wrote no report: agenciabrasil.ebc.com.br, npr.org, estantevirtual.com.br and developer.mozilla.org on dev, adafruit.com on test. Each page loaded, and its snapshot, axe-core results and screenshot were saved.
- **The GPU was shared** with other jobs, and during the runs `gemma4:12b` had only about 1 GB in video memory. Pages that finished took 168 to 858 s (median 460 s) and 23 to 234 model calls.
- **Two pages needed a second attempt**, with the same command. drauziovarella.uol.com.br did not reach `load` within 30 s, and padocadomani.com.br had a connection timeout.

The pages that timed out are long listing and reference pages, so the precision above leaves out the heaviest pages of the sample.

## False-positive patterns

Patterns are grouped by the cause the judges gave. When the two judges named different causes, usually `model_error` against `criterion_misapplied`, the example sits under the cause that fits it best. Each example names its split. The suggested changes further down use only dev examples.

### Criterion misapplied: a stricter rule than WCAG

- **Short headings that work in their hierarchy (2.4.6).**
  - (dev) webaim.org: the h3 headings "Example 1" to "Example 7" were each reported as "The heading "Example 1" says nothing about the content under it." The judges noted that each sits under a parent heading that names the topic ("Context is Everything", "Functional Images", "Decorative Images"), and that the text refers to the examples by number. The patches for Example 1 and Example 2 were the same text, "Alt text for Ellen Ochoa image". The patch for Example 7 would put the exercise's answer into the heading.
  - (dev) gov.br: "DESTAQUE" (Featured), next to its sibling "MAIS ACESSADOS" under "Serviços para você".
  - (test) nhs.uk: "Do" and "Don't" under "Things you can do to help with asthma".
  - (test) python.org.br: nine user-group card headings such as "Py013" and "GruPy-RP". Each is the group's own name.
- **Home pages titled with the site's name (2.4.2).**
  - (dev) gov.br: "The page title "GOV.BR" says nothing about this page."
  - (dev) www.ufc.br: "Universidade Federal do Ceará".
  - (test) mit.edu: "MIT - Massachusetts Institute of Technology".
  - Both judges cited technique G88: on a home page, the name of the site describes the page.
- **Links whose purpose is clear from their sentence or menu (2.4.4).**
  - (dev) webaim.org: "images", "off-screen" and "<figure>", each a term linked inside a sentence.
  - (dev) debian.org: "available" in "Web site source code is available."
  - (dev) drauziovarella.uol.com.br: "ISTs" in the "Saúde Íntima" menu group.
  - (test) docs.python.org: eight keyword cross-references such as "for", "else" and "while", each inside a sentence that names the statement.
- **Fields that are not for the user (1.3.5, 3.3.2).**
  - (dev) barebones.com: the "Website *" field is a spam honeypot, at -9999 px, with `tabindex="-1"` and `autocomplete="off"`. 1.3.5 asked for `autocomplete="url"`, which would make browsers fill the trap. 3.3.2 asked for a visible label, which would show the trap to people.
  - (test) docs.python.org: a documentation language switcher was asked for `autocomplete="language"`.
- **A hidden name judged as a label (2.4.6).**
  - (dev) sosma.org.br: "The label "document" does not say what to enter." "document" is an `aria-label`, and the visible placeholder is "CPF*". The judges called this a Label in Name (2.5.3) mismatch, not a 2.4.6 failure.
- **A broken link reported as a link-text problem (2.4.4).**
  - (dev) sosma.org.br: "The link text "Fatura Verde" does not match where the link leads: a page titled "SOS Mata Atlântica"." The address redirects to /404 ("Página não encontrada"). A broken link is not a 2.4.4 failure, and Rampa's criteria docs say it is never reported. The patch was "Fatura Verde (Página não encontrada)".

### Model error: the context was there and the reading was wrong

- **Functional icons whose alternative names the link (1.1.1).**
  - (dev) www.ufc.br: twelve quick-access pictograms, each the only content of a link whose `title` matches its alternative, were reported as "The text alternative "ÍCONE - Calendário Universitário" describes something the image does not show." On five of them the suggested alternative was the word "decorative", which the patch writes literally as `alt="decorative"`, the only name of a link. Others only stripped the prefix ("ÍCONE - Ônibus da UFC" became "Ônibus da UFC").
  - (dev) gov.br: "Meu INSS - Central de Serviços" on the INSS logo, inside the link that opens that app's entry.
  - (test) python.org.br: user-group logos whose alternative is the group's name, reported as "a file name or a placeholder" ("Pug-PI").
- **Destination titles read as mismatches (2.4.4).**
  - (dev) gov.br: three category tiles, such as "Agricultura e Pecuária ...", lead to `categorias?id=agricultura-e-pecuaria`. They were reported as not matching "a page titled "Categorias"", but every category page has that title.
  - (dev) www.ufc.br: "CULTURA" leads to /pt/cultura and was reported against the title "Universidade Federal do Ceará", which every UFC page shares. The patch was "Página inicial da UFC".
- **Mismatches judged from an address alone (2.4.4).**
  - (dev) debian.org: "The link text "Blog" does not match where the link goes." The link goes to bits.debian.org and its `title` is "Bits from Debian", Debian's blog.
  - (dev) www.ufc.br: the news link "CONCURSO PÚBLICO Edital oferta 65 vagas ..." was judged against its address, which still says "61 vagas". The patch would have put the wrong number into the link.
- **Words the model misread.**
  - (dev) drauziovarella.uol.com.br: "TOC" (transtorno obsessivo-compulsivo, under "Saúde Mental") was read as a table of contents, and the patch was "Sumário".
  - (dev) webaim.org: "The heading "Context is Everything" says nothing about the content under it." That section is about context.
  - (test) accessnow.org: the heading "+1 (888) 414 0100" was flagged in a section marked by a phone icon.

### Context missing: the model did not get what it needed

- **The destination was never read.**
  - (dev) gov.br: "Serviços para Pessoas com Deficiência" was judged from its address alone (`temas/acesso-a-educacao-para-pessoas-com-deficiencia`). The live page's title and heading are "Serviços para pessoas com deficiência".
- **The destination is broader than the link text.**
  - (dev) gov.br: "Declaração de Cookies" leads to "Termo de Uso e Aviso de Privacidade", which has a section "2.2. Declaração de Cookies". Rampa read only the page title.
- **A teaching page.**
  - (dev) webaim.org: the article uses `alt="example image"` on purpose, says so in a note, and describes each example in the text around it. The model judged each exhibit as if it were a real image on a real page. This is the most debatable group: the judges disagreed on four of the eight, and a person could fairly side with the model.

### Collector error: the snapshot showed the wrong thing

- **Stacked carousel slides cropped from the viewport (1.1.1).**
  - (dev) www.ufc.br: the four slides of `#slide-items` share the same bounds (0, 260, 1280×500) and, in the snapshot, the same image bytes, which is a crop of slide 1. Three accurate alternatives were reported as wrong, with patches that describe slide 1's photo. For example, "A imagem mostra um laptop em cima de uma mesa preta ..." was to be replaced by "Professor apresentando conteúdo para estudantes em uma sala de aula".
- **An off-canvas element (1.1.1).**
  - (dev) drauziovarella.uol.com.br: the site logo in the hidden mobile menu sits at x = -152. Its crop showed part of the UOL bar instead, and the patch invented "Logo 70 anos Portal Drauzio Varella".
- **Accessible names the snapshot computed wrongly (2.4.4, 2.4.6).**
  - (test) usa.gov: share links named by `aria-labelledby` were read as "SHARE THIS PAGE:" alone.
  - (test) g1.globo.com: video links were read as "1 min".
  - (test) ibge.gov.br: headings with nested `<small>` text were read without spaces ("ServiçosPMS").

### What the true positives look like

Almost all true positives are plain cases:

- **1.3.5:** contact and newsletter fields with no `autocomplete`, on sosma.org.br and barebones.com (dev) and padocadomani.com.br (test).
- **1.1.1:** placeholder alternatives that axe-core accepts, such as twelve "imagem banner" cards on ibge.gov.br (test) and an illustration on drauziovarella.uol.com.br (dev) whose alternative is the article's subtitle.

## Checking the judges

The analysis read the full reports of a sample of pages and checked the judges' claims against the snapshots. It too was done with a Claude agent, so it is a consistency check, not an independent human review.

- **www.ufc.br, all 23 findings.** The four carousel images do have identical bounds and identical image bytes in the snapshot. The icon patches do set `alt="decorative"`, because the model gave that word as its suggested alternative while reporting the image as wrong content, not as decorative.
- **debian.org, all 9.** The "Blog" link has `title="Bits from Debian"`, and no destination was read for it. The "More..." links and headings are fairly called uncertain: a heading that says only "More..." is weak, but each one has a descriptive paragraph next to it.
- **barebones.com, all 4.** The snapshot marks `#website` as off screen at (-9999, -9943), with `tabindex="-1"` and `autocomplete="off"`.
- **sosma.org.br, all 10.** The "Fatura Verde" destination redirected to /404 with the heading "Página não encontrada". The six 1.3.5 findings are fields with no `autocomplete`, as the judges said.
- **gov.br, all 8.** The category destinations were read with the title and heading "Categorias". The "Pessoas com Deficiência" link has no destination in the snapshot.
- **drauziovarella.uol.com.br, the "TOC" link.** It is in the off-canvas side menu and points to /tag/toc.

On these pages, the judges' reasoning holds. Two groups are still open to dispute:

- **webaim.org (dev).** `alt="example image"` on an image that is the only content of a link (Example 3) leaves a screen reader user with nothing useful, whatever the article's note says. The judges split on it, and a person may count it as a true positive.
- **python.org.br (test).** Cards whose generic Python logo carries the group's name as its alternative. The judges called them false positives and disagreed on the cause. A strict reading of "describes something the image does not show" could go the other way.

Neither group changes the conclusion. Counting all eight webaim.org images as true positives raises dev 1.1.1 to 9 of 28 (0.32). Counting the ten python.org.br placeholder logos the same way raises test 1.1.1 to 22 of 37 (0.59). Both stay well below the ACT figure, and 2.4.4 and 2.4.6 do not change.

## What it means

**On real pages, with this model, precision is far below the ACT test cases for 2.4.4, 2.4.6 and 1.1.1.** On the ACT sets, Gemma 4 12B with Rampa scores:

| Criterion | ACT set | Precision there |
| --- | --- | --- |
| 1.1.1 | qt1vmo | 1.00 |
| 2.4.4 | 5effbb | 0.86 |
| 2.4.4 | fd3a94 | 0.58 |
| 2.4.6 | b49b2e | 0.80 |
| 2.4.6 | cc0f0a | 1.00 |

Here, on test pages, 2.4.4 and 2.4.6 found no real failure in 66 decided findings, and 1.1.1 was right about a third of the time. The units differ: ACT scores count pages, and this study counts findings. The gap is still too large to be a matter of units. As run here, 2.4.4 and 2.4.6 would make a team switch the tool off, and 1.1.1 would need a person to check every finding.

Why the gap:

- **Base rates.** A large share of the ACT test cases fail by design. On a real page, nearly every link and heading passes. The model flagged about 5% of links and 13% of headings; on test cases that rate looks like good judgment, and on real pages it is almost all noise. Precision on real pages depends on how rarely the model flags a passing element, and the ACT sets barely measure that.
- **Clean test cases, noisy pages.** ACT cases are a few elements each, written to make one point. Real pages bring:
  - carousels that stack slides in one box;
  - off-canvas menus and mobile copies of the navigation;
  - spam honeypots;
  - lazy-load placeholders;
  - template destinations that all share one title, and stale address slugs;
  - long cross-referencing tutorials;
  - footers full of one-word links.

  None of these is in the test cases, and each one produced a group of false positives.
- **Context given to the model.** Several errors come from what Rampa passed, or failed to pass, to the model. Destinations were read only as a title and heading, or not at all, and a mismatch could be claimed from an address alone. Crops were taken from the viewport rather than from the image. The model sometimes ignored the context it was given, such as a link's sentence, a heading's parent, or a link's `title`.
- **Model size.** A 12B model, run once, judged hundreds of links per page. It confused "TOC" with a table of contents, called a 3D cell illustration not a cell, and called "Context is Everything" unrelated to its section. Its confidence was "high" on every finding, so the model offers no signal for telling its errors apart. A larger model may do better; this study did not test one.
- **Prompts tuned on the ACT cases.** Rampa's evaluation notes that prompts were adjusted after reading errors on the same ACT cases. The real-page numbers are what that tuning looks like on fresh pages.
- **Locale and language.** `--locale en` changes only the report's language. Suggestions followed each page's language, and Portuguese pages did no worse than English ones: 21 of 128 decided findings on pt-BR pages were true positives, against 2 of 54 on English pages. The Portuguese errors that did involve language, "TOC" and "ISTs", are about the model's knowledge of Portuguese abbreviations, not about the locale flag.

## What the study cannot say

- **Recall.** Only reported findings were labeled. Real failures that the model passed were not counted.
- **Ground truth.** The labels come from two Claude agents, and they still need human review. The judges agree well on whether a finding is wrong (kappa 0.69) but poorly on why (0.33).
- **How well the numbers generalise.** There are 19 pages, picked by hand for variety rather than at random, and four of them hold almost half the findings (98 of 202). Findings on one page are correlated, and the intervals do not account for that.
- **The heaviest pages.** Five pages timed out on a shared GPU, so long listings and reference pages are missing.
- **Other models or settings.** There was one model, one run per page and no `--runs` voting. Whether a larger model, voting, or reasoning mode changes the picture is untested.
- **3.1.1, 3.1.2 and 1.4.5.** The first two reported nothing on these pages, and 1.4.5 was not run.
- **Exact numbers for small groups.** 2.4.2, 3.3.2 and 1.3.5 on test have from 1 to 5 decided findings each, and their intervals span most of 0 to 1.

## Improvements suggested by the dev split

Each change below comes only from false positives on the dev pages, and lists the dev examples behind it. The test split's findings were read to describe the patterns above but were not used to choose any change. After the changes are made, measure them once on the test split and then on fresh pages.

1. **Make 2.4.4 and 2.4.6 experimental and off by default. Put the "wrong content" problem of 1.1.1 behind the same flag.** Dev precision was:

   - 2.4.4: 0 of 21;
   - 2.4.6: 0 of 13;
   - 1.1.1: 1 of 24. Of its "describes something the image does not show" claims, 21 were false positives, 1 a true positive and 6 uncertain.

   Keep them runnable with `--criteria`, and say in the report that they are experimental. Turn them back on only once they meet the bar Rampa's coverage plan already sets for real-page precision: at least 35 findings reviewed by a person with no false positive. 1.3.5 can stay on: 8 of 9 on dev. Its only error is the honeypot in change 9.

2. **Do not add a threshold on the model's own confidence.** All 81 dev findings were reported with `high` confidence, including the 61 false positives, so such a threshold would remove nothing. If a confidence gate is wanted, base it on another signal: the deterministic checks below, or agreement across `--runs`. Measure that too, since repeated runs of one model are consistent, not necessarily correct.

3. **2.4.4: a mismatch needs a destination that was read, not just an address.** Verification now accepts a mismatch when the link has an address, even if nothing was read at that address. Require a title or heading read at the destination, and never infer a mismatch from the address text alone. Dev cases (5 of 5 were false positives):

   - debian.org "Blog", which leads to bits.debian.org;
   - gov.br "Serviços para Pessoas com Deficiência", judged from its address;
   - www.ufc.br "CONCURSO PÚBLICO Edital oferta 65 vagas ...", judged against a stale "61 vagas" address;
   - www.ufc.br "Fortaleza" in the campus list;
   - www.ufc.br "EU 2026 ocorrem de 4 a 6 de novembro ...".

4. **2.4.4: do not trust destination titles that say nothing, and do not report broken links.** A title is no evidence of a mismatch when:

   - several links that lead to different addresses share it;
   - it is the site's own title, the same as the home page's;
   - the destination redirects to a not-found page, or its heading says the page was not found. That is a broken link, which Rampa already promises never to report.

   Dev cases:

   - gov.br, three category tiles, all read as "Categorias";
   - www.ufc.br "CULTURA", read as "Universidade Federal do Ceará";
   - sosma.org.br "Fatura Verde", which redirects to /404.

   Also add to the prompt that a page broader than the link text is not a mismatch when it contains what the text names. Dev cases: gov.br "Declaração de Cookies", which leads to the privacy notice that contains it; debian.org "the default document language", which leads to "Debian Website in different Languages".

5. **2.4.4: limit "generic" to generic words.** Accept a `generic` claim only when the link text, case and punctuation aside, is on a short list of generic phrases in each supported language: "click here", "here", "read more", "more", "link", "clique aqui", "aqui", "saiba mais", "leia mais", "mais" and the like. Accept a `url_or_filename` claim only when the text is not the host of the link's own destination. Dev cases for `generic` (8 false positives, 2 uncertain):

   - webaim.org "images", "off-screen" and "<figure>";
   - debian.org "available" and "Download";
   - drauziovarella.uol.com.br "ISTs" and "TOC";
   - sosma.org.br "Clique aqui para iniciar uma conversa".

   An exact match against the list would have dropped all eight false positives, and the two uncertain "More..." links on debian.org would still be judged. Dev case for `url_or_filename` (1 false positive): www.ufc.br "ufc.br", which links to https://www.ufc.br/.

6. **1.1.1: judge a functional image by its purpose.** When an image is the only content of a link or button, tell the model that its alternative should name the link's purpose, and that a pictogram need not depict what it names. Then drop a `wrong_content` claim when the alternative matches the link's purpose: the alternative, without words such as "ícone", "ícones", "icon", "logo" or "imagem", contains or is contained in the link's `title`, its other text, or the title of its destination. Dev cases (14 false positives):

   - twelve "ÍCONE - …" quick-access links on www.ufc.br, all of which the check would have dropped;
   - one more www.ufc.br icon, "ícone representativo de telefone e e-mail";
   - gov.br "Meu INSS - Central de Serviços".

   The prompt guidance alone covers the last two.

7. **1.1.1: check the suggestion before writing a patch.** Drop a failure, or at least its patch, in two cases:

   - The suggested alternative is a label rather than text, such as "decorative", "decorativo", "none" or "empty", while the problem is not `decorative`. On five www.ufc.br icons this became `alt="decorative"`.
   - The suggestion only removes words from the current alternative or rewords it, as when "ÍCONE - Ônibus da UFC" became "Ônibus da UFC". Dev cases: four www.ufc.br icons, such as "Assistência Estudantil" and "Transparência e Prestação de Contas".

8. **Collector: send each image's own pixels.** When several candidates share their bounds and their crop bytes but differ in source or alternative, as stacked carousel slides do, the crop is not each image. Take the pixels from the image's own source, or skip the vision judgment and say why. Do the same for elements outside the page area, such as an off-canvas menu at a negative x. Dev cases (4 false positives, all labelled `collector_error` by both judges):

   - three www.ufc.br carousel slides judged on slide 1's crop;
   - the drauziovarella.uol.com.br logo at x = -152, whose patch invented "Logo 70 anos".

9. **1.3.5 and 3.3.2: skip honeypots.** Leave out fields that are off screen and out of the tab order (`tabindex="-1"`), since they are not meant for people. Dev case: barebones.com `#website`, which caused the only dev false positive of each criterion.

10. **2.4.6: judge headings in their hierarchy, and judge visible labels.**

    - **Headings.** Tell the model that a short heading passes when, read with its parent heading, it says what its section is. Drop "says nothing" claims on a heading that belongs to a series of siblings that differ only by a number. Dev cases: webaim.org "Example 1" to "Example 7", "Introduction"; gov.br "DESTAQUE", next to its sibling "MAIS ACESSADOS".
    - **Labels.** When a field's name comes from `aria-label` and a visible label or placeholder exists, judge the visible text. A mismatch between the two belongs to 2.5.3, not 2.4.6. Dev cases: sosma.org.br "document" (visible "CPF*") and "phone" (visible "Telefone*").

11. **2.4.2: pass a home page titled with the site's name.** Give the model the page's path. When the page is a site root or a language root (such as "/" or "/pt") and the title names the site or organization, pass, citing technique G88. Dev cases (2 of 2 false positives): gov.br "GOV.BR" and www.ufc.br "Universidade Federal do Ceará". The gov.br patch only added a tagline.

12. **Finish heavy pages with a partial report.** Four of the twelve dev pages timed out in the judgment phase on a shared GPU, and their findings are lost. Write a partial report with the criteria that finished, and put a cap on candidates per criterion with the rest reported as not judged. Then a long page still produces a report, and the report says what it left out. Dev cases: agenciabrasil.ebc.com.br, npr.org, estantevirtual.com.br and developer.mozilla.org.

## Data and reproduction

- `study/scripts/pages-input.json` lists the pages, their split and how each run ended.
- `study/scripts/analyze.py` rebuilds every number in this document: run `python study/scripts/analyze.py`. It reads the reports from `study/pages/`, which is kept out of git; when they are missing, it reads the finding fields back from `study/data/findings.json`.
- `study/labels/` holds both judges' labels and rationales for every finding.
- `study/data/findings.json` has one row per finding, with both labels, the final label and its cause. `study/data/pages.json` has one row per page, and `study/data/summary.json` has precision, the share flagged, agreement and cause counts.
