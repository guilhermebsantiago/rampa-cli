import type { Locale } from './i18n.ts'

export type Level = 'A' | 'AA' | 'AAA'

/** The WCAG version a run checks against; 2.2 by default. */
export type WcagVersion = '2.1' | '2.2'

export const WCAG_VERSIONS: readonly WcagVersion[] = ['2.1', '2.2']

export const DEFAULT_WCAG: WcagVersion = '2.2'

/** What a report says it checked against: the A and AA criteria of one WCAG version. */
export type WcagTarget = 'wcag21-aa' | 'wcag22-aa'

type Localized = { en: string; 'pt-BR': string }

export interface SuccessCriterion {
  id: string
  level: Level
  /** The WCAG version that added the criterion. */
  since: '2.0' | '2.1' | '2.2'
  /** Only 4.1.1 Parsing: WCAG 2.2 removed it, and under 2.1 it is satisfied by definition for HTML and XML. */
  removedIn?: '2.2' | undefined
  name: Localized
  /** What a person still has to review or test, whatever Rampa checked. */
  manual: Localized
}

/**
 * WCAG 2.1 and 2.2, levels A and AA: 56 success criteria, of which a run reports coverage against
 * 50 (WCAG 2.1, with 4.1.1) or 55 (WCAG 2.2, without it). Names in Portuguese follow the W3C
 * authorized translation.
 */
export const WCAG_CRITERIA: readonly SuccessCriterion[] = [
  sc('1.1.1', 'A', '2.0', ['Non-text Content', 'Conteúdo não textual'], [
    'Equivalence for complex and contextual images; decorative or not; long descriptions; CAPTCHA usability',
    'Equivalência de imagens complexas e contextuais; se a imagem é decorativa; descrições longas; usabilidade de CAPTCHA',
  ]),
  sc('1.2.1', 'A', '2.0', ['Audio-only and Video-only (Prerecorded)', 'Apenas áudio e apenas vídeo (pré-gravado)'], [
    'Whether a transcript is equivalent; decorative video-only; labeled media alternatives',
    'Se a transcrição é equivalente; vídeo apenas decorativo; mídia identificada como alternativa',
  ]),
  sc('1.2.2', 'A', '2.0', ['Captions (Prerecorded)', 'Legendas (pré-gravadas)'], [
    'Accuracy, completeness, synchronization, speakers; players Rampa cannot read',
    'Precisão, completude, sincronia e quem está falando; players que o Rampa não consegue ler',
  ]),
  sc('1.2.3', 'A', '2.0', ['Audio Description or Media Alternative (Prerecorded)', 'Audiodescrição ou mídia alternativa (pré-gravada)'], [
    'Whether visual information matters, and whether the description or alternative is adequate',
    'Se a informação visual importa, e se a descrição ou a alternativa é adequada',
  ]),
  sc('1.2.4', 'AA', '2.0', ['Captions (Live)', 'Legendas (ao vivo)'], ['Everything about live captions', 'Tudo sobre legendas ao vivo']),
  sc('1.2.5', 'AA', '2.0', ['Audio Description (Prerecorded)', 'Audiodescrição (pré-gravada)'], [
    'Quality of the description; pauses; importance of the visuals',
    'Qualidade da descrição; pausas; importância do que é visual',
  ]),
  sc('1.3.1', 'A', '2.0', ['Info and Relationships', 'Informações e relações'], [
    'Whether formatting carries meaning; complex tables; charts and maps; structure "available in text"',
    'Se a formatação carrega significado; tabelas complexas; gráficos e mapas; estrutura "disponível em texto"',
  ]),
  sc('1.3.2', 'A', '2.0', ['Meaningful Sequence', 'Sequência com significado'], [
    'Whether an order matters; magazine and dashboard layouts; bidirectional text',
    'Se a ordem importa; layouts de revista e de painel; texto bidirecional',
  ]),
  sc('1.3.3', 'A', '2.0', ['Sensory Characteristics', 'Características sensoriais'], [
    'Instructions in images and media; references that depend on context',
    'Instruções em imagens e mídia; referências que dependem do contexto',
  ]),
  sc('1.3.4', 'AA', '2.1', ['Orientation', 'Orientação'], [
    'Essential orientation; real devices with the rotation lock; native apps',
    'Orientação essencial; dispositivos reais com a trava de rotação; apps nativos',
  ]),
  sc('1.3.5', 'AA', '2.1', ['Identify Input Purpose', 'Identificar o propósito de entrada'], [
    'Whose data a field collects in ambiguous contexts; whether autofill works',
    'De quem é o dado que um campo coleta em contextos ambíguos; se o preenchimento automático funciona',
  ]),
  sc('1.4.1', 'A', '2.0', ['Use of Color', 'Uso de cor'], [
    'Charts, maps, color-coded tables; whether a difference carries meaning',
    'Gráficos, mapas, tabelas codificadas por cor; se uma diferença carrega significado',
  ]),
  sc('1.4.2', 'A', '2.0', ['Audio Control', 'Controle de áudio'], [
    'Audio started by other interactions; games; cross-origin media; keyboard access to the control',
    'Áudio iniciado por outras interações; jogos; mídia de outra origem; acesso ao controle pelo teclado',
  ]),
  sc('1.4.3', 'AA', '2.0', ['Contrast (Minimum)', 'Contraste (mínimo)'], [
    'Text over photos and video; text in images; logotypes',
    'Texto sobre fotos e vídeo; texto em imagens; logotipos',
  ]),
  sc('1.4.4', 'AA', '2.0', ['Resize Text', 'Redimensionar texto'], [
    'Lost functionality in complex widgets; acceptable truncation; real mobile browsers',
    'Perda de funcionalidade em componentes complexos; truncamento aceitável; navegadores móveis reais',
  ]),
  sc('1.4.5', 'AA', '2.0', ['Images of Text', 'Imagens de texto'], [
    'Essential presentation; customizable images; infographics',
    'Apresentação essencial; imagens personalizáveis; infográficos',
  ]),
  sc('1.4.10', 'AA', '2.1', ['Reflow', 'Refluxo'], [
    'Lost functionality at 320 CSS px; content that scrolls horizontally; whether the two-dimensional exception applies',
    'Perda de funcionalidade a 320 px CSS; conteúdo que rola na horizontal; se a exceção de duas dimensões se aplica',
  ]),
  sc('1.4.11', 'AA', '2.1', ['Non-text Contrast', 'Contraste não textual'], [
    'Graphs and charts; whether a graphic is required; hover and active states; gradients',
    'Gráficos; se um elemento gráfico é necessário; estados de hover e ativo; degradês',
  ]),
  sc('1.4.12', 'AA', '2.1', ['Text Spacing', 'Espaçamento de texto'], [
    'Text clipped or overlapping with the spacing applied; scripts where a metric does not apply; text in canvas and images',
    'Texto cortado ou sobreposto com o espaçamento aplicado; escritas em que uma métrica não se aplica; texto em canvas e em imagens',
  ]),
  sc('1.4.13', 'AA', '2.1', ['Content on Hover or Focus', 'Conteúdo em foco ou hover'], [
    'Content shown on hover or focus: dismissible, hoverable, persistent; touch; content that moves',
    'Conteúdo mostrado em hover ou foco: dispensável, passível de hover, persistente; toque; conteúdo que se move',
  ]),
  sc('2.1.1', 'A', '2.0', ['Keyboard', 'Teclado'], [
    'Operating everything with the keyboard; states behind login; drag and drop; canvas; speech and switch input',
    'Operar tudo pelo teclado; estados atrás de login; arrastar e soltar; canvas; entrada por voz e por acionador',
  ]),
  sc('2.1.2', 'A', '2.0', ['No Keyboard Trap', 'Sem bloqueio do teclado'], [
    'Moving through the whole page with the keyboard; traps after interactions; plug-ins; screen-reader modes',
    'Percorrer a página inteira pelo teclado; bloqueios depois de interações; plug-ins; modos de leitor de tela',
  ]),
  sc('2.1.4', 'A', '2.1', ['Character Key Shortcuts', 'Atalhos de teclado por caractere'], [
    'Settings on other pages or behind login, and whether they work; shortcuts in frames; keyboard layouts and IMEs; speech input',
    'Configurações em outras páginas ou atrás de login, e se funcionam; atalhos em frames; layouts de teclado e IMEs; entrada por voz',
  ]),
  sc('2.2.1', 'A', '2.0', ['Timing Adjustable', 'Ajustável por temporização'], [
    'Server-side time-outs; flows behind login; the exceptions',
    'Tempos-limite no servidor; fluxos atrás de login; as exceções',
  ]),
  sc('2.2.2', 'A', '2.0', ['Pause, Stop, Hide', 'Pausar, parar, ocultar'], [
    'Moving, blinking and updating content and its controls; essential motion; reliance on reduced motion',
    'Conteúdo em movimento, piscando ou se atualizando, e seus controles; movimento essencial; dependência de movimento reduzido',
  ]),
  sc('2.3.1', 'A', '2.0', ['Three Flashes or Below Threshold', 'Três flashes ou abaixo do limite'], [
    'Flashing content, live and user-generated content; certification-grade sign-off',
    'Conteúdo que pisca, ao vivo ou gerado por usuários; aprovação com rigor de certificação',
  ]),
  sc('2.4.1', 'A', '2.0', ['Bypass Blocks', 'Ignorar blocos'], [
    'Whether a block is substantial; whether skip links work; single-page-app views',
    'Se um bloco é substancial; se os links de pular funcionam; telas de aplicações de página única',
  ]),
  sc('2.4.2', 'A', '2.0', ['Page Titled', 'Página com título'], ['Whether a title fits the domain and audience', 'Se o título serve ao domínio e ao público']),
  sc('2.4.3', 'A', '2.0', ['Focus Order', 'Ordem do foco'], [
    'Whether the focus order preserves meaning; dialogs and menus',
    'Se a ordem do foco preserva o significado; diálogos e menus',
  ]),
  sc('2.4.4', 'A', '2.0', ['Link Purpose (In Context)', 'Finalidade do link (em contexto)'], [
    'The "ambiguous to users in general" exception; destinations behind login',
    'A exceção "ambíguo para os usuários em geral"; destinos atrás de login',
  ]),
  sc('2.4.5', 'AA', '2.0', ['Multiple Ways', 'Várias formas'], [
    'Defining the set of pages; the process exception',
    'Definir o conjunto de páginas; a exceção de processo',
  ]),
  sc('2.4.6', 'AA', '2.0', ['Headings and Labels', 'Cabeçalhos e rótulos'], [
    'Whether a heading or label fits the domain and audience',
    'Se um cabeçalho ou rótulo serve ao domínio e ao público',
  ]),
  sc('2.4.7', 'AA', '2.0', ['Focus Visible', 'Foco visível'], [
    'Whether every focused element shows it; faint indicators; forced colors',
    'Se todo elemento em foco o mostra; indicadores fracos; cores forçadas',
  ]),
  sc('2.4.11', 'AA', '2.2', ['Focus Not Obscured (Minimum)', 'Foco não obscurecido (mínimo)'], [
    'Focused elements hidden by sticky headers, banners or dialogs; content the user opened or can move',
    'Elementos em foco escondidos por cabeçalhos fixos, banners ou diálogos; conteúdo que o usuário abriu ou pode mover',
  ]),
  sc('2.5.1', 'A', '2.1', ['Pointer Gestures', 'Gestos de ponteiro'], [
    'Multipoint and path-based gestures and their alternatives; real touch hardware',
    'Gestos multiponto e baseados em trajeto, e suas alternativas; hardware de toque real',
  ]),
  sc('2.5.2', 'A', '2.1', ['Pointer Cancellation', 'Cancelamento de ponteiro'], [
    'Actions on the down-event; undo in drag and drop; touch',
    'Ações no evento de pressionar; desfazer em arrastar e soltar; toque',
  ]),
  sc('2.5.3', 'A', '2.1', ['Label in Name', 'Rótulo no nome'], [
    'Label versus nearby instruction; symbols and numbers; testing with speech input',
    'Rótulo versus instrução próxima; símbolos e números; teste com entrada por voz',
  ]),
  sc('2.5.4', 'A', '2.1', ['Motion Actuation', 'Atuação por movimento'], [
    'Motion and sensor input and its alternatives; real sensors',
    'Entrada por movimento e sensores, e suas alternativas; sensores reais',
  ]),
  sc('2.5.7', 'AA', '2.2', ['Dragging Movements', 'Movimentos de arrastar'], [
    'Dragging and its single-pointer alternatives; essential dragging; canvas editors',
    'Arrastar e suas alternativas com um ponteiro; arrasto essencial; editores em canvas',
  ]),
  sc('2.5.8', 'AA', '2.2', ['Target Size (Minimum)', 'Tamanho do alvo (mínimo)'], [
    'Essential or legally required presentation; equivalent targets; canvas and SVG maps',
    'Apresentação essencial ou exigida por lei; alvos equivalentes; mapas em canvas e SVG',
  ]),
  sc('3.1.1', 'A', '2.0', ['Language of Page', 'Idioma da página'], ['Balanced bilingual pages; dialects', 'Páginas bilíngues equilibradas; dialetos']),
  sc('3.1.2', 'AA', '2.0', ['Language of Parts', 'Idioma de partes'], [
    'Unmarked passages; single words; proper names; loanwords',
    'Trechos sem marcação; palavras isoladas; nomes próprios; empréstimos',
  ]),
  sc('3.2.1', 'A', '2.0', ['On Focus', 'Em foco'], [
    'Changes of context when an element receives focus; states after interaction',
    'Mudanças de contexto quando um elemento recebe foco; estados depois de interações',
  ]),
  sc('3.2.2', 'A', '2.0', ['On Input', 'Em entrada'], [
    'Changes of context when a setting changes, and whether notice is adequate; custom widgets',
    'Mudanças de contexto ao mudar uma configuração, e se o aviso é adequado; componentes personalizados',
  ]),
  sc('3.2.3', 'AA', '2.0', ['Consistent Navigation', 'Navegação consistente'], [
    'Navigation order across the set of pages; personalization; pages behind login',
    'Ordem da navegação no conjunto de páginas; personalização; páginas atrás de login',
  ]),
  sc('3.2.4', 'AA', '2.0', ['Consistent Identification', 'Identificação consistente'], [
    'What counts as the same function; icons in context',
    'O que conta como a mesma função; ícones em contexto',
  ]),
  sc('3.2.6', 'A', '2.2', ['Consistent Help', 'Ajuda consistente'], [
    'Help mechanisms and their order across the set of pages; help that is not a link',
    'Mecanismos de ajuda e sua ordem no conjunto de páginas; ajuda que não é um link',
  ]),
  sc('3.3.1', 'A', '2.0', ['Error Identification', 'Identificação de erro'], [
    'Error messages after input; errors the server finds; wording',
    'Mensagens de erro depois da entrada; erros que o servidor encontra; redação',
  ]),
  sc('3.3.2', 'A', '2.0', ['Labels or Instructions', 'Rótulos ou instruções'], [
    'Whether instructions are enough; icons as labels',
    'Se as instruções bastam; ícones como rótulos',
  ]),
  sc('3.3.3', 'AA', '2.0', ['Error Suggestion', 'Sugestão de erro'], [
    'Whether a suggestion is correct; server-side errors; the security exception',
    'Se a sugestão está correta; erros no servidor; a exceção de segurança',
  ]),
  sc('3.3.4', 'AA', '2.0', ['Error Prevention (Legal, Financial, Data)', 'Prevenção de erros (legais, financeiros, de dados)'], [
    'Reversal, checking or confirmation of submissions: almost all of it',
    'Reversão, verificação ou confirmação de envios: quase tudo',
  ]),
  sc('3.3.7', 'A', '2.2', ['Redundant Entry', 'Entrada redundante'], [
    'Information asked again in a process; third-party steps; the exceptions',
    'Informação pedida de novo num processo; etapas de terceiros; as exceções',
  ]),
  sc('3.3.8', 'AA', '2.2', ['Accessible Authentication (Minimum)', 'Autenticação acessível (mínima)'], [
    'Cognitive function tests in sign-in and recovery; CAPTCHA escalations; later steps that need an account',
    'Testes de função cognitiva no login e na recuperação; escalonamentos de CAPTCHA; etapas que exigem uma conta',
  ]),
  {
    ...sc('4.1.1', 'A', '2.0', ['Parsing', 'Análise sintática'], [
      'Only whether a contract still asks for markup validation',
      'Só se um contrato ainda exige validação da marcação',
    ]),
    removedIn: '2.2',
  },
  sc('4.1.2', 'A', '2.0', ['Name, Role, Value', 'Nome, função, valor'], [
    'Roles for custom widgets; values set by assistive technology; what is actually announced',
    'Funções de componentes personalizados; valores definidos por tecnologia assistiva; o que é de fato anunciado',
  ]),
  sc('4.1.3', 'AA', '2.1', ['Status Messages', 'Mensagens de status'], [
    'Whether status messages are announced in screen readers',
    'Se as mensagens de status são anunciadas nos leitores de tela',
  ]),
]

function sc(id: string, level: Level, since: SuccessCriterion['since'], name: [string, string], manual: [string, string]): SuccessCriterion {
  return { id, level, since, name: { en: name[0], 'pt-BR': name[1] }, manual: { en: manual[0], 'pt-BR': manual[1] } }
}

/** The A and AA criteria a run checks against: 50 for WCAG 2.1, 55 for WCAG 2.2 (which removed 4.1.1). */
export function criteriaFor(version: WcagVersion): readonly SuccessCriterion[] {
  return version === '2.1' ? WCAG21_A_AA : WCAG22_A_AA
}

/** WCAG 2.1 levels A and AA: 50 success criteria. */
export const WCAG21_A_AA: readonly SuccessCriterion[] = WCAG_CRITERIA.filter((sc) => sc.since !== '2.2')

/** WCAG 2.2 levels A and AA: 55 success criteria. */
export const WCAG22_A_AA: readonly SuccessCriterion[] = WCAG_CRITERIA.filter((sc) => sc.removedIn !== '2.2')

const BY_ID = new Map(WCAG_CRITERIA.map((sc) => [sc.id, sc]))

export function successCriterion(id: string): SuccessCriterion | undefined {
  return BY_ID.get(id)
}

/** A criterion of WCAG 2.2 A/AA that WCAG 2.1 does not have, in a run that targets 2.1: reported, never counted. */
export function beyondTarget(id: string, version: WcagVersion): boolean {
  const sc = BY_ID.get(id)
  return sc !== undefined && !criteriaFor(version).includes(sc)
}

export function wcagTarget(version: WcagVersion): WcagTarget {
  return version === '2.1' ? 'wcag21-aa' : 'wcag22-aa'
}

/** The version a report targets; reports written before Rampa knew WCAG 2.2 targeted 2.1. */
export function versionOf(target: WcagTarget | undefined): WcagVersion {
  return target === 'wcag22-aa' ? '2.2' : '2.1'
}

/** `2.2` or `2.1`; also takes `22`, `wcag22` and `wcag22-aa`. Undefined for anything else. */
export function parseWcagVersion(input: string | undefined): WcagVersion | undefined {
  const normalized = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^wcag\s*/, '')
    .replace(/-?aa$/, '')
  if (normalized === '2.1' || normalized === '21') return '2.1'
  if (normalized === '2.2' || normalized === '22') return '2.2'
  return undefined
}

export function criterionLabel(id: string, locale: Locale): string {
  const sc = BY_ID.get(id)
  if (!sc) return `WCAG ${id}`
  return `WCAG ${id} (${sc.level}) — ${sc.name[locale] ?? sc.name.en}`
}

/** axe-core tags success criteria as `wcag111`, `wcag1410`... */
export function criterionFromAxeTag(tag: string): string | undefined {
  const match = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined
}

export function compareCriteria(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
