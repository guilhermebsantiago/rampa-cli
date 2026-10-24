# The implementation on the recorded snapshots of studies 2 and 3 (in-sample)

## s3: 24 reports

| split | criterion | TP | FP | unc | new (unlabelled) | precision on labelled |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| dev | 1.1.1 | 6 | 3 | 0 | 0 | 0.67 (0.35–0.88) |
| dev | 1.3.5 | 7 | 0 | 0 | 0 | 1.00 (0.65–1.00) |
| dev | 2.4.4 | 2 | 0 | 1 | 0 | 1.00 (0.34–1.00) |
| dev | **all** | 15 | 3 | 1 | 0 | **0.83 (0.61–0.94)** (before: 0.43 (0.29–0.59)) |
| test | 1.1.1 | 18 | 3 | 0 | 0 | 0.86 (0.65–0.95) |
| test | 1.3.5 | 1 | 0 | 0 | 0 | 1.00 (0.21–1.00) |
| test | 2.4.4 | 5 | 54 | 2 | 0 | 0.08 (0.04–0.18) |
| test | **all** | 24 | 57 | 2 | 0 | **0.30 (0.21–0.40)** (before: 0.24 (0.17–0.34)) |

Both halves: 39 TP, 60 FP, 3 uncertain: **0.39 (0.30–0.49)**. Second pass: {'summary unconfirmed': 23, 'summary confirmed': 23, 'confirmed': 23, 'denied': 23}.

Labelled findings gone (TP = a true positive lost):
- fa dev clevelandclinic 1.1.1 functional-link: 'Cleveland Clinic logo'
- fa dev clevelandclinic 1.1.1 wrong_content: 'cancer icon'
- fa dev clevelandclinic 1.1.1 wrong_content: 'stomach icon'
- fa dev clevelandclinic 1.1.1 wrong_content: 'heart icon'
- fa dev clevelandclinic 1.1.1 wrong_content: 'primary care icon'
- fa dev clevelandclinic 1.1.1 wrong_content: 'Person sitting on a couch looking at their mobile phone.'
- fa dev cnj-ouvidoria 1.1.1 wrong_content: 'pt'
- fa dev cnj-ouvidoria 1.1.1 wrong_content: 'en'
- fa dev cnj-ouvidoria 1.1.1 wrong_content: 'es'
- fa dev cnj-ouvidoria 1.1.1 wrong_content: 'banner web da ouvidoria do cnj. Fundo verde com letras brancas'
- fa dev cnj-ouvidoria 2.4.4 link-url: 'www.cnj.jus.br/comopeticionar.'
- fa test correio 1.1.1 wrong_content: 'Flávio Bolsonaro e Lula em disputa acirrada pela Presidência - (crédito: Charles Vieira e Ricardo Stuckert)'
- fa test ed-ac-uk 1.1.1 wrong_content: 'Research and teaching'
- fa dev hcor-com-br 1.1.1 wrong_content: 'Alerta de Golpe'
- fa dev hcor-com-br 1.1.1 functional-link: 'Banner FAQ - Portal do Paciente'
- fa dev hcor-com-br 1.1.1 wrong_content: 'Alerta de Golpe'
- fa test itaucultural-contato 3.3.2 no-visible-instruction: 'Buscar'
- fa dev metropoles-com 1.1.1 wrong_content: 'Blog do Noblat'
- fa test nps-findapark 1.1.1 wrong_content: 'Abraham Lincoln Birthplace banner image'
- fa test nps-findapark 1.1.1 wrong_content: 'Acadia banner image'
- fa test nps-findapark 1.1.1 wrong_content: 'Adams banner image'
- fa test nps-findapark 1.1.1 wrong_content: 'African American Civil War Memorial banner image'
- fa test nps-findapark 1.1.1 wrong_content: 'African Burial Ground banner image'
- fa test nps-findapark 1.1.1 wrong_content: 'Agate Fossil Beds banner image'
- fa test nps-findapark 1.1.1 wrong_content: 'Alagnak banner image'
- fa test nps-findapark 1.1.1 wrong_content: 'Ala Kahakai banner image'
- fa test nps-findapark 1.1.1 wrong_content: 'Alaska Public Lands banner image'
- fa test nps-findapark 1.1.1 wrong_content: 'Alcatraz Island banner image'
- fa dev pbs-article 1.1.1 functional-link: 'Viewers Like You'
- fa test pimoroni 1.1.1 functional-link: 'Pimoroni'
- fa dev puc-rio-vestibular 1.1.1 wrong_content: 'Imagem de alunos no Campus da PUC-Rio'
- fa dev puc-rio-vestibular 1.1.1 functional-link: 'Selo da Arquidiocese de São Sebastião do Rio de Janeiro'
- fa test vam-ac-uk 1.1.1 wrong_content: 'map'
- fa test vam-ac-uk 1.1.1 wrong_content: 'Shop at V&A South Kensington'
- fa test vam-ac-uk 2.4.6 label-says-nothing: 'name@example.com'
- fa test vam-ac-uk 2.4.6 label-says-nothing: 'name@example.com'
- tr dev cnj-ouvidoria 1.1.1 wrong_content: 'Botão Rybená LIBRAS'
- un test irishtimes-com 1.1.1 wrong_content: 'Masthead logo'
- un test itaucultural-contato 1.1.1 functional-link: 'Logo IC Cultural'

New findings, unlabelled:

## s2: 24 reports

| split | criterion | TP | FP | unc | new (unlabelled) | precision on labelled |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| dev | 1.1.1 | 6 | 0 | 2 | 0 | 1.00 (0.61–1.00) |
| dev | 1.3.5 | 10 | 0 | 0 | 0 | 1.00 (0.72–1.00) |
| dev | 2.4.4 (carried from s2-after) | 2 | 0 | 0 | 0 | 1.00 (0.34–1.00) |
| dev | 3.1.2 | 1 | 0 | 0 | 0 | 1.00 (0.21–1.00) |
| dev | **all** | 19 | 0 | 2 | 0 | **1.00 (0.83–1.00)** (before: 0.49 (0.34–0.64)) |
| test | 1.1.1 | 6 | 1 | 0 | 0 | 0.86 (0.49–0.97) |
| test | 1.3.5 | 1 | 0 | 0 | 0 | 1.00 (0.21–1.00) |
| test | 2.4.4 (carried from s2-after) | 3 | 2 | 0 | 0 | 0.60 (0.23–0.88) |
| test | **all** | 10 | 3 | 0 | 0 | **0.77 (0.50–0.92)** (before: 0.38 (0.23–0.55)) |

Both halves: 29 TP, 3 FP, 2 uncertain: **0.91 (0.76–0.97)**. Second pass: {'summary unconfirmed': 9, 'summary confirmed': 9, 'denied': 9, 'confirmed': 9}.

Labelled findings gone (TP = a true positive lost):
- fa test bl-uk 1.1.1 wrong_content: 'British Library clocktower'
- fa test bl-uk 1.1.1 wrong_content: 'The corner of a highly decorated page'
- fa test cdc-gov 1.1.1 wrong_content: 'Man in a blue shirt standing outdoors'
- fa test cdc-gov 1.1.1 functional-link: 'x icon'
- fa test cdc-gov 1.1.1 functional-link: 'rss icon'
- fa dev ce-gov-br 1.1.1 wrong_content: 'Emitir o licenciamento anual do veículo (CRLV)'
- fa dev ce-gov-br 1.1.1 wrong_content: 'DAE para pagamento de IPVA - boleto/pix'
- fa dev ce-gov-br 1.1.1 wrong_content: 'Transferir a propriedade do veículo'
- fa dev fiocruz-br 1.1.1 wrong_content: 'Boletim InfoGripe'
- fa dev fiocruz-br 1.1.1 functional-link: 'Tour 360º'
- fa dev medlineplus-gov-diabetes 1.1.1 functional-link: 'X'
- fa test metro-sp-gov-br-fale-conosco 2.4.4 link-url: 'www.viaquatro.com.br/fale-conosco'
- fa test metro-sp-gov-br-fale-conosco 2.4.4 link-url: 'www.viamobilidade.com.br/fale-conosco'
- fa dev pinacoteca-org-br 1.1.1 wrong_content: 'Pinacoteca'
- fa dev poder360-com-br 1.1.1 placeholder: 'Lula'
- fa dev poder360-com-br 3.3.2 no-visible-instruction: 'pesquisar'
- fa dev rijksmuseum-nl-newsletter 1.1.1 functional-link: 'ANBIlogo'
- fa dev rijksmuseum-nl-newsletter 1.1.1 wrong_content: 'Instagramlogo'
- fa dev rijksmuseum-nl-newsletter 1.1.1 wrong_content: 'Facebooklogo'
- fa dev rijksmuseum-nl-newsletter 1.1.1 wrong_content: 'Youtubelogo'
- fa dev rijksmuseum-nl-newsletter 1.1.1 wrong_content: 'Tiktoklogo'
- fa dev rijksmuseum-nl-newsletter 1.1.1 wrong_content: 'Linkedinlogo'
- fa dev rijksmuseum-nl-newsletter 1.1.1 wrong_content: 'Ministry of Education, Culture and Sciencelogo'
- fa dev rijksmuseum-nl-newsletter 1.1.1 wrong_content: 'ING - Engelslogo'
- fa test senado-leg-br-falecomosenado 1.1.1 functional-button: 'Aumentar zoom'
- fa test senado-leg-br-falecomosenado 1.1.1 functional-button: 'Diminuir zoom'
- fa test tcd-ie 1.1.1 wrong_content: 'Frontsquare TCD'
- fa test tcd-ie 1.1.1 functional-link: 'X'
- fa test thomann-co-uk 1.1.1 wrong_content: 'oma-with-cookies'
- fa test thomann-co-uk 1.1.1 wrong_content: 'Free Shipping Over'
- fa dev unicamp-br 1.1.1 wrong_content: 'Imagem do campus'
- fa dev unicamp-br 1.1.1 wrong_content: 'Capa da edição 751'
- fa dev unicamp-br 1.1.1 functional-link: 'Imagem aérea da área da saúde com o selo Nova Saúde Unicamp'
- fa dev unicamp-br 3.3.2 no-visible-instruction: 'pesquisar'
- fa test usps-com-zip-code-lookup 2.4.6 label-says-nothing: 'Search USPS.com'
- fa test usps-com-zip-code-lookup 2.4.6 label-says-nothing: 'Search USPS.com'
- fa test usps-com-zip-code-lookup 2.4.6 label-says-nothing: 'Search USPS.com'
- fa test usps-com-zip-code-lookup 2.4.6 label-says-nothing: 'Search USPS.com'
- tr test thomann-co-uk 1.1.1 wrong_content: 'Days Money-Back'
- tr test thomann-co-uk 1.1.1 wrong_content: 'Years warranty'
- tr dev unicamp-br 1.1.1 wrong_content: 'Placas de QR Code estão sendo afixadas nas árvores para proporcionar a pesquisadores e leigos uma observação mais apurada das plantas. Foto: Antonio Scarpinetti'
- un dev fiocruz-br 1.1.1 functional-link: 'Arte transmissões da Fiocruz'
- un dev fiocruz-br 1.1.1 functional-link: 'Pirâmide científica do Museu da Vida tem telescópios, livros, mesas e fotos científicas'

New findings, unlabelled:

## Summary (in-sample)

| study | split | before TP/FP | before precision | after TP/FP/unc | after precision | new unlabelled |
| --- | --- | --- | --- | --- | --- | ---: |
| s3 | dev | 16/21 | 0.43 (0.29–0.59) | 15/3/1 | 0.83 (0.61–0.94) | 0 |
| s3 | test | 24/75 | 0.24 (0.17–0.34) | 24/57/2 | 0.30 (0.21–0.40) | 0 |
| s2 | dev | 20/21 | 0.49 (0.34–0.64) | 19/0/2 | 1.00 (0.83–1.00) | 0 |
| s2 | test | 12/20 | 0.38 (0.23–0.55) | 10/3/0 | 0.77 (0.50–0.92) | 0 |
| **all** | | 72/137 | 0.34 (0.28–0.41) | 68/63 | **0.52 (0.43–0.60)** | 0 |
