/**
 * Words for 1.3.3 Sensory Characteristics, in English, Portuguese and Spanish: instructions that point to something
 * on the page by where it is, its shape, its size, its orientation or a sound. The lists follow the "visual reference
 * words" of ACT rule 9bd38c (visual location, shape, size, orientation), without its colors, which are 1.4.1's (the
 * color probe reads them), and with sound words, which WCAG 1.3.3 names too. They are written for Rampa: the ACT list
 * is not exhaustive, and its translations are left to each tool.
 *
 * The matcher is broad on purpose: it nominates sentences, and a failure needs more than a match (the referenced
 * thing found where the text says, nothing else naming it, and a model that reads the sentence as an instruction;
 * src/criteria/sensory-characteristics.ts). Words are matched without case or accents.
 */

export const SENSORY_LANGUAGES = ['en', 'pt', 'es'] as const
export type SensoryLanguage = (typeof SENSORY_LANGUAGES)[number]

export type SensoryKind = 'location' | 'shape' | 'size' | 'orientation' | 'sound'
export type Direction = 'right' | 'left' | 'top' | 'bottom' | 'above' | 'below' | 'beside'
export type ShapeConcept = 'circle' | 'square' | 'triangle' | 'star' | 'heart' | 'diamond' | 'cross' | 'arrow' | 'dots' | 'hamburger' | 'magnifier' | 'polygon'
export type SizeSense = 'large' | 'small' | 'wide' | 'narrow'
export type ReferentKind = 'button' | 'link' | 'icon' | 'image' | 'menu' | 'tab' | 'field' | 'form' | 'list' | 'figure' | 'text' | 'region' | 'page'

interface Lexicon {
  /** Words that make a sentence an instruction: imperatives, and "can be found", "is located". */
  cues: string[]
  /** Locative phrases, each with the directions it names. */
  location: Array<[string, Direction[]]>
  /** Phrases a location word is part of without naming a place: "above all", "abaixo-assinado". */
  idioms: string[]
  /** Shape words, by the concept they name; `adjective` words need a noun next to them ("round button"). */
  shape: Array<[string, ShapeConcept, 'noun' | 'adjective']>
  size: Array<[string, SizeSense]>
  orientation: string[]
  sound: string[]
  /** Nouns for what an instruction points to. Longer phrases first win ("search box" is a field, "box" too). */
  referents: Array<[string, ReferentKind]>
  /** Words that carry no name: articles, prepositions, pronouns. */
  stopwords: string[]
}

const DIRECTIONS = {
  right: ['right'],
  left: ['left'],
  top: ['top'],
  bottom: ['bottom'],
  topRight: ['top', 'right'],
  topLeft: ['top', 'left'],
  bottomRight: ['bottom', 'right'],
  bottomLeft: ['bottom', 'left'],
  above: ['above'],
  below: ['below'],
  beside: ['beside'],
} as const satisfies Record<string, readonly Direction[]>

const at = (phrases: string[], directions: readonly Direction[]): Array<[string, Direction[]]> => phrases.map((phrase) => [phrase, [...directions]])

const EN: Lexicon = {
  cues: [
    'click', 'clicking', 'tap', 'tapping', 'press', 'pressing', 'push', 'hit', 'select', 'choose', 'pick', 'use', 'using', 'find', 'look',
    'see', 'locate', 'check', 'tick', 'enter', 'type', 'fill', 'scroll', 'drag', 'follow', 'refer', 'open', 'close', 'interact', 'navigate',
    'go', 'listen', 'hear', 'wait', 'touch', 'toggle', 'visit', 'view', 'found', 'located', 'shown', 'displayed',
  ],
  location: [
    ...at(['on the right', 'to the right', 'at the right', 'on your right', 'right-hand', 'right hand side', 'right side', 'right column', 'right corner', 'right sidebar', 'right panel'], DIRECTIONS.right),
    ...at(['on the left', 'to the left', 'at the left', 'on your left', 'left-hand', 'left hand side', 'left side', 'left column', 'left corner', 'left sidebar', 'left panel'], DIRECTIONS.left),
    ...at(['top right', 'top-right', 'upper right', 'upper-right'], DIRECTIONS.topRight),
    ...at(['top left', 'top-left', 'upper left', 'upper-left'], DIRECTIONS.topLeft),
    ...at(['bottom right', 'bottom-right', 'lower right', 'lower-right'], DIRECTIONS.bottomRight),
    ...at(['bottom left', 'bottom-left', 'lower left', 'lower-left'], DIRECTIONS.bottomLeft),
    ...at(['at the top', 'on top', 'top of the', 'top of this', 'top of your'], DIRECTIONS.top),
    ...at(['at the bottom', 'bottom of the', 'bottom of this', 'bottom of your'], DIRECTIONS.bottom),
    ...at(['above'], DIRECTIONS.above),
    ...at(['below', 'beneath', 'underneath', 'under the', 'under this'], DIRECTIONS.below),
    ...at(['beside', 'next to', 'alongside'], DIRECTIONS.beside),
  ],
  idioms: ['above all', 'above-mentioned', 'above mentioned', 'on top of that', 'on top of this', 'on top of everything', 'under the hood', 'under the terms', 'under the law', 'under this agreement', 'under the agreement', 'next to nothing', 'top of the line', 'top of the range'],
  shape: [
    ['circle', 'circle', 'noun'], ['circles', 'circle', 'noun'], ['circular', 'circle', 'adjective'], ['round', 'circle', 'adjective'], ['oval', 'circle', 'adjective'], ['disc', 'circle', 'noun'],
    ['square', 'square', 'noun'], ['squared', 'square', 'adjective'], ['rectangle', 'square', 'noun'], ['rectangular', 'square', 'adjective'],
    ['triangle', 'triangle', 'noun'], ['triangles', 'triangle', 'noun'], ['triangular', 'triangle', 'adjective'],
    ['star', 'star', 'noun'], ['stars', 'star', 'noun'],
    ['heart', 'heart', 'noun'], ['hearts', 'heart', 'noun'],
    ['diamond', 'diamond', 'noun'], ['diamonds', 'diamond', 'noun'],
    ['cross', 'cross', 'noun'],
    ['arrow', 'arrow', 'noun'], ['arrows', 'arrow', 'noun'], ['chevron', 'arrow', 'noun'], ['chevrons', 'arrow', 'noun'],
    ['three dots', 'dots', 'noun'], ['dots', 'dots', 'noun'],
    ['hamburger', 'hamburger', 'noun'], ['three lines', 'hamburger', 'noun'],
    ['magnifying glass', 'magnifier', 'noun'], ['magnifier', 'magnifier', 'noun'],
    ['hexagon', 'polygon', 'noun'], ['pentagon', 'polygon', 'noun'], ['octagon', 'polygon', 'noun'], ['polygon', 'polygon', 'noun'],
  ],
  size: [
    ['big', 'large'], ['bigger', 'large'], ['biggest', 'large'], ['large', 'large'], ['larger', 'large'], ['largest', 'large'], ['huge', 'large'],
    ['small', 'small'], ['smaller', 'small'], ['smallest', 'small'], ['little', 'small'], ['tiny', 'small'],
    ['wide', 'wide'], ['wider', 'wide'], ['widest', 'wide'], ['narrow', 'narrow'], ['narrower', 'narrow'],
  ],
  orientation: ['tilted', 'tilt', 'rotated', 'slanted', 'slanting', 'skewed', 'sideways', 'askew', 'crooked', 'angled', 'upside down', 'upside-down'],
  sound: ['when you hear', 'after the beep', 'after the tone', 'after the sound', 'the beep', 'the tone', 'the chime', 'the sound', 'a beep', 'a tone', 'a chime', 'audio cue', 'sound signal', 'beeps'],
  referents: [
    ['search box', 'field'], ['search bar', 'field'], ['search field', 'field'], ['text box', 'field'], ['textbox', 'field'], ['check box', 'field'], ['checkbox', 'field'], ['checkboxes', 'field'],
    ['drop-down', 'field'], ['dropdown', 'field'], ['drop down', 'field'], ['list box', 'field'], ['field', 'field'], ['fields', 'field'], ['box', 'field'], ['boxes', 'field'], ['input', 'field'], ['slider', 'field'],
    ['navigation bar', 'menu'], ['menu bar', 'menu'], ['tool bar', 'menu'], ['toolbar', 'menu'], ['navbar', 'menu'], ['side bar', 'menu'], ['sidebar', 'menu'], ['navigation', 'menu'], ['nav', 'menu'], ['menu', 'menu'], ['menus', 'menu'], ['bar', 'menu'],
    ['button', 'button'], ['buttons', 'button'],
    ['hyperlink', 'link'], ['link', 'link'], ['links', 'link'],
    ['icon', 'icon'], ['icons', 'icon'], ['symbol', 'icon'], ['symbols', 'icon'], ['logo', 'icon'],
    ['image', 'image'], ['images', 'image'], ['picture', 'image'], ['pictures', 'image'], ['photo', 'image'], ['photos', 'image'], ['photograph', 'image'], ['illustration', 'image'], ['graphic', 'image'], ['banner', 'image'],
    ['tab', 'tab'], ['tabs', 'tab'],
    ['form', 'form'], ['forms', 'form'],
    ['list', 'list'], ['lists', 'list'],
    ['table', 'figure'], ['tables', 'figure'], ['chart', 'figure'], ['charts', 'figure'], ['graph', 'figure'], ['graphs', 'figure'], ['map', 'figure'], ['maps', 'figure'], ['diagram', 'figure'],
    ['text', 'text'], ['paragraph', 'text'], ['sentence', 'text'], ['message', 'text'],
    ['section', 'region'], ['sections', 'region'], ['area', 'region'], ['column', 'region'], ['panel', 'region'], ['corner', 'region'], ['side', 'region'], ['block', 'region'], ['region', 'region'], ['frame', 'region'], ['window', 'region'],
    ['page', 'page'], ['screen', 'page'], ['site', 'page'],
  ],
  stopwords: ['the', 'a', 'an', 'of', 'to', 'on', 'in', 'at', 'for', 'and', 'or', 'with', 'this', 'that', 'these', 'those', 'your', 'you', 'it', 'its', 'is', 'are', 'be', 'can', 'will', 'from', 'by', 'then', 'there', 'here', 'when', 'more', 'all', 'any', 'one', 'two', 'three', 'please', 'which', 'what', 'where', 'how', 'also', 'just', 'each', 'other'],
}

const PT: Lexicon = {
  cues: [
    'clique', 'clicar', 'clica', 'cliquem', 'toque', 'tocar', 'toca', 'pressione', 'pressionar', 'aperte', 'apertar', 'aperta', 'selecione', 'selecionar', 'seleciona',
    'escolha', 'escolher', 'escolhe', 'use', 'usar', 'usa', 'utilize', 'utilizar', 'encontre', 'encontrar', 'encontra', 'encontram', 'encontrara', 'procure', 'procurar', 'procura',
    'veja', 'ver', 've', 'vera', 'localize', 'localizar', 'acesse', 'acessar', 'acessa', 'marque', 'marcar', 'marca', 'digite', 'digitar', 'digita', 'preencha', 'preencher', 'preenche',
    'role', 'rolar', 'rola', 'arraste', 'arrastar', 'arrasta', 'consulte', 'consultar', 'siga', 'seguir', 'abra', 'abrir', 'abre', 'feche', 'fechar', 'fecha', 'ouca', 'ouvir', 'ouvira',
    'aguarde', 'aguardar', 'navegue', 'navegar', 'olhe', 'olhar', 'confira', 'conferir', 'localizado', 'localizada', 'localizados', 'localizadas', 'fica', 'ficam', 'mostrado', 'exibido',
  ],
  location: [
    ...at(['a direita', 'da direita', 'do lado direito', 'no lado direito', 'na lateral direita', 'coluna direita', 'barra lateral direita', 'canto direito', 'lado direito'], DIRECTIONS.right),
    ...at(['a esquerda', 'da esquerda', 'do lado esquerdo', 'no lado esquerdo', 'na lateral esquerda', 'coluna esquerda', 'barra lateral esquerda', 'canto esquerdo', 'lado esquerdo'], DIRECTIONS.left),
    ...at(['canto superior direito', 'parte superior direita', 'no alto a direita'], DIRECTIONS.topRight),
    ...at(['canto superior esquerdo', 'parte superior esquerda', 'no alto a esquerda'], DIRECTIONS.topLeft),
    ...at(['canto inferior direito', 'parte inferior direita'], DIRECTIONS.bottomRight),
    ...at(['canto inferior esquerdo', 'parte inferior esquerda'], DIRECTIONS.bottomLeft),
    ...at(['no topo', 'no alto', 'na parte superior', 'na parte de cima', 'em cima'], DIRECTIONS.top),
    ...at(['na parte inferior', 'na parte de baixo', 'no rodape', 'no fim da pagina', 'no final da pagina'], DIRECTIONS.bottom),
    ...at(['acima', 'logo acima'], DIRECTIONS.above),
    ...at(['abaixo', 'logo abaixo', 'embaixo', 'em baixo', 'debaixo', 'logo embaixo'], DIRECTIONS.below),
    ...at(['ao lado', 'do lado de', 'junto ao', 'junto a'], DIRECTIONS.beside),
  ],
  idioms: ['acima de tudo', 'abaixo-assinado', 'abaixo assinado', 'abaixo assinados', 'em cima da hora', 'ao lado de quem'],
  shape: [
    ['circulo', 'circle', 'noun'], ['circulos', 'circle', 'noun'], ['bolinha', 'circle', 'noun'], ['bolinhas', 'circle', 'noun'], ['circular', 'circle', 'adjective'], ['redondo', 'circle', 'adjective'], ['redonda', 'circle', 'adjective'], ['oval', 'circle', 'adjective'],
    ['quadrado', 'square', 'noun'], ['quadrados', 'square', 'noun'], ['quadradinho', 'square', 'noun'], ['retangulo', 'square', 'noun'], ['retangular', 'square', 'adjective'],
    ['triangulo', 'triangle', 'noun'], ['triangulos', 'triangle', 'noun'], ['triangular', 'triangle', 'adjective'],
    ['estrela', 'star', 'noun'], ['estrelas', 'star', 'noun'], ['estrelinha', 'star', 'noun'],
    ['coracao', 'heart', 'noun'], ['coracoes', 'heart', 'noun'], ['coracaozinho', 'heart', 'noun'],
    ['losango', 'diamond', 'noun'], ['diamante', 'diamond', 'noun'],
    ['cruz', 'cross', 'noun'], ['xis', 'cross', 'noun'],
    ['seta', 'arrow', 'noun'], ['setas', 'arrow', 'noun'], ['setinha', 'arrow', 'noun'], ['setinhas', 'arrow', 'noun'], ['flecha', 'arrow', 'noun'], ['flechas', 'arrow', 'noun'],
    ['tres pontinhos', 'dots', 'noun'], ['tres pontos', 'dots', 'noun'], ['pontinhos', 'dots', 'noun'],
    ['hamburguer', 'hamburger', 'noun'], ['tres linhas', 'hamburger', 'noun'], ['tres tracinhos', 'hamburger', 'noun'], ['tres risquinhos', 'hamburger', 'noun'],
    ['lupa', 'magnifier', 'noun'], ['lupinha', 'magnifier', 'noun'],
    ['hexagono', 'polygon', 'noun'], ['pentagono', 'polygon', 'noun'], ['octogono', 'polygon', 'noun'], ['poligono', 'polygon', 'noun'],
  ],
  size: [
    ['grande', 'large'], ['grandes', 'large'], ['maior', 'large'], ['maiores', 'large'], ['enorme', 'large'],
    ['pequeno', 'small'], ['pequena', 'small'], ['pequenos', 'small'], ['pequenas', 'small'], ['menor', 'small'], ['menores', 'small'], ['minusculo', 'small'], ['pequenino', 'small'], ['pequenininho', 'small'],
    ['largo', 'wide'], ['larga', 'wide'], ['estreito', 'narrow'], ['estreita', 'narrow'],
  ],
  orientation: ['inclinado', 'inclinada', 'girado', 'girada', 'rotacionado', 'rotacionada', 'torto', 'torta', 'de lado', 'de cabeca para baixo', 'de ponta-cabeca', 'de ponta cabeca'],
  sound: ['quando ouvir', 'ao ouvir', 'apos o bipe', 'apos o sinal', 'apos o som', 'o bipe', 'um bipe', 'sinal sonoro', 'aviso sonoro', 'alerta sonoro', 'o som', 'um som', 'o apito', 'bipes'],
  referents: [
    ['caixa de texto', 'field'], ['caixa de selecao', 'field'], ['caixa de busca', 'field'], ['caixa de pesquisa', 'field'], ['barra de busca', 'field'], ['barra de pesquisa', 'field'], ['campo de busca', 'field'], ['lista suspensa', 'field'],
    ['campo', 'field'], ['campos', 'field'], ['caixa', 'field'], ['caixas', 'field'], ['caixinha', 'field'], ['caixinhas', 'field'], ['seletor', 'field'],
    ['barra de navegacao', 'menu'], ['barra de ferramentas', 'menu'], ['barra lateral', 'menu'], ['menu lateral', 'menu'], ['navegacao', 'menu'], ['menu', 'menu'], ['menus', 'menu'], ['barra', 'menu'],
    ['botao', 'button'], ['botoes', 'button'], ['botaozinho', 'button'],
    ['hiperlink', 'link'], ['link', 'link'], ['links', 'link'], ['ligacao', 'link'],
    ['icone', 'icon'], ['icones', 'icon'], ['iconezinho', 'icon'], ['simbolo', 'icon'], ['simbolos', 'icon'], ['logotipo', 'icon'], ['logo', 'icon'],
    ['imagem', 'image'], ['imagens', 'image'], ['figura', 'image'], ['figuras', 'image'], ['foto', 'image'], ['fotos', 'image'], ['fotografia', 'image'], ['ilustracao', 'image'], ['banner', 'image'],
    ['aba', 'tab'], ['abas', 'tab'], ['guia', 'tab'], ['guias', 'tab'],
    ['formulario', 'form'], ['formularios', 'form'],
    ['lista', 'list'], ['listas', 'list'],
    ['tabela', 'figure'], ['tabelas', 'figure'], ['grafico', 'figure'], ['graficos', 'figure'], ['mapa', 'figure'], ['mapas', 'figure'], ['diagrama', 'figure'],
    ['texto', 'text'], ['paragrafo', 'text'], ['frase', 'text'], ['mensagem', 'text'],
    ['secao', 'region'], ['secoes', 'region'], ['area', 'region'], ['coluna', 'region'], ['painel', 'region'], ['canto', 'region'], ['lado', 'region'], ['bloco', 'region'], ['quadro', 'region'], ['janela', 'region'],
    ['pagina', 'page'], ['tela', 'page'], ['site', 'page'],
  ],
  stopwords: ['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'para', 'por', 'com', 'e', 'ou', 'que', 'se', 'seu', 'sua', 'este', 'esta', 'esse', 'essa', 'isso', 'aqui', 'ai', 'la', 'mais', 'todos', 'todas', 'cada', 'voce', 'pelo', 'pela', 'ao', 'aos', 'entao', 'quando', 'onde', 'como', 'tambem', 'favor', 'por favor'],
}

const ES: Lexicon = {
  cues: [
    'clic', 'click', 'haga', 'haz', 'pulse', 'pulsa', 'pulsar', 'presione', 'presiona', 'presionar', 'toque', 'toca', 'tocar', 'seleccione', 'selecciona', 'seleccionar',
    'elija', 'elige', 'elegir', 'use', 'usa', 'usar', 'utilice', 'utiliza', 'utilizar', 'busque', 'busca', 'buscar', 'encuentre', 'encuentra', 'encontrar', 'encontrara',
    'vea', 'ver', 'mire', 'mira', 'mirar', 'localice', 'localiza', 'acceda', 'accede', 'acceder', 'marque', 'marca', 'marcar', 'escriba', 'escribe', 'escribir',
    'rellene', 'rellena', 'rellenar', 'complete', 'completa', 'desplacese', 'desplazate', 'arrastre', 'arrastra', 'arrastrar', 'consulte', 'consulta', 'siga', 'sigue',
    'abra', 'abre', 'abrir', 'cierre', 'cierra', 'escuche', 'escucha', 'oir', 'oiga', 'espere', 'espera', 'navegue', 'navega', 'ubicado', 'ubicada', 'situado', 'situada', 'mostrado',
  ],
  location: [
    ...at(['a la derecha', 'de la derecha', 'del lado derecho', 'en el lado derecho', 'en la parte derecha', 'columna derecha', 'barra lateral derecha', 'lado derecho'], DIRECTIONS.right),
    ...at(['a la izquierda', 'de la izquierda', 'del lado izquierdo', 'en el lado izquierdo', 'en la parte izquierda', 'columna izquierda', 'barra lateral izquierda', 'lado izquierdo'], DIRECTIONS.left),
    ...at(['esquina superior derecha', 'parte superior derecha', 'arriba a la derecha'], DIRECTIONS.topRight),
    ...at(['esquina superior izquierda', 'parte superior izquierda', 'arriba a la izquierda'], DIRECTIONS.topLeft),
    ...at(['esquina inferior derecha', 'parte inferior derecha', 'abajo a la derecha'], DIRECTIONS.bottomRight),
    ...at(['esquina inferior izquierda', 'parte inferior izquierda', 'abajo a la izquierda'], DIRECTIONS.bottomLeft),
    ...at(['en la parte superior', 'en la parte de arriba', 'en lo alto'], DIRECTIONS.top),
    ...at(['en la parte inferior', 'en la parte de abajo', 'al pie de la pagina', 'al final de la pagina'], DIRECTIONS.bottom),
    ...at(['arriba', 'encima'], DIRECTIONS.above),
    ...at(['abajo', 'debajo'], DIRECTIONS.below),
    ...at(['al lado', 'junto al', 'junto a'], DIRECTIONS.beside),
  ],
  idioms: ['por encima de todo', 'abajo firmante', 'abajo firmantes', 'de arriba abajo', 'hacia arriba y hacia abajo'],
  shape: [
    ['circulo', 'circle', 'noun'], ['circulos', 'circle', 'noun'], ['circular', 'circle', 'adjective'], ['redondo', 'circle', 'adjective'], ['redonda', 'circle', 'adjective'], ['ovalado', 'circle', 'adjective'], ['ovalada', 'circle', 'adjective'], ['ovalo', 'circle', 'noun'],
    ['cuadrado', 'square', 'noun'], ['cuadrados', 'square', 'noun'], ['cuadradito', 'square', 'noun'], ['rectangulo', 'square', 'noun'], ['rectangular', 'square', 'adjective'],
    ['triangulo', 'triangle', 'noun'], ['triangulos', 'triangle', 'noun'], ['triangular', 'triangle', 'adjective'],
    ['estrella', 'star', 'noun'], ['estrellas', 'star', 'noun'], ['estrellita', 'star', 'noun'],
    ['corazon', 'heart', 'noun'], ['corazones', 'heart', 'noun'], ['corazoncito', 'heart', 'noun'],
    ['rombo', 'diamond', 'noun'], ['diamante', 'diamond', 'noun'],
    ['cruz', 'cross', 'noun'], ['equis', 'cross', 'noun'],
    ['flecha', 'arrow', 'noun'], ['flechas', 'arrow', 'noun'], ['flechita', 'arrow', 'noun'],
    ['tres puntos', 'dots', 'noun'], ['tres puntitos', 'dots', 'noun'], ['puntitos', 'dots', 'noun'],
    ['hamburguesa', 'hamburger', 'noun'], ['tres lineas', 'hamburger', 'noun'], ['tres rayas', 'hamburger', 'noun'],
    ['lupa', 'magnifier', 'noun'],
    ['hexagono', 'polygon', 'noun'], ['pentagono', 'polygon', 'noun'], ['octogono', 'polygon', 'noun'], ['poligono', 'polygon', 'noun'],
  ],
  size: [
    ['grande', 'large'], ['grandes', 'large'], ['mayor', 'large'], ['mayores', 'large'], ['enorme', 'large'],
    ['pequeno', 'small'], ['pequena', 'small'], ['pequenos', 'small'], ['pequenas', 'small'], ['menor', 'small'], ['menores', 'small'], ['diminuto', 'small'], ['chiquito', 'small'],
    ['ancho', 'wide'], ['ancha', 'wide'], ['estrecho', 'narrow'], ['estrecha', 'narrow'],
  ],
  orientation: ['inclinado', 'inclinada', 'girado', 'girada', 'rotado', 'rotada', 'torcido', 'torcida', 'de lado', 'al reves', 'boca abajo'],
  sound: ['cuando oiga', 'cuando escuche', 'al oir', 'tras el pitido', 'despues del pitido', 'despues del tono', 'el pitido', 'un pitido', 'senal sonora', 'aviso sonoro', 'alerta sonora', 'el sonido', 'un sonido', 'pitidos'],
  referents: [
    ['cuadro de texto', 'field'], ['cuadro de busqueda', 'field'], ['barra de busqueda', 'field'], ['campo de busqueda', 'field'], ['lista desplegable', 'field'], ['desplegable', 'field'],
    ['campo', 'field'], ['campos', 'field'], ['casilla', 'field'], ['casillas', 'field'], ['caja', 'field'], ['cajas', 'field'], ['selector', 'field'],
    ['barra de navegacion', 'menu'], ['barra de herramientas', 'menu'], ['barra lateral', 'menu'], ['menu lateral', 'menu'], ['navegacion', 'menu'], ['menu', 'menu'], ['menus', 'menu'], ['barra', 'menu'],
    ['boton', 'button'], ['botones', 'button'],
    ['hipervinculo', 'link'], ['enlace', 'link'], ['enlaces', 'link'], ['vinculo', 'link'], ['vinculos', 'link'], ['link', 'link'],
    ['icono', 'icon'], ['iconos', 'icon'], ['simbolo', 'icon'], ['simbolos', 'icon'], ['logotipo', 'icon'], ['logo', 'icon'],
    ['imagen', 'image'], ['imagenes', 'image'], ['figura', 'image'], ['foto', 'image'], ['fotos', 'image'], ['fotografia', 'image'], ['ilustracion', 'image'], ['banner', 'image'],
    ['pestana', 'tab'], ['pestanas', 'tab'],
    ['formulario', 'form'], ['formularios', 'form'],
    ['lista', 'list'], ['listas', 'list'],
    ['tabla', 'figure'], ['tablas', 'figure'], ['grafico', 'figure'], ['graficos', 'figure'], ['mapa', 'figure'], ['mapas', 'figure'], ['diagrama', 'figure'],
    ['texto', 'text'], ['parrafo', 'text'], ['frase', 'text'], ['mensaje', 'text'],
    ['seccion', 'region'], ['secciones', 'region'], ['area', 'region'], ['columna', 'region'], ['panel', 'region'], ['esquina', 'region'], ['lado', 'region'], ['bloque', 'region'], ['recuadro', 'region'], ['ventana', 'region'],
    ['pagina', 'page'], ['pantalla', 'page'], ['sitio', 'page'],
  ],
  stopwords: ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'para', 'por', 'con', 'y', 'o', 'que', 'se', 'su', 'sus', 'este', 'esta', 'ese', 'esa', 'eso', 'aqui', 'alli', 'mas', 'todos', 'todas', 'cada', 'usted', 'al', 'a', 'luego', 'cuando', 'donde', 'como', 'tambien', 'favor', 'por favor'],
}

export const SENSORY_LEXICONS: Readonly<Record<SensoryLanguage, Lexicon>> = { en: EN, pt: PT, es: ES }

/** The language whose lists apply to a language tag (pt-BR reads the Portuguese ones), or undefined. */
export function sensoryLanguageOf(tag: string | undefined): SensoryLanguage | undefined {
  const primary = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? ''
  return (SENSORY_LANGUAGES as readonly string[]).includes(primary) ? (primary as SensoryLanguage) : undefined
}

/** Lower case, without accents, one character for one: indices into the folded text are indices into the original. */
export function fold(text: string): string {
  let out = ''
  for (const char of text.normalize('NFC')) {
    const bare = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    out += bare.length === char.length ? bare : char.toLowerCase().slice(0, char.length).padEnd(char.length, ' ')
  }
  return out
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A whole-word, case- and accent-free pattern for a list of phrases, longest first. */
function phrasePattern(phrases: readonly string[]): RegExp {
  const sorted = [...new Set(phrases.map(fold))].sort((a, b) => b.length - a.length)
  const body = sorted.map((phrase) => escapeRegex(phrase).replace(/\\-|\s+/g, (sep) => (sep === '\\-' ? '[-\\s]?' : '\\s+'))).join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'gu')
}

interface Compiled {
  cue: RegExp
  location: RegExp
  locationOf: Map<string, Direction[]>
  idiom: RegExp
  shape: RegExp
  shapeOf: Map<string, [ShapeConcept, 'noun' | 'adjective']>
  size: RegExp
  sizeOf: Map<string, SizeSense>
  orientation: RegExp
  sound: RegExp
  referent: RegExp
  referentOf: Map<string, ReferentKind>
  stopwords: Set<string>
  /** Every word the lists hold, for telling a name word from an instruction word. */
  listed: Set<string>
}

const compiled = new Map<SensoryLanguage, Compiled>()

const squash = (phrase: string) => fold(phrase).replace(/[-\s]+/g, ' ').trim()

function compile(language: SensoryLanguage): Compiled {
  const known = compiled.get(language)
  if (known) return known
  const lexicon = SENSORY_LEXICONS[language]
  const listed = new Set<string>()
  const words = (phrases: Iterable<string>) => {
    for (const phrase of phrases) for (const word of squash(phrase).split(' ')) if (word) listed.add(word)
  }
  words(lexicon.cues)
  words(lexicon.location.map(([phrase]) => phrase))
  words(lexicon.shape.map(([phrase]) => phrase))
  words(lexicon.size.map(([phrase]) => phrase))
  words(lexicon.orientation)
  words(lexicon.sound)
  words(lexicon.referents.map(([phrase]) => phrase))
  const result: Compiled = {
    cue: phrasePattern(lexicon.cues),
    location: phrasePattern(lexicon.location.map(([phrase]) => phrase)),
    locationOf: new Map(lexicon.location.map(([phrase, directions]) => [squash(phrase), directions])),
    idiom: phrasePattern(lexicon.idioms),
    shape: phrasePattern(lexicon.shape.map(([phrase]) => phrase)),
    shapeOf: new Map(lexicon.shape.map(([phrase, concept, part]) => [squash(phrase), [concept, part]])),
    size: phrasePattern(lexicon.size.map(([phrase]) => phrase)),
    sizeOf: new Map(lexicon.size.map(([phrase, sense]) => [squash(phrase), sense])),
    orientation: phrasePattern(lexicon.orientation),
    sound: phrasePattern(lexicon.sound),
    referent: phrasePattern(lexicon.referents.map(([phrase]) => phrase)),
    referentOf: new Map(lexicon.referents.map(([phrase, kind]) => [squash(phrase), kind])),
    stopwords: new Set(lexicon.stopwords.map(squash)),
    listed,
  }
  compiled.set(language, result)
  return result
}

export interface SensoryPhrase {
  kind: SensoryKind
  /** The words as the sentence has them. */
  phrase: string
  index: number
  directions?: Direction[] | undefined
  shape?: ShapeConcept | undefined
  size?: SizeSense | undefined
}

export interface Referent {
  kind: ReferentKind
  word: string
  index: number
}

export interface SensoryInstruction {
  sentence: string
  language: SensoryLanguage
  /** The word that makes it an instruction, as written. */
  cue: string
  phrases: SensoryPhrase[]
  /** The noun closest to the sensory words: what the sentence points to. */
  referent?: Referent | undefined
  /** Text in quotation marks: a name the instruction gives. */
  quoted: string[]
  /** The sentence's own words that are on none of the lists: what may name the thing in words. */
  nameWords: string[]
}

interface Hit {
  text: string
  index: number
  end: number
  key: string
}

function hits(pattern: RegExp, folded: string, original: string): Hit[] {
  const found: Hit[] = []
  for (const match of folded.matchAll(pattern)) {
    const index = match.index ?? 0
    found.push({ text: original.slice(index, index + match[0].length), index, end: index + match[0].length, key: squash(match[0]) })
  }
  return found
}

/** Words between two positions of a text: how far apart two phrases are. */
function wordsBetween(folded: string, from: number, to: number): number {
  const [start, end] = from <= to ? [from, to] : [to, from]
  return folded.slice(start, end).split(/[^\p{L}\p{N}]+/u).filter(Boolean).length
}

/** Words for keys and the keyboard, in the three languages: arrows in such a sentence are keys. */
const KEYBOARD = /(?<![\p{L}])(?:keys?|keyboard|up and down arrows?|tecla|teclas|teclado|flechas? del teclado)(?![\p{L}])/u

const QUOTED = /["“”«»„]([^"“”«»„]{1,80})["“”«»]|(?<![\p{L}])['‘’]([^'‘’]{1,80})['‘’](?![\p{L}])/gu

/** Splits a block of text into sentences: at a stop, a question or an exclamation mark followed by a space, and at line breaks. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+(?=[^\s\p{Ll}])|\n+/u)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 400)
}

/**
 * The instructions in a text that point to something by a sensory characteristic, in one language: a sentence with
 * an instruction word and a location, shape, size, orientation or sound phrase. A size or orientation word counts only
 * next to a noun for what it describes ("the big button", "o botão grande"), a shape adjective too ("round button"),
 * and a location word that is part of an idiom ("above all") does not count.
 */
export function findSensoryInstructions(text: string, language: SensoryLanguage): SensoryInstruction[] {
  const lists = compile(language)
  const found: SensoryInstruction[] = []
  for (const sentence of sentencesOf(text)) {
    const folded = fold(sentence)
    const cue = hits(lists.cue, folded, sentence)[0]
    if (!cue) continue
    const referents = hits(lists.referent, folded, sentence)
    const idioms = hits(lists.idiom, folded, sentence)
    const inIdiom = (hit: Hit) => idioms.some((idiom) => hit.index >= idiom.index && hit.end <= idiom.end)
    // "Use the up and down arrows": keys on the keyboard, not something drawn on the page.
    const keys = KEYBOARD.test(folded)
    // Nouns at most `distance` words away from a phrase, counting the words between the two.
    const near = (hit: Hit, distance: number) =>
      referents.filter((referent) => {
        if (referent.index === hit.index) return false
        const [gapStart, gapEnd] = referent.end <= hit.index ? [referent.end, hit.index] : [hit.end, referent.index]
        return gapEnd >= gapStart && wordsBetween(folded, gapStart, gapEnd) <= distance
      })
    const phrases: SensoryPhrase[] = []
    for (const hit of hits(lists.location, folded, sentence)) {
      if (inIdiom(hit)) continue
      // "above 18", "abaixo de 10": a quantity, not a place.
      if (/^\s*(?:(?:of|de|del|da|do)\s+)?[\d$€£]/u.test(folded.slice(hit.end))) continue
      phrases.push({ kind: 'location', phrase: hit.text, index: hit.index, directions: lists.locationOf.get(hit.key) })
    }
    for (const hit of hits(lists.shape, folded, sentence)) {
      const [concept, part] = lists.shapeOf.get(hit.key) ?? ['circle', 'adjective']
      if (inIdiom(hit) || (concept === 'arrow' && keys)) continue
      // A shape that is also a noun for a part of the page ("box") is listed as a referent, not here.
      if (part === 'adjective' && near(hit, 2).length === 0) continue
      phrases.push({ kind: 'shape', phrase: hit.text, index: hit.index, shape: concept })
    }
    for (const hit of hits(lists.size, folded, sentence)) {
      if (near(hit, 2).length === 0) continue
      phrases.push({ kind: 'size', phrase: hit.text, index: hit.index, size: lists.sizeOf.get(hit.key) })
    }
    for (const hit of hits(lists.orientation, folded, sentence)) {
      if (near(hit, 3).length === 0) continue
      phrases.push({ kind: 'orientation', phrase: hit.text, index: hit.index })
    }
    for (const hit of hits(lists.sound, folded, sentence)) phrases.push({ kind: 'sound', phrase: hit.text, index: hit.index })
    if (phrases.length === 0) continue
    phrases.sort((a, b) => a.index - b.index)
    const nameWords = folded
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !lists.listed.has(word) && !lists.stopwords.has(word))
    found.push({
      sentence,
      language,
      cue: cue.text,
      phrases,
      referent: referentOf(lists, folded, referents, phrases),
      quoted: quotedIn(sentence),
      nameWords: [...new Set(nameWords)],
    })
  }
  return found
}

/**
 * The noun the sensory words describe: the closest one. A noun inside a location phrase ("lado" in "do lado direito")
 * counts only when the sentence has no other ("the right sidebar"). With a shape noun ("the star"), the shape is what
 * the sentence points to, unless a noun sits right next to it ("the star icon").
 */
function referentOf(lists: Compiled, folded: string, referents: Hit[], phrases: SensoryPhrase[]): Referent | undefined {
  const inside = (hit: Hit) => phrases.some((phrase) => hit.index >= phrase.index && hit.index < phrase.index + phrase.phrase.length)
  const outside = referents.filter((hit) => !inside(hit))
  const pool = outside.length > 0 ? outside : referents
  const distance = (a: number, b: number) => wordsBetween(folded, Math.min(a, b), Math.max(a, b))
  const closest = pool
    .map((hit) => ({ hit, distance: Math.min(...phrases.map((phrase) => distance(hit.index, phrase.index))) }))
    .sort((a, b) => a.distance - b.distance)[0]?.hit
  const shapeNoun = phrases.find((phrase) => phrase.kind === 'shape' && lists.shapeOf.get(squash(phrase.phrase))?.[1] === 'noun')
  if (!closest) return undefined
  if (shapeNoun && distance(closest.index, shapeNoun.index) > 2) return undefined
  return { kind: lists.referentOf.get(closest.key) ?? 'region', word: closest.text, index: closest.index }
}

function quotedIn(sentence: string): string[] {
  return [...sentence.matchAll(QUOTED)].map((match) => (match[1] ?? match[2] ?? '').trim()).filter(Boolean)
}

/** The location, shape, size, orientation and sound phrases of the lists in a text, folded: the broad matcher's side of a claim. */
export function sensoryPhrasesIn(text: string, language: SensoryLanguage): string[] {
  const lists = compile(language)
  const folded = fold(text)
  return [lists.location, lists.shape, lists.size, lists.orientation, lists.sound].flatMap((pattern) => hits(pattern, folded, text).map((hit) => hit.key))
}

/** Each word of a text, folded, without the words of the lists and the stop words: words that may name something. */
export function nameWordsOf(text: string, language: SensoryLanguage): string[] {
  const lists = compile(language)
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !lists.stopwords.has(word))
}

// What a shape looks like on a page: characters drawn as that shape, and words in class names, ids, file names and
// icon names (fa-star, icon-arrow-right, star.svg). A circle is also a box whose corners make it one (native.shape).

export const SHAPE_GLYPHS: Readonly<Record<ShapeConcept, string>> = {
  circle: '●○◯⬤◉◎⚪⚫',
  square: '■□▪▫◼◻⬛⬜',
  triangle: '▲△▴▵▶▷▸▹►▻▼▽▾▿◀◁◂◃◄◅',
  star: '★☆✦✧✩✪✫✬✭✮✯✰⭐🌟',
  heart: '♥♡❤❥💙💚💛🧡💜🖤🤍💗',
  diamond: '◆◇♦◊',
  cross: '✕✖✗✘❌×',
  arrow: '←→↑↓⇦⇨⇧⇩➔➜➞➡⬅⬆⬇❮❯‹›«»',
  dots: '⋮⋯…⁝',
  hamburger: '☰≡',
  magnifier: '🔍🔎⌕',
  polygon: '⬡⬢⬟⭓',
}

export const SHAPE_TOKENS: Readonly<Record<ShapeConcept, readonly string[]>> = {
  // Not "rounded": Bootstrap's class rounds the corners a little; "rounded-circle" reads as "circle".
  circle: ['circle', 'circulo', 'dot'],
  square: ['square', 'quadrado', 'cuadrado'],
  triangle: ['triangle', 'triangulo', 'caret'],
  star: ['star', 'stars', 'estrela', 'estrella'],
  heart: ['heart', 'hearts', 'coracao', 'corazon'],
  diamond: ['diamond', 'losango', 'rombo'],
  cross: ['cross', 'close', 'xmark', 'times', 'cruz'],
  arrow: ['arrow', 'arrows', 'chevron', 'seta', 'flecha', 'caret', 'angle'],
  dots: ['dots', 'ellipsis', 'kebab', 'meatball'],
  hamburger: ['hamburger', 'burger', 'bars', 'toggler', 'hamburguer', 'hamburguesa'],
  magnifier: ['search', 'magnifier', 'magnifying', 'lupa', 'loupe'],
  polygon: ['hexagon', 'pentagon', 'octagon', 'polygon'],
}
