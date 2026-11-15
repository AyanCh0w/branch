import Foundation
import CryptoKit

/// One element from the selected Accessibility window, in document order.
struct ChatElement: Sendable {
    let role: String
    var labels: [String] = []
    var text = ""
    var parent: Int? = nil

    private func hasLabel(_ options: Set<String>) -> Bool {
        let candidates = role == "AXHeading" ? labels + [text] : labels
        return candidates.contains { options.contains($0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) }
    }

    var isAssistantLabel: Bool {
        role != "AXButton" && hasLabel(["chatgpt said:", "chatgpt said", "assistant response", "assistant message", "assistant-message"])
    }

    var isUserLabel: Bool {
        hasLabel(["you said:", "you said", "user message", "user-message"])
    }

    var isResponseAction: Bool {
        role == "AXButton" && hasLabel(["copy response", "copy-turn-action-button", "good response", "bad response",
                                        "good-response-turn-action-button"])
    }

    var isInterrupted: Bool {
        hasLabel(["continue generating", "response stopped", "you stopped this response"])
            || ["response stopped", "you stopped this response"].contains(text.lowercased())
    }

    var isBodyText: Bool {
        ["AXStaticText", "AXHeading"].contains(role) && !isAssistantLabel && !isUserLabel && !text.isEmpty
    }
}

/// Reads only text owned by a recognized assistant turn with its own response actions.
struct ChatTranscript: Sendable {
    let conversationID: String?
    let title: String
    let isGenerating: Bool
    let replies: [String]

    static func completedReplies(in elements: [ChatElement]) -> [String] {
        var seen = Set<Int>()
        var replies: [String] = []
        for index in elements.indices where elements[index].isAssistantLabel {
            var enclosing: Int? = index
            for _ in 0..<7 {
                guard let start = enclosing else { break }
                enclosing = elements[start].parent
                guard ["AXGroup", "AXLandmarkRegion", "AXArticle", "AXSection"].contains(elements[start].role) else { continue }
                var end = start + 1
                while end < elements.count, let parent = elements[end].parent, parent >= start { end += 1 }
                let group = elements[start..<end]
                guard group.dropFirst().filter(\.isAssistantLabel).count <= 1,
                      !group.contains(where: { $0.isUserLabel || ["AXTextArea", "AXTextField"].contains($0.role) || $0.isInterrupted }) else { break }
                guard group.contains(where: \.isResponseAction), group.contains(where: \.isBodyText) else { continue }
                guard seen.insert(start).inserted else { break }
                let text = (start..<end).compactMap { offset -> String? in
                    let node = elements[offset]
                    guard offset >= index, node.isBodyText,
                          offset + 1 == end || elements[offset + 1].parent != offset else { return nil }
                    var ancestor = node.parent
                    while let parent = ancestor, parent >= start {
                        if ["AXButton", "AXMenu", "AXToolbar"].contains(elements[parent].role) || elements[parent].isAssistantLabel && parent == index && parent != start {
                            return nil
                        }
                        ancestor = elements[parent].parent
                    }
                    return node.text
                }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { replies.append(text) }
                break
            }
        }
        return replies
    }
}

/// Binds writes to a stable ChatGPT URL or a random marker in the selected window's reply history.
enum DesktopChatIdentity {
    case url(String), marker(String)

    static func pairingChallenge(code: UUID = UUID()) -> (identity: Self, prompt: String) {
        let token = code.uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let marker = "BRANCH DESKTOP \(token)"
        let prompt = "Reply with these three items separated by spaces instead of commas. Copy the code exactly. BRANCH, DESKTOP, \(token)"
        return (.marker(marker), prompt)
    }

    static func verifiedURL(in transcript: ChatTranscript) -> Self? {
        guard !transcript.isGenerating, !transcript.replies.isEmpty, let id = transcript.conversationID else { return nil }
        return .url(id)
    }

    var pairingID: String {
        switch self {
        case .url(let id): id
        case .marker(let marker): "marker:" + marker
        }
    }

    func matches(_ transcript: ChatTranscript) -> Bool {
        switch self {
        case .url(let id): transcript.conversationID == id
        case .marker(let marker): transcript.replies.contains {
            $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") == marker
        }
        }
    }
}

/// Advances only when one new assistant turn settles after an observed generation cycle.
struct ReplyCapture {
    enum Event: Equatable {
        case waitingForHistory, ready, generating, completed(Reply), historyChanged
    }

    struct Reply: Equatable, Sendable {
        let id: UUID
        let body: String
    }

    private var baseline: [SHA256Digest]?
    private var generated = false
    private var candidate: SHA256Digest?
    private var stableSamples = 0
    private var idleSamples = 0

    mutating func interruptSample() {
        candidate = nil
        stableSamples = 0
    }

    mutating func observe(_ snapshot: ChatTranscript) -> Event {
        let hashes = snapshot.replies.map { SHA256.hash(data: Data($0.utf8)) }
        guard let baseline else {
            guard !snapshot.isGenerating, !hashes.isEmpty else { return .waitingForHistory }
            self.baseline = hashes
            return .ready
        }
        if snapshot.isGenerating {
            generated = true
            idleSamples = 0
            interruptSample()
            return .generating
        }
        if hashes == baseline {
            interruptSample()
            if generated {
                idleSamples += 1
                if idleSamples <= 4 { return .generating }
                generated = false
            }
            return .ready
        }
        guard hashes.starts(with: baseline), hashes.count == baseline.count + 1, generated,
              let last = hashes.last, let text = snapshot.replies.last else { return .historyChanged }
        if last != candidate {
            candidate = last
            stableSamples = 0
        }
        stableSamples += 1
        guard stableSamples >= 3 else { return .generating }
        self.baseline = hashes
        generated = false
        interruptSample()
        return .completed(Reply(id: UUID(), body: text))
    }
}
