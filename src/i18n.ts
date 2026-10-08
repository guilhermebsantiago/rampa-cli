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
    surface: 'Surface',
    model: 'Model',
    high: 'high',
    medium: 'medium',
    low: 'low',
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
    surface: 'Superfície',
    model: 'Modelo',
    high: 'alta',
    medium: 'média',
    low: 'baixa',
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
