# Offline replay of 1.1.1 on the dev halves: before against after

Floor: 0.05. Sets keyed by criterion, ref, fingerprint, source and rule (suggestions have no fingerprint). Misses are the reports' `offlineMisses`; calls are new model calls (none can happen offline). Counted, in-sample: dev pages only.

| Study | Pages | Same sets | Misses before | Misses after | Calls before | Calls after | Findings to suggestions | Unexpected | Other changes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s2 | 12 | 12 / 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| s3 | 12 | 11 / 12 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| s4 | 12 | 11 / 12 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| s5 | 12 | 12 / 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Findings of "before" confirmed with an identical claim

Label: the two Claude judges' final label in the study's data/findings.json (dev rows, the same slug, criterion and ref), not a person's.

| Study | Page | Alternative | Ref | Own min. probability | Group (claims, confirmed on their own) | After | Label |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s3 | puc-rio-vestibular | Imagem de alunos no Campus da PUC-Rio | `#VG-topo > div:nth-of-type(2) > div > div > div:nth-of-type(2) > a > img` | 0.013 | 2, 1 | **suggestion** | false_positive |
| s4 | cobasi-cachorro | Ilustração SVG demonstrativa cachorro | `#__next > div > div:nth-of-type(4) > div > div > picture > img` | 0.00068 | 2, 1 | **suggestion** | false_positive (noconfirm-only) |
| s5 | hering | payment | `#__next > footer > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > ul > li:nth-of-type(1) > img` | 0.959 | 7, 1 | stays a finding | true_positive (noconfirm-only) |
| s5 | hering | payment | `#__next > footer > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > ul > li:nth-of-type(2) > img` | 0.336 | 7, 1 | stays a finding | true_positive (noconfirm-only) |
| s5 | hering | payment | `#__next > footer > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > ul > li:nth-of-type(3) > img` | 0.655 | 7, 1 | stays a finding | true_positive (noconfirm-only) |
| s5 | hering | payment | `#__next > footer > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > ul > li:nth-of-type(5) > img` | 0.694 | 7, 1 | stays a finding | true_positive (noconfirm-only) |
| s5 | hering | payment | `#__next > footer > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > ul > li:nth-of-type(6) > img` | 0.120 | 7, 1 | stays a finding | true_positive (noconfirm-only) |
| s5 | hering | payment | `#__next > footer > div > div:nth-of-type(2) > div > div:nth-of-type(2) > div:nth-of-type(2) > div > ul > li:nth-of-type(7) > img` | 0.528 | 7, 1 | stays a finding | true_positive (noconfirm-only) |

## Findings that became suggestions

- s3 puc-rio-vestibular "Imagem de alunos no Campus da PUC-Rio" `#VG-topo > div:nth-of-type(2) > div > div > div:nth-of-type(2) > a > img`, own min. probability 0.013: The model suggests: "Duas estudantes sorridentes usando um notebook no campus da PUC-Rio" · A second pass, asked one word at a time three ways, did not confirm it (rules: fail (1.00), claim: no (0.01), reversed: no (0.99))
- s4 cobasi-cachorro "Ilustração SVG demonstrativa cachorro" `#__next > div > div:nth-of-type(4) > div > div > picture > img`, own min. probability 0.00068: The model suggests: "Ilustração estilizada de uma folha de carvalho, um broto e um cachorro azul." · A second pass, asked one word at a time three ways, did not confirm it (rules: fail (0.93), claim: no (0.00), reversed: yes (0.06))

Unexpected moves, items that appeared or left otherwise, and missing reports: 0.

Other differences between the reports (createdAt aside, the moved items out of both, the counts that follow the moves aside): 0.
