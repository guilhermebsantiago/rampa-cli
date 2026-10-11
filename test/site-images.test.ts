import { describe, expect, it } from 'vitest'
import { captureHash, pagePictureKeys, pictureKeys, repeatedPictures } from '../src/core/site-images.ts'
import { node } from './helpers.ts'

const logo = (image: string, src: string) => node({ ref: 'img', role: 'img', name: 'Acme', image, native: { tag: 'img', attributes: { src } } })

describe('pictures repeated across a crawl', () => {
  it('knows a captured picture by its pixels and by its address', () => {
    expect(pictureKeys(logo('data:image/png;base64,AAAA', '/brand/acme.png'), 'https://acme.example/shop/')).toEqual([
      `capture:${captureHash('data:image/png;base64,AAAA')}`,
      'src:https://acme.example/brand/acme.png',
    ])
    // A picture with no capture is not judged, so it has no key; an inline picture is known by its pixels only.
    expect(pictureKeys(node({ ref: 'img', native: { tag: 'img', attributes: { src: '/a.png' } } }), 'https://acme.example/')).toEqual([])
    expect(pictureKeys(logo('data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'), 'https://acme.example/')).toHaveLength(1)
  })

  it('counts the other pages that showed each picture of a page', () => {
    const root = node({ ref: 'html', children: [logo('data:image/png;base64,AAAA', '/brand/acme.png')] })
    const keys = pagePictureKeys(root, 'https://acme.example/c')
    // Three pages of the crawl show the logo, this one included.
    const shown = new Set(['https://acme.example/a', 'https://acme.example/b', 'https://acme.example/c'])
    const pages = new Map([...keys].map((key) => [key, shown]))
    expect(repeatedPictures(keys, pages, 'https://acme.example/c')).toEqual(Object.fromEntries([...keys].map((key) => [key, 2])))
    expect(repeatedPictures(keys, new Map([[[...keys][0] ?? '', new Set(['https://acme.example/c'])]]), 'https://acme.example/c')).toBeUndefined()
  })
})
