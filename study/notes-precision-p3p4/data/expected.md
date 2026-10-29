## Expected from data/facts.json: default-threshold judgment findings, main -> predicted

| study | half | status | per element before | per element after | page bootstrap after | per group before | per group after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s2 | dev | in-sample | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) | 1.00–1.00 | 19 / 0: 1.00 (0.83–1.00) | 19 / 0: 1.00 (0.83–1.00) |
| s2 | test | in-sample | 10 / 3: 0.77 (0.50–0.92) | 10 / 2: 0.83 (0.55–0.95) | 0.33–1.00 | 10 / 3: 0.77 (0.50–0.92) | 10 / 2: 0.83 (0.55–0.95) |
| s3 | dev | in-sample | 15 / 3 (1 unc.): 0.83 (0.61–0.94) | 15 / 3 (1 unc.): 0.83 (0.61–0.94) | 0.57–1.00 | 15 / 3: 0.83 (0.61–0.94) | 15 / 3: 0.83 (0.61–0.94) |
| s3 | test | in-sample | 24 / 5 (2 unc.): 0.83 (0.65–0.92) | 24 / 3 (2 unc.): 0.89 (0.72–0.96) | 0.84–1.00 | 12 / 3: 0.80 (0.55–0.93) | 14 / 3: 0.82 (0.59–0.94) |
| s4 | dev | in-sample | 13 / 3 (1 unc.): 0.81 (0.57–0.93) | 13 / 3 (1 unc.): 0.81 (0.57–0.93) | 0.57–1.00 | 6 / 3: 0.67 (0.35–0.88) | 6 / 3: 0.67 (0.35–0.88) |
| s4 | test | in-sample | 14 / 4: 0.78 (0.55–0.91) | 14 / 4: 0.78 (0.55–0.91) | 0.36–0.95 | 7 / 4: 0.64 (0.35–0.85) | 7 / 4: 0.64 (0.35–0.85) |
| s5 | dev | in-sample | 37 / 0 (1 unc.): 1.00 (0.91–1.00) | 37 / 0 (1 unc.): 1.00 (0.91–1.00) | 1.00–1.00 | 16 / 0: 1.00 (0.81–1.00) | 16 / 0: 1.00 (0.81–1.00) |
| s5 | test | counted | 20 / 4 (1 unc.): 0.83 (0.64–0.93) | 20 / 4 (1 unc.): 0.83 (0.64–0.93) | 0.62–0.97 | 20 / 4: 0.83 (0.64–0.93) | 20 / 4: 0.83 (0.64–0.93) |
| s2-s4 | both | in-sample | 95 / 18 (4 unc.): 0.84 (0.76–0.90) | 95 / 15 (4 unc.): 0.86 (0.79–0.92) | 0.78–0.93 | 69 / 16: 0.81 (0.72–0.88) | 71 / 15: 0.83 (0.73–0.89) |
| s2-s4 + s5 dev | in-sample | in-sample | 132 / 18 (5 unc.): 0.88 (0.82–0.92) | 132 / 15 (5 unc.): 0.90 (0.84–0.94) | 0.83–0.95 | 85 / 16: 0.84 (0.76–0.90) | 87 / 15: 0.85 (0.77–0.91) |
| s5 | both | in-sample + counted | 57 / 4 (2 unc.): 0.93 (0.84–0.97) | 57 / 4 (2 unc.): 0.93 (0.84–0.97) | 0.82–1.00 | 36 / 4: 0.90 (0.77–0.96) | 36 / 4: 0.90 (0.77–0.96) |
| all | both | in-sample + counted | 152 / 22 (6 unc.): 0.87 (0.82–0.92) | 152 / 19 (6 unc.): 0.89 (0.83–0.93) | 0.83–0.94 | 105 / 20: 0.84 (0.77–0.89) | 107 / 19: 0.85 (0.78–0.90) |

Cells are true / false findings (uncertain and unlabelled apart) and precision with its Wilson 95% interval.

## What moved

Findings that left the default threshold, by study, half, criterion and label: s2 test 1.1.1 false_positive 1, s3 test 2.4.4 false_positive 2
- s2 test tcd-ie 1.1.1 missing_information [false_positive]: 'istagram'
- s3 test correio 2.4.4 ambiguous [false_positive]: 'Direito e Justiça'
- s3 test pimoroni 2.4.4 ambiguous [false_positive]: 'Pimoroni'

Findings that came to the default threshold, by study, half, criterion and label: none

