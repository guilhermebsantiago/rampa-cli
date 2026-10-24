# False positives across the studies

Every count below is of labelled findings (two Claude judges; uncertain = the judges disagreed).

### By study and split, every labelled finding (FP total 604)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| s3 test | 88 | 100 | 10 | 0.47 (0.40–0.54) | 17% |
| s1 test | 14 | 98 | 9 | 0.12 (0.08–0.20) | 16% |
| s2 test | 90 | 98 | 17 | 0.48 (0.41–0.55) | 16% |
| s1-remeasure test | 20 | 81 | 8 | 0.20 (0.13–0.29) | 13% |
| s2 dev | 73 | 69 | 9 | 0.51 (0.43–0.59) | 11% |
| s1 dev | 9 | 61 | 11 | 0.13 (0.07–0.23) | 10% |
| s2-after test | 68 | 45 | 3 | 0.60 (0.51–0.69) | 7% |
| s3 dev | 121 | 28 | 19 | 0.81 (0.74–0.87) | 5% |
| s2-after dev | 54 | 24 | 7 | 0.69 (0.58–0.78) | 4% |

### By study and split, default threshold only (what a user sees) (FP total 372)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| s1 test | 14 | 98 | 9 | 0.12 (0.08–0.20) | 26% |
| s3 test | 24 | 75 | 4 | 0.24 (0.17–0.34) | 20% |
| s1 dev | 9 | 61 | 11 | 0.13 (0.07–0.23) | 16% |
| s1-remeasure test | 17 | 34 | 2 | 0.33 (0.22–0.47) | 9% |
| s2 dev | 18 | 25 | 4 | 0.42 (0.28–0.57) | 7% |
| s2-after dev | 20 | 21 | 4 | 0.49 (0.34–0.64) | 6% |
| s3 dev | 16 | 21 | 1 | 0.43 (0.29–0.59) | 6% |
| s2-after test | 12 | 20 | 0 | 0.38 (0.23–0.55) | 5% |
| s2 test | 9 | 17 | 0 | 0.35 (0.19–0.54) | 5% |

## The latest run of each study (s1 first run, its re-measure, s2 after the 2.4.4/2.4.6 change, s3)

### By check, all thresholds (FP total 457)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| judgment/1.1.1 | 68 | 144 | 22 | 0.32 (0.26–0.39) | 32% |
| judgment/2.4.4 | 12 | 142 | 10 | 0.08 (0.05–0.13) | 31% |
| judgment/2.4.6 | 0 | 70 | 4 | 0.00 (0.00–0.05) | 15% |
| rampa/css-reading-order | 0 | 19 | 0 | 0.00 (0.00–0.17) | 4% |
| rampa/pixel-contrast | 81 | 13 | 2 | 0.86 (0.78–0.92) | 3% |
| judgment/2.4.2 | 0 | 10 | 0 | 0.00 (0.00–0.28) | 2% |
| rampa/link-color-only | 0 | 10 | 0 | 0.00 (0.00–0.28) | 2% |
| judgment-hidden/1.1.1 | 2 | 9 | 0 | 0.18 (0.05–0.48) | 2% |
| judgment/1.3.5 | 31 | 7 | 0 | 0.82 (0.67–0.91) | 2% |
| judgment/3.3.2 | 0 | 6 | 0 | 0.00 (0.00–0.39) | 1% |
| rampa/icon-contrast | 15 | 5 | 3 | 0.75 (0.53–0.89) | 1% |
| rampa/placeholder-alt | 15 | 3 | 0 | 0.83 (0.61–0.94) | 1% |
| rampa/state-text-contrast | 7 | 3 | 0 | 0.70 (0.40–0.89) | 1% |
| rampa/placeholder-contrast | 12 | 2 | 0 | 0.86 (0.60–0.96) | 0% |
| rampa/keyboard-reach | 0 | 2 | 0 | 0.00 (0.00–0.66) | 0% |
| rampa/character-key-shortcuts | 0 | 2 | 0 | 0.00 (0.00–0.66) | 0% |
| rampa/focus-visible | 35 | 2 | 9 | 0.95 (0.82–0.99) | 0% |
| rampa/text-spacing | 3 | 2 | 0 | 0.60 (0.23–0.88) | 0% |
| rampa/no-visible-label | 0 | 1 | 0 | 0.00 (0.00–0.79) | 0% |
| judgment/3.1.2 | 4 | 1 | 3 | 0.80 (0.38–0.96) | 0% |
| rampa/focus-obscured | 66 | 1 | 6 | 0.99 (0.92–1.00) | 0% |
| rampa/focus-indicator-contrast | 31 | 1 | 11 | 0.97 (0.84–0.99) | 0% |
| rampa/reflow | 1 | 1 | 0 | 0.50 (0.09–0.91) | 0% |
| rampa/state-indicator-contrast | 1 | 1 | 0 | 0.50 (0.09–0.91) | 0% |

### By check, default threshold (FP total 330)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| judgment/1.1.1 | 68 | 144 | 22 | 0.32 (0.26–0.39) | 44% |
| judgment/2.4.4 | 12 | 117 | 6 | 0.09 (0.05–0.16) | 35% |
| judgment/2.4.6 | 0 | 51 | 3 | 0.00 (0.00–0.07) | 15% |
| judgment/1.3.5 | 31 | 7 | 0 | 0.82 (0.67–0.91) | 2% |
| judgment/3.3.2 | 0 | 6 | 0 | 0.00 (0.00–0.39) | 2% |
| judgment/2.4.2 | 0 | 5 | 0 | 0.00 (0.00–0.43) | 2% |

### By claim (judged criteria), all thresholds (FP total 389)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| 1.1.1 wrong_content | 29 | 107 | 15 | 0.21 (0.15–0.29) | 28% |
| 2.4.4 link-ambiguous | 12 | 66 | 3 | 0.15 (0.09–0.25) | 17% |
| 2.4.4 link-generic | 0 | 42 | 5 | 0.00 (0.00–0.08) | 11% |
| 2.4.6 heading-says-nothing | 0 | 41 | 4 | 0.00 (0.00–0.09) | 11% |
| 2.4.4 link-mismatch | 0 | 28 | 2 | 0.00 (0.00–0.12) | 7% |
| 2.4.6 label-says-nothing | 0 | 25 | 0 | 0.00 (0.00–0.13) | 6% |
| 1.1.1 placeholder | 9 | 17 | 0 | 0.35 (0.19–0.54) | 4% |
| 1.1.1 functional-link | 22 | 16 | 6 | 0.58 (0.42–0.72) | 4% |
| 2.4.2 title | 0 | 10 | 0 | 0.00 (0.00–0.28) | 3% |
| 1.1.1 hidden-image | 2 | 9 | 0 | 0.18 (0.05–0.48) | 2% |
| 1.3.5 1.3.5:other | 31 | 7 | 0 | 0.82 (0.67–0.91) | 2% |
| 2.4.4 link-url | 0 | 6 | 0 | 0.00 (0.00–0.39) | 2% |
| 3.3.2 hidden-image | 0 | 3 | 0 | 0.00 (0.00–0.56) | 1% |
| 2.4.6 heading-mismatch | 0 | 3 | 0 | 0.00 (0.00–0.56) | 1% |
| 3.3.2 no-visible-instruction | 0 | 3 | 0 | 0.00 (0.00–0.56) | 1% |
| 1.1.1 functional-button | 0 | 2 | 0 | 0.00 (0.00–0.66) | 1% |
| 1.1.1 decorative | 3 | 1 | 0 | 0.75 (0.30–0.95) | 0% |
| 1.1.1 generic-alt | 5 | 1 | 1 | 0.83 (0.44–0.97) | 0% |
| 2.4.6 label-other | 0 | 1 | 0 | 0.00 (0.00–0.79) | 0% |
| 3.1.2 3.1.2:other | 4 | 1 | 3 | 0.80 (0.38–0.96) | 0% |

### By claim, default threshold (FP total 330)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| 1.1.1 wrong_content | 29 | 107 | 15 | 0.21 (0.15–0.29) | 32% |
| 2.4.4 link-ambiguous | 12 | 58 | 2 | 0.17 (0.10–0.28) | 18% |
| 2.4.6 heading-says-nothing | 0 | 32 | 3 | 0.00 (0.00–0.11) | 10% |
| 2.4.4 link-generic | 0 | 27 | 3 | 0.00 (0.00–0.12) | 8% |
| 2.4.4 link-mismatch | 0 | 26 | 1 | 0.00 (0.00–0.13) | 8% |
| 1.1.1 placeholder | 9 | 17 | 0 | 0.35 (0.19–0.54) | 5% |
| 2.4.6 label-says-nothing | 0 | 16 | 0 | 0.00 (0.00–0.19) | 5% |
| 1.1.1 functional-link | 22 | 16 | 6 | 0.58 (0.42–0.72) | 5% |
| 1.3.5 1.3.5:other | 31 | 7 | 0 | 0.82 (0.67–0.91) | 2% |
| 2.4.4 link-url | 0 | 6 | 0 | 0.00 (0.00–0.39) | 2% |
| 2.4.2 title | 0 | 5 | 0 | 0.00 (0.00–0.43) | 2% |
| 3.3.2 hidden-image | 0 | 3 | 0 | 0.00 (0.00–0.56) | 1% |
| 3.3.2 no-visible-instruction | 0 | 3 | 0 | 0.00 (0.00–0.56) | 1% |
| 2.4.6 heading-mismatch | 0 | 2 | 0 | 0.00 (0.00–0.66) | 1% |
| 1.1.1 functional-button | 0 | 2 | 0 | 0.00 (0.00–0.66) | 1% |
| 1.1.1 decorative | 3 | 1 | 0 | 0.75 (0.30–0.95) | 0% |
| 1.1.1 generic-alt | 5 | 1 | 1 | 0.83 (0.44–0.97) | 0% |
| 2.4.6 label-other | 0 | 1 | 0 | 0.00 (0.00–0.79) | 0% |

### By page, default threshold (top 15) (FP total 330)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| s3 ufpe-br | 0 | 50 | 0 | 0.00 (0.00–0.07) | 15% |
| s1 python-org-br | 0 | 32 | 1 | 0.00 (0.00–0.11) | 10% |
| s1 www-ufc-br-pt | 0 | 22 | 1 | 0.00 (0.00–0.15) | 7% |
| s1 docs-python-org-pt-br-3-tutorial-controlflow-html | 0 | 21 | 0 | 0.00 (0.00–0.15) | 6% |
| s1 webaim-org-techniques-alttext | 0 | 17 | 4 | 0.00 (0.00–0.18) | 5% |
| s1-remeasure python-org-br | 0 | 17 | 0 | 0.00 (0.00–0.18) | 5% |
| s3 nps-findapark | 0 | 10 | 0 | 0.00 (0.00–0.28) | 3% |
| s1 www-mit-edu | 0 | 9 | 1 | 0.00 (0.00–0.30) | 3% |
| s1 www-gov-br-pt-br | 0 | 8 | 0 | 0.00 (0.00–0.32) | 2% |
| s1 www-ibge-gov-br | 12 | 8 | 0 | 0.60 (0.39–0.78) | 2% |
| s1 www-usa-gov-state-consumer | 0 | 8 | 0 | 0.00 (0.00–0.32) | 2% |
| s2-after rijksmuseum-nl-newsletter | 3 | 8 | 0 | 0.27 (0.10–0.57) | 2% |
| s3 clevelandclinic | 3 | 7 | 0 | 0.30 (0.11–0.60) | 2% |
| s1 www-bbc-com-news-articles-c3j4790elkx7o | 0 | 6 | 7 | 0.00 (0.00–0.39) | 2% |
| s1-remeasure www-adafruit-com-category-17 | 0 | 6 | 0 | 0.00 (0.00–0.39) | 2% |

### By the judges' cause, default threshold (FP total 330)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| model_error | 0 | 111 | 0 | 0.00 (0.00–0.03) | 34% |
| criterion_misapplied | 0 | 101 | 0 | 0.00 (0.00–0.04) | 31% |
| disputed | 0 | 87 | 0 | 0.00 (0.00–0.04) | 26% |
| context_missing | 0 | 18 | 0 | 0.00 (0.00–0.18) | 5% |
| collector_error | 0 | 13 | 0 | 0.00 (0.00–0.23) | 4% |

### Clusters: criterion, claim and page, default threshold (top 25) (FP total 330)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| s3 ufpe-br · 2.4.4 link-ambiguous | 0 | 50 | 0 | 0.00 (0.00–0.07) | 15% |
| s1 www-ufc-br-pt · 1.1.1 wrong_content | 0 | 16 | 1 | 0.00 (0.00–0.19) | 5% |
| s1 python-org-br · 1.1.1 wrong_content | 0 | 11 | 0 | 0.00 (0.00–0.26) | 3% |
| s1 docs-python-org-pt-br-3-tutorial-controlflow-html · 2.4.4 link-generic | 0 | 10 | 0 | 0.00 (0.00–0.28) | 3% |
| s1 python-org-br · 2.4.6 heading-says-nothing | 0 | 10 | 0 | 0.00 (0.00–0.28) | 3% |
| s1-remeasure python-org-br · 1.1.1 wrong_content | 0 | 10 | 0 | 0.00 (0.00–0.28) | 3% |
| s3 nps-findapark · 1.1.1 wrong_content | 0 | 10 | 0 | 0.00 (0.00–0.28) | 3% |
| s1 webaim-org-techniques-alttext · 2.4.6 heading-says-nothing | 0 | 9 | 0 | 0.00 (0.00–0.30) | 3% |
| s1 docs-python-org-pt-br-3-tutorial-controlflow-html · 2.4.6 label-says-nothing | 0 | 8 | 0 | 0.00 (0.00–0.32) | 2% |
| s1 python-org-br · 1.1.1 placeholder | 0 | 7 | 0 | 0.00 (0.00–0.35) | 2% |
| s1-remeasure python-org-br · 1.1.1 placeholder | 0 | 7 | 0 | 0.00 (0.00–0.35) | 2% |
| s2-after rijksmuseum-nl-newsletter · 1.1.1 wrong_content | 0 | 7 | 0 | 0.00 (0.00–0.35) | 2% |
| s1-remeasure www-adafruit-com-category-17 · 1.1.1 wrong_content | 0 | 6 | 0 | 0.00 (0.00–0.39) | 2% |
| s3 clevelandclinic · 1.1.1 wrong_content | 0 | 6 | 0 | 0.00 (0.00–0.39) | 2% |
| s1 www-gov-br-pt-br · 2.4.4 link-mismatch | 0 | 5 | 0 | 0.00 (0.00–0.43) | 2% |
| s1 www-ufc-br-pt · 2.4.4 link-mismatch | 0 | 4 | 0 | 0.00 (0.00–0.49) | 1% |
| s1 www-mit-edu · 2.4.4 link-mismatch | 0 | 4 | 0 | 0.00 (0.00–0.49) | 1% |
| s1 www-padocadomani-com-br-contato · 2.4.6 heading-says-nothing | 0 | 4 | 0 | 0.00 (0.00–0.49) | 1% |
| s2-after usps-com-zip-code-lookup · 2.4.6 label-says-nothing | 0 | 4 | 0 | 0.00 (0.00–0.49) | 1% |
| s3 cnj-ouvidoria · 1.1.1 wrong_content | 2 | 4 | 0 | 0.33 (0.10–0.70) | 1% |
| s1 webaim-org-techniques-alttext · 2.4.4 link-generic | 0 | 3 | 0 | 0.00 (0.00–0.56) | 1% |
| s1 www-ibge-gov-br · 2.4.6 heading-says-nothing | 0 | 3 | 0 | 0.00 (0.00–0.56) | 1% |
| s1 www-usa-gov-state-consumer · 1.1.1 wrong_content | 0 | 3 | 0 | 0.00 (0.00–0.56) | 1% |
| s1 www-usa-gov-state-consumer · 2.4.4 link-ambiguous | 0 | 3 | 0 | 0.00 (0.00–0.56) | 1% |
| s1 www-bbc-com-news-articles-c3j4790elkx7o · 2.4.4 link-mismatch | 0 | 3 | 0 | 0.00 (0.00–0.56) | 1% |

## Studies 2 and 3 only (the code since the 2.4.4/2.4.6 change), judged criteria, default threshold

### By criterion (FP total 137)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| 1.1.1 | 40 | 69 | 6 | 0.37 (0.28–0.46) | 50% |
| 2.4.4 | 12 | 59 | 3 | 0.17 (0.10–0.27) | 43% |
| 2.4.6 | 0 | 6 | 0 | 0.00 (0.00–0.39) | 4% |
| 3.3.2 | 0 | 3 | 0 | 0.00 (0.00–0.56) | 2% |

### By claim (FP total 137)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| 2.4.4 link-ambiguous | 12 | 55 | 2 | 0.18 (0.11–0.29) | 40% |
| 1.1.1 wrong_content | 7 | 52 | 2 | 0.12 (0.06–0.23) | 38% |
| 1.1.1 functional-link | 18 | 14 | 4 | 0.56 (0.39–0.72) | 10% |
| 2.4.6 label-says-nothing | 0 | 6 | 0 | 0.00 (0.00–0.39) | 4% |
| 3.3.2 no-visible-instruction | 0 | 3 | 0 | 0.00 (0.00–0.56) | 2% |
| 2.4.4 link-url | 0 | 3 | 0 | 0.00 (0.00–0.56) | 2% |
| 1.1.1 functional-button | 0 | 2 | 0 | 0.00 (0.00–0.66) | 1% |
| 1.1.1 placeholder | 9 | 1 | 0 | 0.90 (0.60–0.98) | 1% |
| 2.4.4 link-generic | 0 | 1 | 1 | 0.00 (0.00–0.79) | 1% |

### By page (top 12) (FP total 137)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| s3 ufpe-br | 0 | 50 | 0 | 0.00 (0.00–0.07) | 36% |
| s3 nps-findapark | 0 | 10 | 0 | 0.00 (0.00–0.28) | 7% |
| s2-after rijksmuseum-nl-newsletter | 3 | 8 | 0 | 0.27 (0.10–0.57) | 6% |
| s3 clevelandclinic | 3 | 7 | 0 | 0.30 (0.11–0.60) | 5% |
| s3 cnj-ouvidoria | 4 | 5 | 1 | 0.44 (0.19–0.73) | 4% |
| s2-after unicamp-br | 2 | 4 | 0 | 0.33 (0.10–0.70) | 3% |
| s2-after usps-com-zip-code-lookup | 0 | 4 | 0 | 0.00 (0.00–0.49) | 3% |
| s2-after thomann-co-uk | 2 | 4 | 0 | 0.33 (0.10–0.70) | 3% |
| s3 vam-ac-uk | 0 | 4 | 0 | 0.00 (0.00–0.49) | 3% |
| s3 correio | 9 | 4 | 2 | 0.69 (0.42–0.87) | 3% |
| s2-after ce-gov-br | 1 | 3 | 1 | 0.25 (0.05–0.70) | 2% |
| s2-after tcd-ie | 0 | 3 | 0 | 0.00 (0.00–0.56) | 2% |

## Experimental rules and probes, studies 2 and 3

### By check (FP total 65)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| rampa/css-reading-order | 0 | 19 | 0 | 0.00 (0.00–0.17) | 29% |
| rampa/pixel-contrast | 81 | 13 | 2 | 0.86 (0.78–0.92) | 20% |
| rampa/link-color-only | 0 | 10 | 0 | 0.00 (0.00–0.28) | 15% |
| rampa/icon-contrast | 15 | 5 | 3 | 0.75 (0.53–0.89) | 8% |
| rampa/state-text-contrast | 7 | 3 | 0 | 0.70 (0.40–0.89) | 5% |
| rampa/placeholder-contrast | 11 | 2 | 0 | 0.85 (0.58–0.96) | 3% |
| rampa/keyboard-reach | 0 | 2 | 0 | 0.00 (0.00–0.66) | 3% |
| rampa/character-key-shortcuts | 0 | 2 | 0 | 0.00 (0.00–0.66) | 3% |
| rampa/focus-visible | 35 | 2 | 9 | 0.95 (0.82–0.99) | 3% |
| rampa/text-spacing | 3 | 2 | 0 | 0.60 (0.23–0.88) | 3% |
| rampa/placeholder-alt | 15 | 1 | 0 | 0.94 (0.72–0.99) | 2% |
| rampa/focus-obscured | 66 | 1 | 6 | 0.99 (0.92–1.00) | 2% |
| rampa/focus-indicator-contrast | 31 | 1 | 11 | 0.97 (0.84–0.99) | 2% |
| rampa/reflow | 1 | 1 | 0 | 0.50 (0.09–0.91) | 2% |
| rampa/state-indicator-contrast | 1 | 1 | 0 | 0.50 (0.09–0.91) | 2% |
| rampa/language-switcher-lang | 9 | 0 | 1 | 1.00 (0.70–1.00) | 0% |
| rampa/widget-name | 6 | 0 | 2 | 1.00 (0.61–1.00) | 0% |
| rampa/custom-control | 1 | 0 | 0 | 1.00 (0.21–1.00) | 0% |
| rampa/hover-content | 16 | 0 | 0 | 1.00 (0.81–1.00) | 0% |
| rampa/on-focus | 1 | 0 | 0 | 1.00 (0.21–1.00) | 0% |

### Clusters by check and page (FP only, top 12) (FP total 65)

| group | TP | FP | unc | precision (Wilson) | share of FP |
| --- | ---: | ---: | ---: | --- | ---: |
| s2 theguardian-com-international · rampa/css-reading-order | 0 | 19 | 0 | 0.00 (0.00–0.17) | 29% |
| s3 ed-ac-uk · rampa/pixel-contrast | 0 | 13 | 0 | 0.00 (0.00–0.23) | 20% |
| s2 medlineplus-gov-diabetes · rampa/link-color-only | 0 | 10 | 0 | 0.00 (0.00–0.28) | 15% |
| s2 cdc-gov · rampa/state-text-contrast | 0 | 2 | 0 | 0.00 (0.00–0.66) | 3% |
| s2 bl-uk · rampa/text-spacing | 0 | 2 | 0 | 0.00 (0.00–0.66) | 3% |
| s3 ed-ac-uk · rampa/placeholder-contrast | 0 | 2 | 0 | 0.00 (0.00–0.66) | 3% |
| s3 correio · rampa/icon-contrast | 0 | 2 | 1 | 0.00 (0.00–0.66) | 3% |
| s2 poder360-com-br · rampa/icon-contrast | 0 | 1 | 0 | 0.00 (0.00–0.79) | 2% |
| s2 chicorei-com · rampa/keyboard-reach | 0 | 1 | 0 | 0.00 (0.00–0.79) | 2% |
| s2 chicorei-com · rampa/character-key-shortcuts | 0 | 1 | 0 | 0.00 (0.00–0.79) | 2% |
| s2 martinsfontes-literatura · rampa/focus-visible | 9 | 1 | 0 | 0.90 (0.60–0.98) | 2% |
| s2 cdc-gov · rampa/reflow | 0 | 1 | 0 | 0.00 (0.00–0.79) | 2% |
