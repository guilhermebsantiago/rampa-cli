// RampaExport.swift: exports the screen an XCUITest is on, for `rampa check`.
//
// Add this file to your UI test target (not the app target). It writes what
// XCUIElementSnapshot reports, plus a screenshot, as JSON; Rampa decides roles and names
// when it reads the file, so the Swift side stays small. See docs/ios.md.
//
// Status: written without a Mac. It has not been compiled or run by the Rampa project.
// It uses public XCUITest API, except two optional reads that are guarded so they cannot
// crash: accessibility traits (headings) and the bundle identifier. If it does not build
// with your Xcode, please open an issue with the error.
//
// MIT License, part of Rampa: https://github.com/guilhermebsantiago/rampa-cli

import XCTest
#if canImport(UIKit)
import UIKit
#endif

/// Exports the current screen of an app under test as a Rampa XCUITest export.
///
/// ```swift
/// func testLoginScreenForRampa() throws {
///     let app = XCUIApplication()
///     app.launchArguments += ["-AppleLanguages", "(pt-BR)", "-AppleLocale", "pt_BR"]
///     app.launch()
///     try RampaExport.capture(app, name: "login")
/// }
/// ```
@MainActor
public enum RampaExport {
    public static let format = "rampa-xcuitest"
    public static let version = 1

    public struct Failure: Error, CustomStringConvertible {
        public let description: String
    }

    /// Captures the screen and attaches the JSON to the test result, kept even when the test
    /// passes. When the test runner has RAMPA_EXPORT_DIR in its environment (run xcodebuild
    /// with TEST_RUNNER_RAMPA_EXPORT_DIR=/path), it also writes `<name>.json` there; that works
    /// in the Simulator, whose processes can write to the Mac's disk, not on a device.
    ///
    /// - Parameters:
    ///   - language: the language the app is running in, such as "pt-BR". Without it, the
    ///     helper reads -AppleLanguages from the launch arguments; if neither is there, Rampa
    ///     does not check the screen language (3.1.1), because iOS picks the app's language
    ///     among its localizations and the device language alone does not say which one ran.
    ///   - bundleIdentifier: the app's bundle id, when the helper cannot read it.
    @discardableResult
    public static func capture(_ app: XCUIApplication, name: String, language: String? = nil, bundleIdentifier: String? = nil) throws -> Data {
        let data = try export(app, language: language, bundleIdentifier: bundleIdentifier)
        let fileName = name.replacingOccurrences(of: "/", with: "-")
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "\(fileName).json"
        attachment.lifetime = .keepAlways
        XCTContext.runActivity(named: "Rampa export: \(fileName)") { activity in
            activity.add(attachment)
        }
        if let directory = ProcessInfo.processInfo.environment["RAMPA_EXPORT_DIR"], !directory.isEmpty {
            let folder = URL(fileURLWithPath: directory, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: folder.appendingPathComponent("\(fileName).json"))
        }
        return data
    }

    /// The export as JSON: the element tree, a screenshot of the whole screen, and the language.
    public static func export(_ app: XCUIApplication, language: String? = nil, bundleIdentifier: String? = nil) throws -> Data {
        let snapshot = try app.snapshot()
        let screenshot = XCUIScreen.main.screenshot().pngRepresentation
        var payload: [String: Any] = [
            "format": format,
            "version": version,
            "exportedAt": ISO8601DateFormatter().string(from: Date()),
            "root": element(snapshot),
            "screenshot": screenshot.base64EncodedString(),
            "device": device(),
        ]
        if let bundle = bundleIdentifier ?? privateString(app, keys: ["bundleID", "bundleIdentifier"]) {
            payload["bundleIdentifier"] = bundle
        }
        if let language {
            payload["language"] = language
            payload["languageSource"] = "explicit"
        } else if let launched = appleLanguage(app.launchArguments) {
            payload["language"] = launched
            payload["languageSource"] = "launch-arguments"
        }
        if let preferred = Locale.preferredLanguages.first {
            payload["deviceLanguage"] = preferred
        }
        guard JSONSerialization.isValidJSONObject(payload) else {
            throw Failure(description: "RampaExport built an export that is not valid JSON.")
        }
        return try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    }

    // MARK: - The element tree

    private static func element(_ snapshot: any XCUIElementSnapshot) -> [String: Any] {
        let frame = snapshot.frame
        var out: [String: Any] = [
            "type": typeName(snapshot.elementType),
            "typeRaw": Int(snapshot.elementType.rawValue),
            "identifier": snapshot.identifier,
            "label": snapshot.label,
            "title": snapshot.title,
            // Elements far off screen can report infinite frames; JSON has no infinity.
            "frame": [
                "x": finite(frame.origin.x),
                "y": finite(frame.origin.y),
                "width": finite(frame.size.width),
                "height": finite(frame.size.height),
            ],
            "enabled": snapshot.isEnabled,
            "selected": snapshot.isSelected,
            "children": snapshot.children.map { element($0) },
        ]
        if let value = stringValue(snapshot.value) {
            out["value"] = value
        }
        if let placeholder = snapshot.placeholderValue {
            out["placeholderValue"] = placeholder
        }
        if let focused = privateBool(snapshot, key: "hasFocus") {
            out["hasFocus"] = focused
        }
        if let traits = traitNames(snapshot) {
            out["traits"] = traits
        }
        return out
    }

    /// XCUIElement.ElementType raw values in order (0 is any, 9 is button, 48 is staticText).
    /// Indexing by raw value keeps this file building when Xcode adds or renames cases.
    private static let typeNames = [
        "any", "other", "application", "group", "window", "sheet", "drawer", "alert", "dialog", "button",
        "radioButton", "radioGroup", "checkBox", "disclosureTriangle", "popUpButton", "comboBox", "menuButton", "toolbarButton", "popover", "keyboard",
        "key", "navigationBar", "tabBar", "tabGroup", "toolbar", "statusBar", "table", "tableRow", "tableColumn", "outline",
        "outlineRow", "browser", "collectionView", "slider", "pageIndicator", "progressIndicator", "activityIndicator", "segmentedControl", "picker", "pickerWheel",
        "switch", "toggle", "link", "image", "icon", "searchField", "scrollView", "scrollBar", "staticText", "textField",
        "secureTextField", "datePicker", "textView", "menu", "menuItem", "menuBar", "menuBarItem", "map", "webView", "incrementArrow",
        "decrementArrow", "timeline", "ratingIndicator", "valueIndicator", "splitGroup", "splitter", "relevanceIndicator", "colorWell", "helpTag", "matte",
        "dockItem", "ruler", "rulerMarker", "grid", "levelIndicator", "cell", "layoutArea", "layoutItem", "handle", "stepper",
        "tab", "touchBar", "statusItem",
    ]

    private static func typeName(_ type: XCUIElement.ElementType) -> String {
        let raw = Int(type.rawValue)
        return raw < typeNames.count ? typeNames[raw] : "other"
    }

    private static func stringValue(_ value: Any?) -> String? {
        guard let value else { return nil }
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return String(describing: value)
    }

    private static func finite(_ value: CGFloat) -> Double {
        let number = Double(value)
        return number.isFinite ? number : 0
    }

    /// Accessibility traits are not public on XCUIElementSnapshot. The snapshot object answers
    /// `traits` in current Xcode versions; when it does not, the export simply has no traits
    /// and Rampa reports that headings could not be found.
    private static func traitNames(_ snapshot: any XCUIElementSnapshot) -> [String]? {
        #if canImport(UIKit)
        guard let object = snapshot as? NSObject,
              object.responds(to: NSSelectorFromString("traits")),
              let number = object.value(forKey: "traits") as? NSNumber
        else { return nil }
        let traits = UIAccessibilityTraits(rawValue: number.uint64Value)
        let known: [(UIAccessibilityTraits, String)] = [
            (.button, "button"), (.link, "link"), (.image, "image"), (.selected, "selected"),
            (.header, "header"), (.staticText, "staticText"), (.notEnabled, "notEnabled"),
            (.adjustable, "adjustable"), (.searchField, "searchField"), (.tabBar, "tabBar"),
            (.keyboardKey, "keyboardKey"), (.summaryElement, "summaryElement"),
            (.updatesFrequently, "updatesFrequently"), (.playsSound, "playsSound"),
            (.startsMediaSession, "startsMediaSession"), (.allowsDirectInteraction, "allowsDirectInteraction"),
            (.causesPageTurn, "causesPageTurn"),
        ]
        return known.filter { traits.contains($0.0) }.map { $0.1 }
        #else
        return nil
        #endif
    }

    private static func privateBool(_ snapshot: any XCUIElementSnapshot, key: String) -> Bool? {
        guard let object = snapshot as? NSObject, object.responds(to: NSSelectorFromString(key)) else { return nil }
        return (object.value(forKey: key) as? NSNumber)?.boolValue
    }

    private static func privateString(_ object: NSObject, keys: [String]) -> String? {
        for key in keys where object.responds(to: NSSelectorFromString(key)) {
            if let value = object.value(forKey: key) as? String, !value.isEmpty { return value }
        }
        return nil
    }

    /// The first language in `-AppleLanguages (pt-BR, en)` among the launch arguments.
    private static func appleLanguage(_ arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: "-AppleLanguages"), index + 1 < arguments.count else { return nil }
        let list = arguments[index + 1].trimmingCharacters(in: CharacterSet(charactersIn: "() "))
        guard let first = list.split(separator: ",").first else { return nil }
        let language = first.trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
        return language.isEmpty ? nil : language
    }

    private static func device() -> [String: Any] {
        #if canImport(UIKit)
        let current = UIDevice.current
        return ["model": current.model, "systemName": current.systemName, "systemVersion": current.systemVersion]
        #else
        return ["systemVersion": ProcessInfo.processInfo.operatingSystemVersionString]
        #endif
    }
}
