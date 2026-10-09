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
  /** ACT rules whose passed examples it breaks; by default the criterion's semantic rules. */
  rules?: readonly string[] | undefined
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

/**
 * 3.1.2: take the lang off every element in another language than the page, as a copy and paste into a CMS does.
 * The passage is then read in the page's language; only the language identifier can nominate it.
 */
export const langDrop: Corruptor = {
  id: 'lang-drop',
  criterion: '3.1.2',
  async apply(page) {
    return page.evaluate(() => {
      const primary = (tag: string | null) => (tag ?? '').trim().split('-')[0]?.toLowerCase() ?? ''
      const page = primary(document.documentElement.getAttribute('lang'))
      let changed = 0
      for (const element of Array.from(document.querySelectorAll('body [lang]'))) {
        const declared = primary(element.getAttribute('lang'))
        const letters = (element.textContent ?? '').match(/\p{L}/gu)?.length ?? 0
        if (declared === '' || declared === page || letters < 4) continue
        element.removeAttribute('lang')
        changed++
      }
      return changed
    })
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

/**
 * 2.4.4: give every link whose text stands alone a text that says nothing, with words the prompt never shows.
 * A link whose paragraph, item or cell holds more words is left alone, since that context could still explain it;
 * links that end up sharing the text with nothing to tell them apart fail too. Image-only links are 1.1.1's.
 */
export const linkGeneric: Corruptor = {
  id: 'link-generic',
  criterion: '2.4.4',
  rules: ['c487ae', '5effbb'],
  async apply(page) {
    return page.evaluate(() => {
      const words = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim()
      let changed = 0
      for (const link of Array.from(document.querySelectorAll('a[href]:not([role]), area[href]:not([role]), [role="link"]'))) {
        if (link.closest('[aria-hidden="true"]') || (typeof link.checkVisibility === 'function' && !link.checkVisibility())) continue
        const block = link.parentElement?.closest('p, li, td, th, dd, dt, blockquote, figcaption, caption')
        if (block && words(block) !== words(link)) continue
        const labelledBy = (link.getAttribute('aria-labelledby') ?? '').split(/\s+/).flatMap((id) => document.getElementById(id) ?? [])
        if (labelledBy.length > 0) {
          labelledBy.forEach((label, i) => {
            label.textContent = i === 0 ? 'Check it out' : ''
          })
        } else if (link.hasAttribute('aria-label')) {
          link.setAttribute('aria-label', 'Check it out')
        } else {
          // Only the words change: images inside the link stay.
          const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT)
          const texts: Text[] = []
          for (let text = walker.nextNode(); text; text = walker.nextNode()) if ((text.textContent ?? '').trim()) texts.push(text as Text)
          if (texts.length === 0) continue
          texts.forEach((text, i) => {
            text.textContent = i === 0 ? 'Check it out' : ''
          })
        }
        changed++
      }
      return changed
    })
  },
}

/**
 * 2.4.4: point every link that has an address at a part of the page about something else. The new part is in
 * the page, so the pair needs no network, and its words are not among the prompt's examples.
 */
export const linkMismatch: Corruptor = {
  id: 'link-mismatch',
  criterion: '2.4.4',
  rules: ['c487ae', '5effbb'],
  async apply(page) {
    return page.evaluate(() => {
      let changed = 0
      for (const link of Array.from(document.querySelectorAll('a[href]:not([role]), area[href]:not([role])'))) {
        if (link.closest('[aria-hidden="true"]') || (typeof link.checkVisibility === 'function' && !link.checkVisibility())) continue
        const named = (link.textContent ?? '').trim() !== '' || link.hasAttribute('aria-label') || link.hasAttribute('aria-labelledby')
        if (!named) continue
        link.setAttribute('href', '#hours')
        changed++
      }
      if (changed > 0) {
        const hours = document.createElement('p')
        hours.id = 'hours'
        hours.textContent = 'Opening hours: Monday to Friday, nine to five.'
        document.body.append(hours)
      }
      return changed
    })
  },
}

/** Field types that take no autocomplete token worth judging. */
const NOT_DATA_FIELDS = ['hidden', 'submit', 'reset', 'button', 'image', 'checkbox', 'radio', 'file']

/** 1.3.5: take the token off every field, as a form rebuilt without its autocomplete attributes would be. */
export const autocompleteDrop: Corruptor = {
  id: 'autocomplete-drop',
  criterion: '1.3.5',
  async apply(page) {
    return page.evaluate((skipped: string[]) => {
      let changed = 0
      for (const field of Array.from(document.querySelectorAll('input[autocomplete], select[autocomplete], textarea[autocomplete]'))) {
        const value = (field.getAttribute('autocomplete') ?? '').trim().toLowerCase()
        if (value === '' || value === 'on' || value === 'off') continue
        if (field instanceof HTMLInputElement && skipped.includes(field.type)) continue
        field.removeAttribute('autocomplete')
        changed++
      }
      return changed
    }, NOT_DATA_FIELDS)
  },
}

/**
 * 1.3.5: give every text field a valid token for unrelated data, a name suffix, so axe-core's
 * syntax check still passes (failure F107). Only fields where that token is allowed change.
 */
export const autocompleteSwap: Corruptor = {
  id: 'autocomplete-swap',
  criterion: '1.3.5',
  async apply(page) {
    return page.evaluate(() => {
      let changed = 0
      for (const field of Array.from(document.querySelectorAll('input[autocomplete], select[autocomplete], textarea[autocomplete]'))) {
        if (field instanceof HTMLInputElement && field.type !== 'text') continue
        const terms = (field.getAttribute('autocomplete') ?? '').trim().toLowerCase().split(/\s+/)
        if (terms.length === 1 && ['', 'on', 'off'].includes(terms[0] ?? '')) continue
        // The section and billing or shipping stay; a contact qualifier would make the new token invalid.
        const kept = terms.filter((term) => term.startsWith('section-') || term === 'billing' || term === 'shipping')
        field.setAttribute('autocomplete', [...kept, 'honorific-suffix'].join(' '))
        changed++
      }
      return changed
    })
  },
}

/** Words rendered into the 1.4.5 corruption; none of them appear in the prompts. */
const PICTURED_SENTENCE = 'Members save twenty percent this week'

/**
 * 1.4.5: swap every image that has an alternative for a picture of a sentence, with the
 * sentence as its alt, the way a banner made in an image editor reaches a page.
 */
export const textAsImage: Corruptor = {
  id: 'text-as-image',
  criterion: '1.4.5',
  async apply(page) {
    return page.evaluate(async (sentence: string) => {
      const targets = Array.from(document.querySelectorAll('img[alt], input[type="image"]')).filter((el) => (el.getAttribute('alt') ?? '').trim() !== '')
      if (targets.length === 0) return 0
      const canvas = document.createElement('canvas')
      canvas.width = 720
      canvas.height = 96
      const context = canvas.getContext('2d')
      if (!context) return 0
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#1f2328'
      context.font = 'bold 32px Georgia, serif'
      context.textBaseline = 'middle'
      context.fillText(sentence, 20, canvas.height / 2, canvas.width - 40)
      const url = canvas.toDataURL('image/png')
      for (const target of targets) {
        // At its own size, so the words stay legible where the old image was a small icon.
        target.removeAttribute('width')
        target.removeAttribute('height')
        target.setAttribute('src', url)
        target.setAttribute('alt', sentence)
      }
      await Promise.all(
        targets.map((target) =>
          target instanceof HTMLImageElement ? target.decode().catch(() => undefined) : new Promise((resolve) => setTimeout(resolve, 100)),
        ),
      )
      return targets.length
    }, PICTURED_SENTENCE)
  },
}

/**
 * 3.3.2: move every visible label into aria-label and take it off the screen. Screen readers
 * get the same name, so axe-core still passes; people looking at the page see bare fields.
 */
export const labelHidden: Corruptor = {
  id: 'label-hidden',
  criterion: '3.3.2',
  async apply(page) {
    return page.evaluate((skipped: string[]) => {
      let changed = 0
      const gone = new Set<Element>()
      const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))
      for (const field of fields) {
        if (field instanceof HTMLInputElement && skipped.includes(field.type)) continue
        const byId = (field.getAttribute('aria-labelledby') ?? '').split(/\s+/).flatMap((id) => document.getElementById(id) ?? [])
        const sources = [...Array.from(field.labels ?? []), ...byId]
        // The field's own content, such as a select's options, is not part of its label.
        const textOf = (el: Element) =>
          Array.from(el.childNodes)
            .filter((child) => !child.contains(field))
            .map((child) => child.textContent ?? '')
            .join(' ')
        const name = sources.map(textOf).join(' ').replace(/\s+/g, ' ').trim()
        if (name === '') continue
        field.setAttribute('aria-label', name)
        field.removeAttribute('aria-labelledby')
        for (const source of sources) gone.add(source)
        changed++
      }
      for (const source of gone) {
        // A label that wraps its field loses only its text; any other source leaves the page.
        if (source.querySelector('input, select, textarea')) {
          for (const child of Array.from(source.childNodes)) if (!child.contains(source.querySelector('input, select, textarea'))) child.remove()
        } else {
          source.remove()
        }
      }
      return changed
    }, NOT_DATA_FIELDS)
  },
}

export const CORRUPTORS: Readonly<Record<string, Corruptor[]>> = {
  '1.1.1': [altPlaceholder, altSwap],
  '1.3.5': [autocompleteDrop, autocompleteSwap],
  '1.4.5': [textAsImage],
  '2.4.2': [titleGeneric],
  '2.4.4': [linkGeneric, linkMismatch],
  '2.4.6': [headingGeneric],
  '3.1.1': [htmlLangSwap],
  '3.1.2': [langSwap, langDrop],
  '3.3.2': [labelHidden],
}
