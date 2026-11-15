import Foundation
import Testing
@testable import BranchDesktopProbe

struct ReplyCaptureTests {
    @Test func readsOnlyAssistantBodyFromTheTurn() {
        let elements = [
            ChatElement(role: "AXWebArea"),
            ChatElement(role: "AXGroup", labels: ["user-message"], parent: 0),
            ChatElement(role: "AXStaticText", text: "Private prompt", parent: 1),
            ChatElement(role: "AXGroup", labels: ["assistant-message"], parent: 0),
            ChatElement(role: "AXHeading", text: "ChatGPT said:", parent: 3),
            ChatElement(role: "AXStaticText", text: "New reply", parent: 3),
            ChatElement(role: "AXButton", labels: ["copy-turn-action-button"], parent: 3),
            ChatElement(role: "AXStaticText", text: "Copy", parent: 6),
            ChatElement(role: "AXTextArea", text: "Unsent draft", parent: 0),
        ]
        #expect(ChatTranscript.completedReplies(in: elements) == ["New reply"])
        var feedbackAction = elements
        feedbackAction[6].labels = ["good-response-turn-action-button"]
        #expect(ChatTranscript.completedReplies(in: feedbackAction) == ["New reply"])
    }

    @Test func rejectsMixedAndInterruptedTurns() {
        let elements = [
            ChatElement(role: "AXGroup"),
            ChatElement(role: "AXHeading", text: "You said:", parent: 0),
            ChatElement(role: "AXStaticText", text: "Private prompt", parent: 0),
            ChatElement(role: "AXHeading", text: "ChatGPT said:", parent: 0),
            ChatElement(role: "AXStaticText", text: "Incomplete reply", parent: 0),
            ChatElement(role: "AXButton", labels: ["Copy response"], parent: 0),
        ]
        #expect(ChatTranscript.completedReplies(in: elements).isEmpty)
        var interrupted = elements
        interrupted[1] = ChatElement(role: "AXStaticText", text: "Response stopped", parent: 0)
        #expect(ChatTranscript.completedReplies(in: interrupted).isEmpty)
    }

    @Test func skipsHistoryAndSavesOneNewReplyAfterItSettles() {
        var capture = ReplyCapture()
        let before = sample(["Old reply"])
        let sameTextNextTurn = sample(["Old reply", "Old reply"])
        #expect(capture.observe(before) == .ready)
        #expect(capture.observe(before) == .ready)
        #expect(capture.observe(sample(before.replies, generating: true)) == .generating)
        #expect(capture.observe(sameTextNextTurn) == .generating)
        capture.interruptSample()
        #expect(capture.observe(sameTextNextTurn) == .generating)
        #expect(capture.observe(sameTextNextTurn) == .generating)
        guard case .completed(let result) = capture.observe(sameTextNextTurn) else {
            Issue.record("The new reply was not delivered")
            return
        }
        #expect(result.body == "Old reply")
        #expect(capture.observe(sameTextNextTurn) == .ready)
    }

    @Test func rejectsChangesWithoutAValidGenerationCycle() {
        var capture = ReplyCapture()
        _ = capture.observe(sample(["Initial reply"]))
        #expect(capture.observe(sample(["Initial reply", "An unseen turn"])) == .historyChanged)
        _ = capture.observe(sample(["Initial reply"], generating: true))
        #expect(capture.observe(sample(["Reply from another chat", "A new turn"])) == .historyChanged)
        #expect(capture.observe(sample(["Initial reply", "One turn", "Two turns"])) == .historyChanged)
    }

    @Test func aCancelledTurnCannotArmAnUnobservedNextReply() {
        var capture = ReplyCapture()
        _ = capture.observe(sample(["Initial reply"]))
        _ = capture.observe(sample(["Initial reply"], generating: true))
        for _ in 0..<5 { _ = capture.observe(sample(["Initial reply"])) }
        #expect(capture.observe(sample(["Initial reply", "An unseen turn"])) == .historyChanged)
    }

    @Test func identityCannotFollowANewChat() {
        let marker = "BRANCH DESKTOP test-code"
        #expect(DesktopChatIdentity.url("chat-id").matches(sample(["Reply"])))
        #expect(DesktopChatIdentity.url("other").matches(sample(["Reply"])) == false)
        #expect(DesktopChatIdentity.marker(marker).matches(sample([marker, "Reply"])))
        #expect(DesktopChatIdentity.marker(marker).matches(sample(["BRANCH DESKTOP\ntest-code"])))
        #expect(DesktopChatIdentity.marker(marker).matches(sample(["A reply quoting \(marker)"])) == false)
    }

    @Test func directPairingRequiresAnIdleRecognizedReplyAndChatURL() {
        #expect(DesktopChatIdentity.verifiedURL(in: sample(["Reply"]))?.pairingID == "chat-id")
        #expect(DesktopChatIdentity.verifiedURL(in: sample([])) == nil)
        #expect(DesktopChatIdentity.verifiedURL(in: sample(["Reply"], generating: true)) == nil)
        let noURL = ChatTranscript(conversationID: nil, title: "Test Chat", isGenerating: false, replies: ["Reply"])
        #expect(DesktopChatIdentity.verifiedURL(in: noURL) == nil)
    }

    @Test func pairingCodeSurvivesOmittingPunctuation() throws {
        let code = try #require(UUID(uuidString: "01234567-89ab-4cde-8f01-23456789abcd"))
        let (identity, prompt) = DesktopChatIdentity.pairingChallenge(code: code)
        let expected = "BRANCH DESKTOP 0123456789ab4cde8f0123456789abcd"
        #expect(prompt.hasSuffix("BRANCH, DESKTOP, 0123456789ab4cde8f0123456789abcd"))
        #expect(!prompt.contains(expected))
        #expect(identity.matches(sample([expected])))
        #expect(identity.matches(sample(["BRANCH DESKTOP 0123456789ab4cde8f0123456789abce"])) == false)
        #expect(identity.matches(sample([prompt])) == false)
    }

    private func sample(_ replies: [String], generating: Bool = false) -> ChatTranscript {
        ChatTranscript(conversationID: "chat-id", title: "Test Chat", isGenerating: generating, replies: replies)
    }
}
