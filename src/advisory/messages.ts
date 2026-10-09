import type { Locale } from '../i18n.ts'

/**
 * Every string an advisory is shown with, in English and Portuguese. They live apart from src/i18n.ts so
 * one test can read them all: advisory wording never says the page fails, violates or does not conform
 * (docs/plans/cognitive-profile.md §2.4). Messages with two forms, one|other, go through `amPlural`.
 */
const messages = {
  en: {
    labelAdvisory: 'Advisory · COGA {pattern} {title} (not a WCAG requirement)',
    labelBeyond: 'Beyond the target: WCAG {version} {id} {name} (Level {level})',
    sectionTitle: 'Advisories: cognitive accessibility (W3C COGA guidance, not WCAG requirements)',
    beyondTitle: 'Beyond the target (WCAG 2.2 AAA; not part of the A/AA check)',
    impactLegend: 'Impact: barrier, may stop the task or cost money or data; hurdle, makes the task harder or more error-prone; suggestion, improves understanding.',
    impact_barrier: 'barrier',
    impact_hurdle: 'hurdle',
    impact_suggestion: 'suggestion',
    noAdvisories: 'Nothing to report in what the cognitive profile screened.',
    moreAdvisories: '…{count} more (--verbose lists them)',
    sourceRule: 'rule',
    sourceJudgment: 'rule, with text a model proposed',
    related: 'related: WCAG {criterion} finding {id}',
    advisoryCount: '{count} advisory|{count} advisories',
    advisoriesSummary: 'Advisories (not WCAG requirements): {count}',
    siteAdvisories: 'The JSON report (-o) lists each one; rampa check <page> --profile cognitive shows a page in full.',
    omittedAdvisories:
      '{count} advisory was left out to fit the size limit of a comment; the JSON, SARIF and HTML reports have it.|{count} advisories were left out to fit the size limit of a comment; the JSON, SARIF and HTML reports have them all.',
    patternLink: 'COGA pattern {pattern}: {title}',
    noteLink: 'its section in the W3C Note',
    sarifAdvisoryRule: 'Advisory from W3C COGA guidance, pattern {pattern} {title}: not a WCAG requirement, and never part of the conformance check.',
    sarifBeyondRule: 'WCAG {version} {id} {name} (Level {level}): beyond the A/AA target of this run.',
    // coga/input-formats
    purpose_postal: 'postal code',
    purpose_phone: 'phone number',
    purpose_card: 'card number',
    purpose_cpf: 'CPF',
    purpose_cnpj: 'CNPJ',
    purpose_date: 'date',
    purpose_account: 'account number',
    separators_postal: 'the hyphen',
    separators_phone: 'brackets, spaces, the hyphen and the + sign',
    separators_card: 'the spaces',
    separators_cpf: 'the dots and the hyphen',
    separators_cnpj: 'the dots, the slash and the hyphen',
    separators_date: 'the slashes',
    separators_account: 'the hyphen',
    formatsNumber:
      'The {purpose} field is type="number", made for quantities: it refuses "{variant}" as people usually write it ({separators}), and the arrow keys or the mouse wheel can change the value.',
    formatsPattern: "The {purpose} field's pattern accepts only some ways of writing it: it refuses {variants}.",
    formatsLength: 'The {purpose} field stops at {maxlength} characters, so "{variant}" ({length} characters, as people usually write it) does not fit.',
    formatsExample: 'The example "{example}" shown with the field is refused by the field\'s own {constraint}.',
    formatsRecommendNumber: 'COGA recommends accepting the ways people write a value: a text field with inputmode="numeric" shows the same keypad.',
    formatsRecommend: 'COGA recommends accepting different formats, for example by ignoring spaces and separators, and not restricting entries to arbitrary lengths.',
    formatsMask: 'A script may reformat the value while it is typed, and Rampa did not type into the field: confidence is medium.',
    formatsInvalidPattern: 'The pattern of {ref} is not valid in the v mode browsers use, so they ignore it; nothing was claimed from it.',
    // coga/visible-labels
    labelsPlaceholderOnly: 'The only text on screen that says what this field asks for is its placeholder "{placeholder}", which disappears once the person starts typing.',
    'labelsSource_aria-label': 'Its name is in aria-label, which is not shown, and simple text-to-speech tools often do not read it.',
    labelsSource_title: 'Its name is in the title attribute, shown only as a tooltip, and simple text-to-speech tools often do not read it.',
    'labelsSource_hidden-label': 'It has a label, but the label is hidden from view.',
    labelsRecommend: 'COGA recommends labels that stay visible next to the control.',
    labelsHint: 'The placeholder reads like an example: keep it as a hint tied to the field with aria-describedby, and add a visible label.',
    // coga/preselected-cost
    costChecked: 'The option "{option}" is already checked when the page loads, and it adds {cost}.',
    costAmount: 'a charge of {amount}',
    costRecurring: 'a recurring commitment ("{phrase}")',
    costRecommend: 'COGA recommends no new or hidden charges: leave paid options unchecked, so the person chooses them.',
    // coga/abbreviations
    abbrNotExplained: '"{token}" appears {times} on this page without an explanation: no <abbr title>, no full term next to it, no definition and no glossary link.',
    abbrLaterOnly: '"{token}" is explained only at its {nth} use ("{explained}"), not the first time it appears.',
    abbrRecommend: 'COGA recommends explaining an uncommon abbreviation the first time it is used.',
    abbrExpansionPage: 'The page itself spells it out as "{expansion}".',
    abbrExpansionList: 'It stands for "{expansion}" ({source}).',
    abbrExpansionModel: 'Suggestion to confirm: "{expansion}", proposed by {model}; only its initials were checked against the letters, so a person should confirm it.',
    abbrLaw: "Brazil's plain-language law, Lei 15.263/2025 (art. 5º, VIII), asks public bodies to write the full name before an acronym.",
    abbrBeyond:
      '"{token}" appears {times} on this page with no expanded form. It is common enough that COGA does not ask to explain it, but WCAG 3.1.4 (Level AAA) asks for a way to find the expanded form{example}. AAA is beyond the A/AA target of this run.',
    abbrBeyondExample: ', such as <abbr title="{expansion}">',
    beyondAbbrLine: '3.1.4 Abbreviations: {count} abbreviation has no expanded form on this page: {list}|3.1.4 Abbreviations: {count} abbreviations have no expanded form on this page: {list}',
    timesOnce: 'once',
    timesMany: '{count} times',
    listCurated: 'Rampa list of attested expansions, pending review',
    // Text measurements
    metricsTitle: 'Text measurements (context, not findings) — {scope}, {language}',
    scopeMain: 'main content',
    scopePage: 'whole page (no main or article)',
    metricsCounts: '{words} in {sentences} and {paragraphs}; sentence length in words: median {median}, longest {max}',
    countWords: '{count} word|{count} words',
    countSentences: '{count} sentence|{count} sentences',
    countParagraphs: '{count} paragraph|{count} paragraphs',
    metricsLongest: 'Longest sentence: "{text}"',
    metricsLists: '{count} list written as prose (COGA o3p05)|{count} lists written as prose (COGA o3p05)',
    metricsEnglish: '{paragraphs} over 50 words (COGA §4.4.5, English); {sentences} over 25 words (WCAG technique G153, English)',
    metricsFleschEn: 'Flesch Reading Ease {value}; Flesch–Kincaid grade {grade} (a US school grade, fitted in 1975 to US Navy enlisted personnel).',
    metricsFleschPt: 'Flesch adapted to Portuguese (Martins et al., 1996): {value}, band "{band}" ({range}).',
    metricsMartinsCaveat:
      'The adaptation was validated only as an ordering of textbook passages by school grade; its authors say it measures "readability and not the comprehensibility".',
    metricsCaveat: 'Formulas count word and sentence length; they do not measure whether people understand the text.',
    metricsUnder100: 'No readability formula: under 100 words of paragraph prose.',
    metricsNoFormula: 'No readability formula for this language: counts only.',
    metricsHeuristic: 'English syllables are estimated by rule, without a pronouncing dictionary.',
    'band_very-easy': 'very easy',
    band_easy: 'easy',
    'band_fairly-difficult': 'fairly difficult',
    'band_very-difficult': 'very difficult',
    // Coverage
    cogaCoverageTitle: 'Cognitive profile (W3C COGA guidance; advisory, not WCAG conformance):',
    cogaScreened: 'Screened in part: {count} of {total} design patterns: {list}.',
    cogaNotRun: 'Did not run: {list}.',
    cogaNotChecked: 'Not checked: {count} patterns, and the rest of the ones screened in part (--verbose lists them).',
    cogaNotCheckedList: 'Not checked: {list}.',
    cogaBeyond: 'Beyond the A/AA target: WCAG 2.2 3.1.4 Abbreviations (AAA) checked; 3.1.5 Reading Level needs a qualified reviewer, with the text measurements attached.',
    cogaPeople: 'Testing with people should include people with cognitive and learning disabilities (COGA §5).',
    cogaOff: 'Cognitive accessibility guidance (W3C COGA): not screened; --profile cognitive adds advisory checks.',
    cogaStatement: 'Cognitive profile (W3C COGA guidance, advisory, not WCAG): {count} of {total} design patterns screened in part ({list}), the rest not checked',
    part_o3p01: 'abbreviations',
    part_o4p03: 'pre-checked paid options',
    part_o4p06: 'placeholder-only labels',
    part_o4p08: 'static field attributes',
  },
  'pt-BR': {
    labelAdvisory: 'Recomendação · COGA {pattern} {title} (não é requisito da WCAG)',
    labelBeyond: 'Além do alvo: WCAG {version} {id} {name} (nível {level})',
    sectionTitle: 'Recomendações de acessibilidade cognitiva (orientação COGA do W3C, não são requisitos da WCAG)',
    beyondTitle: 'Além do alvo (WCAG 2.2 AAA; fora da verificação A/AA)',
    impactLegend: 'Impacto: barreira, pode impedir a tarefa ou custar dinheiro ou dados; obstáculo, dificulta a tarefa ou leva a enganos; sugestão, melhora a compreensão.',
    impact_barrier: 'barreira',
    impact_hurdle: 'obstáculo',
    impact_suggestion: 'sugestão',
    noAdvisories: 'Nada a relatar no que o perfil cognitivo verificou.',
    moreAdvisories: '…mais {count} (--verbose lista)',
    sourceRule: 'regra',
    sourceJudgment: 'regra, com texto proposto por um modelo',
    related: 'relacionado: achado WCAG {criterion} {id}',
    advisoryCount: '{count} recomendação|{count} recomendações',
    advisoriesSummary: 'Recomendações (não são requisitos da WCAG): {count}',
    siteAdvisories: 'O relatório JSON (-o) lista cada uma; rampa check <página> --profile cognitive mostra uma página por inteiro.',
    omittedAdvisories:
      '{count} recomendação ficou de fora para caber no limite de tamanho de um comentário; os relatórios JSON, SARIF e HTML têm essa recomendação.|{count} recomendações ficaram de fora para caber no limite de tamanho de um comentário; os relatórios JSON, SARIF e HTML têm todas.',
    patternLink: 'Padrão COGA {pattern}: {title} (tradução não oficial)',
    noteLink: 'a seção na Nota do W3C (em inglês)',
    sarifAdvisoryRule: 'Recomendação da orientação COGA do W3C, padrão {pattern} {title}: não é requisito da WCAG e nunca entra na verificação de conformidade.',
    sarifBeyondRule: 'WCAG {version} {id} {name} (nível {level}): além do alvo A/AA desta execução.',
    purpose_postal: 'CEP',
    purpose_phone: 'telefone',
    purpose_card: 'número do cartão',
    purpose_cpf: 'CPF',
    purpose_cnpj: 'CNPJ',
    purpose_date: 'data',
    purpose_account: 'número da conta',
    separators_postal: 'o hífen',
    separators_phone: 'parênteses, espaços, o hífen e o sinal de +',
    separators_card: 'os espaços',
    separators_cpf: 'os pontos e o hífen',
    separators_cnpj: 'os pontos, a barra e o hífen',
    separators_date: 'as barras',
    separators_account: 'o hífen',
    formatsNumber:
      'O campo {purpose} é type="number", feito para quantidades: ele recusa "{variant}", como as pessoas costumam escrever ({separators}), e as setas do teclado ou a roda do mouse podem mudar o valor.',
    formatsPattern: 'O pattern do campo {purpose} aceita só alguns jeitos de escrever o valor: ele recusa {variants}.',
    formatsLength: 'O campo {purpose} para em {maxlength} caracteres, então "{variant}" ({length} caracteres, como as pessoas costumam escrever) não cabe.',
    formatsExample: 'O exemplo "{example}" mostrado com o campo é recusado pelo próprio {constraint} do campo.',
    formatsRecommendNumber: 'A COGA recomenda aceitar os jeitos como as pessoas escrevem o valor: um campo de texto com inputmode="numeric" mostra o mesmo teclado.',
    formatsRecommend: 'A COGA recomenda aceitar diferentes formatos, por exemplo ignorando espaços e separadores, e não limitar a entrada a tamanhos arbitrários.',
    formatsMask: 'Um script pode reformatar o valor durante a digitação, e o Rampa não digitou no campo: a confiança é média.',
    formatsInvalidPattern: 'O pattern de {ref} não é válido no modo v que os navegadores usam, então eles o ignoram; nada foi afirmado a partir dele.',
    labelsPlaceholderOnly: 'O único texto na tela que diz o que este campo pede é o placeholder "{placeholder}", que some assim que a pessoa começa a digitar.',
    'labelsSource_aria-label': 'O nome está no aria-label, que não aparece na tela, e leitores de texto simples muitas vezes não o leem.',
    labelsSource_title: 'O nome está no atributo title, que só aparece como dica ao passar o mouse, e leitores de texto simples muitas vezes não o leem.',
    'labelsSource_hidden-label': 'O campo tem um rótulo, mas ele está escondido da tela.',
    labelsRecommend: 'A COGA recomenda rótulos que fiquem visíveis ao lado do controle.',
    labelsHint: 'O placeholder parece um exemplo: mantenha-o como dica ligada ao campo por aria-describedby e acrescente um rótulo visível.',
    costChecked: 'A opção "{option}" já vem marcada quando a página carrega, e ela acrescenta {cost}.',
    costAmount: 'uma cobrança de {amount}',
    costRecurring: 'um compromisso recorrente ("{phrase}")',
    costRecommend: 'A COGA recomenda não incluir cobranças novas ou escondidas: deixe as opções pagas desmarcadas, para que a pessoa as escolha.',
    abbrNotExplained: 'A sigla "{token}" aparece {times} nesta página sem explicação: nenhum <abbr title>, nenhum nome completo ao lado, nenhuma definição e nenhum link para glossário.',
    abbrLaterOnly: 'A sigla "{token}" só é explicada na {nth} ocorrência ("{explained}"), não na primeira vez em que aparece.',
    abbrRecommend: 'A COGA recomenda explicar uma sigla pouco comum na primeira vez em que ela aparece.',
    abbrExpansionPage: 'A própria página escreve por extenso: "{expansion}".',
    abbrExpansionList: 'Ela significa "{expansion}" ({source}).',
    abbrExpansionModel: 'Sugestão a confirmar: "{expansion}", proposta por {model}; só as iniciais foram conferidas com as letras, então uma pessoa deve confirmar.',
    abbrLaw: 'A Lei 15.263/2025 (art. 5º, VIII) orienta os órgãos públicos a redigir o nome completo antes das siglas.',
    abbrBeyond:
      'A sigla "{token}" aparece {times} nesta página sem a forma expandida. Ela é comum o bastante para a COGA não pedir explicação, mas a WCAG 3.1.4 (nível AAA) pede um meio de achar a forma expandida{example}. O nível AAA está além do alvo A/AA desta execução.',
    abbrBeyondExample: ', como <abbr title="{expansion}">',
    beyondAbbrLine: '3.1.4 Abreviaturas: {count} sigla sem a forma expandida nesta página: {list}|3.1.4 Abreviaturas: {count} siglas sem a forma expandida nesta página: {list}',
    timesOnce: 'uma vez',
    timesMany: '{count} vezes',
    listCurated: 'lista de expansões atestadas do Rampa, em revisão',
    metricsTitle: 'Medidas do texto (contexto, não são achados) — {scope}, {language}',
    scopeMain: 'conteúdo principal',
    scopePage: 'página inteira (sem main nem article)',
    metricsCounts: '{words} em {sentences} e {paragraphs}; tamanho das frases em palavras: mediana {median}, a mais longa {max}',
    countWords: '{count} palavra|{count} palavras',
    countSentences: '{count} frase|{count} frases',
    countParagraphs: '{count} parágrafo|{count} parágrafos',
    metricsLongest: 'Frase mais longa: "{text}"',
    metricsLists: '{count} lista escrita como texto corrido (COGA o3p05)|{count} listas escritas como texto corrido (COGA o3p05)',
    metricsEnglish: '{paragraphs} com mais de 50 palavras (COGA §4.4.5, inglês); {sentences} com mais de 25 palavras (técnica G153 da WCAG, inglês)',
    metricsFleschEn: 'Flesch Reading Ease {value}; nível Flesch–Kincaid {grade} (série escolar dos EUA, ajustado em 1975 com recrutas da Marinha americana).',
    metricsFleschPt: 'Flesch adaptado ao português (Martins et al., 1996): {value}, faixa "{band}" ({range}).',
    metricsMartinsCaveat:
      'A adaptação só foi validada como ordenação de textos didáticos por série escolar; os autores dizem que ela mede legibilidade, não compreensão ("readability and not the comprehensibility").',
    metricsCaveat: 'As fórmulas contam o tamanho das palavras e das frases; não medem se as pessoas entendem o texto.',
    metricsUnder100: 'Sem fórmula de legibilidade: menos de 100 palavras de texto em parágrafos.',
    metricsNoFormula: 'Sem fórmula de legibilidade para este idioma: só as contagens.',
    metricsHeuristic: 'As sílabas em inglês são estimadas por regra, sem dicionário de pronúncia.',
    'band_very-easy': 'muito fácil',
    band_easy: 'fácil',
    'band_fairly-difficult': 'difícil',
    'band_very-difficult': 'muito difícil',
    cogaCoverageTitle: 'Perfil cognitivo (orientação COGA do W3C; recomendação, não é conformidade com a WCAG):',
    cogaScreened: 'Verificados em parte: {count} de {total} padrões de design: {list}.',
    cogaNotRun: 'Não rodaram: {list}.',
    cogaNotChecked: 'Não verificados: {count} padrões, e o restante dos verificados em parte (--verbose lista).',
    cogaNotCheckedList: 'Não verificados: {list}.',
    cogaBeyond: 'Além do alvo A/AA: WCAG 2.2 3.1.4 Abreviaturas (AAA) verificado; 3.1.5 Nível de leitura exige revisão qualificada, com as medidas do texto anexas.',
    cogaPeople: 'O teste com pessoas deve incluir pessoas com deficiências cognitivas e de aprendizagem (COGA §5).',
    cogaOff: 'Orientação de acessibilidade cognitiva (COGA do W3C): não verificada; --profile cognitive adiciona recomendações.',
    cogaStatement:
      'Perfil cognitivo (orientação COGA do W3C, recomendação, não é WCAG): {count} de {total} padrões de design verificados em parte ({list}), o restante não verificado',
    part_o3p01: 'siglas',
    part_o4p03: 'opções pagas pré-marcadas',
    part_o4p06: 'rótulos só no placeholder',
    part_o4p08: 'atributos estáticos dos campos',
  },
} as const

export type AdvisoryMessageKey = keyof (typeof messages)['en']

/** Every template, for the test that keeps failure wording out of advisories. */
export const ADVISORY_MESSAGES: Readonly<Record<Locale, Readonly<Record<AdvisoryMessageKey, string>>>> = messages

export function am(locale: Locale, key: AdvisoryMessageKey, vars: Record<string, string | number> = {}): string {
  const template: string = messages[locale][key] ?? messages.en[key]
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

/** A message written `one|other`: the first form for a count of 1, the second for any other. */
export function amPlural(locale: Locale, key: AdvisoryMessageKey, count: number, vars: Record<string, string | number> = {}): string {
  const forms = am(locale, key, { count, ...vars }).split('|')
  return (count === 1 ? forms[0] : forms[1]) ?? forms[0] ?? ''
}

export function times(locale: Locale, count: number): string {
  return count === 1 ? am(locale, 'timesOnce') : am(locale, 'timesMany', { count })
}

/** 2nd, 3rd; 2ª, 3ª in Portuguese (ocorrência is feminine). */
export function ordinal(locale: Locale, n: number): string {
  if (locale === 'pt-BR') return `${n}ª`
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** Words that read as a failure verdict, and "error" used as a label. Advisory text must never use them. */
export const FAILURE_WORDING = /fail|violat|non-?conform|does not conform|falh|\bviol[aá]|n[ãa]o conform|reprov/i
export const ERROR_LABEL = /(?:^|[\n·|•]\s*)(?:error|erro)s?\s*[:·]/i
