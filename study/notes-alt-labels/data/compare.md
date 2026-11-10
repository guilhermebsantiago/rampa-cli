# Offline replay of 1.1.1 on the dev halves: before against after

Sets keyed by criterion, ref, fingerprint and source (suggestions by criterion, ref and rule). Misses are the reports' `offlineMisses`; calls are new model calls (none can happen offline). Labels: the studies' two Claude judges (data/findings.json, dev rows, same page and ref). In-sample: dev pages.

| Study | Pages | Identical sets | Misses before | Misses after | Calls before | Calls after | Place or confirmation changes | Message changes | Other changes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s2 | 12 | 12 / 12 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| s3 | 12 | 12 / 12 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| s4 | 12 | 12 / 12 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| s5 | 12 | 12 / 12 | 0 | 0 | 0 | 0 | 3 | 14 | 11 |

## Part (a): elements whose place or second-pass confirmation changes

| Study | Page | Alternative | Rule | Before | After | Confirmation before | Confirmation after | Claude final label |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s5 | ms-gov-br | not found | absence | findings | findings | 3 framings, min 1.000 | none | true_positive |
| s5 | hering | HOME_GERAL_TV1_TUDO_COM_60 | identifier | findings | findings | 3 framings, min 0.997 | none | true_positive |
| s5 | hering | HOME_GERAL_TV1_ALTO_VERAO | identifier | findings | findings | 3 framings, min 1.000 | none | true_positive |

## Message changes on pages whose sets are identical

| Study | Page | List | Alternative | Before | After | New wording | Claude final label |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s2 | martinsfontes-literatura | findings | Banner padrão | The text alternative "Banner padrão" describes something the image does not show. | The text alternative "Banner padrão" names a label, not what the image conveys here. | names a label | true_positive |
| s3 | pbs-article | findings | fullepisode | The text alternative "fullepisode" describes something the image does not show. | The text alternative "fullepisode" names a label, not what the image conveys here. | names a label | false_positive |
| s4 | infomoney-article | needsReview | Autor avatar | The text alternative "Autor avatar" describes something the image does not show. | The text alternative "Autor avatar" names a label, not what the image conveys here. | names a label | false_positive |
| s4 | osesp-contato | findings | Patrocinador | The text alternative "Patrocinador" describes something the image does not show. | The text alternative "Patrocinador" names a label, not what the image conveys here. | names a label | true_positive |
| s4 | bhf-article | needsReview | BHF logo | The text alternative "BHF logo" describes something the image does not show. | The text alternative "BHF logo" names a label, not what the image conveys here. | names a label | false_positive (noconfirm-only) |
| s5 | ms-gov-br | findings | not found | The text alternative "not found" describes something the image does not show. | The text alternative "not found" is a file name or a placeholder. | placeholder | true_positive |
| s5 | ms-gov-br | findings | Contraste | The text alternative "Contraste" describes something the image does not show. | The text alternative "Contraste" names a label, not what the image conveys here. | names a label | true_positive |
| s5 | ms-gov-br | findings | Rodapé 2 | The text alternative "Rodapé 2" describes something the image does not show. | The text alternative "Rodapé 2" names a label, not what the image conveys here. | names a label | true_positive |
| s5 | pucrs-graduacao | needsReview | ico login | The text alternative "ico login" describes something the image does not show. | The text alternative "ico login" names a label, not what the image conveys here. | names a label | false_positive (noconfirm-only) |
| s5 | pucrs-graduacao | needsReview | ico search | The text alternative "ico search" describes something the image does not show. | The text alternative "ico search" names a label, not what the image conveys here. | names a label | false_positive (noconfirm-only) |
| s5 | hering | findings | HOME_GERAL_TV1_TUDO_COM_60 | The text alternative "HOME_GERAL_TV1_TUDO_COM_60" describes something the image does not show. | The text alternative "HOME_GERAL_TV1_TUDO_COM_60" is a file name or a placeholder. | placeholder | true_positive |
| s5 | hering | findings | HOME_GERAL_TV1_ALTO_VERAO | The text alternative "HOME_GERAL_TV1_ALTO_VERAO" describes something the image does not show. | The text alternative "HOME_GERAL_TV1_ALTO_VERAO" is a file name or a placeholder. | placeholder | true_positive |
| s5 | hering | findings | payment | The text alternative "payment" describes something the image does not show. | The text alternative "payment" names a label, not what the image conveys here. | names a label | true_positive (noconfirm-only) |
| s5 | hering | findings | payment | The text alternative "payment" describes something the image does not show. | The text alternative "payment" names a label, not what the image conveys here. | names a label | true_positive (noconfirm-only) |
| s5 | hering | findings | payment | The text alternative "payment" describes something the image does not show. | The text alternative "payment" names a label, not what the image conveys here. | names a label | true_positive (noconfirm-only) |
| s5 | hering | findings | payment | The text alternative "payment" describes something the image does not show. | The text alternative "payment" names a label, not what the image conveys here. | names a label | true_positive |
| s5 | hering | findings | payment | The text alternative "payment" describes something the image does not show. | The text alternative "payment" names a label, not what the image conveys here. | names a label | true_positive (noconfirm-only) |
| s5 | hering | findings | payment | The text alternative "payment" describes something the image does not show. | The text alternative "payment" names a label, not what the image conveys here. | names a label | true_positive (noconfirm-only) |
| s5 | hering | findings | payment | The text alternative "payment" describes something the image does not show. | The text alternative "payment" names a label, not what the image conveys here. | names a label | true_positive (noconfirm-only) |

## Findings worded "describes something the image does not show" before, by their wording after

| Wording after | True | False | Uncertain | Unlabelled | All |
| --- | --- | --- | --- | --- | --- |
| placeholder | 3 | 0 | 0 | 0 | 3 |
| names a label | 11 | 1 | 0 | 0 | 12 |
| leaves out | 0 | 0 | 0 | 0 | 0 |
| unchanged ("does not show") | 2 | 3 | 0 | 0 | 5 |

Other differences between the reports (createdAt aside): 11.
- s5 ms-gov-br `/criteria[0]/confirmed`: 3 → 2
- s5 ms-gov-br `/findings[1]/confirmation`: {"framings":3,"minProbability":0.9999917953360224} → undefined
- s5 ms-gov-br `/usage/cachedCalls`: 15 → 12
- s5 ms-gov-br `/usage/inputTokens`: 7026 → 5996
- s5 ms-gov-br `/usage/outputTokens`: 521 → 515
- s5 hering `/criteria[0]/confirmed`: 9 → 7
- s5 hering `/findings[0]/confirmation`: {"framings":3,"minProbability":0.9973582647781668} → undefined
- s5 hering `/findings[1]/confirmation`: {"framings":3,"minProbability":0.9999450182330575} → undefined
- s5 hering `/usage/cachedCalls`: 63 → 57
- s5 hering `/usage/inputTokens`: 44195 → 38981
- s5 hering `/usage/outputTokens`: 2020 → 2008
