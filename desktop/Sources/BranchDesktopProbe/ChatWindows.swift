import AppKit
import ApplicationServices

/// Keeps Accessibility objects off the main actor and inside this sampler.
actor ChatWindows {
    enum Read: Sendable {
        case sample(WindowSample)
        case incomplete
        case windowChanged
        case permissionLost
    }

    private struct Window {
        let app: AXUIElement
        let element: AXUIElement
        let title: String
    }

    private var choices: [Window] = []
    private var selected: Window?
    private var chatPath: String?

    /// Lists only windows belonging to the installed ChatGPT desktop apps.
    func list() -> [String] {
        guard AXIsProcessTrusted() else { return [] }
        let bundleIDs = ["com.openai.codex", "com.openai.chat"]
        choices = bundleIDs.flatMap { bundleID in
            NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).flatMap { application in
                let app = AXUIElementCreateApplication(application.processIdentifier)
                AXUIElementSetMessagingTimeout(app, 0.15)
                return windows(of: app).map { element in
                    Window(app: app, element: element, title: title(of: element))
                }
            }
        }
        return choices.enumerated().map { index, window in
            "\(index + 1). \(window.title.isEmpty ? "ChatGPT window" : window.title)"
        }
    }

    /// Pins reads to the specific Accessibility window chosen by the user.
    func select(_ index: Int) -> Bool {
        guard choices.indices.contains(index) else { return false }
        selected = choices[index]
        chatPath = nil
        return true
    }

    /// Searches one window for synthetic markers and returns no raw Accessibility text.
    func sample(matching prompts: ProbePrompts) -> Read {
        guard AXIsProcessTrusted() else { return .permissionLost }
        guard let selected, isSameWindow(selected) else { return .windowChanged }

        let clock = ContinuousClock()
        let deadline = clock.now + .milliseconds(900)
        var pending = [selected.element]
        var visited = Set<AXUIElement>()
        var signals = WindowSample()
        var observedPath: String?

        while let element = pending.popLast() {
            guard !Task.isCancelled, clock.now < deadline, visited.count < 2400 else { return .incomplete }
            guard visited.insert(element).inserted else { continue }
            let keys = [kAXRoleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute,
                        kAXIdentifierAttribute, kAXHelpAttribute, kAXChildrenAttribute]
            var raw: CFArray?
            let error = AXUIElementCopyMultipleAttributeValues(element, keys as CFArray, [], &raw)
            if error == .cannotComplete { return .incomplete }
            guard error == .success, let attributes = raw as? [Any], attributes.count == keys.count else { continue }

            let role = attributes[0] as? String ?? ""
            let words = attributes[1...5].compactMap { $0 as? String }
            for value in words {
                signals.baseline = signals.baseline || value.contains(prompts.baseline)
                signals.firstLine = signals.firstLine || value.contains(prompts.firstLine)
                signals.lastLine = signals.lastLine || value.contains(prompts.lastLine)
            }
            if role == kAXButtonRole {
                signals.stopControl = signals.stopControl || words.contains(where: Self.isStopControl)
            }
            if role == kAXWindowRole || role == "AXWebArea" {
                for key in [kAXURLAttribute, kAXDocumentAttribute] {
                    guard let path = conversationPath(from: attribute(key, of: element)) else { continue }
                    if let observedPath, observedPath != path { return .windowChanged }
                    observedPath = path
                }
            }
            if let children = attributes[6] as? [AXUIElement] {
                pending.append(contentsOf: children.reversed())
            }
        }

        guard isSameWindow(selected) else { return .windowChanged }
        if let chatPath {
            guard let observedPath else { return .incomplete }
            guard observedPath == chatPath else { return .windowChanged }
        }
        chatPath = observedPath
        signals.chatURL = observedPath != nil
        return .sample(signals)
    }

    private static func isStopControl(_ label: String) -> Bool {
        switch label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "stop generating", "stop streaming", "stop response", "stop generating response",
             "stop responding", "stop answering", "stop-button", "stop-generating": true
        default: false
        }
    }

    private func isSameWindow(_ window: Window) -> Bool {
        windows(of: window.app).contains(window.element) && title(of: window.element) == window.title
    }

    private func windows(of app: AXUIElement) -> [AXUIElement] {
        attribute(kAXWindowsAttribute, of: app) as? [AXUIElement] ?? []
    }

    private func title(of window: AXUIElement) -> String {
        attribute(kAXTitleAttribute, of: window) as? String ?? ""
    }

    private func attribute(_ name: String, of element: AXUIElement) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }

    private func conversationPath(from value: CFTypeRef?) -> String? {
        let url = (value as? URL) ?? (value as? String).flatMap { URL(string: $0) }
        guard let url, url.scheme == "https", url.host == "chatgpt.com" else { return nil }
        let parts = url.path.split(separator: "/")
        guard let index = parts.firstIndex(of: "c"), parts.count == index + 2,
              let id = UUID(uuidString: String(parts[index + 1])) else { return nil }
        return id.uuidString
    }
}
