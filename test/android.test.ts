import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng, pngFromBase64 } from '../src/pixels/png.ts'
import { type A11yNode, A11ySnapshotSchema } from '../src/snapshot/schema.ts'
import { indexTree, walkTree } from '../src/snapshot/tree.ts'
import { parseBounds, readUiAutomatorDump, snapshotFromUiAutomator } from '../src/surfaces/android/uiautomator.ts'
import { blank, fill } from './screens.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/android/${name}`, import.meta.url), 'utf8')

function byRef(root: A11yNode, ref: string): A11yNode {
  const found = indexTree(root).get(ref)?.node
  if (!found) throw new Error(`no node ${ref}`)
  return found
}

describe('UI Automator dump', () => {
  const login = snapshotFromUiAutomator(fixture('login.xml'), { locale: 'en-US', localeSource: 'device', collectedAt: '2026-10-08T00:00:00.000Z' })

  it('becomes a valid android snapshot of the app package, in the device language', () => {
    expect(A11ySnapshotSchema.safeParse(login).success).toBe(true)
    expect(login).toMatchObject({ surface: 'android', target: 'com.example.shop', locale: 'en-US', title: undefined })
    expect(login.root).toMatchObject({ ref: '/hierarchy', role: 'application', lang: 'en-US' })
    expect(login.viewport).toEqual({ width: 1080, height: 2400, scale: 1 })
  })

  it('maps classes to roles and names as TalkBack reads them', () => {
    const roles = Object.fromEntries([...walkTree(login.root)].filter((n) => n.native.resourceId).map((n) => [n.native.resourceId, [n.role, n.name]]))
    expect(roles).toMatchObject({
      'com.example.shop:id/logo': ['img', 'image'],
      'com.example.shop:id/title': ['text', 'Welcome back'],
      'com.example.shop:id/email': ['textbox', 'Email'],
      'com.example.shop:id/password': ['textbox', 'Password'],
      'com.example.shop:id/toggle_password': ['button', undefined],
      'com.example.shop:id/remember': ['checkbox', 'Remember me'],
      'com.example.shop:id/sign_in': ['button', 'Sign in'],
      'com.example.shop:id/forgot': ['text', 'Forgot password?'],
      'com.example.shop:id/help': ['button', 'Help'],
      'com.example.shop:id/login_root': ['generic', undefined],
    })
  })

  it('reads an empty field showing its hint as a name, not as entered text', () => {
    const email = byRef(login.root, 'com.example.shop:id/email')
    expect(email).toMatchObject({ name: 'Email', text: undefined, native: { nameFrom: 'hint', showingHint: true, renderedText: 'Email' } })
    expect(byRef(login.root, 'com.example.shop:id/password').states).toEqual(expect.arrayContaining(['password', 'clickable', 'focusable']))
  })

  it('keeps states, bounds in screen pixels and the node as markup for prompts', () => {
    const toggle = byRef(login.root, 'com.example.shop:id/toggle_password')
    expect(toggle.bounds).toEqual({ x: 870, y: 800, width: 147, height: 147 })
    expect(toggle.native).toMatchObject({ class: 'android.widget.ImageButton', imageControl: true, naf: true })
    expect(toggle.native.source).toBe('<android.widget.ImageButton resource-id="com.example.shop:id/toggle_password" clickable="true" bounds="[870,800][1017,947]">')
    expect(byRef(login.root, 'com.example.shop:id/create').states).toContain('disabled')
    expect(byRef(login.root, 'com.example.shop:id/remember').states).toEqual(expect.arrayContaining(['checkable', 'clickable']))
  })

  it('refers to a node by its resource-id when unique, else by a path from the nearest unique id', () => {
    const refs = [...walkTree(login.root)].map((node) => node.ref)
    expect(refs.slice(0, 5)).toEqual([
      '/hierarchy',
      '/hierarchy/android.widget.FrameLayout',
      '/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout',
      'android:id/content',
      'com.example.shop:id/login_root',
    ])
    expect(refs).toContain('//*[@resource-id="com.example.shop:id/login_root"]/android.widget.LinearLayout')
    expect(new Set(refs).size).toBe(refs.length)
  })

  it('tolerates what adb prints around the XML', () => {
    const noisy = `WARNING: linker: unused DT entry\n${fixture('login.xml')}UI hierchary dumped to: /dev/tty\n`
    expect(snapshotFromUiAutomator(noisy).root.children).toHaveLength(1)
  })

  it('refuses what is not a dump', () => {
    expect(() => snapshotFromUiAutomator('<html><body/></html>')).toThrow(/Not a UI Automator dump/)
    expect(() => snapshotFromUiAutomator('plain text')).toThrow(/Not a UI Automator dump/)
  })

  it('parses bounds strictly', () => {
    expect(parseBounds('[0,63][1080,2400]')).toEqual({ x: 0, y: 63, width: 1080, height: 2337 })
    expect(parseBounds('[10,10][10,50]')).toBeUndefined()
    expect(parseBounds('garbage')).toBeUndefined()
  })
})

describe('Appium page source', () => {
  const notes = snapshotFromUiAutomator(fixture('notes-appium.xml'))

  it('reads class-named tags and the extra attributes Appium adds', () => {
    expect(readUiAutomatorDump(fixture('notes-appium.xml')).format).toBe('appium')
    const headings = [...walkTree(notes.root)].filter((n) => n.role === 'heading').map((n) => n.name)
    expect(headings).toEqual(['Notes', 'Item 1', 'Item 2', 'Item 3'])
    const filter = byRef(notes.root, 'com.example.notes:id/filter')
    expect(filter).toMatchObject({ role: 'textbox', name: 'Field 1', text: undefined, native: { nameFrom: 'hint', showingHint: true } })
  })

  it('treats an image left out of what TalkBack reads as presentation', () => {
    const divider = [...walkTree(notes.root)].find((n) => n.native.resourceId === 'com.example.notes:id/row_divider')
    expect(divider?.role).toBe('presentation')
    expect(divider?.states).toContain('not-important')
  })

  it('makes list rows list items, named by their content, with paths where ids repeat', () => {
    const rows = [...walkTree(notes.root)].filter((n) => n.native.resourceId === 'com.example.notes:id/row')
    expect(rows.map((row) => row.ref)).toEqual([
      '//*[@resource-id="com.example.notes:id/list"]/android.widget.LinearLayout[1]',
      '//*[@resource-id="com.example.notes:id/list"]/android.widget.LinearLayout[2]',
      '//*[@resource-id="com.example.notes:id/list"]/android.widget.LinearLayout[3]',
    ])
    expect(rows[0]).toMatchObject({ role: 'listitem', name: 'Item 1 Buy oat milk, coffee beans and bread for the weekend.' })
    expect(rows[0]?.children[0]?.ref).toBe('//*[@resource-id="com.example.notes:id/list"]/android.widget.LinearLayout[1]/android.widget.TextView[1]')
    expect(byRef(notes.root, 'com.example.notes:id/list').role).toBe('list')
  })
})

describe('uiautomator dump --windows', () => {
  it('keeps the app window, takes its title, and leaves the status and navigation bars out', () => {
    const gallery = snapshotFromUiAutomator(fixture('gallery-windows.xml'), { locale: 'en-US' })
    expect(readUiAutomatorDump(fixture('gallery-windows.xml')).format).toBe('uiautomator-windows')
    expect(gallery).toMatchObject({ target: 'com.example.gallery', title: 'Galeria' })
    const packages = new Set([...walkTree(gallery.root)].map((n) => n.native.package).filter(Boolean))
    expect([...packages]).toEqual(['com.example.gallery'])
    expect(gallery.root.children[0]?.ref).toBe('/hierarchy/android.widget.FrameLayout')
    const photos = [...walkTree(gallery.root)].filter((n) => n.native.resourceId === 'com.example.gallery:id/photo')
    expect(photos.map((p) => [p.ref, p.name])).toEqual([
      ['//*[@resource-id="com.example.gallery:id/grid"]/android.widget.ImageView[1]', 'image'],
      ['//*[@resource-id="com.example.gallery:id/grid"]/android.widget.ImageView[2]', 'Cachorro dourado dormindo numa manta vermelha'],
      ['//*[@resource-id="com.example.gallery:id/grid"]/android.widget.ImageView[3]', undefined],
    ])
    // A clickable image is a control drawn as an image.
    expect(byRef(gallery.root, 'com.example.gallery:id/share').native.imageControl).toBe(true)
  })

  it('wraps several app windows, marking the ones behind the active window', () => {
    const xml = fixture('gallery-windows.xml').replace(
      '<window index="1" title="Status bar"',
      '<window index="3" title="Excluir foto?" bounds="[90,900][990,1500]" active="false" focused="false" accessibility-focused="false" id="2200" layer="3" type="TYPE_APPLICATION"><hierarchy rotation="0"><node index="0" text="Excluir" resource-id="android:id/button1" class="android.widget.Button" package="com.example.gallery" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[600,1380][950,1480]" drawing-order="0" hint="" /></hierarchy></window><window index="1" title="Status bar"',
    )
    const snapshot = snapshotFromUiAutomator(xml)
    expect(snapshot.root.children.map((w) => [w.role, w.name, w.states])).toEqual([
      ['window', 'Galeria', []],
      ['window', 'Excluir foto?', ['inactive']],
    ])
  })
})

describe('images from the screenshot', () => {
  it('crops each named image so 1.1.1 judges what people see', () => {
    const screen = blank(1080, 2400)
    fill(screen, { x: 390, y: 150, width: 300, height: 300 }, [200, 30, 30])
    const snapshot = snapshotFromUiAutomator(fixture('login.xml'), { screenshot: screen })
    const logo = byRef(snapshot.root, 'com.example.shop:id/logo')
    const png = pngFromBase64(logo.image ?? '')
    expect(png && decodePng(png)).toMatchObject({ width: 300, height: 300 })
    expect([...(png ? decodePng(png).data.subarray(0, 4) : [])]).toEqual([200, 30, 30, 255])
    // The unlabeled image button has nothing to judge: the rules report it instead.
    expect(byRef(snapshot.root, 'com.example.shop:id/toggle_password').image).toBeUndefined()
    expect(byRef(snapshot.root, 'com.example.shop:id/help').image).toBeDefined()
  })
})
