# Guia de rotulagem: sexto estudo com páginas reais

Para quem rotula os achados do Rampa no Rampa Lab. Cada item é uma afirmação que o Rampa fez sobre um elemento de uma
página real, e o título do item é essa afirmação. Responda às três perguntas, escolha o rótulo que decorre das
respostas e escreva uma nota curta. A rubrica dos juízes (judge-rubric.md, em inglês) segue as mesmas regras.

## As três perguntas

Cada uma tem três respostas: sim, não ou não dá para saber (no arquivo exportado: `yes`, `no`, `cannot_tell`). Os
exemplos são inventados.

1. **A afirmação, do jeito que está escrita, é verdadeira no documento capturado?** (`claimTrue`) O documento
   capturado é o snapshot que o Rampa leu: o que o Lab mostra em **Evidência**, no recorte e em **No snapshot**.
   Confira a frase, não a WCAG. *Exemplo:* a afirmação diz "O campo pede o e-mail da pessoa e não tem o atributo
   autocomplete". O snapshot mostra um campo com o rótulo "Seu e-mail" e sem `autocomplete`: sim. Com
   `autocomplete="email"`, seria não.
2. **O elemento falha neste critério na página que as pessoas recebem, por qualquer motivo?** (`elementFails`) A
   página que as pessoas recebem é a página daquele endereço como o navegador de uma pessoa a mostra, com estilos e
   scripts. Julgue o elemento, não a redação da afirmação. *Exemplo:* a afirmação diz "O texto do link 'Leia mais' não
   diz para onde ele leva". O link fecha um parágrafo que dá o nome da matéria que ele abre, e a WCAG conta esse
   parágrafo como contexto do link: não, embora a frase sobre o texto do link seja verdadeira.
3. **A captura difere da página que as pessoas recebem de um jeito que importa para esta afirmação?**
   (`captureDiffers`) Por exemplo: a página foi capturada sem a folha de estilo, o site mandou uma versão feita para
   navegadores automáticos, há conteúdo escondido na página real, ou a página mudou desde a captura. Abra a página no
   seu navegador para comparar. *Exemplo:* no snapshot, a página tem o título "Carregando…", mas quem abre o endereço
   recebe a página completa, com o título "Biblioteca Municipal | Horários". Para a afirmação "O título da página não
   descreve a página": sim.

## O rótulo

- **Verdadeiro positivo**: o elemento falha (a pergunta 2 é sim), e a afirmação, lida de boa-fé, aponta essa falha.
- **Falso positivo**: o elemento não falha (a pergunta 2 é não), ou falha neste critério por um motivo que a
  afirmação não aponta; diga qual na nota.
- **Incerto**: não dá para saber se o elemento falha (a pergunta 2 é não dá para saber), ou auditores competentes
  discordariam com razão.

As perguntas 1 e 3 não decidem o rótulo; elas explicam por que ele é o que é. O terceiro exemplo é um falso positivo,
mesmo com a afirmação verdadeira na captura. *Ler de boa-fé*: uma afirmação que aponta o defeito real com palavras
imperfeitas conta como apontá-lo (um texto alternativo que, segundo a afirmação, "descreve algo que a imagem não
mostra", quando na verdade ele deixa de fora a maior parte do que a imagem transmite); uma afirmação que aponta outra
coisa não conta.

## Links (2.4.4): o que conta como contexto

O propósito de um link tem que ficar claro pelo texto dele sozinho, ou pelo texto junto com o contexto. O contexto é:

- o texto do link e o nome acessível dele (`aria-label`, `aria-labelledby`), e a descrição dele (`title`,
  `aria-describedby`);
- o contexto do link determinado programaticamente, como a definição da WCAG o descreve: a mesma frase, parágrafo,
  item de lista ou célula de tabela do link, com as células de cabeçalho da tabela ligadas a essa célula;
- o título de seção (heading) que vem logo antes do link (técnica H80);
- numa lista dentro de outra, o item da lista de fora sob o qual fica a lista do link (técnica H81).

Um rótulo visual que não é um heading nem está dentro desses, como o título de uma coluna ou de um card que é só um
parágrafo estilizado, não conta (falha F63). Quando um rótulo assim é o único contexto de um link, responda por esta
regra e comece a nota com `[visual context]`.

## Para que serve o "Incerto"

Para dois casos: quando não dá para ver o que as pessoas recebem (a página saiu do ar ou bloqueia você, e a captura
pode não ser o que as pessoas recebem), ou quando você vê duas leituras que um auditor competente poderia defender.
Diga na nota qual é o caso. Ele não serve para um item que você não olhou.

## A nota

Diga o que você conferiu, em uma ou duas frases. Por exemplo: "Abri a página no navegador: ela tem estilos e o mesmo
título da captura. O texto alternativo dá o nome do logotipo, não para onde o link leva." A causa do falso positivo é
opcional.
