# 1.1.1 "describes something the image does not show": suggestions that keep the alternative (dev halves, counted)

Distinct (page, alternative, suggestion) among the cached answers with verdict `fail` and problem `wrong_content`, classed in the order `verify` reads them (`count.ts`). In-sample: dev pages, read when the rule was written.

| Study | Dev pages | Cached answers | Items | (a) suggestion keeps it exactly | (b) suggestion keeps it only with forms | (c) description and suggestion keep it exactly | (d) (c) only with forms | (e) none | of (c), suggestion keeps it with forms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s2 | 12 | 46 | 33 | 14 | 0 | 0 | 0 | 19 | 0 |
| s3 | 12 | 54 | 40 | 4 | 1 | 6 | 0 | 29 | 0 |
| s4 | 12 | 17 | 17 | 1 | 0 | 1 | 0 | 15 | 0 |
| s5 | 12 | 45 | 45 | 3 | 1 | 0 | 0 | 41 | 0 |
| all | 48 | 162 | 135 | 22 | 2 | 7 | 0 | 104 | 0 |

## Items in (b) and (d)

| Study | Page | Class | Alternative | Suggestion | New wording | Claude final label (findings.json) |
| --- | --- | --- | --- | --- | --- | --- |
| s3 | hcor-com-br | b | Alerta de Golpe | Alerta de segurança: Evite golpes. O Hcor não faz ligações para solicitar pagamentos antecipados. | yes | false_positive, false_positive |
| s5 | hering | b | Vestidos | Mulher usando vestido de alças com estampa abstrata | yes | no finding |
