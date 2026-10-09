# Android screens

Rampa checks one Android screen at a time: the UI Automator hierarchy of what is on the screen, a screenshot taken right after it, and the language the screen is in. Nothing is installed on the device, and nothing leaves your machine unless your model does.

Navigate to the screen first, by hand or with your UI tests, then run the check. Each run sees the screen as it is at that moment: other screens, other states (an error message, an open menu) and what is scrolled away are not checked.

## Setup

- **adb**, from [Android platform-tools](https://developer.android.com/tools/releases/platform-tools) (about 8 MB; the full SDK is not needed). Rampa looks for it in `RAMPA_ADB_PATH`, then in `platform-tools` under `ANDROID_HOME` or `ANDROID_SDK_ROOT`, then on the `PATH`. `rampa doctor` says whether it found one.
- **A device or an emulator** that `adb devices` lists as `device`: USB or wireless debugging on, and the computer authorized on the device.
- **A model** for the judgment layer, as for web pages. 1.1.1 needs one with vision, such as `ollama:gemma4:12b`. Without a model, the deterministic rules still run.

## Commands

```sh
rampa check android:                                  # the screen on the only connected device
rampa check android:emulator-5554                     # one of several devices, by its adb serial
rampa check android: --save recordings                # also record the screen, to check it later without the device
rampa check recordings/android-com-example-shop.snapshot.json   # replay a recording
rampa check login.xml                                 # a saved UI Automator dump; login.png next to it is the screenshot
rampa check examples/android/login.xml --no-llm       # the example in this repository
```

`--save` writes four files per screen, named after the app and the screen title: the snapshot and the engine results, which `rampa check` replays like a web recording, plus the raw dump (`.xml`) and the screenshot (`.png`).

To save a dump yourself, for example on a CI runner, pull it from the device rather than redirecting binary output in a shell:

```sh
adb shell uiautomator dump /sdcard/window.xml && adb pull /sdcard/window.xml login.xml
adb shell screencap -p /sdcard/screen.png && adb pull /sdcard/screen.png login.png
```

An Appium page source from the UiAutomator2 driver (`driver.page_source`, saved as `.xml`) is read the same way. It is the richer source: Appium adds attributes the plain dump lacks, such as `heading` and `a11y-important`.

## How Rampa reads the screen

1. `adb devices`: exactly one device, or the serial you named. Errors say what to do: no device, several devices, a device that has not authorized the computer, or one that is offline.
2. `uiautomator dump --windows` to `/dev/tty`, which adds window titles on Android versions that support it; else the plain dump; else a dump to a file on the device, read back and deleted. UI Automator's own errors are explained, such as a screen that never goes idle because it keeps animating.
3. `screencap -p`, right after the dump, so both show the same state.
4. The language: the app's own language setting (`cmd locale get-app-locales`, Android 13 and later), else the system language (`persist.sys.locale`, then `ro.product.locale`).

Only the app's windows are kept: the status bar, the navigation bar and the keyboard belong to the system. Then each view becomes a node of the [normalized snapshot](../schema/snapshot.schema.json):

| Android class (or attribute) | Role |
| --- | --- |
| `Button`, `MaterialButton` and other `…Button` classes | `button` |
| `ImageButton`, a clickable `ImageView` | `button` or `img`, marked as a control drawn as an image |
| `ImageView`, `android.widget.Image` (a WebView image) | `img` |
| `EditText` | `textbox` |
| `AutoCompleteTextView`, `Spinner` | `combobox` |
| `CheckBox`, a checkable `CheckedTextView` or view | `checkbox` |
| `Switch`, `SwitchCompat`, `ToggleButton` | `switch` |
| `RadioButton`, `RadioGroup` | `radio`, `radiogroup` |
| `SeekBar`, `RatingBar` | `slider` |
| `ProgressBar` | `progressbar` |
| `RecyclerView`, `ListView`, `GridView` and their rows | `list`, `listitem` |
| `TextView` | `text` |
| `WebView` | `document` |
| `heading="true"` (Appium page source) | `heading` |
| anything else | `generic` |

The name is what TalkBack reads: `content-desc`, else the text of a button, checkbox or text view, else a field's hint. A clickable container with no label of its own is named by the text inside it. An empty field reports its hint as its text; Rampa treats that text as the hint, not as something typed. Bounds stay in screen pixels, so the screenshot crops at a scale of 1.

A node's `ref` is its `resource-id` when no other node has the same one; otherwise it is an XPath from the nearest ancestor whose id is unique, with class names as steps: `//*[@resource-id="com.example:id/list"]/android.widget.LinearLayout[2]`. Both are written to work as Appium locators (not tried against an Appium server), and they stay the same between runs of the same screen, so waivers keep working.

## What is checked

Without axe-core, the deterministic layer is a set of rules over the tree and the screenshot. Like axe-core on the web, a violation goes straight to the report; what a rule cannot decide is never reported as a failure.

| What | How | WCAG |
| --- | --- | --- |
| Controls without a name | Rule `control-name`: a clickable, long-clickable or checkable view, or a button-like class, with no text, no `content-desc` and no text inside it. This is UI Automator's own "not accessibility friendly" check; lists and grids that are clickable to pick an item are left out, as UI Automator leaves them. A control named only by another view's `labelFor`, which the dump does not show, would be reported too; that is rare outside text fields, which have their own rule. | 4.1.2 |
| Image buttons without a name | Rule `image-control-name`: the same, for a control whose only content is an image, such as an `ImageButton` | 1.1.1, 4.1.2 |
| Images without a description | Rule `image-name`: listed for a person to decide, never failed. UI Automator cannot tell a missing `contentDescription` from `contentDescription="@null"`, which marks an image as decorative. Appium's `a11y-important="false"` does mark it, and such images are skipped. | 1.1.1 |
| Fields without a name | Rule `field-name`: a field with no `content-desc` and no hint is listed for a person, because a label can still point at it with `labelFor`, which the dump does not show | 4.1.2 |
| Text contrast | Rule `text-contrast`: measured from the screenshot inside each view that draws text. Below 3:1 fails at any text size; between 3:1 and 4.5:1 is enough only for large text, whose size the dump does not give, so it is listed for a person; a view over an image or a gradient, or with strokes too thin to hold their color, is listed as not measurable. Disabled views are exempt, as WCAG says. | 1.4.3 |
| Image descriptions that do not describe | Judgment 1.1.1, with each image cut out of the screenshot. A finding patches `android:contentDescription`, or `android:importantForAccessibility="no"` for a decorative image. | 1.1.1 |
| Labels and headings that do not describe | Judgment 2.4.6: field labels (hint, `content-desc`, a checkbox's text) with the field's `resource-id`; headings only from an Appium page source | 2.4.6 |
| Links that do not say where they go | Judgment 2.4.4, for nodes shown as links, which UI Automator seldom does | 2.4.4 |
| The screen in another language than the app | Judgment 3.1.1: the screen's text against the language the app runs in | 3.1.1 |
| A passage in another language | Judgment 3.1.2, only for snapshots whose exporter recorded a node's language; UI Automator does not | 3.1.2 |

The contrast measurement takes the color that covers most of the box as the background and the most contrasting color shared by enough pixels as the text, after leaving out lines that cross the box, such as a field's underline. Anti-aliasing only blends text toward the background, so this can overstate a ratio, never understate it, as long as some pixels are fully covered by a stroke; boxes whose strokes are under three pixels wide are not measured.

## WCAG2ICT

[WCAG2ICT](https://www.w3.org/TR/wcag2ict-22/) (W3C Group Note, 11 December 2025) explains how WCAG applies to software. Rampa follows it where it changes what a check means:

- **1.1.1, 1.4.3, 2.4.6** apply as written.
- **2.4.4** applies to any control that behaves like a link.
- **3.1.1** becomes the default language of the software. An app that uses the platform's language setting and shows its interface in that language satisfies it, so Rampa reads the screen against the language the app runs in. A screen mostly in another language is read by TalkBack with the wrong voice, unless the app marks the text's language with a `LocaleSpan`, which the dump cannot show; the finding says so.
- **2.4.2 Page Titled** is replaced for software by *Non-web Software Titled*: where the platform has a title property for windows or screens, each one has a title that describes its name, topic or purpose. Rampa does not judge it on app screens. The window title only comes with `uiautomator dump --windows`, and single-activity apps keep it as the app name while their screens change, so judging it would flag every screen of those apps. The title is recorded in the snapshot when the dump has one.
- **2.4.1, 2.4.5, 3.2.3 and 3.2.4** concern sets of software programs, which a single screen cannot show. They stay in the "not checked" list.

## What the dump does not show

UI Automator leaves out much of what TalkBack knows, so these are not checked from a plain dump: headings, `labelFor`, role and state descriptions, the language of a passage, which views are not important for accessibility, custom actions, live regions, traversal order and pane titles. An Appium page source carries some of them (`heading`, `a11y-important`, `pane-title`), and Rampa uses the first two.

## Status

- The parser, the role and name mapping, the rules and the criteria are tested on hand-written dumps in the three shapes (a plain dump, a `--windows` dump and an Appium page source) and on painted screenshots.
- The adb collector is tested with a scripted adb. The error paths were run against the real adb from platform-tools 37.0.1 with no device connected. **No device or emulator was available, so `rampa check android:` has not been run against a real screen yet.**
- `examples/android/login.xml` is a hand-written dump and `login.png` a mock rendered in a browser on its bounds (`scripts/mobile-examples.ts`), not a device capture. On it, `ollama:gemma4:12b` judged the logo's `content-desc="image"` a placeholder and proposed "Shopping bag icon"; the rules failed the unlabeled password toggle and the 2.68:1 "Forgot password?" link, and listed both placeholders at 3.1:1 and 4.1:1 for a person.
- If the screen moves between the dump and the screenshot, crops and contrast describe a different state. Turning off the three animation scales in Developer options keeps runs stable.
