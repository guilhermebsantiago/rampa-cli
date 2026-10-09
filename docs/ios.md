# iOS screens

Reading an iOS screen needs a Mac with Xcode, and Rampa runs anywhere, so iOS works in two steps: a UI test exports the screen it is on, and `rampa check` reads the export on any machine.

```
XCUITest on a Mac  ──  RampaExport.capture(app, name: "login")  ──>  login.json  ──>  rampa check login.json
```

> [!WARNING]
> [`integrations/ios/RampaExport.swift`](../integrations/ios/RampaExport.swift) was written without a Mac. **It has not been compiled or run.** It uses public XCUITest API apart from two optional reads that are guarded so they cannot crash. If it does not build with your Xcode, please open an issue with the error. The importer on the Rampa side is tested on hand-written exports that mirror what XCUITest reports.

## Setup

1. Copy `integrations/ios/RampaExport.swift` into your **UI test** target (not the app target).
2. In a UI test, bring the app to the screen you want checked and call `RampaExport.capture`:

```swift
import XCTest

final class RampaScreens: XCTestCase {
    @MainActor
    func testSignIn() throws {
        let app = XCUIApplication()
        // The language the app runs in, so Rampa can check the language of the screen (3.1.1).
        app.launchArguments += ["-AppleLanguages", "(pt-BR)", "-AppleLocale", "pt_BR"]
        app.launch()
        app.buttons["Sign in"].tap()
        try RampaExport.capture(app, name: "sign-in")
    }
}
```

`capture` takes a snapshot of the whole app (`XCUIApplication().snapshot()`), a screenshot of the screen (`XCUIScreen.main.screenshot()`), and the language: the `language:` argument if you pass one, else `-AppleLanguages` from the launch arguments. It attaches `sign-in.json` to the test result, kept even when the test passes.

3. Get the JSON out:

- **Simulator.** Pass a folder through xcodebuild, which hands `TEST_RUNNER_`-prefixed variables to the test runner without the prefix. The Simulator writes to the Mac's disk:

```sh
TEST_RUNNER_RAMPA_EXPORT_DIR="$PWD/rampa" xcodebuild test \
  -scheme Shop -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:ShopUITests/RampaScreens
```

- **Device or CI.** Export the attachments from the result bundle. On Xcode 16 and later, `xcrun xcresulttool export attachments --path Test.xcresult --output-path rampa/` does it (check `--help` for your version); or open the result in Xcode and save the attachment.

4. Check it, on any machine:

```sh
rampa check rampa/sign-in.json --model ollama:gemma4:12b
rampa check rampa/sign-in.json --save recordings        # also record the snapshot, its rules results and the screenshot
rampa check examples/ios/login.json --no-llm             # the example in this repository
```

## The export

A JSON file with `"format": "rampa-xcuitest"` and `"version": 1`. The helper writes what `XCUIElementSnapshot` reports and leaves the meaning to Rampa, so the Swift side stays small and the mapping can be tested:

| Field | From |
| --- | --- |
| `bundleIdentifier` | the `bundleIdentifier:` argument, else XCUIApplication's private `bundleID` when it answers |
| `language`, `languageSource` | the `language:` argument (`explicit`) or `-AppleLanguages` (`launch-arguments`) |
| `deviceLanguage` | `Locale.preferredLanguages.first` |
| `device` | `UIDevice` model, system name and version |
| `screenshot` | the screen as PNG, base64 |
| `root` | the element tree |

Each element has `type` (the `XCUIElement.ElementType` name, such as `staticText`), `typeRaw` (its raw value), `identifier`, `label`, `title`, `value`, `placeholderValue`, `frame` in points, `enabled`, `selected`, `hasFocus`, `traits` and `children`. Any tool can write this shape, for example from Appium's XCUITest page source; `rampa check` recognizes it by its `format`.

Two fields come from outside the public API, read only when the snapshot object answers them, so a future Xcode can drop them without breaking the export:

- `traits`, the element's accessibility traits. Without them Rampa cannot find headings, and says so in the report.
- `hasFocus`, documented only for tvOS in older SDKs.

## How Rampa reads the export

- **Roles.** `button` and the other button types become `button`; `link` a link; `image` and `icon` `img`; `staticText` `text`; `textField`, `secureTextField` and `textView` `textbox`; `searchField` `searchbox`; `switch` and `toggle` `switch`; `checkBox` `checkbox`; `slider` and `pageIndicator` `slider`; `stepper` and `pickerWheel` `spinbutton`; `navigationBar` `navigation`; `tabBar` `tablist`; `table` and `collectionView` `list`, with `cell` as `listitem`; `alert` `alertdialog`; `sheet` and `popover` `dialog`; `webView` `document`. The header trait makes any element a heading.
- **Names.** `accessibilityLabel` is the name and the text alternative. A field without one is named by its placeholder, which VoiceOver reads. On static texts and links the label is the visible text, so a fix changes the text and both stay the same.
- **Left out.** The keyboard and the status bar belong to the system. Elements scrolled off the screen are kept but marked, and are not cropped or measured.
- **Frames** stay in points. The screenshot's scale is its width in pixels over the app's width in points, snapped to 2 or 3.
- **Language.** iOS picks the language an app runs in among the app's own localizations, so the device language alone does not say which one ran. Rampa checks the language of the screen (3.1.1) only when the export states the app's language; the device language is used only to write suggestions in.
- **Refs.** The `accessibilityIdentifier` when it is unique, else an Appium-style XPath from the nearest element with a unique one: `//*[@name="form"]/XCUIElementTypeStaticText[2]`.

## What is checked

The same rules and criteria as [Android](android.md#what-is-checked), with two differences. A text field with neither an `accessibilityLabel` nor a placeholder fails `field-name` (4.1.2): on iOS nothing else can name it. And headings exist only when the export has traits. Patches show the property to change: `accessibilityLabel = "…"`, `placeholder = "…"`, `text = "…"`, `isAccessibilityElement = false` for a decorative image, `accessibilityLanguage = "…"` for a passage.

Contrast is measured only on what certainly draws text (static texts, links, a field's value or placeholder), never on a button, whose label may name an icon.

## WCAG2ICT

The notes in [docs/android.md](android.md#wcag2ict) apply. On iOS, the title in the snapshot is the navigation bar's (its identifier, which UIKit and SwiftUI set to the title), recorded but not judged.

## Status

- The importer, the rules and the criteria are tested on exports written by hand to mirror real XCUITest trees: a window, nested `other` containers, a navigation bar, header traits, a placeholder-only field, an unlabeled button and the keyboard.
- **The Swift helper has not been compiled or run.** It is `@MainActor`, like the XCUITest API it calls, so call it from a test marked `@MainActor`, as in the example.
- `examples/ios/login.json` is hand-written, with a screenshot rendered in a browser at 3x on its frames (`scripts/mobile-examples.ts`). On it, `ollama:gemma4:12b` judged the logo label "image" a placeholder and the field label "Field 1" generic (it proposed "Promo code"), passed the link, the navigation title and the language, and also flagged the heading "Welcome back" as not describing its section, which is debatable. The rules failed the unlabeled password toggle and the default placeholder gray at 1.74:1, and listed the secondary text at 3.26:1 and system blue at 4.02:1 for a person.
- Untested: landscape, iPad split view (the app's frame is not the screen), and Display P3 screenshots, whose colors are read as sRGB.
