# Claims as findings or suggestions: a policy fitted on some studies, checked on another

Default-threshold judgment findings only. Each cell is TP/FP/uncertain.

| criterion · claim | s1 (first run + re-measure) | s2 (after the 2.4.4/2.4.6 change) | s3 |
| --- | --- | --- | --- |
| 1.1.1 · decorative | 0/1/0 | 0/0/0 | 3/0/0 |
| 1.1.1 · functional-button | 0/0/0 | 0/2/0 | 0/0/0 |
| 1.1.1 · functional-link | 4/2/2 | 5/8/3 | 13/6/1 |
| 1.1.1 · generic-alt | 2/1/1 | 0/0/0 | 3/0/0 |
| 1.1.1 · placeholder | 0/16/0 | 6/1/0 | 3/0/0 |
| 1.1.1 · wrong_content | 22/55/13 | 4/20/1 | 3/32/1 |
| 1.3.5 · 1.3.5:other | 12/7/0 | 11/0/0 | 8/0/0 |
| 2.4.2 · title | 0/5/0 | 0/0/0 | 0/0/0 |
| 2.4.4 · link-ambiguous | 0/3/0 | 5/2/0 | 7/53/2 |
| 2.4.4 · link-generic | 0/26/2 | 0/0/0 | 0/1/1 |
| 2.4.4 · link-mismatch | 0/26/1 | 0/0/0 | 0/0/0 |
| 2.4.4 · link-url | 0/3/0 | 0/2/0 | 0/1/0 |
| 2.4.6 · heading-mismatch | 0/2/0 | 0/0/0 | 0/0/0 |
| 2.4.6 · heading-says-nothing | 0/32/3 | 0/0/0 | 0/0/0 |
| 2.4.6 · label-other | 0/1/0 | 0/0/0 | 0/0/0 |
| 2.4.6 · label-says-nothing | 0/10/0 | 0/4/0 | 0/2/0 |
| 3.1.2 · 3.1.2:other | 0/0/0 | 1/0/0 | 0/0/0 |
| 3.3.2 · hidden-image | 0/3/0 | 0/0/0 | 0/0/0 |
| 3.3.2 · no-visible-instruction | 0/0/0 | 0/2/0 | 0/1/0 |

## Policies

| fitted on | target precision for a claim to stay a finding | claims kept | checked on | before | after | TP kept |
| --- | --- | --- | --- | --- | --- | --- |
| s1+s2 | 0.3 | 1.1.1 functional-link, 1.1.1 generic-alt, 1.3.5 1.3.5:other, 2.4.4 link-ambiguous | s3 | 0.29 (0.22–0.38) | 0.34 (0.25–0.45) | 31 of 40 |
| s1+s2 | 0.5 | 1.1.1 generic-alt, 1.3.5 1.3.5:other, 2.4.4 link-ambiguous | s3 | 0.29 (0.22–0.38) | 0.25 (0.17–0.37) | 18 of 40 |
| s1+s2 | 0.7 | 1.3.5 1.3.5:other | s3 | 0.29 (0.22–0.38) | 1.00 (0.68–1.00) | 8 of 40 |
| s2+s3 | 0.3 | 1.1.1 decorative, 1.1.1 functional-link, 1.1.1 generic-alt, 1.1.1 placeholder, 1.3.5 1.3.5:other, 2.4.2 title, 2.4.4 link-mismatch, 2.4.6 heading-mismatch, 2.4.6 heading-says-nothing, 2.4.6 label-other, 3.3.2 hidden-image | s1 | 0.17 (0.13–0.23) | 0.16 (0.10–0.24) | 18 of 40 |
| s2+s3 | 0.5 | 1.1.1 decorative, 1.1.1 functional-link, 1.1.1 generic-alt, 1.1.1 placeholder, 1.3.5 1.3.5:other, 2.4.2 title, 2.4.4 link-mismatch, 2.4.6 heading-mismatch, 2.4.6 heading-says-nothing, 2.4.6 label-other, 3.3.2 hidden-image | s1 | 0.17 (0.13–0.23) | 0.16 (0.10–0.24) | 18 of 40 |
| s2+s3 | 0.7 | 1.1.1 decorative, 1.1.1 generic-alt, 1.1.1 placeholder, 1.3.5 1.3.5:other, 2.4.2 title, 2.4.4 link-mismatch, 2.4.6 heading-mismatch, 2.4.6 heading-says-nothing, 2.4.6 label-other, 3.3.2 hidden-image | s1 | 0.17 (0.13–0.23) | 0.13 (0.08–0.21) | 14 of 40 |
| s1+s3 | 0.3 | 1.1.1 functional-button, 1.1.1 functional-link, 1.3.5 1.3.5:other, 3.1.2 3.1.2:other | s2 | 0.44 (0.33–0.55) | 0.63 (0.44–0.78) | 17 of 32 |
| s1+s3 | 0.5 | 1.1.1 functional-button, 1.1.1 functional-link, 1.3.5 1.3.5:other, 3.1.2 3.1.2:other | s2 | 0.44 (0.33–0.55) | 0.63 (0.44–0.78) | 17 of 32 |
| s1+s3 | 0.7 | 1.1.1 functional-button, 1.3.5 1.3.5:other, 3.1.2 3.1.2:other | s2 | 0.44 (0.33–0.55) | 0.86 (0.60–0.96) | 12 of 32 |
