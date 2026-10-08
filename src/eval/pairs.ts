import type { Page } from 'playwright-core'

/**
 * Corrupted pairs, after López-Gil & Pereira (2025): take a case that passes,
 * break it on purpose, and check that the verdict flips. A tool that gives
 * both versions the same verdict is not judging.
 */

/** A valid tag for a different language, so the engine's syntax check still passes. */
export const LANGUAGE_SWAP: Readonly<Record<string, string>> = {
  nl: 'es',
  es: 'nl',
  en: 'de',
  de: 'en',
  fr: 'it',
  it: 'fr',
  pt: 'fi',
  fi: 'pt',
  ja: 'ko',
  ko: 'ja',
  zh: 'ja',
  ar: 'he',
  he: 'ar',
}

export interface Corruptor {
  id: string
  criterion: string
  /** Mutates the live page; returns how many elements were changed (0 = no pair). */
  apply(page: Page): Promise<number>
}

/** 3.1.2: swap the lang of every element that has enough text to judge. */
export const langSwap: Corruptor = {
  id: 'lang-swap',
  criterion: '3.1.2',
  async apply(page) {
    return page.evaluate((swap: Record<string, string>) => {
      let changed = 0
      for (const element of Array.from(document.querySelectorAll('body [lang]'))) {
        const declared = (element.getAttribute('lang') ?? '').trim()
        const letters = (element.textContent ?? '').match(/\p{L}/gu)?.length ?? 0
        if (declared === '' || letters < 4) continue
        const primary = declared.split('-')[0]?.toLowerCase() ?? ''
        element.setAttribute('lang', swap[primary] ?? (primary === 'es' ? 'nl' : 'es'))
        changed++
      }
      return changed
    }, LANGUAGE_SWAP)
  },
}

/** 1.1.1: replace every non-empty alt with a placeholder, the "img-1" case. */
export const altPlaceholder: Corruptor = {
  id: 'alt-placeholder',
  criterion: '1.1.1',
  async apply(page) {
    return page.evaluate(() => {
      let changed = 0
      for (const [index, image] of Array.from(document.querySelectorAll('img[alt]')).entries()) {
        if ((image.getAttribute('alt') ?? '').trim() === '') continue
        image.setAttribute('alt', `img-${index + 1}`)
        changed++
      }
      return changed
    })
  },
}

/** 1.1.1: replace every non-empty alt with a fluent description of something else. */
export const altSwap: Corruptor = {
  id: 'alt-swap',
  criterion: '1.1.1',
  async apply(page) {
    return page.evaluate(() => {
      let changed = 0
      for (const image of Array.from(document.querySelectorAll('img[alt]'))) {
        if ((image.getAttribute('alt') ?? '').trim() === '') continue
        image.setAttribute('alt', 'A bowl of fresh fruit on a wooden kitchen table')
        changed++
      }
      return changed
    })
  },
}

/** 2.4.2: a title that says nothing about the page. The words are not among the prompt's examples, so the pair tests judgment, not recall. */
export const titleGeneric: Corruptor = {
  id: 'title-generic',
  criterion: '2.4.2',
  async apply(page) {
    return page.evaluate(() => {
      if (document.title.trim() === '') return 0
      document.title = 'Welcome'
      return 1
    })
  },
}

/** 2.4.6: number every heading and label instead of naming it, with words the prompt never shows. */
export const headingGeneric: Corruptor = {
  id: 'heading-generic',
  criterion: '2.4.6',
  async apply(page) {
    return page.evaluate(() => {
      let changed = 0
      for (const [index, heading] of Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')).entries()) {
        if ((heading.textContent ?? '').trim() === '') continue
        heading.textContent = `Part ${index + 1}`
        changed++
      }
      for (const [index, label] of Array.from(document.querySelectorAll('label')).entries()) {
        if (!label.control || (label.textContent ?? '').trim() === '') continue
        // A wrapped field stays in place; only the label's own text changes.
        for (const node of Array.from(label.childNodes)) if (node.nodeType === Node.TEXT_NODE) node.remove()
        label.prepend(`Entry ${index + 1} `)
        changed++
      }
      return changed
    })
  },
}

/** 3.1.1: declare another valid language on the root, as a template copied from another site would. */
export const htmlLangSwap: Corruptor = {
  id: 'html-lang-swap',
  criterion: '3.1.1',
  async apply(page) {
    return page.evaluate((swap: Record<string, string>) => {
      const root = document.documentElement
      const declared = (root.getAttribute('lang') ?? '').trim()
      if (declared === '') return 0
      const primary = declared.split('-')[0]?.toLowerCase() ?? ''
      root.setAttribute('lang', swap[primary] ?? (primary === 'es' ? 'nl' : 'es'))
      return 1
    }, LANGUAGE_SWAP)
  },
}

export const CORRUPTORS: Readonly<Record<string, Corruptor[]>> = {
  '1.1.1': [altPlaceholder, altSwap],
  '2.4.2': [titleGeneric],
  '2.4.6': [headingGeneric],
  '3.1.1': [htmlLangSwap],
  '3.1.2': [langSwap],
}
