import type { Confidence, Finding, ProbeCoverage } from '../core/types.ts'
import type { Locale } from '../i18n.ts'
import type { AuthData, AuthField, AuthStep, Captcha, PasteTrial } from '../probes/auth.ts'
import { matchNode } from '../probes/identity.ts'
import type { A11yNode, ProbeRecord } from '../snapshot/schema.ts'
import type { TreeIndex } from '../snapshot/tree.ts'
import { type ProbeRule, type ProbeRuleContext, type ProbeRuleResult, asArray, asRecord, conditionsText, coverageStatus, say } from './probes.ts'
import { probeFinding } from './probes.ts'

/**
 * 3.3.8 Accessible Authentication (Minimum), over the authentication probe (src/probes/auth.ts). In sign-in and
 * recovery steps (sign-up and change of password are out of scope, as the Understanding leaves account creation out):
 *
 * - a password or code field that a trusted paste does not reach while a typed key does (F109, H100): failure, high;
 * - a code asked one character per box, where pasting the whole code fills only some boxes (the Understanding's own
 *   example of a failure): failure, high;
 * - a read-only password field filled only through an on-screen keypad: failure, high;
 * - text that asks for some characters of a secret (F109), a calculation, or the transcription of an image
 *   CAPTCHA: failure, medium. These are cognitive function tests by the text that asks them, and the 3.3.8 judgment
 *   (src/criteria/accessible-authentication.ts) may only clear them, quoting the page;
 * - when the page offers another way to sign in near the step (a passkey, "Sign in with…", "Email me a link"), each
 *   of those goes to review instead: the Alternative exception may apply, and Rampa does not follow it;
 * - attributes that may keep password managers away (autocomplete="off" or "new-password" on a sign-in field, the
 *   ignore attributes of LastPass, 1Password and Bitwarden, a text field drawn as dots), and CAPTCHAs whose challenge
 *   cannot be classified: review.
 *
 * Object-recognition CAPTCHAs (reCAPTCHA's and hCaptcha's image challenges) are excepted at AA, and CAPTCHAs that ask
 * nothing (reCAPTCHA v3, Turnstile) are no test: both are counted in the coverage note.
 */

export const AUTH_RULE = 'rampa/accessible-authentication'
const MAX_REPORTED = 10

type Cognitive = 'partial-characters' | 'calculation' | 'transcription'

/** Narrowed from a record read back from a file. */
export function authData(record: ProbeRecord): AuthData {
  const data = asRecord(record.data)
  return {
    viewport: { width: Number(asRecord(data.viewport).width) || 0, height: Number(asRecord(data.viewport).height) || 0 },
    steps: asArray<AuthStep>(data.steps)
      .filter((s) => s && typeof s.el?.ref === 'string')
      .map((s) => ({ ...s, fields: asArray<AuthField>(s.fields).filter((f) => f && typeof f.el?.ref === 'string'), texts: asArray<string>(s.texts).filter((t) => typeof t === 'string') })),
    hidden: asArray<AuthData['hidden'][number]>(data.hidden),
    captchas: asArray<Captcha>(data.captchas).filter((c) => c && typeof c.el?.ref === 'string'),
    alternatives: asArray<AuthData['alternatives'][number]>(data.alternatives).filter((a) => a && typeof a.text === 'string'),
    links: asArray<AuthData['links'][number]>(data.links),
    ...(typeof data.wall === 'string' ? { wall: data.wall } : {}),
    ...(typeof data.landed === 'string' ? { landed: data.landed } : {}),
    clipboard: data.clipboard === 'unavailable' ? 'unavailable' : 'ok',
    end: data.end === 'time' ? 'time' : data.end === 'no-steps' ? 'no-steps' : 'complete',
  }
}

/** The auth probe's record, when it is one these rules read. */
export function authRecord(probes: readonly ProbeRecord[] | undefined): ProbeRecord | undefined {
  return probes?.find((p) => p.kind === 'auth' && p.version === '1' && p.status !== 'skipped')
}

const inScope = (step: AuthStep) => step.kind === 'login' || step.kind === 'recovery'

export interface CognitiveTest {
  step: AuthStep
  stepIndex: number
  node: A11yNode
  /** The tests the step's text asks, each quoted. */
  tests: Array<{ kind: Cognitive; quote: string }>
  /** Other ways to sign in near the step. */
  alternatives: string[]
}

/** Steps that ask a cognitive function test by their text: what the rule fails and the 3.3.8 judgment may clear. */
export function cognitiveTests(data: AuthData, index: TreeIndex): CognitiveTest[] {
  const out: CognitiveTest[] = []
  data.steps.forEach((step, stepIndex) => {
    if (!inScope(step)) return
    const tests: CognitiveTest['tests'] = []
    if (step.partial) tests.push({ kind: 'partial-characters', quote: step.partial })
    if (step.arithmetic) tests.push({ kind: 'calculation', quote: step.arithmetic })
    if (step.transcription) tests.push({ kind: 'transcription', quote: step.transcription.quote })
    if (tests.length === 0) return
    const node = matchNode(index, step.el.ref, step.el.id)
    if (!node) return
    out.push({ step, stepIndex, node, tests, alternatives: data.alternatives.filter((a) => a.step === stepIndex).map((a) => a.text) })
  })
  return out
}

const TEXT: Record<
  Locale,
  {
    blocked: string
    split: string
    keypad: string
    paired: string
    noInput: string
    readonly: string
    partial: string
    calculation: string
    transcription: string
    alternative: string
    manager: string
    captcha: string
    field: Record<AuthField['kind'], string>
    secret: Record<AuthField['kind'], string>
  }
> = {
  en: {
    blocked:
      'Pasting into this {field} does not work: a trusted paste (Ctrl+V) of a value from the clipboard did not reach it, twice, while a typed key did. People who use a password manager or copy the {secret} must transcribe it to sign in (WCAG 3.3.8; F109; H100). Let the field take pasted text.',
    split:
      'This code is asked one character per box, and pasting the whole code fills {filled} of the {total} boxes. People who copy the code must transcribe it one character at a time (WCAG 3.3.8; F109). Let a paste into the first box fill them all, or use a single field.',
    keypad:
      'This password field is read-only and filled only through an on-screen keypad{paired}: neither a password manager nor a paste can fill it, and people must transcribe the password key by key (WCAG 3.3.8). Let people type and paste the password, or offer another way to sign in.',
    paired: ' whose keys each stand for two digits',
    noInput: 'Neither a paste nor a typed key reached this {field}. Check how people are meant to enter the {secret}: if only by transcribing it, the step fails 3.3.8.',
    readonly: 'This {field} is read-only, and Rampa found no keypad that fills it. Check how people are meant to enter the {secret}.',
    partial:
      'This step asks for some characters of a secret: "{quote}". Neither a password manager nor a paste can fill that in, so people must remember the secret and count its characters (WCAG 3.3.8; F109). Ask for the whole password or code, in the format it was given.',
    calculation: 'This step asks a calculation to sign in: "{quote}". That is a cognitive function test (WCAG 3.3.8). Use a check that asks nothing of the person, or offer another way to sign in.',
    transcription:
      'This step asks people to transcribe characters from an image ("{quote}"): a cognitive function test, and an audio version asks the same (WCAG 3.3.8). Use a check that asks nothing of the person or only to recognize objects, or offer another way to sign in.',
    alternative: ' The page offers another way to sign in ({alternatives}): if it asks no cognitive function test, the step meets 3.3.8 by its Alternative exception. Rampa does not follow it; check it.',
    manager: '{attributes} may keep password managers from filling this {field}; H100 asks that they not be blocked. {detail}',
    captcha: 'A {vendor} challenge guards this step ({why}). Rampa never solves CAPTCHAs: check whether it asks a puzzle or another cognitive function test, and whether another way exists (WCAG 3.3.8).',
    field: { password: 'password field', code: 'code field', identifier: 'field' },
    secret: { password: 'password', code: 'code', identifier: 'value' },
  },
  'pt-BR': {
    blocked:
      'Colar neste {field} não funciona: uma colagem confiável (Ctrl+V) de um valor da área de transferência não chegou a ele, duas vezes, enquanto uma tecla digitada chegou. Quem usa um gerenciador de senhas ou copia a {secret} precisa transcrevê-la para entrar (WCAG 3.3.8; F109; H100). Deixe o campo aceitar texto colado.',
    split:
      'Este código é pedido um caractere por caixa, e colar o código inteiro preenche {filled} das {total} caixas. Quem copia o código precisa transcrevê-lo um caractere por vez (WCAG 3.3.8; F109). Faça a colagem na primeira caixa preencher todas, ou use um só campo.',
    keypad:
      'Este campo de senha é somente leitura e só se preenche por um teclado virtual{paired}: nem um gerenciador de senhas nem uma colagem conseguem preenchê-lo, e a pessoa precisa transcrever a senha tecla por tecla (WCAG 3.3.8). Deixe digitar e colar a senha, ou ofereça outra forma de entrar.',
    paired: ' cujas teclas valem dois dígitos cada',
    noInput: 'Nem uma colagem nem uma tecla digitada chegaram a este {field}. Confira como a pessoa deve informar a {secret}: se só transcrevendo, a etapa falha no 3.3.8.',
    readonly: 'Este {field} é somente leitura, e o Rampa não achou um teclado que o preencha. Confira como a pessoa deve informar a {secret}.',
    partial:
      'Esta etapa pede alguns caracteres de um segredo: "{quote}". Nem um gerenciador de senhas nem uma colagem preenchem isso, então a pessoa precisa lembrar o segredo e contar seus caracteres (WCAG 3.3.8; F109). Peça a senha ou o código inteiro, no formato em que foi dado.',
    calculation: 'Esta etapa pede um cálculo para entrar: "{quote}". Isso é um teste de função cognitiva (WCAG 3.3.8). Use uma verificação que não peça nada à pessoa, ou ofereça outra forma de entrar.',
    transcription:
      'Esta etapa pede para transcrever caracteres de uma imagem ("{quote}"): um teste de função cognitiva, e uma versão em áudio pede o mesmo (WCAG 3.3.8). Use uma verificação que não peça nada à pessoa ou só peça para reconhecer objetos, ou ofereça outra forma de entrar.',
    alternative: ' A página oferece outra forma de entrar ({alternatives}): se ela não pede teste de função cognitiva, a etapa atende ao 3.3.8 pela exceção Alternativa. O Rampa não a segue; confira.',
    manager: '{attributes} pode impedir gerenciadores de senhas de preencher este {field}; a H100 pede que eles não sejam bloqueados. {detail}',
    captcha: 'Um desafio {vendor} protege esta etapa ({why}). O Rampa nunca resolve CAPTCHAs: confira se ele pede um quebra-cabeça ou outro teste de função cognitiva, e se há outra forma (WCAG 3.3.8).',
    field: { password: 'campo de senha', code: 'campo de código', identifier: 'campo' },
    secret: { password: 'senha', code: 'código', identifier: 'informação' },
  },
}

const quoteOf = (text: string) => (text.length > 120 ? `${text.slice(0, 119)}…` : text)

function pasteEvidence(field: AuthField, paste: PasteTrial, locale: Locale): string {
  const events = asArray<PasteTrial['events'][number]>(paste.events)
  const seen = events.length === 0 ? say(locale, 'no paste event reached the page', 'nenhum evento de colagem chegou à página') : events.map((e) => `${e.type}${e.trusted ? say(locale, ' (trusted)', ' (confiável)') : ''}${e.prevented ? say(locale, ' cancelled by the page', ' cancelado pela página') : ''}`).join(', ')
  const reads = asArray<string>(paste.reads).map((r) => `"${r}"`).join(say(locale, ', then ', ', depois '))
  const listeners = Array.isArray(field.listeners) && field.listeners.length > 0 ? say(locale, `; the field listens to ${field.listeners.join(', ')}`, `; o campo escuta ${field.listeners.join(', ')}`) : ''
  const typed = paste.typed ? say(locale, `; the key "${paste.typed.key}" typed ${paste.typed.arrived ? 'arrived' : 'did not arrive'}`, `; a tecla "${paste.typed.key}" digitada ${paste.typed.arrived ? 'chegou' : 'não chegou'}`) : ''
  return say(
    locale,
    `${field.el.tag === 'input' ? `<input type=${field.type}>` : `<${field.el.tag}>`} "${field.label}": pasted "${paste.value}" with Ctrl+V${paste.clipboard ? '' : ' (the clipboard could not be read back)'}; ${seen}; the field held ${reads || '""'}${typed}${listeners}`,
    `${field.el.tag === 'input' ? `<input type=${field.type}>` : `<${field.el.tag}>`} "${field.label}": colado "${paste.value}" com Ctrl+V${paste.clipboard ? '' : ' (a área de transferência não pôde ser relida)'}; ${seen}; o campo ficou com ${reads || '""'}${typed}${listeners}`,
  )
}

function managerHints(field: AuthField, step: AuthStep, locale: Locale): { attributes: string; detail: string } | undefined {
  const parts: Array<[string, string]> = []
  const autocomplete = field.autocomplete.trim().toLowerCase()
  if (field.kind === 'identifier') {
    // H100: the identifier of a sign-in too should be one a password manager can fill.
    if (step.kind !== 'login' || !/^(off|new-password)$/.test(autocomplete)) return undefined
    parts.push([`autocomplete="${autocomplete}"`, say(locale, 'On the identifier of a sign-in it asks browsers and password managers not to fill the saved one; use username, or email.', 'No identificador de uma entrada, pede a navegadores e gerenciadores de senhas que não preencham o salvo; use username, ou email.')])
    return { attributes: parts.map(([a]) => a).join(', '), detail: parts.map(([, d]) => d).join(' ') }
  }
  if (field.kind === 'password' && autocomplete === 'off') parts.push(['autocomplete="off"', say(locale, 'Most browsers ignore it on password fields, but some password managers obey it.', 'A maioria dos navegadores o ignora em campos de senha, mas alguns gerenciadores de senhas obedecem.')])
  if (field.kind === 'password' && step.kind === 'login' && /new-password/.test(autocomplete)) parts.push(['autocomplete="new-password"', say(locale, 'On a sign-in field it makes browsers offer a new password instead of filling the saved one: use current-password.', 'Num campo de entrada, faz os navegadores oferecerem uma senha nova em vez de preencher a salva: use current-password.')])
  for (const attribute of asArray<string>(field.ignore)) parts.push([attribute, say(locale, 'It tells a password manager extension to skip the field.', 'Ele diz a uma extensão de gerenciador de senhas para pular o campo.')])
  if (field.masked) parts.push(['-webkit-text-security', say(locale, 'A text field drawn as dots: password managers look for type="password".', 'Um campo de texto desenhado como pontos: gerenciadores de senhas procuram type="password".')])
  if (parts.length === 0) return undefined
  return { attributes: parts.map(([a]) => a).join(', '), detail: parts.map(([, d]) => d).join(' ') }
}

export const authRule: ProbeRule = {
  id: AUTH_RULE,
  kind: 'auth',
  variant: 'paste',
  versions: ['1'],
  criteria: ['3.3.8'],
  run(record: ProbeRecord, ctx: ProbeRuleContext): ProbeRuleResult {
    const data = authData(record)
    const text = TEXT[ctx.locale]
    const findings: Finding[] = []
    const review: Finding[] = []
    const counts: Record<string, number> = {}
    const bump = (key: string) => {
      counts[key] = (counts[key] ?? 0) + 1
    }
    let applicable = 0
    let unmatched = 0
    let failures = 0
    const fill = (template: string, values: Record<string, string>) => Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, value), template)
    const report = (node: A11yNode, message: string, evidence: string, confidence: Confidence, subject: string, alternatives: string[]) => {
      if (alternatives.length > 0) {
        review.push(probeFinding({ criterion: '3.3.8', rule: AUTH_RULE, node, message: `${message}${fill(text.alternative, { alternatives: alternatives.slice(0, 3).map((a) => `"${a}"`).join(', ') })}`, evidence, confidence: 'medium', subject }))
        return
      }
      failures++
      if (findings.length >= MAX_REPORTED) return
      findings.push(probeFinding({ criterion: '3.3.8', rule: AUTH_RULE, node, message, evidence, confidence, subject }))
    }

    data.steps.forEach((step, stepIndex) => {
      if (!inScope(step)) {
        bump(step.kind)
        return
      }
      const alternatives = data.alternatives.filter((a) => a.step === stepIndex).map((a) => a.text)
      const stepNode = matchNode(ctx.index, step.el.ref, step.el.id)
      if (!stepNode) {
        unmatched++
        return
      }
      applicable++
      const secretFields = step.fields.filter((f) => f.kind === 'password' || f.kind === 'code')
      if (secretFields.length === 0 && !step.partial && !step.arithmetic && !step.transcription) bump('identifier-first')
      for (const field of step.fields.filter((f) => f.kind === 'identifier')) {
        const hints = managerHints(field, step, ctx.locale)
        const node = hints ? matchNode(ctx.index, field.el.ref, field.el.id) : undefined
        if (hints && node && review.length < MAX_REPORTED * 2) {
          review.push(probeFinding({ criterion: '3.3.8', rule: AUTH_RULE, node, message: fill(text.manager, { ...hints, field: text.field.identifier }), evidence: `${field.label ? `"${field.label}": ` : ''}${hints.attributes}`, confidence: 'low', subject: `manager|${hints.attributes}` }))
        }
      }
      for (const field of secretFields) {
        const node = matchNode(ctx.index, field.el.ref, field.el.id)
        if (!node) {
          unmatched++
          continue
        }
        const words = { field: text.field[field.kind], secret: text.secret[field.kind] }
        const hints = managerHints(field, step, ctx.locale)
        if (hints && review.length < MAX_REPORTED * 2) {
          review.push(probeFinding({ criterion: '3.3.8', rule: AUTH_RULE, node, message: fill(text.manager, { ...hints, field: words.field }), evidence: `${field.label ? `"${field.label}": ` : ''}${hints.attributes}`, confidence: 'low', subject: `manager|${hints.attributes}` }))
        }
        const paste = field.paste
        if (paste?.arrived) {
          bump('pasted')
          continue
        }
        if (paste && paste.typed?.arrived) {
          const group = asArray(field.group)
          if (group.length > 0) {
            const filled = Math.min(group.length, Math.max(0, ...asArray<string>(paste.reads).map((r) => r.replace(/\s/g, '').length)))
            report(node, fill(text.split, { filled: String(filled), total: String(group.length) }), pasteEvidence(field, paste, ctx.locale), 'high', 'split-code', alternatives)
          } else report(node, fill(text.blocked, words), pasteEvidence(field, paste, ctx.locale), 'high', 'paste-blocked', alternatives)
          continue
        }
        const keypad = field.keypad
        const keypadEvidence = keypad
          ? say(ctx.locale, `read-only; ${keypad.buttons} key(s) such as ${asArray<string>(keypad.samples).map((s) => `"${s}"`).join(', ')}`, `somente leitura; ${keypad.buttons} tecla(s) como ${asArray<string>(keypad.samples).map((s) => `"${s}"`).join(', ')}`)
          : ''
        if ((paste && paste.typed && !paste.typed.arrived) || (!paste && field.readonly)) {
          if (keypad && field.kind === 'password') {
            report(node, fill(text.keypad, { paired: keypad.paired ? text.paired : '' }), `"${field.label}": ${keypadEvidence}`, 'high', 'keypad', alternatives)
          } else if (review.length < MAX_REPORTED * 2) {
            review.push(probeFinding({ criterion: '3.3.8', rule: AUTH_RULE, node, message: fill(paste ? text.noInput : text.readonly, words), evidence: paste ? pasteEvidence(field, paste, ctx.locale) : `"${field.label}": ${say(ctx.locale, 'read-only after it took focus', 'somente leitura depois de receber o foco')}`, confidence: 'medium', subject: paste ? 'no-input' : 'readonly' }))
          }
          continue
        }
        bump('not-tried')
      }
      const tests: Array<[Cognitive, string | undefined, string]> = [
        ['partial-characters', step.partial, text.partial],
        ['calculation', step.arithmetic, text.calculation],
        ['transcription', step.transcription?.quote, text.transcription],
      ]
      for (const [kind, quote, template] of tests) {
        if (!quote) continue
        const evidence = say(ctx.locale, `${step.kind === 'recovery' ? 'recovery' : 'sign-in'} step (${step.why}); quoted from the page: "${quoteOf(quote)}"`, `etapa de ${step.kind === 'recovery' ? 'recuperação' : 'entrada'} (${step.why}); citado da página: "${quoteOf(quote)}"`)
        report(stepNode, fill(template, { quote: quoteOf(quote) }), evidence, 'medium', `cognitive|${kind}`, alternatives)
      }
    })

    for (const captcha of data.captchas) {
      const step = data.steps[captcha.step]
      if (captcha.step >= 0 && step && !inScope(step)) continue
      if (captcha.kind === 'object-recognition') bump('captcha-objects')
      else if (captcha.kind === 'no-test') bump('captcha-none')
      else if (captcha.kind === 'unknown') {
        const node = matchNode(ctx.index, captcha.el.ref, captcha.el.id)
        if (!node) {
          unmatched++
          continue
        }
        review.push(probeFinding({ criterion: '3.3.8', rule: AUTH_RULE, node, message: fill(text.captcha, { vendor: captcha.vendor, why: captcha.why }), evidence: `${captcha.vendor}: ${captcha.why}`, confidence: 'low', subject: `captcha|${captcha.vendor}` }))
      }
    }

    const c = counts
    const vendors = [...new Set(data.captchas.filter((cap) => cap.kind === 'object-recognition').map((cap) => cap.vendor))].join(', ')
    const notes = [
      say(ctx.locale, `${applicable} sign-in or recovery step(s)`, `${applicable} etapa(s) de entrada ou recuperação`),
      data.landed ? say(ctx.locale, `read where the page landed after its own redirects: ${data.landed.slice(0, 80)}`, `lida onde a página chegou depois dos próprios redirecionamentos: ${data.landed.slice(0, 80)}`) : '',
      c.pasted ? say(ctx.locale, `${c.pasted} field(s) took a trusted paste`, `${c.pasted} campo(s) aceitaram uma colagem confiável`) : '',
      c['identifier-first'] ? say(ctx.locale, `${c['identifier-first']} ask(s) only for an identifier (an e-mail, a CPF, a username); the next step needs a submit, which Rampa never does`, `${c['identifier-first']} pede(m) só um identificador (e-mail, CPF, usuário); a etapa seguinte exige envio, o que o Rampa nunca faz`) : '',
      c['sign-up'] ? say(ctx.locale, `${c['sign-up']} sign-up form(s) left out (account creation is out of scope)`, `${c['sign-up']} formulário(s) de cadastro deixado(s) de fora (criação de conta está fora do escopo)`) : '',
      c['change-password'] ? say(ctx.locale, `${c['change-password']} change-password form(s) left out`, `${c['change-password']} formulário(s) de troca de senha deixado(s) de fora`) : '',
      c['captcha-objects'] ? say(ctx.locale, `${c['captcha-objects']} CAPTCHA(s) that ask to recognize objects (${vendors}), excepted at AA`, `${c['captcha-objects']} CAPTCHA(s) que pedem para reconhecer objetos (${vendors}), exceção no nível AA`) : '',
      c['captcha-none'] ? say(ctx.locale, `${c['captcha-none']} CAPTCHA(s) that ask nothing`, `${c['captcha-none']} CAPTCHA(s) que não pedem nada`) : '',
      data.alternatives.length > 0
        ? say(ctx.locale, `other ways to sign in, not followed: ${data.alternatives.slice(0, 4).map((a) => `"${a.text}"`).join(', ')}`, `outras formas de entrar, não seguidas: ${data.alternatives.slice(0, 4).map((a) => `"${a.text}"`).join(', ')}`)
        : '',
      c['not-tried'] ? say(ctx.locale, `${c['not-tried']} field(s) not pasted into`, `${c['not-tried']} campo(s) sem colagem`) : '',
      data.hidden.length > 0 ? say(ctx.locale, `${data.hidden.length} sign-in form(s) not showing (a closed menu or dialog), not opened`, `${data.hidden.length} formulário(s) de entrada não visível(is) (menu ou diálogo fechado), não aberto(s)`) : '',
      data.clipboard === 'unavailable' ? say(ctx.locale, 'the clipboard was not available, so nothing was pasted', 'a área de transferência não estava disponível, então nada foi colado') : '',
      failures > findings.length ? say(ctx.locale, `${failures - findings.length} more failure(s) not listed`, `mais ${failures - findings.length} falha(s) não listada(s)`) : '',
      applicable === 0 && data.links.length > 0
        ? say(ctx.locale, `links to sign-in or recovery pages, not followed: ${data.links.slice(0, 3).map((l) => `"${l.text}"`).join(', ')}`, `links para páginas de entrada ou recuperação, não seguidos: ${data.links.slice(0, 3).map((l) => `"${l.text}"`).join(', ')}`)
        : '',
      data.end === 'time' ? say(ctx.locale, 'time budget reached', 'limite de tempo atingido') : '',
    ].filter(Boolean)
    // A page that showed a bot check, or went somewhere else right after it loaded (an SSO redirect the guard answered),
    // was not the sign-in page: nothing on it says the criterion has nothing to apply to.
    const away = asArray<{ url: string; cause?: string }>(record.guard?.navigations).find((n) => n && !n.cause && typeof n.url === 'string')
    if (applicable === 0 && data.wall) notes.unshift(say(ctx.locale, `the page showed a bot check (${data.wall}) instead of its content; Rampa never solves it`, `a página mostrou uma verificação anti-robô (${data.wall}) no lugar do conteúdo; o Rampa nunca a resolve`))
    if (applicable === 0 && away) notes.unshift(say(ctx.locale, `the page tried to go to ${away.url.slice(0, 80)} after it loaded, which the guard answered; if that is the sign-in form, run again with --wait-for and a selector of the form`, `a página tentou ir para ${away.url.slice(0, 80)} depois de carregar, o que o guarda respondeu; se ali está o formulário de entrada, rode de novo com --wait-for e um seletor do formulário`))
    // Steps the probe read that are not in the snapshot: the collector read the page before it landed (a redirect, a
    // challenge), or the page changed between loads. Nothing about them can be reported.
    if (applicable === 0 && unmatched > 0) notes.unshift(say(ctx.locale, `${unmatched} element(s) the probe read are not in the snapshot: the page may have redirected after it was collected; run again with --wait-for and a selector of the sign-in form`, `${unmatched} elemento(s) lido(s) pela sonda não estão no snapshot: a página pode ter redirecionado depois da coleta; rode de novo com --wait-for e um seletor do formulário de entrada`))
    const status: ProbeCoverage['status'] = applicable === 0 && (data.hidden.length > 0 || data.clipboard === 'unavailable' || !!data.wall || !!away || unmatched > 0) ? 'not-checked' : coverageStatus(findings.length, review.length)
    const coverage: ProbeCoverage = {
      criterion: '3.3.8',
      method: `probe/auth@${record.version}`,
      rule: AUTH_RULE,
      conditions: conditionsText(record, say(ctx.locale, `trusted paste into password and code fields at ${data.viewport.width}×${data.viewport.height}`, `colagem confiável em campos de senha e código em ${data.viewport.width}×${data.viewport.height}`)),
      status,
      applicable,
      failures: findings.length,
      review: review.length,
      unmatched,
      note: notes.join('; '),
      maturity: 'experimental',
    }
    return { findings, review, coverage: [coverage] }
  },
}
