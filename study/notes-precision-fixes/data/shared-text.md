# The shared-text fact before and after F1, on the recorded snapshots (no model)

| study | split | page | label | findings | still grounded after F1 |
| --- | --- | --- | --- | ---: | ---: |
| s2 | dev | poder360-com-br | true_positive | 2 | 2 |
| s2 | test | thomann-co-uk | false_positive | 2 | 2 |
| s2 | test | tuasaude-com-dengue | true_positive | 3 | 3 |
| s3 | dev | cnj-ouvidoria | true_positive | 2 | 2 |
| s3 | dev | cnj-ouvidoria | uncertain | 1 | 1 |
| s3 | test | correio | false_positive | 2 | 2 |
| s3 | test | correio | true_positive | 3 | 3 |
| s3 | test | correio | uncertain | 1 | 1 |
| s3 | test | kalunga-apresentacao | true_positive | 2 | 2 |
| s3 | test | pimoroni | false_positive | 1 | 1 |
| s3 | test | ufpe-br | false_positive | 50 | 50 |
| s4 | dev | osesp-contato | false_positive | 2 | 2 |
| s4 | dev | toolstation-plumbing | false_positive | 50 | 0 |
| s4 | test | tst-ouvidoria | true_positive | 8 | 8 |
| s4 | test | ufpr-br | true_positive | 1 | 1 |

Labelled shared-text findings: 130 (missing from the snapshot's candidates: 0).
- true_positive: grounded before 21, after 21
- false_positive: grounded before 107, after 57
- uncertain: grounded before 2, after 2

| study | page | link candidates | grounded shared-text before | after |
| --- | --- | ---: | ---: | ---: |
| s2 | poder360-com-br | 447 | 2 | 2 |
| s2 | thomann-co-uk | 111 | 2 | 2 |
| s2 | tuasaude-com-dengue | 177 | 3 | 3 |
| s3 | cnj-ouvidoria | 65 | 3 | 3 |
| s3 | correio | 195 | 6 | 6 |
| s3 | kalunga-apresentacao | 163 | 2 | 2 |
| s3 | pimoroni | 94 | 1 | 1 |
| s3 | ufpe-br | 1646 | 521 | 521 |
| s4 | conversation | 55 | 5 | 5 |
| s4 | osesp-contato | 18 | 2 | 2 |
| s4 | toolstation-plumbing | 477 | 59 | 0 |
| s4 | tst-ouvidoria | 80 | 8 | 8 |
| s4 | ufpr-br | 57 | 2 | 2 |

All 72 snapshots: 616 grounded shared-text candidates before, 557 after.
