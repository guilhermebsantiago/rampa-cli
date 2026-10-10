import type { JudgeRequest, ModelProvider } from '../src/providers/types.ts'

export interface Asked {
  criterion: string
  /** The text the model was asked about: the alternative, title, link, heading, label or language. */
  subject: string
  images: number
}

/** Fails what is generic on the test pages and passes the rest. */
const GENERIC = /^(click here|read more|section \d+|field \d+|untitled document|img_\d+\.jpg)$/i

/**
 * A model that answers by rule instead of over the network: it fails generic texts with a
 * suggestion and passes the rest, always quoting the element so verification holds. It
 * records every question, so tests can check what reached the model and what never did.
 */
export function stubModel(): ModelProvider & { asked: Asked[] } {
  const asked: Asked[] = []
  return {
    id: 'stub:rules',
    asked,
    async judge<T>(request: JudgeRequest<T>) {
      const criterion = request.schemaName.replace(/^wcag_/, '').replace(/_judgment$/, '').replaceAll('_', '.')
      const { subject, output } = answer(criterion, request.user)
      asked.push({ criterion, subject, images: request.images?.length ?? 0 })
      return { output: request.schema.parse(output), inputTokens: 120, outputTokens: 30, latencyMs: 1, modelId: 'stub' }
    },
  }
}

function answer(criterion: string, prompt: string): { subject: string; output: unknown } {
  const tagged = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(prompt)?.[1] ?? ''
  switch (criterion) {
    case '1.1.1': {
      // An image hidden from assistive technology: the stub takes it as decoration.
      if (prompt.includes('How the page hides it from assistive technology:')) {
        const file = /Image file name: (.*)/.exec(prompt)?.[1] ?? ''
        return {
          subject: `hidden ${file}`,
          output: { imageShows: 'A soft pattern of shapes', textInImage: '', verdict: 'pass', evidence: '', suggestedAlt: '', confidence: 'high' },
        }
      }
      const alt = /Current text alternative: "(.*)"/.exec(prompt)?.[1] ?? ''
      const fail = GENERIC.test(alt)
      return {
        subject: alt,
        output: {
          verdict: fail ? 'fail' : 'pass',
          evidence: alt,
          problem: fail ? 'filename_or_placeholder' : 'none',
          imageShows: 'A blue mug with steam rising from it',
          suggestedAlt: fail ? 'Blue ceramic mug' : '',
          confidence: 'high',
        },
      }
    }
    case '2.4.2': {
      const title = tagged('title')
      const fail = GENERIC.test(title)
      return {
        subject: title,
        output: { verdict: fail ? 'fail' : 'pass', evidence: title, problem: fail ? 'generic' : 'none', suggestedTitle: fail ? 'Your cart | Corner Store' : '', confidence: 'high' },
      }
    }
    case '2.4.4': {
      const link = tagged('link')
      const fail = GENERIC.test(link)
      return {
        subject: link,
        output: {
          promises: link,
          leadsTo: 'unknown',
          verdict: fail ? 'fail' : 'pass',
          evidence: link,
          problem: fail ? 'generic' : 'none',
          suggestedText: fail ? 'Shipping and returns' : '',
          confidence: 'high',
        },
      }
    }
    case '2.4.6': {
      const text = tagged('heading') || tagged('label')
      const fail = GENERIC.test(text)
      return {
        subject: text,
        output: {
          named: fail ? '' : text,
          verdict: fail ? 'fail' : 'pass',
          evidence: text,
          problem: fail ? 'generic' : 'none',
          suggestedText: fail ? 'Your cart' : '',
          confidence: 'high',
        },
      }
    }
    case '3.1.1':
    case '3.1.2': {
      const declared = /Declared (?:page )?language \([^)]*\): (\S+)/.exec(prompt)?.[1] ?? 'en'
      const words = tagged('text').trim().split(/\s+/).slice(0, 3).join(' ')
      const base = { verdict: 'pass', detectedLanguage: declared.split('-')[0], evidence: words, confidence: 'high' }
      return { subject: declared, output: criterion === '3.1.2' ? { ...base, exception: 'none' } : base }
    }
    // Fields on the test pages either name what they collect or collect nothing about the user.
    case '1.3.5': {
      const label = tagged('label')
      return { subject: label, output: { asks: label, about: 'not_personal', purpose: 'none', verdict: 'pass', evidence: label, confidence: 'high' } }
    }
    case '3.3.2': {
      const name = tagged('name')
      return { subject: name, output: { shown: name, rule: '', verdict: 'pass', problem: 'none', evidence: name, confidence: 'high' } }
    }
    default:
      throw new Error(`The stub model has no rule for WCAG ${criterion}`)
  }
}
