## Default-threshold judgment findings, main -> p1p2

| study | half | status | per element before | per element after | page bootstrap after | per group before | per group after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s2 | dev | in-sample | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | 1.00–1.00 | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) |
| s2 | test | in-sample | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) | 0.14–1.00 | 10 / 3: 0.77 (0.50–0.92) | 10 / 3: 0.77 (0.50–0.92) |
| s3 | dev | in-sample | 15 / 2 (1 unc.): 0.88 (0.66–0.97) | 15 / 3 (1 unc.): 0.83 (0.61–0.94) | 0.57–1.00 | 15 / 2: 0.88 (0.66–0.97) | 15 / 3: 0.83 (0.61–0.94) |
| s3 | test | in-sample | 24 / 5 (2 unc.): 0.83 (0.65–0.92) | 24 / 5 (2 unc.): 0.83 (0.65–0.92) | 0.78–0.94 | 12 / 3: 0.80 (0.55–0.93) | 12 / 3: 0.80 (0.55–0.93) |
| s4 | dev | in-sample | 13 / 2 (2 unc.): 0.87 (0.62–0.96) | 13 / 3 (1 unc.): 0.81 (0.57–0.93) | 0.57–1.00 | 6 / 2: 0.75 (0.41–0.93) | 6 / 3: 0.67 (0.35–0.88) |
| s4 | test | in-sample | 14 / 4: 0.78 (0.55–0.91) | 14 / 4: 0.78 (0.55–0.91) | 0.36–0.95 | 7 / 4: 0.64 (0.35–0.85) | 7 / 4: 0.64 (0.35–0.85) |
| s5 | dev | in-sample | 31 / 8 (1 unc.): 0.79 (0.64–0.89) | 37 / 0 (1 unc.): 1.00 (0.91–1.00) | 1.00–1.00 | 18 / 2: 0.90 (0.70–0.97) | 16 / 0: 1.00 (0.81–1.00) |
| s5 | test | read-once (counted) | 20 / 4 (1 unc.): 0.83 (0.64–0.93) | 20 / 4 (1 unc.): 0.83 (0.64–0.93) | 0.62–0.97 | 20 / 4: 0.83 (0.64–0.93) | 20 / 4: 0.83 (0.64–0.93) |
| s2-s4 | both | in-sample | 95 / 16 (5 unc.): 0.86 (0.78–0.91) | 95 / 18 (4 unc.): 0.84 (0.76–0.90) | 0.76–0.91 | 69 / 14: 0.83 (0.74–0.90) | 69 / 16: 0.81 (0.72–0.88) |
| s2-s4 + s5 dev | in-sample | in-sample | 126 / 24 (6 unc.): 0.84 (0.77–0.89) | 132 / 18 (5 unc.): 0.88 (0.82–0.92) | 0.81–0.94 | 87 / 16: 0.84 (0.76–0.90) | 85 / 16: 0.84 (0.76–0.90) |
| s5 | both | in-sample + read-once | 51 / 12 (2 unc.): 0.81 (0.70–0.89) | 57 / 4 (2 unc.): 0.93 (0.84–0.97) | 0.82–1.00 | 38 / 6: 0.86 (0.73–0.94) | 36 / 4: 0.90 (0.77–0.96) |
| all | both | in-sample + read-once | 146 / 28 (7 unc.): 0.84 (0.78–0.89) | 152 / 22 (6 unc.): 0.87 (0.82–0.92) | 0.81–0.93 | 107 / 20: 0.84 (0.77–0.90) | 105 / 20: 0.84 (0.77–0.89) |

Cells are true / false findings (uncertain and unlabelled apart) and precision with its Wilson 95% interval.

## What moved

Findings that left the default threshold, by study, half, criterion and label: s4 dev 2.4.4 uncertain 1, s5 dev 2.4.4 false_positive 8
- s4 dev infomoney-article 2.4.4 generic [uncertain]: 'Veja mais'
- s5 dev horniman 2.4.4 generic [false_positive]: 'More'
- s5 dev pucrs-graduacao 2.4.4 generic [false_positive]: 'Saiba mais'
- s5 dev pucrs-graduacao 2.4.4 generic [false_positive]: 'Leia mais'
- s5 dev pucrs-graduacao 2.4.4 generic [false_positive]: 'Leia mais'
- s5 dev pucrs-graduacao 2.4.4 generic [false_positive]: 'Leia mais'
- s5 dev pucrs-graduacao 2.4.4 generic [false_positive]: 'Leia mais'
- s5 dev pucrs-graduacao 2.4.4 generic [false_positive]: 'Leia mais'
- s5 dev pucrs-graduacao 2.4.4 generic [false_positive]: 'Leia mais'

Findings that came to the default threshold, by study, half, criterion and label: s3 dev 1.1.1 false_positive 1, s4 dev 1.1.1 false_positive 1, s5 dev 1.1.1 true_positive 6
- s3 dev puc-rio-vestibular 1.1.1 wrong_content [false_positive] (identical: {'claims': 2, 'confirmed': 1}): 'Imagem de alunos no Campus da PUC-Rio'
- s4 dev cobasi-cachorro 1.1.1 wrong_content [false_positive] (identical: {'claims': 2, 'confirmed': 1}): 'Ilustração SVG demonstrativa cachorro'
- s5 dev hering 1.1.1 wrong_content [true_positive] (identical: {'claims': 7, 'confirmed': 1}): 'payment'
- s5 dev hering 1.1.1 wrong_content [true_positive] (identical: {'claims': 7, 'confirmed': 1}): 'payment'
- s5 dev hering 1.1.1 wrong_content [true_positive] (identical: {'claims': 7, 'confirmed': 1}): 'payment'
- s5 dev hering 1.1.1 wrong_content [true_positive] (identical: {'claims': 7, 'confirmed': 1}): 'payment'
- s5 dev hering 1.1.1 wrong_content [true_positive] (identical: {'claims': 7, 'confirmed': 1}): 'payment'
- s5 dev hering 1.1.1 wrong_content [true_positive] (identical: {'claims': 7, 'confirmed': 1}): 'payment'

## Model calls and cache misses

| study | half | pages | new model calls before | after | cached calls after | offline misses before | after | errors after | suggestions before | after |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| s2 | dev | 12 | 0 | 0 | 233 | 0 | 0 | 0 | 9 | 9 |
| s2 | test | 12 | 0 | 0 | 175 | 0 | 0 | 0 | 7 | 7 |
| s3 | dev | 12 | 0 | 9 | 953 | 0 | 0 | 0 | 77 | 77 |
| s3 | test | 12 | 0 | 2 | 1001 | 0 | 0 | 0 | 116 | 115 |
| s4 | dev | 12 | 0 | 1 | 725 | 0 | 0 | 0 | 30 | 29 |
| s4 | test | 12 | 0 | 0 | 924 | 0 | 0 | 0 | 67 | 67 |
| s5 | dev | 12 | 0 | 54 | 817 | 0 | 0 | 0 | 58 | 53 |
| s5 | test | 12 | 0 | 6 | 966 | 0 | 0 | 0 | 83 | 80 |

After, by criterion, in-sample sets only (TP / FP / unc. / unlabelled): 1.1.1 59/9/2/0, 1.3.5 28/0/0/0, 2.4.4 35/8/3/0, 2.4.6 0/0/0/0, 3.1.1 1/0/0/0, 3.1.2 9/0/0/0, 3.3.2 0/1/0/0
