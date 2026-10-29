# What the judged findings add over axe-core (2026-10-29)

Rampa runs axe-core first and then judges, with a model, what axe-core's rules cannot decide: whether an image's alternative says what the image does, whether a link's text says where it goes, which purpose a field has, which language a passage is in. These notes count how many of the true judged findings on real pages axe-core, run on the same snapshot, does not report. No new run: the labels and reports of the second to fifth studies, read again (`study/notes-added-over-axe/added.py`, `added.json`).

**Which findings.** Judged findings at the default threshold of the current code (`b759128`): on the second to fourth studies, the in-sample replay of the [precision fixes](notes-precision-fixes.md) (72 pages; those pages were read to choose the fixes); on the [fifth study](real-pages-2026-10-round5.md), its main run (24 pages none of the code had seen). The first study and its re-measurement are left out: their labels belong to code too old to replay. Every label comes from two Claude agents, pending human review.

**When axe-core counts as finding it too.** An axe-core finding in the same report, on the same element (the same snapshot reference), under the same criterion. A looser reading counts an axe-core finding on that element under any criterion. Element references match across the two: 9 true judged findings sit on an element axe-core also fails, under another criterion.

| Pages | True judged findings | Also failed by axe-core, same element and criterion | Same element, any criterion | Under a criterion axe-core failed nothing on, on that page |
| --- | ---: | ---: | ---: | ---: |
| Studies 2–4, in-sample (72) | 95 (16 false) | 0 | 5 | 68 |
| Study 5, held out (24) | 51 (12 false) | 0 | 4 | 22 |
| **Studies 2–5 (96)** | **146** (28 false) | **0** | 9 | 90 |

- **None of the 146 true judged findings is a failure axe-core reports.** Nine sit on an element axe-core fails for something else: color contrast (1.4.3) on five "Faça uma denúncia" and "Ir para a página" links, and a visible label missing from the accessible name (2.5.3) on four.
- **By criterion**, the 146 are 1.1.1 60, 2.4.4 40, 1.3.5 33, 3.1.2 11, 2.4.6 1 and 3.1.1 1. The 1.1.1 ones are images whose alternative exists but is a file name, a placeholder or a description of something the image does not show, which axe-core's `image-alt` passes (it reported 73 images with no alternative at all on the fifth study's pages); the 2.4.4 ones are links whose text does not say where they go, which `link-name` passes; the 1.3.5 ones are fields asking for the user's name, email, phone or postal code with no `autocomplete` purpose (missing, or `off`), which `autocomplete-valid` does not ask for.
- **90 of the 146 (36 of the 50 pages with one) are under a criterion axe-core failed nothing on that page**, so a reader of axe-core's results alone would have seen no failure under that criterion there.
- **What it costs.** On the fifth study's pages, 51 true and 12 false judged findings: about one false finding for every four true ones it adds.

**Limits.** The labels are a pre-annotation by two Claude agents of one model family; the studies 2–4 rows are in-sample; axe-core's own findings were not labelled, so this says nothing about their precision; "axe-core" is axe-core 4.14 as Rampa runs it (every frame, open shadow roots), on the snapshot Rampa judged.
