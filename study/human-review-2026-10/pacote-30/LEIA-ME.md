# Revisão de 30 achados do Rampa

Oi! Obrigado por topar ajudar.

O Rampa é a ferramenta do TCC do Guilherme. Ela procura problemas de acessibilidade em sites, ou seja, coisas que atrapalham quem navega com leitor de tela, só com o teclado ou com outra tecnologia assistiva. Cada **achado** é uma afirmação da ferramenta sobre um pedaço de uma página, do tipo "o texto alternativo desta imagem descreve algo que ela não mostra". O seu trabalho é dizer se cada afirmação está certa.

São 30 achados, e cada um leva uns 2 a 3 minutos: no total, de 1h a 1h30. Dá para parar e continuar depois, no mesmo navegador e no mesmo computador. Não precisa saber programar.

Três combinados:

- Faça sem conversar com o Guilherme sobre os itens, até mandar o arquivo para ele.
- Não existe "resposta da ferramenta" para acertar: a gente quer a sua leitura.
- Se ficar em dúvida de verdade, marque **Incerto** e escreva o porquê.

## Passo a passo

1. Descompacte a pasta `pacote-30` em algum lugar do computador.
2. No computador (Chrome, Edge ou Firefox), abra <https://rampalab.guilhermebs.com.br/pt/> e clique em **Revisão**, no menu.
3. Clique em **Escolher uma pasta** e escolha a pasta `pacote-30`. Se o navegador perguntar se pode carregar os arquivos, pode confirmar: nada sai do seu computador. Deve aparecer "Carregados: 1 arquivo com 30 itens para revisar e 20 snapshots".
4. Em **Quem rotula**, escreva o seu nome.
5. Deixe **Mostrar os juízes do estudo** desligado.
6. Para cada item:
   - Leia o título: é a afirmação.
   - Olhe a **Evidência** (o trecho da página), o **recorte** da imagem quando houver, e o quadro **No snapshot** (nome, texto, onde o elemento está e, num link, para onde ele leva).
   - Se ajudar, abra a página pelo link (ela pode ter mudado desde outubro) ou a imagem `contexto/<fingerprint>.jpg` desta pasta, onde o elemento aparece contornado em magenta. O código da fingerprint aparece no item. Só 13 dos 30 têm essa imagem.
   - Escolha **Verdadeiro positivo**, **Falso positivo** ou **Incerto** e escreva uma nota curta dizendo por quê.
   - A **Causa** só aparece em falso positivo e é opcional: escolha se souber, senão deixe em branco.
   - Clique em **Próximo**. Se preferir o teclado: T, F e U escolhem o rótulo, E vai para a nota, Esc volta e N passa para o próximo.
7. No fim, clique em **Exportar rótulos**. O navegador baixa um arquivo `rampa-lab-labels-<seu nome>-<data>.json`. Mande esse arquivo para o Guilherme.

## Como decidir

- **Verdadeiro positivo**: o problema existe, do jeito que o achado diz.
- **Falso positivo**: não é um problema desse critério, ou o achado descreve algo que não é falha. Se o problema existe, mas por outro motivo, escreva isso na nota.
- **Incerto**: dá para defender os dois lados, ou falta informação para decidir.

Os 30 achados são de quatro critérios da WCAG, a norma internacional de acessibilidade na web:

- **1.1.1 Conteúdo não textual** (imagens): uma imagem que passa informação precisa de um texto alternativo (o `alt`) que diga o que ela comunica ali. Se a imagem é a única coisa dentro de um link ou botão, o `alt` precisa dizer para onde o link leva ou o que o botão faz. Uma imagem só decorativa deve ter o `alt` vazio, para o leitor de tela pular. Um `alt` que é nome de arquivo ("IMG_123.jpg") ou só "imagem" não serve.
- **2.4.4 Finalidade do link** (links): tem que dar para entender para onde o link leva pelo texto dele, ou pelo texto mais o que está junto dele na página: a mesma frase ou parágrafo, o mesmo item de lista, o item "pai" quando a lista está dentro de outra lista, a célula da tabela, ou o título que vem logo antes. Dois links com o mesmo texto indo para lugares diferentes só são problema quando nada em volta ajuda a diferenciar um do outro.
- **1.3.5 Identificar o propósito de entrada** (campos de formulário): um campo que pede um dado **da própria pessoa** (nome, e-mail, telefone, CEP...) precisa dizer isso no código (o atributo `autocomplete`), para o navegador poder preencher sozinho. A mensagem já diz o que falta; confira se o campo pede mesmo um dado de quem está preenchendo. Busca ou e-mail de outra pessoa não contam.
- **3.1.2 Idioma de partes** (trechos em outra língua): se a página está em português e um trecho está em inglês, o trecho precisa estar marcado como inglês no código, senão o leitor de tela lê com a pronúncia errada. Não precisam de marcação nomes próprios, termos técnicos e palavras que já viraram parte do português. A mensagem diz qual idioma a página declara; você julga se o trecho está mesmo em outra língua e se não é uma dessas exceções.

Obrigado!
