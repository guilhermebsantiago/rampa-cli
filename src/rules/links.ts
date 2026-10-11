import type { ProbeCoverage } from '../core/types.ts'
import { LINKS_VERSION, type ScriptedLink, linksData } from '../probes/links.ts'
import { matchNode } from '../probes/identity.ts'
import type { ProbeRecord } from '../snapshot/schema.ts'
import { type ProbeRule, type ProbeRuleContext, asArray, asRecord, conditionsText, say } from './probes.ts'

export const SCRIPTED_LINKS_RULE = 'rampa/scripted-links'

const KIND_TEXT: Record<string, [string, string]> = {
  navigation: ['go to another address (intercepted)', 'vão para outro endereço (interceptado)'],
  'new-window': ['open a window', 'abrem uma janela'],
  route: ['change the address in place', 'mudam o endereço sem carregar a página'],
  fragment: ['move within the page', 'levam a outra parte da página'],
  download: ['start a download (intercepted)', 'iniciam um download (interceptado)'],
  submit: ['submit a form (cancelled)', 'enviam um formulário (cancelado)'],
  dialog: ['show a browser dialog (dismissed)', 'mostram um diálogo do navegador (dispensado)'],
  opened: ['open a dialog or layer (not exercised)', 'abrem um diálogo ou camada (não exercitado)'],
  content: ['change the page in place', 'mudam a página no lugar'],
  nothing: ['change nothing seen', 'não mudam nada visível'],
}

const SKIP_TEXT: Record<string, [string, string]> = {
  destructive: ['a destructive or account-changing name', 'um nome destrutivo ou que muda a conta'],
  submit: ['it submits', 'envia'],
  'sensitive-form': ['in a form with password, payment or file fields', 'em formulário com senha, pagamento ou arquivo'],
  download: ['a download', 'um download'],
  'new-window': ['opens a new window', 'abre nova janela'],
  'other-origin': ['another origin', 'outra origem'],
  disabled: ['disabled', 'desabilitado'],
  secret: ['a password or file field', 'campo de senha ou arquivo'],
}

/**
 * 2.4.4, the links probe's coverage line. It decides nothing (an inventory): it says how many scripted links were
 * clicked, where they went (the addresses are read and given to the 2.4.4 judgment), which ones the skip list kept
 * out, and which were not exercised (under another layer, past the budget).
 */
export const scriptedLinksRule: ProbeRule = {
  id: SCRIPTED_LINKS_RULE,
  kind: 'links',
  variant: 'scripted-links',
  versions: [LINKS_VERSION],
  criteria: ['2.4.4'],
  run(record: ProbeRecord, ctx: ProbeRuleContext) {
    const data = linksData(record)
    const links = asArray<ScriptedLink>(data.links)
    const counts = new Map<string, number>()
    let unmatched = 0
    for (const link of links) {
      const kind = link.outcome?.kind
      if (!kind || link.skip) continue
      if (kind in KIND_TEXT) counts.set(kind, (counts.get(kind) ?? 0) + 1)
      if (kind !== 'unmatched' && kind !== 'not-tried' && kind !== 'not-exercised' && !matchNode(ctx.index, link.ref, link.id)) unmatched++
    }
    const skipped = links.filter((link) => link.skip)
    const covered = links.filter((link) => link.outcome?.kind === 'not-exercised')
    const notTried = links.filter((link) => link.outcome?.kind === 'not-tried').length
    const activated = Number(data.activated) || 0
    const loc = ctx.locale
    const kinds = [...counts.entries()].map(([kind, count]) => `${count} ${say(loc, ...(KIND_TEXT[kind] ?? [kind, kind]))}`)
    const name = (link: ScriptedLink) => `<${link.tag}> "${(link.label ?? '').slice(0, 40)}"`
    const notes = [
      say(loc, `${Number(data.found) || 0} scripted link(s) found, ${activated} clicked`, `${Number(data.found) || 0} link(s) com script encontrado(s), ${activated} clicado(s)`),
      kinds.length > 0 ? kinds.join(', ') : '',
      skipped.length > 0
        ? say(loc, `${skipped.length} skipped`, `${skipped.length} pulado(s)`) +
          `: ${skipped
            .slice(0, 4)
            .map((link) => `${name(link)} (${say(loc, ...(SKIP_TEXT[link.skip?.reason ?? ''] ?? [link.skip?.reason ?? '', link.skip?.reason ?? '']))}${link.skip?.detail ? ` "${link.skip.detail}"` : ''})`)
            .join(', ')}${skipped.length > 4 ? ', …' : ''}`
        : '',
      covered.length > 0
        ? say(loc, `${covered.length} not exercised`, `${covered.length} não exercitado(s)`) +
          `: ${covered
            .slice(0, 3)
            .map((link) => (link.outcome?.cover ? `${name(link)} ${say(loc, 'under', 'sob')} <${link.outcome.cover.tag}> "${link.outcome.cover.text.slice(0, 40)}"` : name(link)))
            .join(', ')}`
        : '',
      notTried > 0 ? say(loc, `${notTried} not tried (${data.end === 'time' ? 'time budget' : 'budget'})`, `${notTried} não tentado(s) (${data.end === 'time' ? 'limite de tempo' : 'limite'})`) : '',
      say(loc, 'their destinations go to the 2.4.4 judgment', 'os destinos vão para o julgamento do 2.4.4'),
    ].filter(Boolean)
    const viewport = asRecord(data.viewport)
    const coverage: ProbeCoverage = {
      criterion: '2.4.4',
      method: `probe/links@${record.version}`,
      rule: this.id,
      conditions: conditionsText(
        record,
        say(loc, `scripted links clicked at ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`, `links com script clicados em ${Number(viewport.width) || 0}×${Number(viewport.height) || 0}`),
      ),
      status: 'no-failure-found',
      applicable: activated,
      failures: 0,
      review: 0,
      unmatched,
      note: notes.join('; '),
      maturity: 'experimental',
      inventory: true,
    }
    return { findings: [], review: [], coverage: [coverage] }
  },
}
