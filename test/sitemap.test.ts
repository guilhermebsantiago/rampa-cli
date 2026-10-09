import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { type Fetched, parseSitemap, readSitemaps, sitemapText } from '../src/surfaces/sitemap.ts'

const urlset = (...locs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`

describe('parseSitemap', () => {
  it('reads the pages of a urlset, decoding entities and CDATA', () => {
    const xml = urlset('https://example.com/', 'https://example.com/a?x=1&amp;y=2', '<![CDATA[https://example.com/b?x=1&y=2]]>', ' https://example.com/&#233;t&#xE9; ')
    expect(parseSitemap(xml)).toEqual({
      kind: 'urlset',
      urls: ['https://example.com/', 'https://example.com/a?x=1&y=2', 'https://example.com/b?x=1&y=2', 'https://example.com/été'],
    })
  })

  it('tells a sitemap index from a urlset', () => {
    const index = '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>'
    expect(parseSitemap(index)).toEqual({ kind: 'index', urls: ['https://example.com/s1.xml'] })
  })

  it('leaves out the files the image extension lists, which are not pages', () => {
    const xml =
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' +
      '<url><loc>https://example.com/page</loc><image:image><image:loc>https://example.com/photo.jpg</image:loc></image:image></url></urlset>'
    expect(parseSitemap(xml).urls).toEqual(['https://example.com/page'])
  })

  it('reads the plain-text form, one address per line', () => {
    expect(parseSitemap('﻿https://example.com/\r\nnot a url\nhttps://example.com/about\n')).toEqual({
      kind: 'text',
      urls: ['https://example.com/', 'https://example.com/about'],
    })
  })

  it('gunzips a .xml.gz served as a file', () => {
    expect(sitemapText(gzipSync(urlset('https://example.com/')))).toContain('<loc>https://example.com/</loc>')
    expect(sitemapText(new TextEncoder().encode('plain'))).toBe('plain')
  })
})

function fakeFetch(files: Record<string, string | number>): { fetch: (url: string) => Promise<Fetched>; asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    async fetch(url) {
      asked.push(url)
      const file = files[url]
      if (file === undefined) return { status: 404, url, body: new Uint8Array() }
      if (typeof file === 'number') return { status: file, url, body: new Uint8Array() }
      return { status: 200, url, body: new TextEncoder().encode(file) }
    },
  }
}

describe('readSitemaps', () => {
  it('follows an index to its sitemaps, once each, and resolves relative entries', async () => {
    const index = '<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap><sitemap><loc>/b.xml</loc></sitemap><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>'
    const { fetch, asked } = fakeFetch({
      'https://example.com/sitemap.xml': index,
      'https://example.com/a.xml': urlset('https://example.com/1', 'https://example.com/2'),
      'https://example.com/b.xml': urlset('https://example.com/3'),
    })
    const read = await readSitemaps(['https://example.com/sitemap.xml'], fetch)
    expect(read.urls).toEqual(['https://example.com/1', 'https://example.com/2', 'https://example.com/3'])
    expect(read.read).toEqual(['https://example.com/sitemap.xml', 'https://example.com/a.xml', 'https://example.com/b.xml'])
    expect(asked).toHaveLength(3)
  })

  it('records the sitemaps it could not read and goes on', async () => {
    const { fetch } = fakeFetch({
      'https://example.com/sitemap.xml': '<sitemapindex><sitemap><loc>https://example.com/gone.xml</loc></sitemap><sitemap><loc>https://example.com/ok.xml</loc></sitemap></sitemapindex>',
      'https://example.com/ok.xml': urlset('https://example.com/1'),
      'https://example.com/gone.xml': 500,
    })
    const read = await readSitemaps(['https://example.com/sitemap.xml'], fetch)
    expect(read.urls).toEqual(['https://example.com/1'])
    expect(read.failed).toEqual([{ url: 'https://example.com/gone.xml', detail: 'HTTP 500' }])
  })

  it('stops after a number of files, so a runaway index cannot make it fetch forever', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 50; i++) files[`https://example.com/s${i}.xml`] = `<sitemapindex><sitemap><loc>https://example.com/s${i + 1}.xml</loc></sitemap></sitemapindex>`
    const { fetch, asked } = fakeFetch(files)
    await readSitemaps(['https://example.com/s0.xml'], fetch, 5)
    expect(asked).toHaveLength(5)
  })
})
