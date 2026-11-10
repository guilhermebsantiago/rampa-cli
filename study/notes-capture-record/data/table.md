# Capture records of the 48 dev pages, from an offline replay

Reports of the build before the record (`before`) and after it (`after`), replayed offline by replay.sh. Counted, in-sample (dev): the 12 dev pages of each of the second to fifth real-page studies. A record says what the collector noticed, not that the capture equals what people see.

## The comparison

Pages compared: 48 of 48; missing reports: 0. Differences once `capture`, `createdAt` and `rampaVersion` are removed: 0.

The record against the rest of the same report: `images.notCaptured` against the count in the note on images left without a capture (26 pages have the note), and each `notJudged` count against the criterion's summary. Mismatches: 0.

## Per study

| Study | Pages | Not styled | Stylesheets recorded | Overlay | Blocked | HTTP error | Cut | Unsettled | Load timed out | With `images` | Images captured | Pages with images not captured | Images not captured | By reason | Pages with candidates not judged |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| s2 | 12 | 0 | 0 | 0 | 0 | 0 | 1 | 5 | 0 | 12 | 215 | 8 | 420 | outside-page 7, clipped 1, not-shown 13, not-loaded 1, limit 398 | 0 |
| s3 | 12 | 0 | 0 | 0 | 0 | 0 | 1 | 4 | 0 | 12 | 196 | 8 | 336 | outside-page 13, clipped 1, not-shown 1, not-loaded 1, blank 1, capture-failed 9, limit 310 | 9 |
| s4 | 12 | 0 | 1 | 2 | 0 | 0 | 1 | 1 | 0 | 11 | 131 | 5 | 121 | outside-page 19, not-shown 4, limit 98 | 7 |
| s5 | 12 | 0 | 1 | 0 | 0 | 0 | 2 | 5 | 0 | 12 | 166 | 5 | 140 | outside-page 3, clipped 1, not-loaded 12, blank 1, limit 123 | 8 |
| **All four** | 48 | 0 | 2 | 2 | 0 | 0 | 5 | 15 | 0 | 47 | 708 | 26 | 1017 | outside-page 42, clipped 3, not-shown 18, not-loaded 14, blank 2, capture-failed 9, limit 929 | 24 |

## Candidates not judged, per criterion (all four studies)

| Criterion | Pages | Candidates on those pages | Capped | Timed out | Offline misses | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2.4.4 | 24 | 3634 | 2434 | 0 | 0 | 0 |
| 2.4.6 | 3 | 376 | 226 | 0 | 0 | 0 |

## Per page

| Study | Page | Styled | Overlay | Cut | Images captured | Not captured (by reason) | Not judged | Other fields |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| s2 | ce-gov-br | yes | — | — | 24 | 7 (clipped 1, limit 6) | — | — |
| s2 | unicamp-br | yes | — | — | 25 | 29 (limit 29) | — | — |
| s2 | poder360-com-br | yes | — | — | 14 | 97 (outside-page 5, not-shown 8, limit 84) | — | unsettled after 3000 ms |
| s2 | martinsfontes-literatura | yes | — | 5000 | 1 | 0 | — | unsettled after 3000 ms |
| s2 | fiocruz-br | yes | — | — | 25 | 8 (limit 8) | — | — |
| s2 | pinacoteca-org-br | yes | — | — | 24 | 152 (not-loaded 1, limit 151) | — | unsettled after 3000 ms |
| s2 | ons-gov-uk | yes | — | — | 13 | 0 | — | — |
| s2 | berkeley-edu-admissions | yes | — | — | 10 | 0 | — | — |
| s2 | propublica-org-article | yes | — | — | 18 | 37 (outside-page 2, not-shown 5, limit 30) | — | unsettled after 3000 ms |
| s2 | ikea-com-tables-chairs | yes | — | — | 25 | 69 (limit 69) | — | unsettled after 3000 ms |
| s2 | medlineplus-gov-diabetes | yes | — | — | 25 | 21 (limit 21) | — | — |
| s2 | rijksmuseum-nl-newsletter | yes | — | — | 11 | 0 | — | — |
| s3 | cnj-ouvidoria | yes | — | — | 12 | 0 | 2.4.4 (capped 15 of 65) | — |
| s3 | puc-rio-vestibular | yes | — | — | 19 | 1 (clipped 1) | — | — |
| s3 | metropoles-com | yes | — | — | 25 | 127 (outside-page 1, not-loaded 1, limit 125) | 2.4.4 (capped 364 of 414); 2.4.6 (capped 111 of 161) | unsettled after 3000 ms |
| s3 | travessa-com-br | yes | — | — | 19 | 132 (outside-page 6, limit 126) | 2.4.4 (capped 51 of 101) | — |
| s3 | hcor-com-br | yes | — | — | 22 | 16 (outside-page 3, limit 13) | 2.4.4 (capped 28 of 78) | unsettled after 3000 ms |
| s3 | museudoipiranga | yes | — | — | 16 | 29 (outside-page 1, capture-failed 9, limit 19) | — | — |
| s3 | canada-ca | yes | — | — | 6 | 0 | 2.4.4 (capped 12 of 62) | unsettled after 3000 ms |
| s3 | kcl-undergraduate | yes | — | — | 9 | 0 | 2.4.4 (capped 8 of 58) | — |
| s3 | pbs-article | yes | — | — | 13 | 2 (outside-page 2) | 2.4.4 (capped 46 of 96) | — |
| s3 | halfords-motoring | yes | — | 5000 | 25 | 20 (limit 20) | 2.4.4 (capped 67 of 117) | — |
| s3 | clevelandclinic | yes | — | — | 23 | 9 (not-shown 1, blank 1, limit 7) | 2.4.4 (capped 33 of 83) | unsettled after 3000 ms |
| s3 | tate-contact | yes | — | — | 7 | 0 | — | — |
| s4 | es-gov-br | yes | — | — | 5 | 0 | — | stylesheets: 1 of 18 failed |
| s4 | mackenzie-vestibular | yes | — | 5000 | — | — | — | — |
| s4 | infomoney-article | yes | — | — | 8 | 4 (outside-page 4) | 2.4.4 (capped 68 of 118) | — |
| s4 | cobasi-cachorro | yes | — | — | 25 | 20 (limit 20) | 2.4.4 (capped 104 of 154) | — |
| s4 | hospitalmoinhos | yes | — | — | 10 | 32 (outside-page 15, not-shown 1, limit 16) | — | unsettled after 3000 ms |
| s4 | osesp-contato | yes | — | — | 4 | 0 | — | — |
| s4 | gov-scot | yes | — | — | 18 | 0 | 2.4.4 (capped 13 of 63); 2.4.6 (capped 10 of 60) | — |
| s4 | leeds-undergraduate | yes | — | — | 13 | 0 | 2.4.4 (capped 26 of 76) | — |
| s4 | conversation | yes | — | — | 6 | 0 | 2.4.4 (capped 5 of 55) | — |
| s4 | toolstation-plumbing | yes | div (89%, hidden) | — | 25 | 62 (limit 62) | 2.4.4 (capped 427 of 477) | — |
| s4 | bhf-article | yes | div (89%, hidden) | — | 15 | 3 (not-shown 3) | 2.4.4 (capped 10 of 60) | — |
| s4 | nls-contact | yes | — | — | 2 | 0 | — | — |
| s5 | ms-gov-br | yes | — | — | 8 | 1 (blank 1) | 2.4.4 (capped 3 of 53) | — |
| s5 | pucrs-graduacao | yes | — | — | 25 | 56 (limit 56) | 2.4.4 (capped 261 of 311); 2.4.6 (capped 105 of 155) | — |
| s5 | correio24horas | yes | — | — | 25 | 27 (limit 27) | 2.4.4 (capped 15 of 65) | unsettled after 3000 ms |
| s5 | hering | yes | — | — | 24 | 0 | 2.4.4 (capped 28 of 78) | — |
| s5 | santacasasp | yes | — | — | 10 | 52 (outside-page 3, clipped 1, not-loaded 12, limit 36) | — | stylesheets: 1 of 34 failed; unsettled after 3000 ms |
| s5 | museu-lingua | yes | — | — | 8 | 0 | 2.4.4 (capped 16 of 66) | — |
| s5 | food-ratings | yes | — | — | 1 | 0 | — | — |
| s5 | ncl-ac-uk | yes | — | 5000 | 1 | 0 | — | — |
| s5 | irishcentral-article | yes | — | 5000 | 1 | 0 | — | unsettled after 3000 ms |
| s5 | lakeland | yes | — | — | 19 | 0 | 2.4.4 (capped 793 of 843) | unsettled after 3000 ms |
| s5 | patient-article | yes | — | — | 25 | 4 (limit 4) | 2.4.4 (capped 34 of 84) | unsettled after 3000 ms |
| s5 | horniman | yes | — | — | 19 | 0 | 2.4.4 (capped 7 of 57) | — |
