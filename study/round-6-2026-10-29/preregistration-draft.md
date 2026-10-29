# Sixth real-page study: pre-registration DRAFT (2026-10-29)

> **This is a draft, not the pre-registration.** The pages, the split and its seed are fixed here; the code is not. The
> code will be frozen once the fixes after round 5 are in ([notes after round 5](../../docs/studies/notes-precision-round5.md),
> section 2): P1 and P2 were merged into `main` as `a82558e` while this draft was written, and P3 and P4 have a branch,
> `fix/precision-p3p4`, with nothing on it yet. The commit and the frozen thresholds below are placeholders until the
> freeze (marked **TO FIX**). Decisions this draft cannot make alone are
> marked **DECISION** and listed in [section 9](#9-conflicts-with-the-article-and-open-decisions). The pre-registration
> proper is this file, completed, renamed `preregistration.md` and committed before Rampa runs on any of these pages.
> Nothing in it may change after that commit.

Only the pre-screen in headless Edge (`scripts/screen.mjs`, `data/screen-*.json`) and the link listing used to pick
inner pages (`scripts/links.mjs`) have loaded these pages. Rampa has not run on any of them.

**Question.** This round is the final evaluation the thesis article commits to (`~/dev/tcc/notas/atividade-08-proposta-de-avaliacao.md`,
section 5, "T2" and the real-page parts of "T3" and "T4"). Its main question is the article's P2: on 36 pages none of
the frozen code has seen, how often is what `rampa check --wcag 2.1` reports, by the judgment layer at the default
threshold, a real failure? Beside it, on the same pages: how many of the true findings axe-core does not report (the
real-page part of P1), how much each component contributes and how much the verdicts repeat (P3), and the time and
cost per page (P4). Precision only: pages are not audited for what Rampa missed.

**What it builds on.** The [fifth study](../../docs/studies/real-pages-2026-10-round5.md) measured 0.83 on its test half
(20 of 24 decided; Wilson 0.64–0.93, page bootstrap 0.62–1.00) and 0.81 over both halves (51 of 63). The notes after
round 5 project 0.84–0.92 for a sixth round once P1 and P2 ship (central 0.88), and show that a 24-page round cannot
show 0.9 whatever it measures (section 4 there). This round is three blocks of the fifth study's design, 72 pages, as
those notes and the article propose.

## 1. Code, to be frozen (TO FIX)

`main` at **`<COMMIT>`**: `a82558e` or later, with P1 and P2 (merged) and P3 and P4 if they are merged before the
freeze; built with `pnpm install --frozen-lockfile` and `pnpm build`. `src/` stays at that commit for the whole study.
The rules and thresholds that decide what a finding is (P1 and P2 as frozen in
[notes-precision-p1p2](../../docs/studies/notes-precision-p1p2.md), section 2, before their replay):

| Rule | Value | Where | Status |
| --- | --- | --- | --- |
| H81 nesting, default body look, no author style, 150-element floor, old-recording fallback, self-link correction, second pass at 0.99, 2.4.2 and 3.3.2 grounding, burst group of 6 | as frozen for the fifth study ([its pre-registration](../round-5-2026-10-28/preregistration.md), "Code, frozen") | `link-purpose.ts`, `look.ts`, `page-look.ts`, `reach.ts`, `confirm.ts`, `page-titled.ts`, `labels-or-instructions.ts`, `groups.ts` | **TO CONFIRM** against the merged code |
| P1, card heading (H80) | for a generic link text only: the nearest heading before the link (visible, with a name), when it and the link share an ancestor at most 2 levels above the link whose whole text is at most 300 characters, counts as context, and the prompt gains one line, "Heading of the card the link sits in: …" | `link-purpose.ts`, `cardHeadingOf`, `CARD_DEPTH`, `CARD_TEXT` | merged in `a82558e`; **TO CONFIRM** at the freeze |
| P1, disclosure toggle | a generic link text whose `href` is absent, empty, `#` or `javascript:`, and whose list item holds a list after it, is not grounded as generic (verification only) | `link-purpose.ts`, `menuToggleOf`, `groundedLink` | merged; **TO CONFIRM** |
| P2, identical claims | on one page, second-pass claims with the same criterion, the same subject (the alternative text after NFKD, marks removed, spaces collapsed, lower case) and the same verdict form a group; when the pass confirms one on its own answers, every denied member is confirmed ("C-any") | `confirm.ts`, `identicalClaimKey`, `confirmTogether` | merged; **TO CONFIRM** |
| P3, social icon | a link to a social network whose alternative names it (a known network's name, or within edit distance 2 of a hostname label of the link) is not a 1.1.1 failure | | only if merged |
| P4, destination name | a shared-text 2.4.4 claim on a link whose destination's title or heading contains the link's text is a suggestion | | only if merged |
| `--no-verify` on `rampa check` | the verification ablation (below) | `src/cli/main.ts` | **MISSING**: neither `0bada65` nor `a82558e` has it; only `rampa eval` does |

**Precondition: the `--no-verify` flag.** At `0bada65` and at `a82558e`, `rampa check` has no `--no-verify` option and
`RampaOptions` (`src/api/options.ts`) has no `verify`; only `rampa eval --no-verify` sets `verify: false`
(`src/core/check.ts`). The article's T3 names this ablation, so the frozen code needs it on `rampa check` (a few lines
in `main.ts`, `commands/check.ts` and `api/options.ts`), or the study needs a script that calls `checkSnapshot` with
`verify: false`. What `verify: false` turns off, read from `src/core/check.ts` at `a82558e`: a fail claim whose quote
does not match the page stays a finding instead of being discarded; and a fail on a page read as unstyled, or with no
checked fact behind it (2.4.2, 2.4.4, 2.4.6, 3.3.2), is no longer held back as a suggestion (`heldBack`). A discarded
claim still never reaches the second pass, which asks `failed` claims only, so an offline replay of `--no-verify` on a
copy of the main cache asks the model nothing new, except on a page read as unstyled, where 1.1.1 claims the main run
held back would now reach the pass and count as offline misses.

## 2. Pages

**Exclusions.** No registrable domain (Public Suffix List, fetched 2026-10-29, SHA-256 `1f96bae4…`) of any earlier
study (the first, its re-measure, the second to fifth studies and the robustness study's 53 sites: 160 domains, the
fifth study's 24 pages among them), none that any file of the repository's 16 branches, 2 tags or `origin/main`, or any
commit message, names (2,425 domains), and none named only on a line some commit of the history added (12 more):
`scripts/exclusions.py`, `data/excluded-domains.json`, built on 2026-10-29 at `0bada65`. It is the fifth study's
script, with its 24 pages added and the tags, the remote ref and the history as new sets that only widen it.

**Design.** Three blocks of the fifth study's design. In each block, twelve strata, Brazil or international, times
government, education, news, e-commerce, health, and culture or public services; in each stratum, a home page and an
inner page from two different sites. No site appears twice in the 72. Brazilian pages are in Portuguese, the others in
English (14 United Kingdom, 13 Ireland, 9 United States). Inner pages, by stratum: the ombudsman or contact page of a
Brazilian court, prosecution service or court of accounts; a public search form for international government; the
undergraduate page of a university; the first article of a news or health site's home page; the first product
category of a store; the contact page of a theatre, orchestra or cultural body.

**Selection.** Before anything was loaded, 480 sites were written in 24 pools (`scripts/pools.tsv`, 20 per stratum and
slot type, in order), 19 were dropped as excluded (metropoles.com, r7.com, jota.info, tuasaude.com, gov.wales,
www.gov.scot, usps.com, scotsman.com, npr.org, csmonitor.com, apnews.com, propublica.org, screwfix.com, powells.com,
patagonia.com, mountsinai.org, mdanderson.org, cancerresearchuk.org, lincolncenter.org), and the remaining 461 were
dealt in turn to the three blocks' slots, 5 to 7 per slot (`scripts/deal.py`, `scripts/candidates.tsv`), with the
screen's rules and the split seed: committed in `b4c77c5` at 01:06 (UTC−3), before the screen began at 01:07. Every
candidate was loaded once in headless Edge (`scripts/screen.mjs`, `data/screen-1.json`, 01:07–01:32). The connection
dropped near the end of that run, so the 56 candidates that had failed with a network error or a time-out before their
slot's choice were screened once more (`scripts/candidates-retry.tsv`, `data/screen-2.json`); those that failed again
were counted as not loading. Inner pages were picked from each site's link listing (`scripts/links.mjs`,
`scripts/pick.py`) and screened (`scripts/candidates-inner*.tsv`, `data/screen-3.json` to `screen-5.json`, three of
them again after another drop of the connection). `scripts/selection.tsv` and `scripts/pages.tsv` say, slot by slot,
which candidates failed before the chosen one and why, and what the page is.

**Replacements: 30 of the 72 slots went to a backup** (11, 9 and 10 by block):

- *HTTP 403 or 404, or a bot challenge*: check-mot.service.gov.uk, register.fca.org.uk, colorado.gov, durham.ac.uk,
  uclh.nhs.uk, npg.org.uk, nms.ac.uk and iwm.org.uk (block 1); zattini.com.br, casafiat.com.br, birmingham.gov.uk,
  edinburgh.gov.uk, thenorthernecho.co.uk, harveynorman.ie, arnotts.ie and brownthomas.com (block 2); opopular.com.br,
  ospa.org.br (404), fcs.mg.gov.br, umich.edu, maynoothuniversity.ie, seattletimes.com, agriland.ie, edp24.co.uk,
  axios.com and superdrug.com (block 3); and in block 3 the MS Society's Cloudflare challenge, and Blacks, whose home
  page passed and whose first category showed a Cloudflare challenge;
- *no load in two tries*: hospitalmaterdei.com.br, johnlewis.com, ufpa.br, tribunadonorte.com.br, riachuelo.com.br,
  submarino.com.br, girafa.com.br, hospitalsantacatarina.org.br (an invalid certificate), hospitalmaededeus.com.br,
  huffingtonpost.co.uk and rei.com;
- *other*: fortaleza.ce.gov.br answered 503; go.gov.br showed 4 links, under the rule's 5; museudeartedorio.org.br and
  sbn.org.br showed almost no text (144 and 146 characters); find-energy-certificate.service.gov.uk redirected to
  www.gov.uk, which the exclusions name; tjrs.jus.br redirected to a maintenance notice and its link listing timed out
  twice; rbo.org.uk links no contact page from its home page (a help centre only), and parkinsons.org.uk no story or
  post (news hubs in its menu only).

No slot ran out of candidates; the deepest went to its fourth backup (Donegal Daily, block 3, international news inner).

**Readings added during the selection** (recorded here; all were settled before the selection was fixed, none after
Rampa ran, since it has not, and none changes what the rules of `scripts/candidates.tsv` exclude or admit outright):

1. *Which link is "the first article" or "the first category".* After the first block's link listings were seen and
   before any pick was fixed, `links.mjs` was given a third column, the region a link sits in (header, navigation,
   footer or content), and the rule was read so: an article is the first story or post in the page's *content*, not an
   evergreen page linked from a menu; a category is the first product category of the *main menu* (header or
   navigation), else, on a page with none there, the page's first category link. Promotions ("20% off ...", deals),
   seasonal shops (Christmas, Halloween), wish lists, delivery filters and customer service are not product
   categories; information, support, directory, guide and hub pages, and a home-banner post type, are not stories or
   posts. A contact page is found by its text or by its address (`/contact-us/`). `scripts/pick.py` applies this, and
   each override of its first proposal is written in `scripts/pages.tsv`.
2. *A link listing that times out twice counts as a load that failed twice* (TJRS), and *a home page that redirects to
   a maintenance notice is an error page* (TJRS).
3. *A redirect's target is the page's address*, as in the fifth study (for example FGV's "Graduação" link, which leads
   to its admissions site, vestibular.fgv.br); tracking query strings of picked links are dropped.
4. *A wall phrase is checked in context*: SBOC's article matched "matéria exclusiva" in a list of older posts ("Em
   matéria exclusiva para o portal UOL ..."), not a wall, and was kept. No other chosen page matched.
5. *Redaction.* Three client addresses, each shown by a block page (mpba.mp.br's web filter, a hospital site's error
   page, fei.edu.br's block page; all three failed the screen), are replaced with "[redacted]", and
   every final address in the kept screen files loses its query string: one bot check's redirect carried tokens, and
   lojasrenner.com.br's carried the region it read from the client's address (`scripts/redact.py`).

**Split.** `scripts/split.py`, `random.Random(20261029)`: for block 1, 2 and 3 in turn, and within a block for each
stratum in sorted order, a seeded coin sends the home page to dev when it is under 0.5, else the inner page
(`data/pages-input.json`, which also records the 36 coins). The seed was written in `scripts/split.py` and
`scripts/candidates.tsv` in `b4c77c5`, before any page loaded. Each block's test half holds one page per stratum; the
test half is 36 pages (14 home pages and 22 inner pages), the dev half 36.

**The proposed T4 subset** (section 3; **DECISION**), drawn with the same generator after the split, one page per
stratum: gosh.nhs.uk and museum.wales (block 1); the Ultrafarma category, the Migalhas article, Unicap's undergraduate
page, the SBPT article and OSU's undergraduate site (block 2); Instituto Tomie Ohtake, rn.gov.br, The White Company,
Cork City Council and The Denver Post (block 3). Marked "(T4)" below.

**Long paths.** Rampa names a recording after the whole address; the SBPT article's recording would sit at a
282-character path in this worktree (about 246 from the main checkout), past Windows' 260. The collection scripts must
run from a short folder or with long paths enabled (section 10).

| Block | Split | Region | Category | Country | Type | Page | Chosen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | dev | Brazil | culture | BR | contact | https://www.teatroguaira.pr.gov.br/Pagina/Fale-Conosco | primary |
| 1 | dev | Brazil | e-commerce | BR | listing | https://www.mobly.com.br/moveis/moveis-sala | primary |
| 1 | dev | Brazil | education | BR | home | https://www.ufam.edu.br/ | primary |
| 1 | dev | Brazil | government | BR | contact | https://www.tce.sp.gov.br/ouvidoria | backup b1 |
| 1 | dev | Brazil | health | BR | home | https://graacc.org.br/ | backup b1 |
| 1 | dev | Brazil | news | BR | home | https://www.oliberal.com/ | primary |
| 1 | dev | intl | culture | IE | contact | https://gatetheatre.ie/contact-us/ | backup b1 |
| 1 | dev | intl | e-commerce | US | home | https://global.llbean.com/ | backup b1 |
| 1 | dev | intl | education | UK | home | https://www.exeter.ac.uk/ | backup b1 |
| 1 | dev | intl | government | US | home | https://www.utah.gov/index.html | backup b1 |
| 1 | dev | intl | health | UK | home | https://www.gosh.nhs.uk/ (T4) | backup b1 |
| 1 | dev | intl | news | UK | home | https://www.manchestereveningnews.co.uk/ | primary |
| 1 | test | Brazil | culture | BR | home | https://museucatavento.org.br/ | backup b2 |
| 1 | test | Brazil | e-commerce | BR | home | https://www.lojasrenner.com.br/ | primary |
| 1 | test | Brazil | education | BR | info | https://vestibular.fgv.br/ | primary |
| 1 | test | Brazil | government | BR | home | https://www.to.gov.br/ | backup b2 |
| 1 | test | Brazil | health | BR | article | https://revista.abrale.org.br/destaques/2026/10/policitemia-vera-pesquisa-da-abrale-revela-desafios-no-diagnostico/ | primary |
| 1 | test | Brazil | news | BR | article | https://exame.com/invest/mercados/producao-da-petrobras-bate-recorde-no-3o-tri-e-importacao-de-diesel-dispara/ | primary |
| 1 | test | intl | culture | UK | home | https://museum.wales/ (T4) | backup b3 |
| 1 | test | intl | e-commerce | UK | listing | https://www.marksandspencer.com/c/women | primary |
| 1 | test | intl | education | UK | info | https://www.lboro.ac.uk/study/undergraduate/ | primary |
| 1 | test | intl | government | UK | form | https://reports.ofsted.gov.uk/ | backup b3 |
| 1 | test | intl | health | IE | article | https://www.cancer.ie/your-stories/amanda-broaderss-breast-cancer-story | primary |
| 1 | test | intl | news | UK | article | https://www.liverpoolecho.co.uk/news/liverpool-news/anfield-street-goes-days-without-34829284 | primary |
| 2 | dev | Brazil | culture | BR | contact | https://filarmonica.art.br/fale-conosco/ | primary |
| 2 | dev | Brazil | e-commerce | BR | listing | https://www.ultrafarma.com.br/categoria/medicamentos (T4) | backup b3 |
| 2 | dev | Brazil | education | BR | home | https://ufu.br/ | backup b1 |
| 2 | dev | Brazil | government | BR | contact | https://www.mprj.mp.br/comunicacao/ouvidoria | primary |
| 2 | dev | Brazil | health | BR | home | https://santacasabh.org.br/ | primary |
| 2 | dev | Brazil | news | BR | article | https://www.migalhas.com.br/quentes/467452/listas-de-boicote-a-comerciantes-podem-configurar-crime (T4) | primary |
| 2 | dev | intl | culture | IE | contact | https://www.nch.ie/contact-us/ | primary |
| 2 | dev | intl | e-commerce | IE | home | https://www.easons.com/ | backup b2 |
| 2 | dev | intl | education | IE | home | https://www.ucc.ie/en/ | primary |
| 2 | dev | intl | government | IE | home | https://www.fingal.ie/ | backup b2 |
| 2 | dev | intl | health | IE | home | https://www.beaumont.ie/ | primary |
| 2 | dev | intl | news | IE | home | https://www.irishmirror.ie/ | primary |
| 2 | test | Brazil | culture | BR | home | https://museudaimigracao.org.br/ | backup b1 |
| 2 | test | Brazil | e-commerce | BR | home | https://www.arezzo.com.br/ | backup b1 |
| 2 | test | Brazil | education | BR | info | https://portal.unicap.br/graduacao (T4) | primary |
| 2 | test | Brazil | government | BR | home | https://conecta.recife.pe.gov.br/ | primary |
| 2 | test | Brazil | health | BR | article | https://sbpt.org.br/portal/congresso-da-sbpt-reune-mais-de-2-mil-participantes-apresenta-941-trabalhos-cientificos-e-homenageia-nomes-da-pneumologia-brasileira/ (T4) | primary |
| 2 | test | Brazil | news | BR | home | https://www.hojeemdia.com.br/ | backup b1 |
| 2 | test | intl | culture | IE | home | https://imma.ie/ | primary |
| 2 | test | intl | e-commerce | IE | listing | https://www.dunnesstores.com/women | backup b1 |
| 2 | test | intl | education | US | info | https://undergrad.osu.edu/ (T4) | primary |
| 2 | test | intl | government | US | form | https://www.cpsc.gov/Recalls | primary |
| 2 | test | intl | health | US | article | https://www.lung.org/blog/radon-awareness-lung-cancer-advocate | primary |
| 2 | test | intl | news | US | article | https://calmatters.org/politics/2026/10/trump-ballot-claims-california-ruling/ | backup b1 |
| 3 | dev | Brazil | culture | BR | home | https://www.institutotomieohtake.org.br/ (T4) | primary |
| 3 | dev | Brazil | e-commerce | BR | home | https://www.cea.com.br/ | primary |
| 3 | dev | Brazil | education | BR | info | https://www.espm.br/tecno/ | primary |
| 3 | dev | Brazil | government | BR | home | https://www.rn.gov.br/ (T4) | primary |
| 3 | dev | Brazil | health | BR | home | https://www.boldrini.org.br/ | backup b2 |
| 3 | dev | Brazil | news | BR | home | https://www.acritica.com/ | backup b1 |
| 3 | dev | intl | culture | UK | contact | https://www.rsc.org.uk/contact-us-and-faqs | primary |
| 3 | dev | intl | e-commerce | UK | listing | https://www.joules.com/womens-clothing | backup b2 |
| 3 | dev | intl | education | UK | home | https://www.st-andrews.ac.uk/ | backup b2 |
| 3 | dev | intl | government | IE | form | https://www.propertypriceregister.ie/ | primary |
| 3 | dev | intl | health | US | home | https://www.massgeneralbrigham.org/en/about/massachusetts-general-hospital | primary |
| 3 | dev | intl | news | IE | article | https://www.donegaldaily.com/health/hiqa-sounds-major-alarm-on-fire-safety-at-falcarragh-community-hospital-655893 | backup b4 |
| 3 | test | Brazil | culture | BR | contact | https://grupocorpo.com.br/contato/ | backup b2 |
| 3 | test | Brazil | e-commerce | BR | listing | https://www.usereserva.com/colecao-reserva-masculino | primary |
| 3 | test | Brazil | education | BR | home | https://www.ufes.br/ | primary |
| 3 | test | Brazil | government | BR | contact | https://www.tjmg.jus.br/ouvidoria/ | primary |
| 3 | test | Brazil | health | BR | article | https://sboc.org.br/noticias/sboc-marca-presenca-na-programacao-do-interonco-2026/ | backup b1 |
| 3 | test | Brazil | news | BR | article | https://conjur.com.br/2026-out-28/toffoli-suspende-julgamento-sobre-restricoes-a-buser-em-mg/ | primary |
| 3 | test | intl | culture | US | home | https://www.philamuseum.org/ | primary |
| 3 | test | intl | e-commerce | UK | home | https://www.thewhitecompany.com/uk/ (T4) | backup b1 |
| 3 | test | intl | education | UK | info | https://www.southampton.ac.uk/study/undergraduate | primary |
| 3 | test | intl | government | IE | home | https://www.corkcity.ie/en/ (T4) | primary |
| 3 | test | intl | health | UK | article | https://www.epilepsy.org.uk/news/extraordinary-dads-marking-fathers-day | backup b2 |
| 3 | test | intl | news | US | home | https://www.denverpost.com/ (T4) | backup b1 |

## 3. Method

The fifth study's, with its rubric (`../round-5-2026-10-28/judge-rubric.md`), judge prompt
(`../round-5-2026-10-28/scripts/judge_prompt.py`, including its one-line reply) and packet format, except as listed.

- **Target version.** Every `rampa check` of this study runs with `--wcag 2.1`, as the article fixes. It changes the
  collection (axe-core runs the `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa` rules, without `wcag22aa`, whose one rule
  in axe-core 4.14 is target-size, `src/engine/axe.ts`) and the report (a finding under a WCAG 2.2 criterion is listed
  in `beyondTarget` and never counted, `src/core/check.ts`). The eight judged criteria are all WCAG 2.0 criteria, so
  the primary measure's population is the same under 2.1 and 2.2.
- **Blocks.** The three blocks are collected and judged in order, each in a session of its own (about 11 minutes of
  collection and an hour of judgment each, section 8). No test count is computed until all three blocks are labelled;
  the dev half of a finished block may be read, since `src/` cannot change.
- **Collection, no model call.** `rampa check <url> --wcag 2.1 --model ollama:gemma4:12b --offline --locale en
  --min-confidence low --save <dir> --screenshots --timings`, with Edge through playwright-core, one page at a time
  (the fifth study's `collect.sh`, plus `--wcag 2.1` and `--timings`). Each page is loaded once for collection. In all,
  a site is loaded a few times, never two at once: the screen (again after a network error), the link listing and the
  inner page's screen for an inner slot, the collection, and for a T4 page one live `--fast` collection; requests to
  one origin are spaced, as the article's ethics paragraph says.
- **Judgment on the saved snapshot.** `rampa check <snapshot> --wcag 2.1 --model ollama:gemma4:12b --locale en
  --min-confidence low --time-limit 900 --concurrency 2 --timings`, the second pass on (the default), one page at a
  time, from an empty cache. This main run is the one labelled, the "once per page" of the article's T2.
- **Model.** Gemma 4 12B (`gemma4:12b`, Q4_K_M), on Ollama at http://127.0.0.1:11434, temperature 0 as Rampa's provider
  sends it; the digest, the Ollama version, Edge's version and Rampa's version are logged at the start of each block.
- **Ablations (T3), each on the same snapshots.**
  1. **Verification off**: `--no-verify` (section 1), offline, on a fresh copy of the page's main cache, so the run
     differs from the main run only by verification; offline misses are counted in its report.
  2. **The judgment layer off**: `rampa check <snapshot> --wcag 2.1 --no-llm --locale en --min-confidence low`, the
     deterministic layer alone (axe-core and Rampa's rules) on the same snapshot; no model.
  3. **A model swap**: the main judgment's command with another model and a fresh empty cache. **DECISION**: the hosted
     `openai:gpt-6-luna`, which also serves the article's hosted cost comparison but needs the user's API key and
     approval for paid use, or the local `ministral-3:14b`, second to Gemma in [docs/models.md](../../docs/models.md)
     (F1 0.84 against 0.91 on the ACT meaning sets) and about 1.3 times slower. Not a Claude model: the judges are
     Claude, and the article requires judges of another family than the model evaluated.
  4. **The second pass off** (`--no-confirm`, the fifth study's ablation, kept; the article does not name it), offline,
     on a fresh copy of the main cache.
  5. **P1 and P2 by replay**, as the fifth study replayed its fixes. P2 exactly: the second pass at `a82558e` asks
     every claim on its own before grouping, so a copy of the build without `confirmTogether` (checked to differ in
     that call only), offline on a copy of the main cache, gives the outcomes without group confirmation. P1 only as
     facts (no model), as the fifth study replayed the H81 nesting: its card heading changes the prompt of the links
     it reads and the order under the 50-candidate cap, so "without P1" would need new model calls; the replay says
     which links the card heading and the toggle take the generic fact from, and how many findings and suggestions
     sit on them (**TO FIX** with the code).
- **Five uncached runs (T4).** On the T4 pages (**DECISION**: the 12-page subset drawn in `scripts/split.py`, section
  2, as the article's "subconjunto"; or all 72), each run with a fresh empty cache and `--timings`:
  - *full mode, local*: the main judgment's command, five times; the main run counts as the first (**DECISION**);
  - *fast mode, local*: `--fast` changes the collection (fewer captures, a shorter wait, no link following, no
    contrast from pixels), so each T4 page is loaded once more, live, with `rampa check <url> --wcag 2.1 --fast --model
    ollama:gemma4:12b --offline --save <dir> --timings`, and that fast snapshot is judged five times with `--fast`;
  - *hosted*: the same two with `--model openai:gpt-6-luna`, only if the user approves (**DECISION**).
  The verdict of each judged candidate is read from each run's judgment cache, one entry per prompt (the report lists
  failures, not passes); the second pass's one-word answers are entries too.
- **Labels.** One packet per page (`packets.py`, adapted), in one form and a seeded shuffled order
  (`random.Random("20261029:<slug>")`): every judgment and rule finding of the main run at any confidence; every
  finding of the `--no-confirm`, `--no-verify` and model-swap runs at the default threshold that the main run does not
  have (**DECISION**: all of the `--no-verify` extras, about 12 a page, or a seeded sample); and the chosen
  suggestions (as in the fifth study). No `confidence`, `patch` or run name in a packet. Two Claude judge agents per
  packet, an auditor and a skeptic, each told not to read the other's work; the final label is the one both gave, else
  `uncertain`. All runs of a block finish before its packets are written, so each page has one packet and one pair of
  judges.
- **Human labels.** The article's sample of about 100 findings labelled by the author and 30 by a second person is
  being drawn now from rounds 3 to 5, not from this round ([human-review-plan](../../docs/studies/human-review-plan.md),
  `study/human-review-2026-10/`, merged in `a82558e`, seed `rampa-human-review-2026-10-29`). It measures how far the
  Claude labels can be trusted before this round's are counted. For this round, the draft proposes (**DECISION**,
  section 9, item 6) a second, blind human labelling by the author of every default-threshold judged finding of the
  main run on the test half (the primary measure's items, about 70 to 95 expected), in the same blind form (the packet
  form, without the judges' labels, the confidence or the run) and with the same rubric, drawn after the judges' label
  files are written and before any count is read; it is what lets the article's fallback (human labels only, below)
  be computed on the primary measure.
- **Kept in git**: as in the fifth study, the part of each report the analysis reads (`compact.py`); recordings,
  screenshots, caches and full reports hashed and kept in `C:/Users/guilh/dev/rampa-study-recordings/round-6`.

## 4. Primary measure (the article's P2)

**Test-half precision per element at the default threshold over the judged criteria**: judgment findings of the eight
default criteria that are not experimental and have medium confidence or above, from the main run, on the 36 test
pages; precision = TP / (TP + FP), uncertain left out. Two 95% intervals:

- **Wilson's**;
- a **page bootstrap**: 10,000 resamples with replacement of the 36 test pages (every one, also those with no decided
  finding), `random.Random(20261029)`, the precision of each resample (a resample with no decided finding is skipped
  and counted), the 2.5th and 97.5th percentiles.

**The reading, from the article (section 5.5), fixed now:**

- **favourable** when the precision is at least 0.90 and the lower bound of Wilson's interval is at least 0.80;
- **inconclusive** when Wilson's lower bound is under 0.80, whatever the precision;
- **under the target** when the precision is under 0.90 and Wilson's lower bound is at least 0.80: the article's
  conclusion is then that "a camada de julgamento amplia o que se encontra, mas exige revisão humana antes de bloquear a
  integração".

The page bootstrap is reported beside it. **DECISION**: whether "favourable" also needs the bootstrap's lower bound at
0.80 or more, as the fifth study's reading needed both intervals (section 9, item 3).

**Size.** The article sizes the round for at least 70 decided findings on the test half. At the fifth study's rates,
36 test pages give a median of 72 (test half's rate, 2.0 a page; chance of 70 or more 0.58) to 93 (both halves', 2.6 a
page; 0.88), by a bootstrap of its pages (`scripts/estimate.py`); P1 removes generic 2.4.4 findings and P2 adds
repeated 1.1.1 ones. **DECISION**: what happens below 70 (section 9, item 4). The count is reported either way.

**Labels used.** The judges' final labels, unless the agreement between the author's labels and the judges' is under
the article's kappa of 0.61, in which case the count uses the human labels only (the article, section 5.4). Which
human labels that is depends on section 9, item 6: with the proposed labelling of this round's test findings, the
human-only count covers every item of the primary measure; with the rounds 3 to 5 sample alone, it cannot be computed
for this round, and the result is then reported as the judges' with the agreement measured on rounds 3 to 5 beside
it. A sensitivity with the human label wherever one exists is reported either way.

## 5. Other measures

1. **What axe-core does not report (P1 on real pages).** Of the true default-threshold judged findings on the test
   half, the share that axe-core, on the same snapshot, does not report on the same element (snapshot reference) and
   criterion, with Wilson's interval; also on any criterion; and the number of criteria with at least one true finding
   (the article's coverage), as in [notes-added-over-axe](../../docs/studies/notes-added-over-axe.md).
2. **The ablations (P3)**, each against the main run on the same pages, per half and pooled, with every changed claim's
   label: precision with verification off (the article expects a fall), with the judgment layer off (the rule
   findings at the default threshold that remain, and the true judged findings that are lost), with the swapped model
   (its own default-threshold findings on the test half, labelled), with the second pass off, and with and without P1
   and P2. Each difference with Newcombe's interval (method 10) and a page-bootstrap interval of the paired difference
   (the same 36 pages resampled for both conditions); **went up** or **went down** only when both lie on one side of 0,
   otherwise **no measurable change**. Recall is not measured on real pages (no audit): what an ablation costs is
   counted as true findings lost or gained.
3. **Five uncached runs (P3).** The share of judged candidates whose verdict (fail, pass, cannot tell, or discarded;
   for a 1.1.1 claim, also the second pass's outcome) is the same in all five runs, with Wilson's interval, per mode,
   model and criterion; a candidate judged in one run and not another (the time limit) counts as differing. The
   article's target: at least 0.95. Also the share of default-threshold findings present in all five runs.
4. **Time and cost (P4).** Per page and mode: median and 90th percentile of the time (the collection's time plus the
   judgment's, from the logs and `--timings`), model calls, input and output tokens, and US dollars for a hosted model
   at the price table Rampa ships (`rampa models`, prices of 2026-10-07). The article's target: a median of at most 2
   minutes a page in fast mode, and no external cost with the local model.
5. **The fifth study's secondary measures, kept**: per group (6 or more findings of one claim on one page, one unit),
   always next to per element; per page (the share of pages whose decided findings are all true, the mean page
   precision); the dev half, both halves and every finding; per criterion; per block (exploratory); the suggestion
   sample (the fifth study's rule, 20 a split per block); bursts (below); sensitivity (each half without its page with
   the most findings; uncertain as true and as false); experimental rules; the comparison with the fifth study's test
   half (20 of 24) and both halves (51 of 63), with its two-interval reading.
6. **Agreement.** Cohen's kappa between the two judges, between the author and the judges' final labels, and between
   the two humans, over the three labels, with observed agreement. The article's floor of 0.61 applies to the judged
   criteria (the primary measure's family: findings, the ablations' claims and suggestions of the eight criteria);
   kappa over the experimental rules, which was 0.10 in the fifth study, is reported, not tested (**DECISION**, section
   9, item 7).

**Bursts.** Every page with 6 or more default-threshold findings of one claim, and every page with 6 or more
suggestions or ablation findings of one claim, listed with its size and labels; its mechanism described from the dev
half only, the test half's counted.

## 6. Rules fixed now

- **Network drops.** An attempt that fails with a network error (`net::ERR_*`, a DNS failure), or whose log shows one,
  does not count; it is tried again once the connection answers, up to three more times.
- **Refusals.** A bot challenge, an HTTP 403, 429 or 503 page, a rate-limit or sign-in page, or a crash that saves no
  snapshot: wait at least 10 minutes and try once more. Refused again, the page is replaced by its slot's next backup
  that passed the screen (section 2), keeping the slot's block and split; for an inner slot, the backup site's inner
  page is picked by the slot's rule before Rampa runs on it. Every attempt is logged and set aside.
- **An unstyled capture is not a refusal**: the page stays and is reported.
- **Once.** Each page is collected and judged once in the main run; nothing is collected or judged again because of
  what Rampa found. `src/` does not change. A script is changed after the pre-registration only to fix a bug that stops
  it, and the change is logged. Analysis scripts are adapted from the fifth study's and committed before the first
  label file.
- **Reading.** The test half's false positives are counted by check and cause, never read for patterns, except by the
  human labellers, who label them blind (section 9, item 6). The test numbers are reported once, after all three
  blocks are labelled. Every number is named for what it is: held-out, exploratory, or in-sample.
- **Exclusions are not rebuilt.** This study's own files now name every candidate, so a rebuild of
  `data/excluded-domains.json` would exclude them all. Before the pre-registration is committed, the chosen domains are
  checked only against what other branches added since `0bada65` (`git diff 0bada65 <branch>` and the commit messages,
  on every branch whose tip moved). Done once for this draft, on 2026-10-29 at about 02:00: the lines added and the
  commit messages on `main` (`a82558e`), `fix/precision-p1p2` (`8da6c7f`), `study/human-review` (`896699d`),
  `fix/word-tokens` (`a4788b6`) and `fix/precision-p3p4` (`a82558e`) name 218 registrable domains, none of the 72.

## 7. Targets of the article (Quadro 3), and where each is measured here

| Question | Target | Measured by |
| --- | --- | --- |
| P1, real pages | true findings on test pages that axe-core does not report | section 5, item 1 (the ACT part is the benchmark's T1, outside this study) |
| P2 | precision of at least 0.90 at the default threshold; inconclusive when the lower bound is under 0.80 | section 4 |
| P3 | at least 95% identical verdicts in five runs; precision falls when verification is off | section 5, items 2 and 3 |
| P4 | median of at most 2 minutes a page in fast mode; no external cost with the local model | section 5, item 4 |
| Labels | kappa of at least 0.61; human labels only below it | sections 4 and 5, item 6 |

## 8. Run time on this PC (estimate)

From the fifth study's logs (`scripts/estimate.py`, `data/estimate.json`): on the RTX 5060 Ti (16 GB) with Gemma 4 12B
on Ollama at `--concurrency 2`, collecting a page took 12 to 47 s (median 28, 90th percentile 38) and judging its
snapshot 17 to 322 s (median 145, 90th percentile 245; mean 155), with 13 to 152 model calls (mean 77) and a mean of
68,400 input and 6,900 output tokens. Replays took about a second. `--fast` took 0.39 of the full time and 0.33 of the
calls on three pages ([docs/performance.md](../../docs/performance.md)); Ministral 3 14B took 1.32 times Gemma's wall
time on the same evaluation ([docs/models.md](../../docs/models.md)). The estimates scale those means; a long page or
a slow site moves them.

| Step | Pages | Hours | Notes |
| --- | ---: | ---: | --- |
| Collection (network, no model) | 72 | 0.6 | about 11 minutes a block, plus any 10-minute refusal waits |
| Main judgment, Gemma 4 12B | 72 | 3.1 | about 1 hour a block |
| Ablations by replay: `--no-verify`, `--no-llm`, `--no-confirm`, P1 and P2 | 72 | 0.2 | no model call |
| Model swap, local Ministral 3 14B | 72 | 4.1 | or hosted `gpt-6-luna`: about the same time as Gemma's (below), about US$1.20 |
| T4 on all 72 pages: 4 more uncached full runs | 72 | 12.4 | 15.5 if the main run is not the first of the five |
| T4 on all 72 pages: a live `--fast` collection and 5 uncached `--fast` judgments | 72 | 6.5 | |
| T4 on the 12-page subset: 4 more full runs, a `--fast` collection, 5 `--fast` judgments | 12 | 3.1 | |
| T4 hosted, `gpt-6-luna`, full and fast, 5 runs each | 72 or 12 | provider | about US$8.35 for 72 pages, US$1.39 for 12 (measured rate; the token-count range was US$4.93–11.52 and US$0.82–1.92) |
| T4 on the ACT cases (the article's T1 material, outside this study): 5 runs, full and fast | 343 cases | 2.2 | |

- **Model time in all**: about **26 hours** with T4 on all 72 pages (3.1 + 0.2 + 4.1 + 12.4 + 6.5), about **10.5
  hours** with the 12-page subset; plus 0.6 hours of collection and, if run, 2.2 hours of T4 on the ACT cases. Five
  uncached runs of all 72 pages in both modes are about 19 GPU hours on their own.
- **Hosted cost and time.** First estimated from the fifth study's token counts at `gpt-6-luna`'s listed price (US$0.10
  and US$0.50 a million input and output tokens), with output tokens counted once to five times (its default medium
  reasoning writes more): US$0.010–0.024 a page in full mode and US$0.003–0.008 in fast mode (`data/estimate.json`).
  Then measured: the user's one approved hosted test of 2026-10-29 (`.rampa/openai-test-2026-10-29/`, outside git)
  judged three of the fifth study's dev snapshots with `gpt-6-luna` at the study's flags. In full mode, 47 to 93
  calls, 53,000 to 101,000 input and 9,400 to 26,800 output tokens, US$0.010 to 0.024 a page (mean US$0.017), 92 to
  271 s; in fast mode, 19 to 23 calls, US$0.006 to 0.008 (mean US$0.0065), 61 to 72 s. Gemma 4 12B took 109 to 246 s
  on the same snapshots in the fifth study. The table's hosted costs use those measured means; three pages make it a
  rough rate.
- **Judge agents**: **144** (an auditor and a skeptic for each of the 72 packets), in three sessions of 48 if each
  block is labelled when it is judged. The fifth study's 48 agents took 30 minutes at up to 8 at once for 358 items
  (15 a page); here a packet would hold about 27 items if every `--no-verify` extra is labelled (about 1,960 items in
  all, before the model swap's), so about 2 to 2.5 hours at 8 at once, or 4 to 5 hours at 4 at once. With a seeded
  sample of the `--no-verify` extras instead, about 1,200 items.
- **Human time**: the author's 100 or so labels and the second person's 30, not estimated here.

## 9. Conflicts with the article, and open decisions

Each item says what the article says, what the studies do or the code allows, what this draft does for now, and what
the user has to decide. None of them is settled by this draft alone.

1. **`--no-verify` does not exist on `rampa check`.** The article's T3 disables "a verificação de evidência"; only
   `rampa eval` has `--no-verify` (section 1). *Draft:* the flag is a precondition of the freeze. Also, in the code,
   `verify: false` turns off three things at once (the quote check, the grounding facts that make ungrounded fails
   suggestions, and the unstyled-page guard), so the ablation measures them together; isolating the quote check alone
   would need another switch. *Decide:* add the flag (or a study script), and whether one combined ablation is what the
   article means.
2. **What the primary measure counts.** The article: "precisão por elemento no limiar padrão, ou seja, sobre os achados
   que a ferramenta exibe e que podem bloquear a integração". The report also shows axe-core's findings and any
   non-experimental rule findings, which the studies have never labelled (599 engine findings in the fifth study). The
   studies' primary measure, kept here, is the judgment layer's findings of the eight default criteria. *Decide:* word
   the article's P2 as the judgment layer's findings, or add axe-core's findings to the labels (several hundred items
   more).
3. **Which interval decides "inconclusive".** The article: inconclusive "quando o limite inferior do intervalo da
   precisão ficar abaixo de 0,80", with both Wilson's interval and a page bootstrap computed; its size argument (70
   findings put Wilson's lower bound above 0.80 at 0.90) is Wilson's. The fifth study made the page bootstrap
   co-primary and needed both intervals. Findings cluster on pages (design effect 1.94 in the fifth study), so at an
   observed 0.90 with 70 findings Wilson's lower bound is 0.81 but a page-level one is about 0.76 (`data/estimate.json`,
   `lowerBounds`): the two readings would disagree in exactly the case the article sized for. *Draft:* Wilson's
   decides, the bootstrap is reported. *Decide:* keep that, or require both (a page-level bound of 0.80 then needs
   about 90 decided test findings at an observed 0.92, and more than 100 at 0.90).
4. **The 70 decided test findings may not come.** At the fifth study's test-half rate (2.0 a page) the chance of 70 or
   more on 36 pages is about 0.58; at its pooled rate (2.6), 0.88; P1 removes generic 2.4.4 findings. The article sizes
   the sample but says nothing for a shortfall. *Draft:* report the count and the interval as they come. *Decide:*
   keep that, or pre-register now one more block of 24 (backups left in the same pools, about 1.3 hours of
   collection and main judgment, more with the swap, and 48 more judge agents) to be added only if the test half has
   fewer than 70, a rule that depends on a count, not on precision.
5. **Test half or pooled.** The notes after round 5 (section 4) proposed the primary measure on the pooled 72 pages;
   the article puts it on the 36 test pages. *Draft:* the article's; pooled is a secondary measure. Nothing to decide
   unless the pooled reading is wanted as primary.
6. **Where the human sample is.** (a) The article's T2 places "uma amostra cega e estratificada de cerca de 100
   achados", labelled by the author, and 30 by a second person, in the final round's labelling. The project is drawing
   that sample from rounds 3 to 5 instead (`docs/studies/human-review-plan.md`, merged in `a82558e`), as the notes
   after round 5 asked, before round 6. Either the article should say the sample comes from the preliminary rounds, or
   this round needs a human sample of its own. (b) The article's fallback, "se for insuficiente, a contagem final
   passa a usar apenas rótulos humanos", can only be computed on this round's primary measure if a human labels this
   round's test findings; a sample from rounds 3 to 5 cannot replace them. *Draft:* the author also labels, blind,
   every default-threshold judged finding of this round's test half (about 70 to 95). (c) The author labelling test
   findings reads the test half's false positives, which the article says are "contados, mas não examinados". It is
   harmless only because this is the final round, after which no tuning is measured on these pages; the article should
   say so. (d) Who the second person is, and when, is the human-review plan's question. *Decide:* (a) the article's
   wording, (b) whether this round gets its own human labels, and (c)'s wording.
7. **The kappa floor's scope.** The article: kappa under 0.61 is insufficient. In the fifth study the two judges'
   kappa was 0.82 on the judged criteria and 0.41 overall, pulled down by one experimental rule (`rampa/widget-name`,
   0.10 on the experimental rules). *Draft:* the floor applies to the judged criteria; all other kappas are reported.
   *Decide:* that scope.
8. **Five uncached runs: subset or all.** The article's T4 runs "sobre os mesmos casos e páginas" with data
   "Subconjunto de T1 e T2"; the request for this draft says five uncached runs. All 72 pages in both modes are about 19
   GPU hours beyond the main run (section 8); a seeded 12-page subset, one page per stratum, about 3.1. *Draft:* the
   subset. Also open: (a) whether the main run counts as the first of the five (it is uncached already; it saves 3.1
   hours on 72 pages); (b) the concurrency: the studies judge at `--concurrency 2`, the CLI's default is 4, and side by
   side calls are one source of run-to-run change ([docs/performance.md](../../docs/performance.md)); *draft:* 2
   everywhere, so the runs compare with the main run, and P4's times are then at 2; (c) fast mode needs one more live
   load of each T4 page, because `--fast` changes the collection, and P4's per-page time in fast mode is that
   collection's time plus a judgment's. *Decide:* subset or all, (a) and (b).
9. **The hosted model.** The article compares cost with a hosted model in T4 (and, read with 5.3, repeats "parte da
   execução" with one). That needs the user's API key and approval for paid use, which the instructions for this draft
   rule out and which the user has given once, for one test, on 2026-10-29. At that test's measured rate (section 8):
   about US$1.40 for the 12-page T4 subset or US$8.35 for all 72, plus about US$1.20 if it is also the model swap.
   *Draft:* hosted runs are conditional. *Decide:* approve or drop; if dropped, the article's P4 hosted cost is
   reported from the 2026-10-29 test only (three pages of the fifth study, not this round's).
10. **The model swap.** The article does not name the second model. *Draft:* the hosted `gpt-6-luna` if approved (one
    run then serves T3 and the hosted half of T4), else the local `ministral-3:14b` (about 4.1 hours). Either way its
    findings that the main run lacks must be labelled, which adds judge work; and it must not be a Claude model. *Decide:*
    which.
11. **"Variação de precisão e revocação" in T3.** On real pages recall is not measured (no audit; the article's 5.6
    says so), so an ablation's effect on recall can only be counted as true findings lost or gained. The notes proposed
    an expert recall audit of 6 pages; the article judges an audit beyond the study's means. *Draft:* counts only.
    *Decide:* whether the article's T3 should say "no conjunto de casos de teste" for recall.
12. **Two extra ablations.** The fifth study's `--no-confirm` and the replays of P1 and P2 are not in the article; they
    are kept as secondary measures, because P1 and P2 were chosen on the fifth study's dev half and this is their first
    held-out measure. Nothing to decide unless the user wants the round limited to the article's list.

## 10. Before this becomes the pre-registration

1. Decide on P3 and P4 (merged or not), add `--no-verify` to `rampa check`, and freeze `main` at a commit (P1 and P2
   are in since `a82558e`); fill section 1's commit and thresholds from it.
2. Take the decisions of section 9 and write them into sections 3 to 5.
3. Check the chosen domains again against what other branches added since `0bada65` (section 6).
4. Adapt the fifth study's `collect.sh`, `run-judged.sh` and `run-noconfirm.sh` (with `--wcag 2.1`, `--timings` and the
   block), and write `run-noverify.sh`, `run-nollm.sh`, `run-swap.sh`, the P2 replay and the T4 scripts; adapt
   `packets.py`. Run them from a folder short enough for the SBPT article's recording (section 2), or enable long
   paths.
5. If the pages wait long before collection, look at them once more in the screen only (a page gone or walled since
   is replaced by the rules of section 6), and log it.
6. Rename this file `preregistration.md`, remove "DRAFT", and commit it with the scripts before the first collection.

## Data and scripts so far

All under `study/round-6-2026-10-29/`, run from the repository root. Nothing here runs Rampa.

- `scripts/exclusions.py <public_suffix_list.dat> build|check <tsv>...` and `data/excluded-domains.json`;
- `scripts/pools.tsv`, `scripts/deal.py <public_suffix_list.dat>` and `scripts/candidates.tsv` (committed in `b4c77c5`
  before the screen);
- `scripts/screen.mjs <tsv> <raw.json>`, `scripts/redact.py <psl> <raw.json> <kept.json>` and `data/screen-1.json` to
  `screen-5.json` (redacted; the raw files stay outside git), from `scripts/candidates.tsv`,
  `candidates-retry.tsv`, `candidates-inner.tsv`, `candidates-inner-retry.tsv` and `candidates-inner-2.tsv`;
  `scripts/screen_pass.py <psl> <screen.json>...` applies the screen's rules slot by slot;
- `scripts/links.mjs <url>` and `scripts/pick.py <psl> <rule> <site> <listing>` for the inner pages (the listings stay
  outside git);
- `scripts/selection.tsv`, `scripts/build_pages.py` and `scripts/pages.tsv`;
- `scripts/split.py` and `data/pages-input.json` (the split, its coins and the proposed T4 subset);
- `scripts/estimate.py` and `data/estimate.json` (section 8; from the fifth study's committed data).
