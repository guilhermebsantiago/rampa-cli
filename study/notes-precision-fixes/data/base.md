## base: every default-threshold judgment finding, in-sample

| study | half | per element TP / FP / unc. | precision per element | page bootstrap | units after collapse TP / FP | precision per group | pages with a decided finding | all right | mean page precision | new, unlabelled |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | ---: |
| s2 | dev | 19 / 0 / 2 | 1.00 (0.83–1.00) | 1.00–1.00 | 19 / 0 | 1.00 (0.83–1.00) | 8 | 8 | 1.00 | 0 |
| s2 | test | 10 / 3 / 0 | 0.77 (0.50–0.92) | 0.14–1.00 | 10 / 3 | 0.77 (0.50–0.92) | 5 | 3 | 0.60 | 0 |
| s2 | both | 29 / 3 / 2 | 0.91 (0.76–0.97) | 0.72–1.00 | 29 / 3 | 0.91 (0.76–0.97) | 13 | 11 | 0.85 | 0 |
| s3 | dev | 15 / 3 / 1 | 0.83 (0.61–0.94) | 0.67–0.95 | 15 / 3 | 0.83 (0.61–0.94) | 7 | 4 | 0.79 | 0 |
| s3 | test | 24 / 57 / 2 | 0.30 (0.21–0.40) | 0.07–0.84 | 12 / 6 | 0.67 (0.44–0.84) | 10 | 4 | 0.69 | 0 |
| s3 | both | 39 / 60 / 3 | 0.39 (0.30–0.49) | 0.15–0.85 | 27 / 9 | 0.75 (0.59–0.86) | 17 | 8 | 0.73 | 0 |
| s4 | dev | 13 / 54 / 2 | 0.19 (0.12–0.30) | 0.02–0.87 | 6 / 5 | 0.55 (0.28–0.79) | 6 | 2 | 0.58 | 0 |
| s4 | test | 14 / 12 / 0 | 0.54 (0.35–0.71) | 0.12–0.91 | 7 / 5 | 0.58 (0.32–0.81) | 8 | 3 | 0.50 | 0 |
| s4 | both | 27 / 66 / 2 | 0.29 (0.21–0.39) | 0.08–0.82 | 13 / 10 | 0.57 (0.37–0.74) | 14 | 5 | 0.53 | 0 |
| **all** | dev | 47 / 57 / 5 | 0.45 (0.36–0.55) | 0.19–0.93 | 40 / 8 | 0.83 (0.70–0.91) | 21 | 14 | 0.81 | 0 |
| **all** | test | 48 / 72 / 2 | 0.40 (0.32–0.49) | 0.16–0.81 | 29 / 14 | 0.67 (0.53–0.80) | 23 | 10 | 0.60 | 0 |
| **all** | both | 95 / 129 / 7 | 0.42 (0.36–0.49) | 0.23–0.82 | 69 / 22 | 0.76 (0.66–0.83) | 44 | 24 | 0.70 | 0 |

Collapsed groups (more than 5 findings of one claim on one page):
- s3 test correio 1.1.1 functional-link: 6 findings, 6 TP / 0 FP -> one true_positive
- s3 test correio 2.4.4 ambiguous: 6 findings, 3 TP / 2 FP -> one true_positive (mixed)
- s3 test ed-ac-uk 1.1.1 functional-link: 6 findings, 6 TP / 0 FP -> one true_positive
- s3 test ufpe-br 2.4.4 ambiguous: 50 findings, 0 TP / 50 FP -> one false_positive
- s4 dev conversation 3.1.2 judgment: 8 findings, 8 TP / 0 FP -> one true_positive
- s4 test museudoamanha 3.1.2 judgment: 8 findings, 0 TP / 8 FP -> one false_positive
- s4 dev toolstation-plumbing 2.4.4 ambiguous: 50 findings, 0 TP / 50 FP -> one false_positive
- s4 test tst-ouvidoria 2.4.4 ambiguous: 8 findings, 8 TP / 0 FP -> one true_positive

Per page (decided findings): s2/ce-gov-br 1/0, s2/fiocruz-br 2/0, s2/fuvest-br-vestibular 5/0, s2/martinsfontes-literatura 1/0, s2/pinacoteca-org-br 4/0, s2/poder360-com-br 5/0, s2/propublica-org-article 2/0, s2/rijksmuseum-nl-newsletter 3/0, s2/senado-leg-br-falecomosenado 1/0, s2/tcd-ie 0/1, s2/thomann-co-uk 0/2, s2/tuasaude-com-dengue 4/0, s2/unicamp-br 1/0, s3/clevelandclinic 3/1, s3/cnj-ouvidoria 3/0, s3/correio 9/3, s3/cruk-all 1/0, s3/ed-ac-uk 6/1, s3/fleury-article 1/1, s3/halfords-motoring 1/0, s3/irishtimes-com 1/0, s3/itaucultural-contato 1/0, s3/kalunga-apresentacao 2/0, s3/mg-gov-br 0/1, s3/museudoipiranga 3/0, s3/pbs-article 3/1, s3/pimoroni 3/1, s3/puc-rio-vestibular 0/1, s3/travessa-com-br 2/0, s3/ufpe-br 0/50, s4/cobasi-cachorro 1/0, s4/conversation 8/1, s4/es-gov-br 1/0, s4/fueleconomy-findacar 0/1, s4/gla-ac-uk 0/1, s4/infomoney-article 0/1, s4/mdanderson 1/1, s4/museudoamanha 0/8, s4/nhm-ac-uk 3/0, s4/osesp-contato 3/2, s4/r7-com 1/0, s4/toolstation-plumbing 0/50, s4/tst-ouvidoria 8/0, s4/ufpr-br 1/1

By criterion (TP / FP / unc. / new): 1.1.1 40/12/3/0, 1.3.5 24/0/0/0, 2.4.4 21/108/4/0, 3.1.1 1/0/0/0, 3.1.2 9/8/0/0, 3.3.2 0/1/0/0

