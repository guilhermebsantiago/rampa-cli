import { describe, expect, it } from 'vitest'
import { compilePattern, parseRobots, robotsAllows, robotsFromResponse } from '../src/surfaces/robots.ts'

const allows = (text: string, path: string) => robotsAllows(parseRobots(text), new URL(path, 'https://example.com'))

describe('robots.txt groups', () => {
  it('follows the group for every crawler when there is none for Rampa', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /private/\n\nUser-agent: Googlebot\nDisallow: /\n')
    expect(robots.group).toBe('*')
    expect(robotsAllows(robots, new URL('https://example.com/'))).toBe(true)
    expect(robotsAllows(robots, new URL('https://example.com/private/x'))).toBe(false)
  })

  it("lets Rampa's own group override the one for every crawler, as RFC 9309 says", () => {
    const staging = 'User-agent: *\nDisallow: /\n\nUser-agent: Rampa\nAllow: /\nDisallow: /admin\n'
    expect(parseRobots(staging).group).toBe('rampa')
    expect(allows(staging, '/docs/')).toBe(true)
    expect(allows(staging, '/admin/users')).toBe(false)

    const blocked = 'User-agent: rampa/1.0\nDisallow: /\n\nUser-agent: *\nAllow: /\n'
    expect(allows(blocked, '/')).toBe(false)
  })

  it('combines several groups for the same agent and shares rules among stacked user agents', () => {
    const text = 'User-agent: Rampa\nDisallow: /a\n\nUser-agent: Other\nUser-agent: RAMPA\nDisallow: /b\n'
    expect(allows(text, '/a/1')).toBe(false)
    expect(allows(text, '/b/1')).toBe(false)
    expect(allows(text, '/c')).toBe(true)
  })

  it('ignores comments, rules before any user agent, unknown lines, a BOM and CRLF line ends', () => {
    const text = '﻿Disallow: /early\r\n# a comment\r\nUser-agent: * # everyone\r\nNoindex: /x\r\nDisallow: /late # trailing\r\n'
    expect(allows(text, '/early')).toBe(true)
    expect(allows(text, '/late/page')).toBe(false)
  })

  it('reads Crawl-delay for the chosen group and Sitemap lines for everyone', () => {
    const robots = parseRobots('Sitemap: https://example.com/a.xml\nUser-agent: *\nCrawl-delay: 2.5\nDisallow:\nSitemap: https://example.com/b.xml\n')
    expect(robots.crawlDelaySeconds).toBe(2.5)
    expect(robots.sitemaps).toEqual(['https://example.com/a.xml', 'https://example.com/b.xml'])
    expect(robots.rules).toEqual([])
  })
})

describe('robots.txt rules', () => {
  it('lets the longest matching pattern decide, and allow win a tie', () => {
    const text = 'User-agent: *\nDisallow: /shop/\nAllow: /shop/public/\nDisallow: /tie\nAllow: /tie\n'
    expect(allows(text, '/shop/cart')).toBe(false)
    expect(allows(text, '/shop/public/item')).toBe(true)
    expect(allows(text, '/tie')).toBe(true)
  })

  it('reads * as anything and a final $ as the end of the path, query included', () => {
    const text = 'User-agent: *\nDisallow: /*/wp-admin/\nDisallow: /*.pdf$\nDisallow: /blog/?\nDisallow: /search*q=\n'
    expect(allows(text, '/en/wp-admin/edit')).toBe(false)
    expect(allows(text, '/files/report.pdf')).toBe(false)
    expect(allows(text, '/files/report.pdf?download=1')).toBe(true)
    expect(allows(text, '/blog/?p=12')).toBe(false)
    expect(allows(text, '/blog/post')).toBe(true)
    expect(allows(text, '/search?lang=en&q=ramp')).toBe(false)
  })

  it('treats a $ inside a pattern as a character, and matches percent-encoded paths', () => {
    expect(compilePattern('/a$b').test('/a$b/c')).toBe(true)
    expect(allows('User-agent: *\nDisallow: /café\n', '/caf%C3%A9/menu')).toBe(false)
    expect(allows('User-agent: *\nDisallow: /caf%c3%a9\n', '/café/menu')).toBe(false)
  })

  it('always allows robots.txt itself', () => {
    expect(allows('User-agent: *\nDisallow: /\n', '/robots.txt')).toBe(true)
  })
})

describe('robots.txt responses', () => {
  it('allows everything when the file is missing (4xx)', () => {
    const robots = robotsFromResponse(404, '')
    expect(robots.status).toBe('missing')
    expect(robotsAllows(robots, new URL('https://example.com/anything'))).toBe(true)
  })

  it('allows nothing when the file cannot be read: 5xx, 429 or a network error', () => {
    for (const robots of [robotsFromResponse(503, ''), robotsFromResponse(429, ''), robotsFromResponse(0, '', 'ECONNRESET')]) {
      expect(robots.status).toBe('unreachable')
      expect(robotsAllows(robots, new URL('https://example.com/'))).toBe(false)
    }
    expect(robotsFromResponse(0, '', 'ECONNRESET').detail).toBe('ECONNRESET')
    expect(robotsFromResponse(503, '').detail).toBe('HTTP 503')
  })

  it('parses an HTML page served as robots.txt as no rules', () => {
    const robots = robotsFromResponse(200, '<!doctype html><html><body><h1>App</h1></body></html>')
    expect(robots.group).toBe('none')
    expect(robotsAllows(robots, new URL('https://example.com/x'))).toBe(true)
  })
})
