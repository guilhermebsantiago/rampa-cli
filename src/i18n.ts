export type Locale = 'en' | 'pt-BR'

export const LOCALES: readonly Locale[] = ['en', 'pt-BR']

export function resolveLocale(input: string | undefined): Locale {
  if (!input) return 'en'
  const normalized = input.toLowerCase()
  if (normalized === 'pt-br' || normalized === 'pt') return 'pt-BR'
  return 'en'
}

const messages = {
  en: {
    tagline: 'accessibility checks beyond syntax',
    menuIntro: 'Commands',
    menuCheck: 'check a page, an HTML file or a snapshot',
    menuEval: 'measure against the W3C ACT test cases',
    menuModels: 'recommended models per criterion',
    menuDoctor: 'check your setup',
    menuHelp: 'Run rampa <command> --help for options.',
    coverageTitle: 'Coverage of this run',
    coverageEngine: 'Checked by {engine} (partial):',
    coverageJudged: 'Judged with verified evidence:',
    coverageNotChecked: 'Not checked automatically:',
    coverageNotCheckedCount: '{count} of {total} WCAG 2.1 A/AA criteria (--verbose lists them)',
    disclaimer: 'This report does not declare the page accessible.',
    manualReview: 'What was not checked needs manual review and testing with people.',
    noFindings: 'No confirmed failures in what was checked.',
    evidence: 'Evidence',
    patch: 'Patch',
    confidence: 'confidence',
    runs: 'runs',
    verified: 'evidence verified',
    engineRule: 'rule',
    discardedTitle: 'Discarded by verification',
    discarded: '{count} claim(s) from the model did not hold against the snapshot and were dropped.',
    belowThreshold: '{count} finding(s) below the confidence threshold (--verbose shows them).',
    cannotTell: '{count} candidate(s) where the model abstained (cannot tell).',
    judgmentSkipped: 'Judgment skipped (--no-llm): {count} candidate(s) for {criteria} were not judged.',
    judgmentErrors: 'The model failed on {count} candidate(s): {error}',
    noModel: 'No model configured, so only the deterministic layer ran. Pass --model (for example ollama:gemma4:12b or anthropic:claude-haiku-5-5) or set an API key; see rampa models.',
    offlineMisses: '{count} candidate(s) had no cached judgment (--offline).',
    usage: 'Model calls: {calls} new, {cached} from cache · {input}k in / {output}k out tokens',
    usageLocal: 'local model, no API cost',
    modelSaid: 'the model said',
    detected: 'detected',
    surface: 'Surface',
    model: 'Model',
    high: 'high',
    medium: 'medium',
    low: 'low',
    disclaimerScreen: 'This report does not declare the screen accessible.',
    disclaimerImage: 'This report does not declare the image accessible.',
    locatedBy: 'Located by {model} in the image: not read from an accessibility tree',
    noteNoScreenshot: 'No screenshot was taken, so images were not judged (1.1.1) and text contrast was not measured.',
    noteNoLocale: 'The device did not report its language, so the language of the screen (3.1.1) was not checked.',
    noteUiAutomator: 'Read from UI Automator, which does not expose headings, labelFor or the language of text: checks that need them did not run.',
    noteAppiumSource: 'Read from an Appium page source, which marks headings but not labelFor or the language of text.',
    noteXcuitest: 'Read from an XCUITest export, which does not expose labels tied to fields or the language of text.',
    noteXcuitestNoTraits: 'The export has no accessibility traits, so headings were not found (2.4.6).',
    noteIosLanguage:
      'The export does not say which language the app ran in, so the language of the screen (3.1.1) was not checked. Pass language: to RampaExport, or launch the app with -AppleLanguages.',
    noteImageScope:
      'An image has no accessibility tree: names, roles, states, focus order, language and structure cannot be checked from pixels. Only text contrast is measured, where a model found text.',
    noteImageNoModel: 'No model to find text in the image, so nothing was measured. Pass --model with a vision model.',
    noteImageBlocks: '{model} located {kept} text block(s) in the image; {dropped} more did not hold up against the pixels and were dropped.',
    noteImageOffline: 'No cached text locations for this image (--offline), so nothing was measured.',
    noteImageError: 'The model could not locate text in the image, so nothing was measured: {error}',
  },
  'pt-BR': {
    tagline: 'verificação de acessibilidade além da sintaxe',
    menuIntro: 'Comandos',
    menuCheck: 'verifica uma página, um arquivo HTML ou um snapshot',
    menuEval: 'mede contra os casos de teste ACT do W3C',
    menuModels: 'modelos recomendados por critério',
    menuDoctor: 'confere seu ambiente',
    menuHelp: 'Rode rampa <comando> --help para ver as opções.',
    coverageTitle: 'Cobertura desta execução',
    coverageEngine: 'Verificado pelo {engine} (parcial):',
    coverageJudged: 'Julgado com evidência verificada:',
    coverageNotChecked: 'Não verificado automaticamente:',
    coverageNotCheckedCount: '{count} de {total} critérios WCAG 2.1 A/AA (--verbose lista)',
    disclaimer: 'Este relatório não declara a página acessível.',
    manualReview: 'O que não foi verificado exige revisão manual e teste com pessoas.',
    noFindings: 'Nenhuma falha confirmada no que foi verificado.',
    evidence: 'Evidência',
    patch: 'Patch',
    confidence: 'confiança',
    runs: 'rodadas',
    verified: 'evidência verificada',
    engineRule: 'regra',
    discardedTitle: 'Descartado pela verificação',
    discarded: '{count} alegação(ões) do modelo não se sustentou(aram) no snapshot e foi(ram) descartada(s).',
    belowThreshold: '{count} achado(s) abaixo do limiar de confiança (--verbose mostra).',
    cannotTell: '{count} candidato(s) em que o modelo se absteve (cannot tell).',
    judgmentSkipped: 'Julgamento desligado (--no-llm): {count} candidato(s) de {criteria} não foram julgados.',
    judgmentErrors: 'O modelo falhou em {count} candidato(s): {error}',
    noModel: 'Nenhum modelo configurado, então só a camada determinística rodou. Use --model (por exemplo ollama:gemma4:12b ou anthropic:claude-haiku-5-5) ou defina uma chave de API; veja rampa models.',
    offlineMisses: '{count} candidato(s) sem julgamento em cache (--offline).',
    usage: 'Chamadas ao modelo: {calls} novas, {cached} do cache · {input} mil tokens de entrada / {output} mil de saída',
    usageLocal: 'modelo local, sem custo de API',
    modelSaid: 'o modelo disse',
    detected: 'detectou',
    surface: 'Superfície',
    model: 'Modelo',
    high: 'alta',
    medium: 'média',
    low: 'baixa',
    disclaimerScreen: 'Este relatório não declara a tela acessível.',
    disclaimerImage: 'Este relatório não declara a imagem acessível.',
    locatedBy: 'Localizado por {model} na imagem: não lido de uma árvore de acessibilidade',
    noteNoScreenshot: 'Sem captura de tela: as imagens não foram julgadas (1.1.1) e o contraste do texto não foi medido.',
    noteNoLocale: 'O aparelho não informou o idioma, então o idioma da tela (3.1.1) não foi verificado.',
    noteUiAutomator: 'Lido do UI Automator, que não expõe títulos, labelFor nem o idioma do texto: as verificações que dependem deles não rodaram.',
    noteAppiumSource: 'Lido do page source do Appium, que marca títulos, mas não labelFor nem o idioma do texto.',
    noteXcuitest: 'Lido de uma exportação do XCUITest, que não expõe rótulos ligados a campos nem o idioma do texto.',
    noteXcuitestNoTraits: 'A exportação não tem os traits de acessibilidade, então os títulos não foram encontrados (2.4.6).',
    noteIosLanguage:
      'A exportação não diz em que idioma o app rodou, então o idioma da tela (3.1.1) não foi verificado. Passe language: ao RampaExport ou abra o app com -AppleLanguages.',
    noteImageScope:
      'Uma imagem não tem árvore de acessibilidade: nomes, papéis, estados, ordem de foco, idioma e estrutura não podem ser verificados em pixels. Só o contraste do texto é medido, onde um modelo encontrou texto.',
    noteImageNoModel: 'Sem modelo para encontrar texto na imagem, nada foi medido. Use --model com um modelo de visão.',
    noteImageBlocks: '{model} localizou {kept} bloco(s) de texto na imagem; outros {dropped} não se sustentaram nos pixels e foram descartados.',
    noteImageOffline: 'Sem localizações de texto em cache para esta imagem (--offline), então nada foi medido.',
    noteImageError: 'O modelo não conseguiu localizar texto na imagem, então nada foi medido: {error}',
  },
} as const

export type MessageKey = keyof (typeof messages)['en']

export function t(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template: string = messages[locale][key] ?? messages.en[key]
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

export function languageName(tag: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}
