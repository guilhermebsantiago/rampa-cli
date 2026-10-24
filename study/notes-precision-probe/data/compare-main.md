# Today's main (15b1149) on the third study's snapshots

24 reports; 143 judgment findings today, 149 labelled in the study.

## The study's labelled judgment findings today

| criterion | label | fate | count |
| --- | --- | --- | ---: |
| 1.1.1 | false_positive | gone | 7 |
| 1.1.1 | false_positive | moved threshold | 6 |
| 1.1.1 | false_positive | same | 31 |
| 1.1.1 | true_positive | claim changed | 2 |
| 1.1.1 | true_positive | gone | 1 |
| 1.1.1 | true_positive | same | 22 |
| 1.1.1 | uncertain | gone | 1 |
| 1.1.1 | uncertain | same | 1 |
| 1.3.5 | true_positive | same | 8 |
| 2.4.2 | false_positive | moved threshold | 1 |
| 2.4.4 | false_positive | same | 55 |
| 2.4.4 | true_positive | same | 7 |
| 2.4.4 | uncertain | same | 3 |
| 2.4.6 | false_positive | same | 2 |
| 3.1.2 | uncertain | moved threshold | 1 |
| 3.3.2 | false_positive | same | 1 |

## New findings today (no label in the study)

| split | criterion | shown | count |
| --- | --- | --- | ---: |
| test | 1.1.1 | True | 3 |
- test mg-gov-br 1.1.1: The text alternative "Serviço Detran" describes something the image does not show.
- test mg-gov-br 1.1.1: The text alternative "Serviço Detran" describes something the image does not show.
- test pimoroni 1.1.1: The text alternative "Raspberry Pi 5 - Up to 16GB of RAM." describes something the image does not show.

## Precision today with the study's labels (matched findings only; new findings unlabelled)

| split | criterion | TP | FP | unc | new (unlabelled) | precision on labelled |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| dev | 1.1.1 | 6 | 17 | 0 | 0 | 0.26 (0.13–0.46) |
| dev | 1.3.5 | 7 | 0 | 0 | 0 | 1.00 (0.65–1.00) |
| dev | 2.4.2 | 0 | 1 | 0 | 0 | 0.00 (0.00–0.79) |
| dev | 2.4.4 | 2 | 1 | 1 | 0 | 0.67 (0.21–0.94) |
| dev | **all** | 15 | 19 | 1 | 0 | 0.44 (0.29–0.61) (study: 0.43 (0.29–0.59)) |
| test | 1.1.1 | 18 | 20 | 1 | 3 | 0.47 (0.32–0.63) |
| test | 1.3.5 | 1 | 0 | 0 | 0 | 1.00 (0.21–1.00) |
| test | 2.4.4 | 5 | 54 | 2 | 0 | 0.08 (0.04–0.18) |
| test | 2.4.6 | 0 | 2 | 0 | 0 | 0.00 (0.00–0.66) |
| test | 3.1.2 | 0 | 0 | 1 | 0 | – |
| test | 3.3.2 | 0 | 1 | 0 | 0 | 0.00 (0.00–0.79) |
| test | **all** | 24 | 77 | 4 | 3 | 0.24 (0.17–0.33) (study: 0.24 (0.17–0.34)) |

## Suggestions (needsReview from the model) per split and criterion

- dev 2.4.4: 44
- dev 2.4.6: 21
- test 2.4.4: 35
- test 2.4.6: 11

## Claims verification discarded today, by reason

- 2.4.4: 22 · no other link with this text leads elsewhere from the same context
- 1.1.1: 16 · the alternative names the purpose of the link it is the only content of
- 2.4.6: 15 · evidence too short to be a quote
- 2.4.4: 11 · evidence is not the link text
- 1.1.1: 8 · the suggested alternative keeps every word of the current one
- 1.1.1: 5 · the model's description of the image keeps every word of the current alternative
- 1.1.1: 5 · the alternative repeats the visible text of the link or button it sits in
- 2.4.4: 4 · mismatch without a known destination
- 1.1.1: 3 · the suggested alternative repeats the text around the image
- 1.1.1: 3 · the text around the image already says what it conveys
- 1.1.1: 3 · the words drawn in the image are in the text around it
- 1.1.1: 2 · evidence is not the current text alternative
- 1.1.1: 2 · suggested alternative is a label, not a description
- 1.1.1: 2 · suggested alternative only rewords the current one
- 2.4.4: 2 · suggested text equals the current one
- 1.1.1: 1 · suggested alternative equals the current one
- 2.4.6: 1 · evidence is not the heading text
- 2.4.6: 1 · suggested text equals the current one

## Labelled findings that are gone today, by page

- tr cnj-ouvidoria 1.1.1: 'Botão Rybená LIBRAS'
- fa metropoles-com 1.1.1: 'Blog do Noblat'
- fa ed-ac-uk 1.1.1: 'Research and teaching'
- fa clevelandclinic 1.1.1: 'cancer icon'
- fa clevelandclinic 1.1.1: 'stomach icon'
- fa clevelandclinic 1.1.1: 'heart icon'
- fa vam-ac-uk 1.1.1: 'Shop at V&A South Kensington'
- fa nps-findapark 1.1.1: 'Abraham Lincoln Birthplace banner image'
- un irishtimes-com 1.1.1: 'Masthead logo'
