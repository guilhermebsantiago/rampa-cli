# Browser options

Real pages are not always the public desktop page: an account area behind a login, the layout a phone gets, dark mode, a single-page app that renders after load. These options open the page the way the people you care about see it. They work for every web check: a URL, a local HTML file, a folder, and a [crawl](crawl.md).

```sh
rampa check https://app.example.com/account --storage-state auth.json
rampa check https://example.com --device "iPhone 13" --color-scheme dark
rampa check https://example.com --viewport 390x844 --reduced-motion
rampa check https://example.com --browser-locale pt-BR --locale pt-BR
rampa check https://app.example.com --wait-for networkidle --wait-for "#app main" --timeout 60000
rampa check https://staging.example.com --header "Authorization: Bearer $TOKEN" --crawl
```

| Option | Default | Effect |
| --- | --- | --- |
| `--storage-state <file>` | | Load a signed-in session saved by Playwright: cookies and localStorage |
| `--header "Name: value"` | | Send an HTTP header to the site being checked; repeatable |
| `--cookie name=value` | | Set a cookie on the site being checked; repeatable |
| `--viewport <WxH>` | `1280x800` | Viewport in CSS pixels, such as `390x844` |
| `--device "<name>"` | | Emulate a device from Playwright's list: viewport, pixel ratio, user agent, touch |
| `--color-scheme <light\|dark>` | the browser's (light) | Emulate `prefers-color-scheme` |
| `--reduced-motion` | | Emulate `prefers-reduced-motion: reduce` |
| `--browser-locale <bcp47>` | the browser's | The browser's language: `navigator.language` and `Accept-Language` |
| `--wait-for <condition>` | `load` | What to wait for before collecting; repeatable, in order |
| `--timeout <ms>` | `30000` | Limit for loading the page, and for each `--wait-for` |
| `--user-agent <ua>` | the browser's | The user agent string |

Every value is checked before the browser starts, so a typo stops the run with exit code 2 and a message that says what is expected.

## Signed-in pages

### --storage-state

A storage state is a JSON file Playwright writes with the cookies and localStorage of a browser session. The simplest way to make one is to sign in by hand in a window Playwright opens:

```sh
npx playwright codegen --save-storage=auth.json https://app.example.com/login
```

Sign in, then close the window: `auth.json` holds the session. `npx playwright` downloads its own Chromium the first time; to use the Chrome or Edge you already have, add `--channel chrome` or `--channel msedge`. Inside this repository, `pnpm exec playwright-core codegen --channel msedge --save-storage=auth.json <url>` works with no download, because Rampa already depends on `playwright-core`.

Then:

```sh
rampa check https://app.example.com/account --storage-state auth.json
rampa check https://app.example.com/ --storage-state auth.json --crawl --exclude logout
```

- `auth.json` is a credential. Keep it out of git and out of CI logs; in CI, write it from a secret at run time.
- Sessions expire. When they do, pages redirect to the login page, and a crawl reports a start page that leads to another host (an identity provider) instead of following it. Save the state again.
- With `--crawl`, exclude the links that end the session (`--exclude logout`), or the crawl may sign itself out halfway.
- Rampa only loads pages; it never types into the login form. Sites that tie a session to a device or an IP address may reject a saved state.

### --cookie

`--cookie session=abc123` sets one cookie on the host of the page being checked (its `www.` twin included), for every path, `SameSite=Lax`, and `Secure` on https. Repeat the flag for more cookies. For anything else (a domain, a path, an expiry, `HttpOnly`), use `--storage-state`. Cookies follow the browser's rules from there: on `localhost` or an IP address they apply to every port of that host.

### --header

`--header "Authorization: Bearer <token>"` adds a header to the requests for the site being checked: the same host or its `www.` twin, on the same port, over http or https. Requests the page makes to other hosts (fonts, scripts, analytics, a CDN) never get it, because a header is often a credential. During a crawl, the requests Rampa makes itself for robots.txt, sitemaps and start pages carry it under the same rule. A header is also kept through a redirect within the site.

Header and cookie values never appear in the report or in error messages; a crawl's JSON report records their names only.

## Phones and screens

`--device` takes a name from Playwright's device list, such as `"iPhone 13"`, `"iPhone 15 Pro"`, `"Pixel 7"` or `"Galaxy S24"`; landscape variants end in `landscape`. Case and spaces are forgiving (`iphone13` works), and an unknown name lists the closest ones. The full list:

```sh
node -e "console.log(Object.keys(require('playwright-core').devices).join('\n'))"
```

`--viewport` sets only the size; with `--device`, it replaces the device's size and keeps the rest. `--user-agent` likewise replaces the device's user agent.

- Rampa renders with Chromium (Chrome or Edge). An iPhone profile gives the page an iPhone's screen, pixel ratio, user agent and touch, not Safari's engine, so it finds what a phone layout breaks, not what WebKit renders differently.
- A page without `<meta name="viewport" content="width=device-width">` is laid out 980 pixels wide on a phone, as on a real one, and the snapshot records that width.
- Images judged by 1.1.1 are captured at CSS pixels whatever the pixel ratio, so a phone run sends the model images of the same size as a desktop run, and reuses the same cached judgments when an image renders the same.

## Dark mode and reduced motion

`--color-scheme dark` makes `prefers-color-scheme: dark` true, so the site's dark styles apply and axe-core measures contrast on the dark colors. A page that passes contrast in light mode can fail in dark mode: check both.

`--reduced-motion` makes `prefers-reduced-motion: reduce` true. Content a site hides or replaces for people who reduce motion is checked as they get it.

## Language

`--browser-locale pt-BR` sets the browser's language: `navigator.language`, the `Accept-Language` header and number and date formats. Sites that choose a language from it serve that version. It is not `--locale`, which sets the language of Rampa's report; use both to check the Portuguese version of a site and read the report in Portuguese.

## Waiting for the page

By default Rampa collects the page once the `load` event fires. Pages that render later need more:

| `--wait-for` | Waits for |
| --- | --- |
| `load` | the load event (the default) |
| `domcontentloaded` | the DOM, without images and other subresources |
| `networkidle` | no network activity for half a second; for apps that fetch their content |
| `#app main` | an element matching the selector to be visible. Any Playwright selector works, such as `text=Welcome` |
| `1500` or `1500ms` | a pause of that many milliseconds |

Repeat the flag to combine: the load state comes first (give at most one), then each selector or pause in the order given. `--wait-for networkidle --wait-for "#results"` waits for the network to settle and then for the results.

`--timeout` limits the navigation and each wait, in milliseconds (30000 by default). A page that does not load in time, or a selector that never shows up, stops the check of that page with a message naming the limit. A single check ends with exit code 2; during a crawl, the page is listed under "Not checked" with the message, and the crawl goes on.

## What the report records

The page's viewport and pixel ratio are in every snapshot. A crawl's report also records, under `browser`, the device, viewport, color scheme, reduced motion, browser locale, whether the user agent was replaced, what was waited for, whether a storage state was used, and the names of the headers and cookies sent. The terminal report shows the same in its `Browser:` line, when anything differs from the default desktop page.
