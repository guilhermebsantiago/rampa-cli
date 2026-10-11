// RampaExport.swift: exports the screen an XCUITest is on, for `rampa check`.
//
// Add this file to your UI test target (not the app target). It writes what
// XCUIElementSnapshot reports, plus a screenshot, as JSON; Rampa decides roles and names
// when it reads the file, so the Swift side stays small. See docs/ios.md.
//
// Status: written without a Mac. It has not been compiled or run by the Rampa project.
// It uses public XCUITest API, except two optional reads that are guarded so they cannot
// crash: accessibility traits (headings) and the bundle identifier. The probe helpers
// (captureOrientation, captureTextSize) were added the same way, also without a Mac: they
// use XCUIDevice.orientation, launch arguments and, on iOS 17, performAccessibilityAudit.
// If it does not build with your Xcode, please open an issue with the error.
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
        try attach(data, name: name)
        return data
    }

    /// The export as JSON: the element tree, a screenshot of the whole screen, and the language.
    public static func export(_ app: XCUIApplication, language: String? = nil, bundleIdentifier: String? = nil) throws -> Data {
        var payload = header(app, language: language, bundleIdentifier: bundleIdentifier)
        let current = try state(app)
        payload["root"] = current["root"]
        payload["screenshot"] = current["screenshot"]
        return try serialize(payload)
    }

    // MARK: - Probes (docs/ios.md, "Probes")

    #if os(iOS)
    /// Turns the device with XCUIDevice: upright, sideways (landscapeLeft) and upright again, exporting the screen
    /// each time, then puts back the orientation it found, even when an export fails. Rampa compares the states for
    /// 1.3.4 Orientation: an app whose screen stays upright while the device is sideways restricts its orientation.
    /// The export's own screen is the first, upright one. Attached and written as `<name>.json`, as `capture` does.
    ///
    /// - Parameter settle: seconds to wait after each turn, for the rotation to finish.
    @discardableResult
    public static func captureOrientation(_ app: XCUIApplication, name: String, language: String? = nil, bundleIdentifier: String? = nil, settle: TimeInterval = 1.5) throws -> Data {
        let device = XCUIDevice.shared
        let original = device.orientation
        defer {
            // Face up, face down and unknown cannot be set back: upright is what the test most likely started in.
            device.orientation = original.isPortrait || original.isLandscape ? original : .portrait
        }
        var steps: [[String: Any]] = []
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft, .portrait] {
            device.orientation = orientation
            pause(settle)
            var step = try state(app)
            step["deviceOrientation"] = orientationName(orientation)
            steps.append(step)
        }
        var payload = header(app, language: language, bundleIdentifier: bundleIdentifier)
        payload["root"] = steps.first?["root"]
        payload["screenshot"] = steps.first?["screenshot"]
        let orientation: [String: Any] = ["steps": steps, "original": orientationName(original)]
        payload["probes"] = ["orientation": orientation] as [String: Any]
        let data = try serialize(payload)
        try attach(data, name: name)
        return data
    }

    /// Launches the app at the default Dynamic Type size and again at a larger one, brings it to the screen with
    /// `navigate` each time, and exports both, for 1.4.4 Resize Text. Dynamic Type has no 200% step: the default,
    /// accessibilityLarge (AX2), sets body text to 33 pt, 194% of the default 17 pt. Nothing on the device changes:
    /// the size is a launch argument (-UIPreferredContentSizeCategoryName), so each launch starts the app afresh.
    /// On iOS 17 and later it also runs Apple's accessibility audit for clipped text and Dynamic Type at the larger
    /// size and exports what the audit reports, without failing the test.
    ///
    /// ```swift
    /// try RampaExport.captureTextSize(name: "sign-in-text", launch: {
    ///     let app = XCUIApplication()
    ///     app.launchArguments += ["-AppleLanguages", "(en)"]
    ///     return app
    /// }, navigate: { app in
    ///     app.buttons["Sign in"].tap()
    /// })
    /// ```
    @discardableResult
    public static func captureTextSize(
        name: String,
        size: UIContentSizeCategory = .accessibilityLarge,
        language: String? = nil,
        bundleIdentifier: String? = nil,
        launch: (() -> XCUIApplication)? = nil,
        navigate: ((XCUIApplication) throws -> Void)? = nil
    ) throws -> Data {
        var steps: [[String: Any]] = []
        var payload: [String: Any] = [:]
        for category in [UIContentSizeCategory.large, size] {
            let app = launch?() ?? XCUIApplication()
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", category.rawValue]
            app.launch()
            try navigate?(app)
            var step = try state(app)
            step["contentSize"] = category.rawValue
            if category == size {
                let audit = textAudit(app)
                step["audit"] = audit.issues
                if let error = audit.error { step["auditError"] = error }
            } else {
                payload = header(app, language: language, bundleIdentifier: bundleIdentifier)
            }
            steps.append(step)
        }
        payload["root"] = steps.first?["root"]
        payload["screenshot"] = steps.first?["screenshot"]
        let textSize: [String: Any] = ["steps": steps]
        payload["probes"] = ["textSize": textSize] as [String: Any]
        let data = try serialize(payload)
        try attach(data, name: name)
        return data
    }

    private static func orientationName(_ orientation: UIDeviceOrientation) -> String {
        switch orientation {
        case .portrait: return "portrait"
        case .portraitUpsideDown: return "portraitUpsideDown"
        case .landscapeLeft: return "landscapeLeft"
        case .landscapeRight: return "landscapeRight"
        case .faceUp: return "faceUp"
        case .faceDown: return "faceDown"
        default: return "unknown"
        }
    }

    /// Apple's accessibility audit for clipped text and Dynamic Type (iOS 17, Xcode 15): every issue is kept for the
    /// export and marked handled, so the test does not fail on it.
    private static func textAudit(_ app: XCUIApplication) -> (issues: [[String: Any]], error: String?) {
        #if compiler(>=5.9)
        if #available(iOS 17.0, *) {
            var issues: [[String: Any]] = []
            do {
                try app.performAccessibilityAudit(for: [.textClipped, .dynamicType]) { issue in
                    var entry: [String: Any] = ["type": Self.auditName(issue.auditType), "description": issue.compactDescription]
                    if let element = issue.element, element.exists {
                        let named: [String: Any] = [
                            "type": Self.typeName(element.elementType),
                            "identifier": element.identifier,
                            "label": element.label,
                            "frame": Self.frameValue(element.frame),
                        ]
                        entry["element"] = named
                    }
                    issues.append(entry)
                    return true
                }
                return (issues, nil)
            } catch {
                return (issues, String(describing: error))
            }
        }
        #endif
        return ([], "Apple's accessibility audit needs iOS 17 and Xcode 15.")
    }

    #if compiler(>=5.9)
    @available(iOS 17.0, *)
    private static func auditName(_ type: XCUIAccessibilityAuditType) -> String {
        if type.contains(.textClipped) { return "textClipped" }
        if type.contains(.dynamicType) { return "dynamicType" }
        return "other"
    }
    #endif
    #endif

    /// Waits without blocking the test's run loop: rotations and launches finish their animations meanwhile.
    private static func pause(_ seconds: TimeInterval) {
        guard seconds > 0 else { return }
        _ = XCTWaiter.wait(for: [XCTestExpectation(description: "Rampa: let the screen settle")], timeout: seconds)
    }

    // MARK: - Writing the export

    /// What every export starts with: the format, the device, the app and its language.
    private static func header(_ app: XCUIApplication, language: String?, bundleIdentifier: String?) -> [String: Any] {
        var payload: [String: Any] = [
            "format": format,
            "version": version,
            "exportedAt": ISO8601DateFormatter().string(from: Date()),
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
        return payload
    }

    /// The screen as it is now: the element tree and a screenshot of the whole screen.
    private static func state(_ app: XCUIApplication) throws -> [String: Any] {
        let snapshot = try app.snapshot()
        return [
            "root": element(snapshot),
            "screenshot": XCUIScreen.main.screenshot().pngRepresentation.base64EncodedString(),
            "exportedAt": ISO8601DateFormatter().string(from: Date()),
        ]
    }

    private static func serialize(_ payload: [String: Any]) throws -> Data {
        guard JSONSerialization.isValidJSONObject(payload) else {
            throw Failure(description: "RampaExport built an export that is not valid JSON.")
        }
        return try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    }

    /// Attaches the export to the test result, kept even when the test passes, and writes it to RAMPA_EXPORT_DIR.
    private static func attach(_ data: Data, name: String) throws {
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
    }

    // MARK: - The element tree

    private static func element(_ snapshot: any XCUIElementSnapshot) -> [String: Any] {
        var out: [String: Any] = [
            "type": typeName(snapshot.elementType),
            "typeRaw": Int(snapshot.elementType.rawValue),
            "identifier": snapshot.identifier,
            "label": snapshot.label,
            "title": snapshot.title,
            "frame": frameValue(snapshot.frame),
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

    /// A frame as JSON. Elements far off screen can report infinite frames; JSON has no infinity.
    private static func frameValue(_ frame: CGRect) -> [String: Double] {
        [
            "x": finite(frame.origin.x),
            "y": finite(frame.origin.y),
            "width": finite(frame.size.width),
            "height": finite(frame.size.height),
        ]
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
