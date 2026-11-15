import Foundation
import Testing
@testable import BranchDesktopProbe

struct DesktopSyncClientTests {
    @Test func pairingAndSavedCardUseHostedOriginWithoutLeakingCapability() throws {
        let client = DesktopSyncClient(conversationID: "synthetic-conversation")
        let url = client.approvalURL
        #expect(url.scheme == "https")
        #expect(url.host == "joinbranch.dev")
        #expect(url.path == "/app")
        #expect(url.query == nil)
        #expect(url.fragment?.contains("challenge=") == true)
        #expect(!url.absoluteString.contains("branch_desktop_"))
        #expect(!url.absoluteString.contains("synthetic-conversation"))
        let board = DesktopSyncClient.Board(boardId: "test-board", boardTitle: "Test")
        let saved = DesktopSyncClient.Saved(cardId: "test-card")
        let card = try #require(DesktopSyncClient.cardURL(board: board, saved: saved))
        #expect(card.host == "joinbranch.dev")
        #expect(card.query?.contains("context=test-card") == true)
    }
}
