# Revisão humana dos achados do Rampa: 100 itens

Esta pasta é uma amostra cega de 100 achados do Rampa em páginas reais, tirada das rodadas 3, 4 e 5 dos estudos (outubro de 2026). Até agora, todo número de precisão desses estudos se apoia em rótulos de dois agentes Claude (o auditor e o cético). Aqui você rotula os mesmos achados sem ver o que eles disseram; depois um script compara os rótulos. Destes 100, 30 também vão para uma segunda pessoa (pasta `pacote-30`), para medir a concordância entre duas pessoas.

Como a amostra foi tirada, o que foi escondido e como é a análise: `docs/studies/human-review-plan.md`, no repositório.

## Antes de começar

- **Não olhe os rótulos dos estudos antes de exportar os seus.** Isso inclui `study/round-*/labels/`, os `data/findings.json` e `data/summary.json` das rodadas, as tabelas de falsos positivos por página dos relatórios `docs/studies/real-pages-2026-10-round*.md` e das notas de precisão, o `study/human-review-2026-10/data/sample.json` e qualquer saída do `analyze.py`. Os arquivos desta pasta podem ser abertos: neles não há rótulo, causa, justificativa, confiança nem correção sugerida.
- Você já leu os relatórios, então conhece números agregados (por exemplo, que as páginas com rajada de achados foram rotuladas como falsas). Tudo bem: o que importa é não saber o rótulo de cada item. Julgue cada um pelo que ele mostra.
- **Use um perfil de navegador só para isso** (um perfil novo no Chrome ou no Edge). O Lab guarda os rótulos no navegador e exporta todos os que estiverem lá. Os itens desta pasta têm fingerprints próprias, então nenhum rótulo antigo aparece neles, mas um perfil separado deixa a exportação limpa.
- **Tempo:** de 1,5 a 2,5 minutos por item, em média; mais quando é preciso abrir a página ao vivo. Os 100 dão de 2h30 a 4h. Pode dividir em sessões: no mesmo perfil, os rótulos continuam salvos de uma sessão para outra.

## 1. Abrir e carregar

1. Abra <https://rampalab.guilhermebs.com.br/pt/> e entre em **Revisão**, no menu.
2. Clique em **Escolher uma pasta** e escolha esta pasta, `pacote-100`, inteira. Arrastar a pasta para a página também funciona. Se o navegador perguntar se pode "carregar" os arquivos, confirme: eles são lidos no navegador e não saem do computador.
3. Deve aparecer "Carregados: 1 arquivo com 100 itens para revisar e 43 snapshots". Se algo der errado, a lista "Não foi possível carregar" diz o quê.
4. Em **Seus rótulos**, no campo **Quem rotula**, escreva seu nome (por exemplo, `guilherme`). Ele vai no arquivo exportado.
5. Deixe **Mostrar os juízes do estudo** desligado. Não há juízes no pacote, mas não ligue mesmo assim.
6. Em **O que revisar**, deixe as listas como estão. Todos os itens aparecem como "Achado" de propósito: a lista em que o Rampa os colocou foi tirada, para você não saber o quanto ele estava confiante. Pelo mesmo motivo, não aparecem a confiança, a correção sugerida nem a metade (dev ou teste) do estudo.

O Lab mostra os itens agrupados por critério e, dentro de cada critério, por página. A ordem das páginas e dos itens foi sorteada.

## 2. O que cada item mostra

- **O título** é a afirmação do Rampa sobre o elemento. É ela que você julga.
- **Página**: link para a página ao vivo. Ela pode ter mudado desde a coleta (23 a 28 de outubro de 2026). Julgue a página como foi capturada e use a página ao vivo como apoio quando o snapshot não bastar. Se ela mudou e isso pesa no rótulo, diga na nota.
- **Critério**, **Verificação** ("Julgamento de um modelo"), **Elemento** (o seletor CSS) e **Fingerprint**.
- **Evidência**: o trecho citado da página.
- **O recorte do elemento**, para imagens: o que o modelo viu ao julgar.
- **O HTML do elemento** e **No snapshot**: papel, nome acessível, nome que o navegador calculou, texto, atributos, até quatro elementos em volta ("Dentro de") e, para links, "Para onde leva", com o título e o primeiro cabeçalho do destino quando o Rampa o leu. Parágrafos aparecem só com o texto, sem HTML.
- **Imagem de contexto**, fora do Lab: `contexto/<fingerprint>.jpg`, nesta pasta. É o elemento contornado em magenta na captura de tela da página inteira. Só 53 dos 100 itens têm uma: a captura de tela foi feita à parte do snapshot, e em várias páginas o layout mudou entre uma e outro (conteúdo carregado depois, carrosséis, barras fixas). Por isso a imagem só foi gerada quando os recortes da própria página batem com a captura. Quando não houver imagem, use o snapshot e a página ao vivo.

O que o Lab não mostra e os juízes tinham: os cabeçalhos perto do elemento e o atributo `lang` da página e dos elementos em volta, que importa em 3.1.1 e 3.1.2. A mensagem diz qual idioma o Rampa leu. Para conferir, veja o `lang` do nó raiz (`"ref": "html"`) e dos ancestrais em `snapshots/<slug>.snapshot.json`, ou inspecione a página ao vivo.

## 3. Como rotular

Com o foco no item, as teclas são: **T** verdadeiro positivo, **F** falso positivo, **U** incerto; **1** a **5** escolhem a causa de um falso positivo e **0** a limpa; **E** vai para a nota e **Esc** volta; **N** próximo, **P** anterior, **Shift+N** próximo sem rótulo. Também dá para usar os botões. Os rótulos são salvos na hora.

### A rubrica

É a mesma que os juízes Claude receberam (`study/round-5-2026-10-28/judge-rubric.md`, igual nas rodadas 3 a 5), resumida.

Decida se o achado é uma **falha real do critério que ele cita**, naquela página, do jeito que a WCAG 2.2 define o critério: o texto normativo, o documento Understanding, as técnicas suficientes e as falhas documentadas. **Julgue o achado como foi relatado**: a mensagem é a afirmação. Se o elemento falha no critério por outro motivo que não o do achado, diga isso na nota, e só marque verdadeiro se a afirmação, lida com boa vontade, ainda descreve uma falha real.

- **Verdadeiro positivo (T)**: o elemento falha no critério, como o achado diz.
- **Falso positivo (F)**: ele não falha neste critério, ou o que o achado descreve não é uma falha dele. Se for falha de outro critério, diga qual na nota.
- **Incerto (U)**: a evidência não basta para decidir, ou auditores competentes discordariam com razão.

**Causa**, só para falso positivo (opcional, mas ajuda a comparar):

1. **Falta de contexto**: faltou ao verificador um contexto de que ele precisava (um destino que ele nunca leu, o texto em volta do elemento).
2. **Erro do modelo**: ele tinha o contexto e julgou errado.
3. **Critério mal aplicado**: ele aplicou uma regra mais rígida ou diferente da que o critério exige.
4. **Erro do coletor**: o snapshot deu dados errados (um recorte errado, um nome calculado errado, um elemento que não é o que o snapshot diz).
5. **Outra**: nenhuma destas; diga qual na nota.

**Nota**: algumas frases simples. O que é o elemento, o que você conferiu e por que o rótulo. É a nota que vai resolver as divergências depois.

### Os critérios da amostra

Um resumo do que a WCAG 2.2 pede em cada um. Na dúvida, vale o documento Understanding (em inglês), no link.

- **1.1.1 Conteúdo não textual (A)**: todo conteúdo não textual tem uma alternativa em texto com a mesma finalidade. Uma imagem informativa precisa de um `alt` que diga o que ela comunica ali. Uma imagem que é todo o conteúdo de um link ou botão precisa de um `alt` que diga aonde o link leva ou o que o botão faz; se o link já tem texto que diz isso, a imagem pode ser decorativa. Uma imagem decorativa deve ser ignorada (`alt=""`). Um `alt` que não é alternativa (nome de arquivo, "imagem", placeholder) é a falha F30; um `alt` não vazio numa imagem que deveria ser ignorada é a F39. [Understanding 1.1.1](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)
- **1.3.5 Identificar o propósito de entrada (AA)**: um campo que coleta um dado **sobre o próprio usuário**, de um dos tipos da lista da WCAG (nome, e-mail, telefone, CEP, endereço e outros), precisa ter esse propósito determinável por programa; em HTML, o `autocomplete` com o valor certo. Um campo de busca, ou o e-mail de outra pessoa, não entra. [Understanding 1.3.5](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html)
- **2.4.4 Finalidade do link (em contexto) (A)**: dá para saber a finalidade de cada link pelo texto dele, ou pelo texto junto com o contexto do link determinado por programa, exceto quando a finalidade seria ambígua para qualquer usuário. Conta como contexto: a mesma frase, o mesmo parágrafo, o mesmo item de lista, a célula de tabela e o cabeçalho associado a ela, o cabeçalho que vem antes do link (técnica H80) e, numa lista aninhada, o item de lista pai (técnica H81). Vários links com o mesmo texto indo para lugares diferentes só falham quando nada disso os distingue. [Understanding 2.4.4](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html)
- **2.4.6 Cabeçalhos e rótulos (AA)**: cabeçalhos e rótulos descrevem o tópico ou a finalidade. O critério não exige que existam; exige que, quando existem, descrevam. Aqui, "rótulo" é o rótulo de um campo de formulário. [Understanding 2.4.6](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)
- **3.1.1 Idioma da página (A)**: o idioma padrão da página é determinável por programa: `lang` no `<html>`, com o valor certo para o conteúdo servido. [Understanding 3.1.1](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html)
- **3.1.2 Idioma de partes (AA)**: o idioma de cada passagem ou frase é determinável por programa, exceto nomes próprios, termos técnicos, palavras de idioma indeterminado e palavras ou frases que viraram parte do vernáculo do texto em volta. [Understanding 3.1.2](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html)
- **3.3.2 Rótulos ou instruções (A)**: quando o conteúdo pede uma entrada do usuário, há rótulos ou instruções. Eles precisam estar na tela: um nome só em `aria-label` ou só no `title` (que aparece como dica ao passar o mouse) não é visto por todo mundo. Um botão ao lado que deixa claro o propósito do campo, como "Buscar", pode servir de rótulo (técnica G167). [Understanding 3.3.2](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)

## 4. Exportar

1. No fim, e ao fim de cada sessão como cópia de segurança, clique em **Exportar rótulos**, em "Seus rótulos". O navegador baixa `rampa-lab-labels-<seu nome>-<data>.json`.
2. Uma nota sem rótulo não é exportada; o Lab avisa quantas ficaram de fora.
3. O arquivo leva todos os rótulos deste navegador; o script de análise usa só os desta amostra.
4. Guarde o arquivo em `study/human-review-2026-10/labels/` (crie a pasta).

## 5. A segunda pessoa

1. Compacte a pasta `pacote-30` e entregue a ela; o `LEIA-ME.md` de lá é a versão curta destas instruções.
2. Não converse com ela sobre os itens antes de ela exportar.
3. Os 30 dela estão entre os seus 100, com as mesmas fingerprints, e o script compara os dois.

## 6. A análise

Só depois que as duas pessoas exportarem, porque o relatório mostra os rótulos do Claude. Na raiz do repositório:

```sh
python -I study/human-review-2026-10/scripts/analyze.py study/human-review-2026-10/labels/rampa-lab-labels-<você>-<data>.json study/human-review-2026-10/labels/rampa-lab-labels-<segunda pessoa>-<data>.json --out study/human-review-2026-10/labels/relatorio.md
```

O relatório traz a concordância e o kappa de Cohen entre você e o Claude (no geral, por critério e por tipo de afirmação), o kappa entre as duas pessoas nos 30 (a meta é 0,61 ou mais) e a precisão que cada estudo teria com os rótulos humanos nos itens sorteados, como estimativa a partir de uma amostra.
