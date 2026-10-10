// Preload for `node --import`: logs every request to the local Ollama server, one JSON line per HTTP call, to the
// file named by RAMPA_CALL_LOG. The request and response pass through unchanged. It records what the eval's own
// records do not: HTTP failures and retries, answers that are not JSON, finish reasons and per-call time.
import { appendFileSync } from 'node:fs'

const file = process.env.RAMPA_CALL_LOG
const original = globalThis.fetch

if (file && original) {
  globalThis.fetch = async function loggedFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
    if (!url || !url.includes(':11434')) return original(input, init)
    const started = Date.now()
    const entry = { started: new Date(started).toISOString(), url }
    try {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      if (body) {
        const content = body.messages?.flatMap((m) => (Array.isArray(m.content) ? m.content : [])) ?? []
        entry.request = {
          model: body.model,
          images: content.filter((c) => c.type === 'image_url').length,
          reasoning_effort: body.reasoning_effort,
          temperature: body.temperature,
          response_format: body.response_format?.type,
          schema: body.response_format?.json_schema?.name,
        }
      }
    } catch {
      entry.request = { unparsed: true }
    }
    try {
      const response = await original(input, init)
      entry.status = response.status
      entry.ms = Date.now() - started
      try {
        const text = await response.clone().text()
        try {
          const json = JSON.parse(text)
          const choice = json.choices?.[0]
          const content = choice?.message?.content
          entry.finish = choice?.finish_reason
          entry.usage = json.usage
          entry.reasoningChars = (choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? '').length
          entry.json = false
          if (typeof content === 'string') {
            entry.contentChars = content.length
            try {
              JSON.parse(content)
              entry.json = true
            } catch {
              entry.content = content.slice(0, 1500)
            }
          }
          if (json.error) entry.error = JSON.stringify(json.error).slice(0, 500)
        } catch {
          entry.body = text.slice(0, 500)
        }
      } catch (error) {
        entry.readError = String(error)
      }
      appendFileSync(file, `${JSON.stringify(entry)}\n`)
      return response
    } catch (error) {
      entry.ms = Date.now() - started
      entry.threw = `${error?.name}: ${error?.message}${error?.cause ? ` (${error.cause?.code ?? error.cause?.name ?? ''} ${error.cause?.message ?? ''})` : ''}`
      appendFileSync(file, `${JSON.stringify(entry)}\n`)
      throw error
    }
  }
}
