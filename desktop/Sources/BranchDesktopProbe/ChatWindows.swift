import AppKit
import ApplicationServices
import CryptoKit

/// Uses a conversation URL when available, or pins an existing reply in the selected window.
struct ChatConnectionIdentity {
    private let chatID: String?
    private let replyElement: AXUIElement
    private let replyDigest: SHA256Digest
    let pairingID: String

    init(chatID: String?, element: AXUIElement, reply: String) {
        self.chatID = chatID
        replyElement = element
        replyDigest = SHA256.hash(data: Data(reply.utf8))
        pairingID = chatID ?? "window:" + UUID().uuidString
    }

    func matches(chatID: String?, replies: [ChatTranscript.CompletedReply], elements: [AXUIElement]) -> Bool {
        if let expected = self.chatID { return chatID == expected }
        return replies.contains { reply in
            elements[reply.containerIndex] == replyElement
                && SHA256.hash(data: Data(reply.text.utf8)) == replyDigest
        }
    }
}

/// Keeps Accessibility objects off the main actor and inside this sampler.
actor ChatWindows {
    enum Read: Sendable {
        case sample(WindowSample)
        case incomplete
        case windowChanged
        case permissionLost
    }

    enum SyncRead: Sendable {
        case transcript(ChatTranscript, pairingID: String?)
        case incomplete, windowChanged, permissionLost
    }

    private struct Frame {
        let elements: [ChatElement]
        let handles: [AXUIElement]
        let chatID: String?
        let title: String
        let isGenerating: Bool
    }

    private enum WindowRead {
        case frame(Frame)
        case incomplete, windowChanged, permissionLost
    }

    private enum WindowCheck {
        case current, unavailable, changed
    }

    private struct Window {
        let app: AXUIElement
        let element: AXUIElement
        let title: String
    }

    private var choices: [Window] = []
    private var selected: Window?
    private var chatPath: String?
    private var connectionIdentity: ChatConnectionIdentity?

    struct Choice: Sendable {
        let title: String
        let label: String
    }

    /// Lists only windows belonging to the installed ChatGPT desktop apps.
    func list() -> [Choice] {
        guard AXIsProcessTrusted() else { return [] }
        let bundleIDs = ["com.openai.codex", "com.openai.chat"]
        choices = []
        for bundleID in bundleIDs {
            for application in NSRunningApplication.runningApplications(withBundleIdentifier: bundleID) {
                let app = AXUIElementCreateApplication(application.processIdentifier)
                AXUIElementSetMessagingTimeout(app, 0.15)
                for element in windows(of: app) {
                    let name = title(of: element)
                    guard Self.isConversationWindow(name) else { continue }
                    choices.append(Window(app: app, element: element, title: name))
                }
            }
        }
        return choices.enumerated().map { index, window in
            Choice(title: window.title, label: "\(index + 1). \(window.title.isEmpty ? "ChatGPT window" : window.title)")
        }
    }

    nonisolated static func isConversationWindow(_ title: String) -> Bool {
        !["computer use", "computer use controls"].contains(title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    /// Pins reads to the specific Accessibility window chosen by the user.
    func select(_ index: Int) -> Bool {
        guard choices.indices.contains(index) else { return false }
        selected = choices[index]
        chatPath = nil
        connectionIdentity = nil
        return true
    }

    /// Searches one window for synthetic markers and returns no raw Accessibility text.
    func sample(matching prompts: ProbePrompts) -> Read {
        switch readWindow() {
        case .incomplete: return .incomplete
        case .windowChanged: return .windowChanged
        case .permissionLost: return .permissionLost
        case .frame(let frame):
            var signals = WindowSample(stopControl: frame.isGenerating, chatURL: frame.chatID != nil)
            signals.recognizedBaseline = ChatTranscript.completedReplies(in: frame.elements).contains { $0.text == prompts.baseline }
            for element in frame.elements {
                for value in [element.text] + element.labels {
                    signals.baseline = signals.baseline || value.contains(prompts.baseline)
                    signals.firstLine = signals.firstLine || value.contains(prompts.firstLine)
                    signals.lastLine = signals.lastLine || value.contains(prompts.lastLine)
                }
            }
            return .sample(signals)
        }
    }

    /// Pins the selected chat before opening board approval and checks that identity before every capture.
    func syncSample(beginPairing: Bool = false) -> SyncRead {
        switch readWindow() {
        case .incomplete: return .incomplete
        case .windowChanged: return .windowChanged
        case .permissionLost: return .permissionLost
        case .frame(let frame):
            let replies = ChatTranscript.completedReplies(in: frame.elements)
            if beginPairing, connectionIdentity == nil, let first = replies.first {
                connectionIdentity = ChatConnectionIdentity(chatID: frame.chatID,
                    element: frame.handles[first.containerIndex], reply: first.text)
            }
            if let connectionIdentity, !connectionIdentity.matches(chatID: frame.chatID, replies: replies, elements: frame.handles) {
                return .windowChanged
            }
            let transcript = ChatTranscript(title: frame.title, isGenerating: frame.isGenerating, replies: replies.map(\.text))
            return .transcript(transcript, pairingID: connectionIdentity?.pairingID)
        }
    }

    private func readWindow() -> WindowRead {
        guard AXIsProcessTrusted() else { return .permissionLost }
        guard let selected else { return .windowChanged }
        switch checkWindow(selected) {
        case .current: break
        case .unavailable: return .incomplete
        case .changed: return .windowChanged
        }

        let clock = ContinuousClock()
        let deadline = clock.now + .milliseconds(900)
        var pending: [(AXUIElement, Int?)] = [(selected.element, nil)]
        var visited = Set<AXUIElement>()
        var elements: [ChatElement] = []
        var handles: [AXUIElement] = []
        var isGenerating = false
        var observedPath: String?
        var pathSource: (element: AXUIElement, key: String)?

        while let (element, parent) = pending.popLast() {
            guard !Task.isCancelled, clock.now < deadline, visited.count < 2400 else { return .incomplete }
            guard visited.insert(element).inserted else { continue }
            let keys = [kAXRoleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute,
                        kAXIdentifierAttribute, kAXHelpAttribute, "AXDOMIdentifier", kAXChildrenAttribute]
            var raw: CFArray?
            let error = AXUIElementCopyMultipleAttributeValues(element, keys as CFArray, [], &raw)
            guard error == .success, let attributes = raw as? [Any], attributes.count == keys.count else { return .incomplete }

            let role = attributes[0] as? String ?? ""
            let text = [attributes[3], attributes[1], attributes[2]].compactMap { $0 as? String }
                .first { !$0.isEmpty } ?? ""
            let labels = [attributes[1], attributes[2], attributes[4], attributes[5], attributes[6]]
                .compactMap { $0 as? String }
            let index = elements.count
            elements.append(ChatElement(role: role, labels: labels, text: text, parent: parent))
            handles.append(element)
            if role == kAXButtonRole {
                isGenerating = isGenerating || (labels + [text]).contains(where: Self.isStopControl)
            }
            if role == kAXWindowRole || role == "AXWebArea" {
                for key in [kAXURLAttribute, kAXDocumentAttribute] {
                    guard let path = conversationPath(from: attribute(key, of: element)) else { continue }
                    if let observedPath, observedPath != path { return .incomplete }
                    observedPath = path
                    pathSource = (element, key)
                }
            }
            if let children = attributes[7] as? [AXUIElement] {
                pending.append(contentsOf: children.reversed().map { ($0, index) })
            }
        }

        switch checkWindow(selected) {
        case .current: break
        case .unavailable: return .incomplete
        case .changed: return .windowChanged
        }
        if let pathSource, conversationPath(from: attribute(pathSource.key, of: pathSource.element)) != observedPath {
            return .incomplete
        }
        if let chatPath {
            guard let observedPath else { return .incomplete }
            guard observedPath == chatPath else { return .windowChanged }
        }
        chatPath = observedPath
        return .frame(Frame(elements: elements, handles: handles, chatID: observedPath, title: selected.title, isGenerating: isGenerating))
    }

    private static func isStopControl(_ label: String) -> Bool {
        switch label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "stop generating", "stop streaming", "stop response", "stop generating response",
             "stop responding", "stop answering", "stop-button", "stop-generating": true
        default: false
        }
    }

    private func checkWindow(_ window: Window) -> WindowCheck {
        var rawWindows: CFTypeRef?
        let windowResult = AXUIElementCopyAttributeValue(window.app, kAXWindowsAttribute as CFString, &rawWindows)
        if windowResult == .invalidUIElement { return .changed }
        guard windowResult == .success, let windows = rawWindows as? [AXUIElement] else { return .unavailable }
        guard windows.contains(window.element) else { return .changed }

        var rawTitle: CFTypeRef?
        let titleResult = AXUIElementCopyAttributeValue(window.element, kAXTitleAttribute as CFString, &rawTitle)
        if titleResult == .invalidUIElement { return .changed }
        if titleResult == .noValue, window.title.isEmpty { return .current }
        guard titleResult == .success, let title = rawTitle as? String else { return .unavailable }
        if title.isEmpty, !window.title.isEmpty { return .unavailable }
        return title == window.title ? .current : .changed
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
