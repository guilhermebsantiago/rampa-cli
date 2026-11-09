# Offline replay of 1.1.1 on the dev halves: before against after

Sets keyed by criterion, ref, fingerprint and source (suggestions by criterion, ref and rule). Misses are the reports' `offlineMisses`; calls are new model calls (none can happen offline). In-sample: dev pages.

| Study | Pages | Identical sets | Misses before | Misses after | Calls before | Calls after | Message changes | Other changes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s2 | 12 | 12 / 12 | 0 | 0 | 0 | 0 | 0 | 0 |
| s3 | 12 | 12 / 12 | 0 | 0 | 0 | 0 | 2 | 0 |
| s4 | 12 | 12 / 12 | 0 | 0 | 0 | 0 | 0 | 0 |
| s5 | 12 | 12 / 12 | 0 | 0 | 0 | 0 | 0 | 0 |

## Message changes

| Study | Page | List | Ref | Before | After | A (b) item of count.json |
| --- | --- | --- | --- | --- | --- | --- |
| s3 | hcor-com-br | needsReview | `html > body > section > div:nth-of-type(1) > div:nth-of-type(1) > div > div:nth-of-type(4) > div > picture > img` | The text alternative "Alerta de Golpe" describes something the image does not show. | The text alternative "Alerta de Golpe" leaves out what the image conveys here. | yes |
| s3 | hcor-com-br | needsReview | `html > body > section > div:nth-of-type(1) > div:nth-of-type(1) > div > div:nth-of-type(9) > div > picture > img` | The text alternative "Alerta de Golpe" describes something the image does not show. | The text alternative "Alerta de Golpe" leaves out what the image conveys here. | yes |

Other differences between the reports (createdAt aside): 0.

(b) items with new wording that no report shows: 1.
- s5 hering "Vestidos": discarded by verify on `#__next > section:nth-of-type(4) > ul > li:nth-of-type(1) > div > a > img`: the alternative repeats the visible text of the link or button it sits in.
