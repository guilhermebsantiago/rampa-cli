# 1.1.1 identifiers, absence texts and short alternatives in the cached answers (dev halves, counted)

Distinct (page, alternative) among the cached 1.1.1 answers about an image with an alternative (`count.ts`). In-sample: dev pages, read when the rules were written. An alternative cached with both verdicts counts under each.

## Part (a): alternatives the new placeholder rules match

| Study | Dev pages | Cached answers | Alternatives | Identifier | with a pass | with a fail | already a placeholder before | Absence text | with a pass | with a fail | already a placeholder before |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s2 | 12 | 270 | 126 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| s3 | 12 | 234 | 106 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| s4 | 12 | 87 | 84 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| s5 | 12 | 82 | 63 | 2 | 0 | 2 | 0 | 1 | 0 | 1 | 0 |
| all | 48 | 673 | 379 | 2 | 0 | 2 | 0 | 1 | 0 | 1 | 0 |

| Study | Page | Rule | Alternative | Cached verdicts | Placeholder before | Claude final label (findings.json) |
| --- | --- | --- | --- | --- | --- | --- |
| s5 | ms-gov-br | absence | not found | fail ×1 (wrong_content ×1) | no | true_positive |
| s5 | hering | identifier | HOME_GERAL_TV1_ALTO_VERAO | fail ×1 (wrong_content ×1) | no | true_positive |
| s5 | hering | identifier | HOME_GERAL_TV1_TUDO_COM_60 | fail ×1 (wrong_content ×1) | no | true_positive |

## Part (b): short alternatives among the "describes something the image does not show" answers

| Study | Alternatives with a fail / wrong_content answer | Short (one or two words) | of which a placeholder or a generic word (that wording wins) | of which the new wording can apply |
| --- | --- | --- | --- | --- |
| s2 | 24 | 14 | 0 | 14 |
| s3 | 28 | 10 | 0 | 10 |
| s4 | 16 | 8 | 0 | 8 |
| s5 | 35 | 15 | 3 | 12 |
| all | 103 | 47 | 3 | 44 |

Whether an image is all its link or button holds (its wording wins) or the answer is worded "leaves out" is not in the cache: the replay says which of these one build reports and how.

| Study | Page | Alternative | Placeholder or generic | Claude final label (findings.json) |
| --- | --- | --- | --- | --- |
| s2 | poder360-com-br | Lula | no | false_positive |
| s2 | martinsfontes-literatura | Banner padrão | no | true_positive |
| s2 | fiocruz-br | Boletim InfoGripe | no | false_positive |
| s2 | fiocruz-br | Instagram | no | no finding |
| s2 | fiocruz-br | Twiter | no | no finding |
| s2 | pinacoteca-org-br | Pinacoteca | no | false_positive |
| s2 | rijksmuseum-nl-newsletter | Facebooklogo | no | false_positive |
| s2 | rijksmuseum-nl-newsletter | ING - Engelslogo | no | false_positive |
| s2 | rijksmuseum-nl-newsletter | Instagramlogo | no | false_positive |
| s2 | rijksmuseum-nl-newsletter | KPN - Engelslogo | no | no finding |
| s2 | rijksmuseum-nl-newsletter | Linkedinlogo | no | false_positive |
| s2 | rijksmuseum-nl-newsletter | Tiktoklogo | no | false_positive |
| s2 | rijksmuseum-nl-newsletter | Vriendenloterij - ENGlogo | no | no finding |
| s2 | rijksmuseum-nl-newsletter | Youtubelogo | no | false_positive |
| s3 | cnj-ouvidoria | en | no | false_positive |
| s3 | cnj-ouvidoria | es | no | false_positive |
| s3 | cnj-ouvidoria | pt | no | false_positive |
| s3 | hcor-com-br | Pacientes Internacionales | no | no finding |
| s3 | pbs-article | fullepisode | no | false_positive |
| s3 | clevelandclinic | cancer icon | no | false_positive |
| s3 | clevelandclinic | Exclamation point | no | no finding |
| s3 | clevelandclinic | heart icon | no | false_positive |
| s3 | clevelandclinic | Pause icon | no | no finding |
| s3 | clevelandclinic | stomach icon | no | false_positive |
| s4 | infomoney-article | Autor avatar | no | false_positive |
| s4 | osesp-contato | Patrocinador | no | true_positive |
| s4 | gov-scot | gov.scot | no | no finding |
| s4 | toolstation-plumbing | 5% OFF + | no | no finding |
| s4 | toolstation-plumbing | CLICK & COLLECT | no | no finding |
| s4 | toolstation-plumbing | Compression Waste | no | no finding |
| s4 | toolstation-plumbing | FREE DELIVERY | no | no finding |
| s4 | bhf-article | BHF logo | no | false_positive (noconfirm-only) |
| s5 | ms-gov-br | Contraste | no | true_positive |
| s5 | ms-gov-br | not found | yes | true_positive |
| s5 | ms-gov-br | Rodapé 2 | no | true_positive |
| s5 | pucrs-graduacao | Disciplina isolada | no | no finding |
| s5 | pucrs-graduacao | ico login | no | false_positive (noconfirm-only) |
| s5 | pucrs-graduacao | ico search | no | uncertain (noconfirm-only), false_positive (noconfirm-only) |
| s5 | pucrs-graduacao | pt | no | no finding |
| s5 | pucrs-graduacao | Reingresso | no | no finding |
| s5 | pucrs-graduacao | Vestibular | no | no finding |
| s5 | hering | payment | no | true_positive, true_positive (noconfirm-only), true_positive (noconfirm-only), true_positive (noconfirm-only), true_positive (noconfirm-only), true_positive (noconfirm-only), true_positive (noconfirm-only) |
| s5 | hering | Vestidos | no | no finding |
| s5 | santacasasp | icone youtube | no | no finding |
| s5 | ncl-ac-uk | logo | yes | true_positive |
| s5 | irishcentral-article | logo | yes | true_positive |
| s5 | lakeland | Lakeland Logo | no | no finding |
