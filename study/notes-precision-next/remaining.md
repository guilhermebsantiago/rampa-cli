# Remaining labelled findings after the merged precision work (s2, s3 replayed in-sample; s4 out-of-sample)

### By study and half

| group | TP | FP | unc | precision |
| --- | ---: | ---: | ---: | --- |
| s3 test | 24 | 57 | 2 | 24 / 57: 0.30 (0.21–0.40) |
| s4 dev | 13 | 54 | 2 | 13 / 54: 0.19 (0.12–0.30) |
| s4 test | 14 | 12 | 0 | 14 / 12: 0.54 (0.35–0.71) |
| s2 test | 10 | 3 | 0 | 10 / 3: 0.77 (0.50–0.92) |
| s3 dev | 15 | 3 | 1 | 15 / 3: 0.83 (0.61–0.94) |
| s2 dev | 19 | 0 | 2 | 19 / 0: 1.00 (0.83–1.00) |

### By criterion and claim

| group | TP | FP | unc | precision |
| --- | ---: | ---: | ---: | --- |
| 2.4.4 link-ambiguous | 21 | 107 | 2 | 21 / 107: 0.16 (0.11–0.24) |
| 1.1.1 wrong_content | 5 | 9 | 1 | 5 / 9: 0.36 (0.16–0.61) |
| 3.1.2 3.1.2 | 8 | 8 | 0 | 8 / 8: 0.50 (0.28–0.72) |
| 1.1.1 functional-link | 18 | 2 | 1 | 18 / 2: 0.90 (0.70–0.97) |
| 1.1.1 other | 2 | 1 | 1 | 2 / 1: 0.67 (0.21–0.94) |
| 2.4.4 link-generic | 0 | 1 | 1 | 0 / 1: 0.00 (0.00–0.79) |
| 3.3.2 3.3.2 | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| 1.1.1 decorative | 3 | 0 | 0 | 3 / 0: 1.00 (0.44–1.00) |
| 1.1.1 generic-alt | 3 | 0 | 0 | 3 / 0: 1.00 (0.44–1.00) |
| 1.1.1 placeholder | 9 | 0 | 0 | 9 / 0: 1.00 (0.70–1.00) |
| 1.3.5 1.3.5 | 5 | 0 | 0 | 5 / 0: 1.00 (0.57–1.00) |
| 1.3.5 1.3.5:other | 19 | 0 | 0 | 19 / 0: 1.00 (0.83–1.00) |
| 2.4.4 link-other | 0 | 0 | 1 | – |
| 3.1.1 3.1.1 | 1 | 0 | 0 | 1 / 0: 1.00 (0.21–1.00) |
| 3.1.2 3.1.2:other | 1 | 0 | 0 | 1 / 0: 1.00 (0.21–1.00) |

### False positives by page and claim

| group | TP | FP | unc | precision |
| --- | ---: | ---: | ---: | --- |
| s3 test ufpe-br 2.4.4 link-ambiguous (criterion_misapplied) | 0 | 39 | 0 | 0 / 39: 0.00 (0.00–0.09) |
| s4 dev toolstation-plumbing 2.4.4 link-ambiguous (model_error) | 0 | 30 | 0 | 0 / 30: 0.00 (0.00–0.11) |
| s4 dev toolstation-plumbing 2.4.4 link-ambiguous (criterion_misapplied) | 0 | 20 | 0 | 0 / 20: 0.00 (0.00–0.16) |
| s3 test ufpe-br 2.4.4 link-ambiguous (context_missing) | 0 | 8 | 0 | 0 / 8: 0.00 (0.00–0.32) |
| s4 test museudoamanha 3.1.2 3.1.2 (collector_error) | 0 | 8 | 0 | 0 / 8: 0.00 (0.00–0.32) |
| s3 test ufpe-br 2.4.4 link-ambiguous (model_error) | 0 | 3 | 0 | 0 / 3: 0.00 (0.00–0.56) |
| s2 test thomann-co-uk 2.4.4 link-ambiguous (disputed) | 0 | 2 | 0 | 0 / 2: 0.00 (0.00–0.66) |
| s3 test correio 2.4.4 link-ambiguous (criterion_misapplied) | 0 | 2 | 0 | 0 / 2: 0.00 (0.00–0.66) |
| s4 dev osesp-contato 2.4.4 link-ambiguous (context_missing) | 0 | 2 | 0 | 0 / 2: 0.00 (0.00–0.66) |
| s2 test tcd-ie 1.1.1 functional-link (disputed) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s3 dev clevelandclinic 1.1.1 wrong_content (model_error) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s3 dev pbs-article 1.1.1 wrong_content (disputed) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s3 dev puc-rio-vestibular 1.1.1 wrong_content (model_error) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s3 test correio 2.4.4 link-generic (model_error) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s3 test ed-ac-uk 1.1.1 wrong_content (criterion_misapplied) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s3 test fleury-article 1.1.1 functional-link (model_error) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s3 test mg-gov-br 1.1.1 wrong_content (model_error) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s3 test pimoroni 2.4.4 link-ambiguous (criterion_misapplied) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s4 dev conversation 1.1.1 wrong_content (criterion_misapplied) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s4 dev infomoney-article 1.1.1 wrong_content (model_error) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s4 test fueleconomy-findacar 1.1.1 wrong_content (criterion_misapplied) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s4 test gla-ac-uk 3.3.2 3.3.2 (disputed) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s4 test mdanderson 1.1.1 wrong_content (model_error) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |
| s4 test ufpr-br 1.1.1 other (disputed) | 0 | 1 | 0 | 0 / 1: 0.00 (0.00–0.79) |

### Findings per page and criterion (bursts), TP / FP

| study | split | page | criterion | TP | FP |
| --- | --- | --- | --- | ---: | ---: |
| s3 | test | ufpe-br | 2.4.4 | 0 | 50 |
| s4 | dev | toolstation-plumbing | 2.4.4 | 0 | 50 |
| s4 | test | tst-ouvidoria | 2.4.4 | 8 | 0 |
| s4 | test | museudoamanha | 3.1.2 | 0 | 8 |
| s4 | dev | conversation | 3.1.2 | 8 | 0 |
| s3 | test | ed-ac-uk | 1.1.1 | 6 | 1 |
| s3 | test | correio | 1.1.1 | 6 | 0 |
| s3 | test | correio | 2.4.4 | 3 | 3 |
| s2 | test | fuvest-br-vestibular | 1.1.1 | 5 | 0 |
| s3 | dev | clevelandclinic | 1.1.1 | 3 | 1 |
| s2 | dev | pinacoteca-org-br | 1.3.5 | 4 | 0 |
| s2 | dev | rijksmuseum-nl-newsletter | 1.3.5 | 3 | 0 |
| s2 | test | tuasaude-com-dengue | 2.4.4 | 3 | 0 |
| s4 | test | nhm-ac-uk | 1.3.5 | 3 | 0 |

Share of each half's FP on its top FP page:
- s2 dev: 0 FP; top page None; top two 0
- s2 test: 3 FP; top page ('thomann-co-uk', 2); top two 3
- s3 dev: 3 FP; top page ('clevelandclinic', 1); top two 2
- s3 test: 57 FP; top page ('ufpe-br', 50); top two 53
- s4 dev: 54 FP; top page ('toolstation-plumbing', 50); top two 52
- s4 test: 12 FP; top page ('museudoamanha', 8); top two 9

ufpe slugs seen: {'ufpe-br'}

### P0: planned fixes (unstyled guard on ufpe.br, H81 context on toolstation.com)

| set | before | after | TP lost | FP gone | sample |
| --- | --- | --- | ---: | ---: | --- |
| s2 dev | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | 0 | 0 | in-sample |
| s2 test | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) | 0 | 0 | in-sample |
| s3 dev | 15 / 3: 0.83 (0.61–0.94) | 15 / 3: 0.83 (0.61–0.94) | 0 | 0 | in-sample |
| s3 test | 24 / 57: 0.30 (0.21–0.40) | 24 / 7: 0.77 (0.60–0.89) | 0 | 50 | in-sample |
| s4 dev | 13 / 54: 0.19 (0.12–0.30) | 13 / 4: 0.76 (0.53–0.90) | 0 | 50 | out-of-sample (dev: read for choosing) |
| s4 test | 14 / 12: 0.54 (0.35–0.71) | 14 / 12: 0.54 (0.35–0.71) | 0 | 0 | out-of-sample |
| s4 both | 27 / 66: 0.29 (0.21–0.39) | 27 / 16: 0.63 (0.48–0.76) | 0 | 50 | out-of-sample |
| all | 95 / 129: 0.42 (0.36–0.49) | 95 / 29: 0.77 (0.68–0.83) | 0 | 100 | mixed |

### B3: after P0, at most 3 findings per page and criterion (beyond that, a page-level note), proportional drop

| set | before | after | TP lost | FP gone | sample |
| --- | --- | --- | ---: | ---: | --- |
| s2 dev | 19 / 0: 1.00 (0.83–1.00) | 18 / 0: 1.00 (0.82–1.00) | 1 | 0 | in-sample |
| s2 test | 10 / 3: 0.77 (0.50–0.92) | 8 / 3: 0.73 (0.43–0.90) | 2 | 0 | in-sample |
| s3 dev | 15 / 3: 0.83 (0.61–0.94) | 14 / 3: 0.82 (0.59–0.94) | 1 | 0 | in-sample |
| s3 test | 24 / 57: 0.30 (0.21–0.40) | 16 / 5: 0.76 (0.55–0.89) | 8 | 52 | in-sample |
| s4 dev | 13 / 54: 0.19 (0.12–0.30) | 8 / 4: 0.67 (0.39–0.86) | 5 | 50 | out-of-sample (dev: read for choosing) |
| s4 test | 14 / 12: 0.54 (0.35–0.71) | 9 / 7: 0.56 (0.33–0.77) | 5 | 5 | out-of-sample |
| s4 both | 27 / 66: 0.29 (0.21–0.39) | 17 / 11: 0.61 (0.42–0.76) | 10 | 55 | out-of-sample |
| all | 95 / 129: 0.42 (0.36–0.49) | 73 / 22: 0.77 (0.67–0.84) | 22 | 107 | mixed |

### B5: after P0, at most 5 findings per page and criterion (beyond that, a page-level note), proportional drop

| set | before | after | TP lost | FP gone | sample |
| --- | --- | --- | ---: | ---: | --- |
| s2 dev | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | 0 | 0 | in-sample |
| s2 test | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) | 0 | 0 | in-sample |
| s3 dev | 15 / 3: 0.83 (0.61–0.94) | 15 / 3: 0.83 (0.61–0.94) | 0 | 0 | in-sample |
| s3 test | 24 / 57: 0.30 (0.21–0.40) | 21 / 6: 0.78 (0.59–0.89) | 3 | 51 | in-sample |
| s4 dev | 13 / 54: 0.19 (0.12–0.30) | 10 / 4: 0.71 (0.45–0.88) | 3 | 50 | out-of-sample (dev: read for choosing) |
| s4 test | 14 / 12: 0.54 (0.35–0.71) | 11 / 9: 0.55 (0.34–0.74) | 3 | 3 | out-of-sample |
| s4 both | 27 / 66: 0.29 (0.21–0.39) | 21 / 13: 0.62 (0.45–0.76) | 6 | 53 | out-of-sample |
| all | 95 / 129: 0.42 (0.36–0.49) | 86 / 25: 0.77 (0.69–0.84) | 9 | 104 | mixed |

### B8: after P0, at most 8 findings per page and criterion (beyond that, a page-level note), proportional drop

| set | before | after | TP lost | FP gone | sample |
| --- | --- | --- | ---: | ---: | --- |
| s2 dev | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | 0 | 0 | in-sample |
| s2 test | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) | 0 | 0 | in-sample |
| s3 dev | 15 / 3: 0.83 (0.61–0.94) | 15 / 3: 0.83 (0.61–0.94) | 0 | 0 | in-sample |
| s3 test | 24 / 57: 0.30 (0.21–0.40) | 24 / 7: 0.77 (0.60–0.89) | 0 | 50 | in-sample |
| s4 dev | 13 / 54: 0.19 (0.12–0.30) | 13 / 4: 0.76 (0.53–0.90) | 0 | 50 | out-of-sample (dev: read for choosing) |
| s4 test | 14 / 12: 0.54 (0.35–0.71) | 14 / 12: 0.54 (0.35–0.71) | 0 | 0 | out-of-sample |
| s4 both | 27 / 66: 0.29 (0.21–0.39) | 27 / 16: 0.63 (0.48–0.76) | 0 | 50 | out-of-sample |
| all | 95 / 129: 0.42 (0.36–0.49) | 95 / 29: 0.77 (0.68–0.83) | 0 | 100 | mixed |

### C1: after P0, 3.1.2 on museudoamanha dropped (a collector-error check: text read as foreign that is the page language, or a repeated burst)

| set | before | after | TP lost | FP gone | sample |
| --- | --- | --- | ---: | ---: | --- |
| s2 dev | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | 0 | 0 | in-sample |
| s2 test | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) | 0 | 0 | in-sample |
| s3 dev | 15 / 3: 0.83 (0.61–0.94) | 15 / 3: 0.83 (0.61–0.94) | 0 | 0 | in-sample |
| s3 test | 24 / 57: 0.30 (0.21–0.40) | 24 / 7: 0.77 (0.60–0.89) | 0 | 50 | in-sample |
| s4 dev | 13 / 54: 0.19 (0.12–0.30) | 13 / 4: 0.76 (0.53–0.90) | 0 | 50 | out-of-sample (dev: read for choosing) |
| s4 test | 14 / 12: 0.54 (0.35–0.71) | 14 / 4: 0.78 (0.55–0.91) | 0 | 8 | out-of-sample |
| s4 both | 27 / 66: 0.29 (0.21–0.39) | 27 / 8: 0.77 (0.61–0.88) | 0 | 58 | out-of-sample |
| all | 95 / 129: 0.42 (0.36–0.49) | 95 / 21: 0.82 (0.74–0.88) | 0 | 108 | mixed |

### C2: after P0, 1.1.1 findings whose lowest confirming probability is under 0.99 dropped

| set | before | after | TP lost | FP gone | sample |
| --- | --- | --- | ---: | ---: | --- |
| s2 dev | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | 0 | 0 | in-sample |
| s2 test | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) | 0 | 0 | in-sample |
| s3 dev | 15 / 3: 0.83 (0.61–0.94) | 15 / 2: 0.88 (0.66–0.97) | 0 | 1 | in-sample |
| s3 test | 24 / 57: 0.30 (0.21–0.40) | 24 / 5: 0.83 (0.65–0.92) | 0 | 52 | in-sample |
| s4 dev | 13 / 54: 0.19 (0.12–0.30) | 13 / 2: 0.87 (0.62–0.96) | 0 | 52 | out-of-sample (dev: read for choosing) |
| s4 test | 14 / 12: 0.54 (0.35–0.71) | 14 / 12: 0.54 (0.35–0.71) | 0 | 0 | out-of-sample |
| s4 both | 27 / 66: 0.29 (0.21–0.39) | 27 / 14: 0.66 (0.51–0.78) | 0 | 52 | out-of-sample |
| all | 95 / 129: 0.42 (0.36–0.49) | 95 / 24: 0.80 (0.72–0.86) | 0 | 105 | mixed |

### C3: every 2.4.4 shared-text ("ambiguous") finding a suggestion (instead of P0)

| set | before | after | TP lost | FP gone | sample |
| --- | --- | --- | ---: | ---: | --- |
| s2 dev | 19 / 0: 1.00 (0.83–1.00) | 17 / 0: 1.00 (0.82–1.00) | 2 | 0 | in-sample |
| s2 test | 10 / 3: 0.77 (0.50–0.92) | 7 / 1: 0.88 (0.53–0.98) | 3 | 2 | in-sample |
| s3 dev | 15 / 3: 0.83 (0.61–0.94) | 13 / 3: 0.81 (0.57–0.93) | 2 | 0 | in-sample |
| s3 test | 24 / 57: 0.30 (0.21–0.40) | 19 / 4: 0.83 (0.63–0.93) | 5 | 53 | in-sample |
| s4 dev | 13 / 54: 0.19 (0.12–0.30) | 13 / 2: 0.87 (0.62–0.96) | 0 | 52 | out-of-sample (dev: read for choosing) |
| s4 test | 14 / 12: 0.54 (0.35–0.71) | 5 / 12: 0.29 (0.13–0.53) | 9 | 0 | out-of-sample |
| s4 both | 27 / 66: 0.29 (0.21–0.39) | 18 / 14: 0.56 (0.39–0.72) | 9 | 52 | out-of-sample |
| all | 95 / 129: 0.42 (0.36–0.49) | 74 / 22: 0.77 (0.68–0.84) | 21 | 107 | mixed |

### C4: P0 + C1 + C2

| set | before | after | TP lost | FP gone | sample |
| --- | --- | --- | ---: | ---: | --- |
| s2 dev | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | 0 | 0 | in-sample |
| s2 test | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) | 0 | 0 | in-sample |
| s3 dev | 15 / 3: 0.83 (0.61–0.94) | 15 / 2: 0.88 (0.66–0.97) | 0 | 1 | in-sample |
| s3 test | 24 / 57: 0.30 (0.21–0.40) | 24 / 5: 0.83 (0.65–0.92) | 0 | 52 | in-sample |
| s4 dev | 13 / 54: 0.19 (0.12–0.30) | 13 / 2: 0.87 (0.62–0.96) | 0 | 52 | out-of-sample (dev: read for choosing) |
| s4 test | 14 / 12: 0.54 (0.35–0.71) | 14 / 4: 0.78 (0.55–0.91) | 0 | 8 | out-of-sample |
| s4 both | 27 / 66: 0.29 (0.21–0.39) | 27 / 6: 0.82 (0.66–0.91) | 0 | 60 | out-of-sample |
| all | 95 / 129: 0.42 (0.36–0.49) | 95 / 16: 0.86 (0.78–0.91) | 0 | 113 | mixed |

### K1: collapse groups > 5 (page, criterion, claim) into one page-level finding, no planned fixes

| set | before | after (collapsed count) | sample |
| --- | --- | --- | --- |
| s2 dev | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | in-sample |
| s2 test | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) | in-sample |
| s3 dev | 15 / 3: 0.83 (0.61–0.94) | 15 / 3: 0.83 (0.61–0.94) | in-sample |
| s3 test | 24 / 57: 0.30 (0.21–0.40) | 14 / 8: 0.64 (0.43–0.80) | in-sample |
| s4 dev | 13 / 54: 0.19 (0.12–0.30) | 6 / 5: 0.55 (0.28–0.79) | out-of-sample |
| s4 test | 14 / 12: 0.54 (0.35–0.71) | 7 / 5: 0.58 (0.32–0.81) | out-of-sample |
| s4 both | 27 / 66: 0.29 (0.21–0.39) | 13 / 10: 0.57 (0.37–0.74) | out-of-sample |
| all | 95 / 129: 0.42 (0.36–0.49) | 71 / 24: 0.75 (0.65–0.82) | mixed |

### K2: P0, then collapse groups > 5

| set | before | after (collapsed count) | sample |
| --- | --- | --- | --- |
| s2 dev | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | in-sample |
| s2 test | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) | in-sample |
| s3 dev | 15 / 3: 0.83 (0.61–0.94) | 15 / 3: 0.83 (0.61–0.94) | in-sample |
| s3 test | 24 / 57: 0.30 (0.21–0.40) | 14 / 7: 0.67 (0.45–0.83) | in-sample |
| s4 dev | 13 / 54: 0.19 (0.12–0.30) | 6 / 4: 0.60 (0.31–0.83) | out-of-sample |
| s4 test | 14 / 12: 0.54 (0.35–0.71) | 7 / 5: 0.58 (0.32–0.81) | out-of-sample |
| s4 both | 27 / 66: 0.29 (0.21–0.39) | 13 / 9: 0.59 (0.39–0.77) | out-of-sample |
| all | 95 / 129: 0.42 (0.36–0.49) | 71 / 22: 0.76 (0.67–0.84) | mixed |
