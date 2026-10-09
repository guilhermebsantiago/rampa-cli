// Renders the screenshots of the app and image examples with the local browser:
// examples/android/login.png, the screenshot inside examples/ios/login.json, and
// examples/image/sign-in.png. They are mocks laid out on the bounds of the hand-written
// dump and export, not captures of a device. Run: node scripts/mobile-examples.ts
import { readFile, writeFile } from 'node:fs/promises'
import { launchBrowser } from '../src/surfaces/web.ts'

const browser = await launchBrowser()

async function render(html: string, width: number, height: number, scale: number): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale })
  const page = await context.newPage()
  await page.setContent(html, { waitUntil: 'load' })
  const png = await page.screenshot({ type: 'png' })
  await context.close()
  return png
}

/** An absolutely placed box at [left, top][right, bottom], the way UI Automator writes bounds. */
const at = (left: number, top: number, right: number, bottom: number, style = '') =>
  `position:absolute;left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;box-sizing:border-box;${style}`

const android = `<!doctype html><html><body style="margin:0;width:1080px;height:2400px;position:relative;background:#fff;font-family:Roboto,'Segoe UI',Arial,sans-serif">
<div style="${at(0, 0, 1080, 63, 'background:#f1f3f4')}"></div>
<div style="${at(42, 0, 300, 63, 'font-size:34px;line-height:63px;color:#202124')}">12:30</div>
<div style="${at(390, 150, 690, 450, 'border-radius:64px;background:#1a73e8')}">
  <div style="position:absolute;left:90px;top:110px;width:120px;height:110px;border-radius:10px 10px 20px 20px;background:#fff"></div>
  <div style="position:absolute;left:115px;top:70px;width:70px;height:70px;border:12px solid #fff;border-bottom:none;border-radius:40px 40px 0 0;box-sizing:border-box"></div>
</div>
<div style="${at(63, 500, 1017, 580, 'font-size:66px;line-height:80px;font-weight:500;color:#202124')}">Welcome back</div>
<div style="${at(63, 620, 1017, 767, 'background:#f1f3f4;border-bottom:4px solid #5f6368;border-radius:12px 12px 0 0;padding-left:40px;font-size:44px;line-height:143px;color:#8a8a8a')}">Email</div>
<div style="${at(63, 800, 870, 947, 'background:#f1f3f4;border-bottom:4px solid #5f6368;border-radius:12px 0 0 0;padding-left:40px;font-size:44px;line-height:143px;color:#757575')}">Password</div>
<div style="${at(870, 800, 1017, 947, 'background:#f1f3f4;border-bottom:4px solid #5f6368;border-radius:0 12px 0 0')}">
  <div style="position:absolute;left:34px;top:48px;width:80px;height:48px;border:7px solid #5f6368;border-radius:50%;box-sizing:border-box"></div>
  <div style="position:absolute;left:60px;top:58px;width:28px;height:28px;background:#5f6368;border-radius:50%"></div>
</div>
<div style="${at(63, 980, 600, 1100)}">
  <div style="position:absolute;left:12px;top:33px;width:54px;height:54px;border:6px solid #5f6368;border-radius:6px;box-sizing:border-box"></div>
  <div style="position:absolute;left:100px;top:0;font-size:44px;line-height:120px;color:#202124">Remember me</div>
</div>
<div style="${at(63, 1140, 1017, 1287, 'background:#1a73e8;border-radius:24px;text-align:center;font-size:44px;line-height:147px;font-weight:500;color:#fff')}">Sign in</div>
<div style="${at(300, 1320, 780, 1400, 'text-align:center;font-size:42px;line-height:80px;color:#9e9e9e')}">Forgot password?</div>
<div style="${at(930, 1320, 1017, 1407, 'border:6px solid #5f6368;border-radius:50%;text-align:center;font-size:52px;line-height:75px;font-weight:700;color:#5f6368')}">?</div>
<div style="${at(63, 1430, 1017, 1500, 'background:#f1f3f4;border-radius:24px;text-align:center;font-size:38px;line-height:70px;color:#bdbdbd')}">Create account</div>
</body></html>`

/** iOS frames are in points; the screenshot is rendered at 3x, like an iPhone 15. */
const box = (x: number, y: number, width: number, height: number, style = '') =>
  `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;box-sizing:border-box;${style}`

const ios = `<!doctype html><html><body style="margin:0;width:393px;height:852px;position:relative;background:#fff;font-family:-apple-system,'Segoe UI',Arial,sans-serif">
<div style="${box(30, 14, 60, 22, 'font-size:17px;font-weight:600;color:#000')}">9:41</div>
<div style="${box(8, 59, 70, 44, 'font-size:17px;line-height:44px;color:#007aff')}">&#8249; Shop</div>
<div style="${box(163, 70, 67, 22, 'font-size:17px;line-height:22px;font-weight:600;color:#000;text-align:center')}">Sign in</div>
<div style="${box(146, 120, 100, 100, 'border-radius:22px;background:#34c759')}">
  <div style="position:absolute;left:30px;top:38px;width:40px;height:36px;border-radius:4px 4px 8px 8px;background:#fff"></div>
  <div style="position:absolute;left:38px;top:24px;width:24px;height:24px;border:4px solid #fff;border-bottom:none;border-radius:14px 14px 0 0;box-sizing:border-box"></div>
</div>
<div style="${box(16, 236, 361, 34, 'font-size:28px;line-height:34px;font-weight:700;color:#000')}">Welcome back</div>
<div style="${box(16, 274, 361, 20, 'font-size:15px;line-height:20px;color:#8e8e93')}">Sign in to see your orders and saved items.</div>
<div style="${box(16, 310, 361, 44, 'border:1px solid #c6c6c8;border-radius:10px;padding-left:12px;font-size:17px;line-height:42px;color:#c4c4c6')}">Email</div>
<div style="${box(16, 362, 313, 44, 'border:1px solid #c6c6c8;border-radius:10px;padding-left:12px;font-size:17px;line-height:42px;color:#000')}">&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;</div>
<div style="${box(333, 362, 44, 44)}">
  <div style="position:absolute;left:8px;top:14px;width:28px;height:16px;border:2px solid #8e8e93;border-radius:50%;box-sizing:border-box"></div>
  <div style="position:absolute;left:18px;top:18px;width:8px;height:8px;background:#8e8e93;border-radius:50%"></div>
</div>
<div style="${box(16, 414, 361, 44, 'border:1px solid #c6c6c8;border-radius:10px')}"></div>
<div style="${box(16, 470, 361, 31, 'font-size:17px;line-height:31px;color:#000')}">Remember me
  <div style="position:absolute;right:0;top:0;width:51px;height:31px;border-radius:16px;background:#34c759"><div style="position:absolute;right:2px;top:2px;width:27px;height:27px;border-radius:50%;background:#fff"></div></div>
</div>
<div style="${box(16, 516, 361, 50, 'background:#007aff;border-radius:12px;text-align:center;font-size:17px;line-height:50px;font-weight:600;color:#fff')}">Sign in</div>
<div style="${box(110, 582, 173, 20, 'font-size:15px;line-height:20px;color:#007aff;text-align:center')}">Forgot password?</div>
<div style="${box(16, 620, 361, 160, 'border-radius:16px;background:linear-gradient(135deg,#ffd60a,#ff9f0a 60%,#ff375f)')}"></div>
</body></html>`

const sheet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
body{margin:0;font-family:"Segoe UI",Roboto,Arial,sans-serif;background:#fff;color:#202124}
.wrap{width:390px;padding:24px;box-sizing:border-box}
h1{font-size:28px;margin:24px 0 8px}
p.sub{color:#9e9e9e;font-size:15px;margin:0 0 24px}
label{display:block;font-size:14px;margin:12px 0 4px;color:#202124}
.field{border:1px solid #c4c4c6;border-radius:8px;height:44px;padding:0 12px;display:flex;align-items:center;color:#c4c4c6;font-size:16px}
.btn{margin-top:24px;background:#1a73e8;color:#fff;border-radius:8px;height:48px;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:16px}
.link{margin-top:16px;text-align:center;color:#8ab4f8;font-size:15px}
.banner{margin-top:24px;height:120px;border-radius:12px;background:linear-gradient(90deg,#ff8a65,#ffd54f);display:flex;align-items:center;padding:0 16px;color:#fff;font-weight:700;font-size:20px}
</style></head><body><div class="wrap">
<h1>Welcome back</h1>
<p class="sub">Sign in to see your orders</p>
<label>Email</label><div class="field">you@example.com</div>
<label>Password</label><div class="field">Password</div>
<div class="btn">Sign in</div>
<div class="link">Forgot password?</div>
<div class="banner">Summer sale: 30% off</div>
</div></body></html>`

try {
  await writeFile('examples/android/login.png', await render(android, 1080, 2400, 1))
  const exported = JSON.parse(await readFile('examples/ios/login.json', 'utf8')) as Record<string, unknown>
  exported.screenshot = (await render(ios, 393, 852, 3)).toString('base64')
  await writeFile('examples/ios/login.json', `${JSON.stringify(exported, null, 2)}\n`)
  await writeFile('examples/image/sign-in.png', await render(sheet, 390, 640, 2))
  console.log('examples/android/login.png, examples/ios/login.json and examples/image/sign-in.png written')
} finally {
  await browser.close()
}
