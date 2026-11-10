# The capture section in four formats: byte comparison on the 48 dev pages

First build: .rampa/capture-report/dist-before. Second build: .rampa/capture-report/dist-after. Reports: .rampa/capture-report/replay/after. Counted, in-sample (dev).

Pages read: 48. Pages whose record has a line to show: 41. Pages whose record has none: 7 (s2 ons-gov-uk, s2 berkeley-edu-admissions, s2 rijksmuseum-nl-newsletter, s3 tate-contact, s4 osesp-contato, s4 nls-contact, s5 food-ratings).

| Runs | Format | Verbose | Runs compared | No `capture`: same bytes | No line: runs | No line: same bytes | With lines: runs | With lines: section exact, rest same bytes |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| one page | pretty | default | 48 | 48 | 7 | 7 | 41 | 41 |
| one page | pretty | verbose | 48 | 48 | 7 | 7 | 41 | 41 |
| one page | markdown | default | 48 | 48 | 7 | 7 | 41 | 41 |
| one page | markdown | verbose | 48 | 48 | 7 | 7 | 41 | 41 |
| one page | html | default | 48 | 48 | 7 | 7 | 41 | 41 |
| one page | html | verbose | 48 | 48 | 7 | 7 | 41 | 41 |
| one page | sarif | default | 48 | 48 | 7 | 7 | 41 | 41 |
| one page | sarif | verbose | 48 | 48 | 7 | 7 | 41 | 41 |
| a study's 12 pages | pretty | default | 4 | 4 | 0 | 0 | 4 | 4 |
| a study's 12 pages | pretty | verbose | 4 | 4 | 0 | 0 | 4 | 4 |
| a study's 12 pages | markdown | default | 4 | 4 | 0 | 0 | 4 | 4 |
| a study's 12 pages | markdown | verbose | 4 | 4 | 0 | 0 | 4 | 4 |
| a study's 12 pages | html | default | 4 | 4 | 0 | 0 | 4 | 4 |
| a study's 12 pages | html | verbose | 4 | 4 | 0 | 0 | 4 | 4 |
| a study's 12 pages | sarif | default | 4 | 4 | 0 | 0 | 4 | 4 |
| a study's 12 pages | sarif | verbose | 4 | 4 | 0 | 0 | 4 | 4 |

| Command output (second build) | Pages | Same as formatReports from the JSON report |
| --- | ---: | ---: |
| terminal (stdout) | 48 | 48 |
| markdown | 48 | 48 |
| html | 48 | 48 |
| sarif | 48 | 48 |

Failures: 0.

Lines shown, by kind (numbers and brackets elided):

| Line | Lines on the 48 pages |
| --- | ---: |
| Candidates the model did not judge for n.n.n: n of n past th… | 27 |
| The page was still changing (…) when the wait after load rea… | 15 |
| Images: n captured, n not captured: n over the limit of imag… | 10 |
| Images: n captured, n not captured: n outside the page (…); … | 8 |
| The page was cut at n elements, the collector's limit.… | 5 |
| Images: n captured, n not captured: n cut off by the box tha… | 2 |
| Images: n captured, n not captured: n outside the page (…).… | 2 |
| Images: n captured, n not captured: n transparent where it s… | 2 |
| The page's stylesheets: n of n applied, n failed.… | 2 |
| A layer lay over the viewport when the page was read (…); it… | 2 |
| Images: n captured, n not captured: n still loading after th… | 1 |
| Images: n captured, n not captured: n blank in its capture.… | 1 |
