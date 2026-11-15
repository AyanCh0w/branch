import ApplicationServices
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
        #expect(ChatTranscript.completedReplies(in: elements).map(\.text) == ["New reply"])
        var feedbackAction = elements
        feedbackAction[6].labels = ["good-response-turn-action-button"]
        #expect(ChatTranscript.completedReplies(in: feedbackAction).map(\.text) == ["New reply"])
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

    @Test func repeatedPausesKeepTheCaptureReadyWithoutImportingRepliesThatFinishedWhileAway() {
        var capture = ReplyCapture()
        #expect(capture.observe(sample(["Existing reply"])) == .ready)
        #expect(capture.observe(sample(["Existing reply"], generating: true)) == .generating)
        capture.pause()
        let afterFirstSwitch = ["Existing reply", "Finished while away"]
        #expect(capture.observe(sample(afterFirstSwitch)) == .ready)
        capture.pause()
        #expect(capture.observe(sample([])) == .waitingForHistory)
        #expect(capture.observe(sample(afterFirstSwitch)) == .ready)
        capture.pause()
        #expect(capture.observe(sample(afterFirstSwitch, generating: true)) == .generating)
        let newReply = sample(afterFirstSwitch + ["Finished after returning"])
        #expect(capture.observe(newReply) == .generating)
        #expect(capture.observe(newReply) == .generating)
        guard case .completed(let result) = capture.observe(newReply) else {
            Issue.record("The reply after returning was not delivered")
            return
        }
        #expect(result.body == "Finished after returning")
        #expect(capture.observe(newReply) == .ready)
    }

    @Test func stableConversationIDCannotFollowAnotherChat() {
        let handle = AXUIElementCreateApplication(101)
        let identity = ChatConnectionIdentity(chatID: "chat-id", element: handle, reply: "Existing reply")
        #expect(identity.pairingID == "chat-id")
        #expect(identity.matches(chatID: "chat-id", replies: [], elements: [handle]))
        #expect(identity.matches(chatID: "different-chat", replies: [], elements: [handle]) == false)
        #expect(identity.matches(chatID: nil, replies: [], elements: [handle]) == false)
        #expect(identity.matches(chatID: "chat-id", replies: [], elements: []))
    }

    @Test func onlyAnUnboundReadableWindowCanFallBackToLocalLookup() {
        let transcript = sample([])
        #expect(ChatWindows.SyncRead.transcript(transcript, pairingID: nil).canTryLocalThread)
        for read: ChatWindows.SyncRead in [
            .transcript(transcript, pairingID: "selected"), .windowChanged, .permissionLost, .incomplete,
        ] {
            #expect(read.canTryLocalThread == false)
        }
    }

    @Test func windowPairingRequiresTheSameReplyAndAccessibilityElement() {
        let handle = AXUIElementCreateApplication(101)
        let otherHandle = AXUIElementCreateApplication(102)
        let reply = ChatTranscript.CompletedReply(containerIndex: 0, text: "Existing reply")
        let otherReply = ChatTranscript.CompletedReply(containerIndex: 0, text: "Different reply")
        let newReply = ChatTranscript.CompletedReply(containerIndex: 1, text: "New reply")
        let identity = ChatConnectionIdentity(chatID: nil, element: handle, reply: reply.text)
        #expect(identity.pairingID.hasPrefix("window:"))
        #expect(identity.pairingID.contains(reply.text) == false)
        #expect(identity.matches(chatID: nil, replies: [reply, newReply], elements: [handle, otherHandle]))
        #expect(identity.matches(chatID: nil, replies: [reply], elements: [otherHandle]) == false)
        #expect(identity.matches(chatID: nil, replies: [otherReply], elements: [handle]) == false)
        #expect(identity.matches(chatID: nil, replies: [], elements: [handle]) == false)
    }

    private func sample(_ replies: [String], generating: Bool = false) -> ChatTranscript {
        ChatTranscript(title: "Test Chat", isGenerating: generating, replies: replies)
    }
}
