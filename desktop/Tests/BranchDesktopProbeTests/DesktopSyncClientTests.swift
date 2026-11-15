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

struct ConnectionLinkTests {
    @Test func boardHintTravelsToConsentWithoutCredentials() throws {
        let link = try #require(ConnectionLink(URL(string: "joinbranch://connect?board=boards_123")!))
        #expect(link.boardID == "boards_123")
        let client = DesktopSyncClient(conversationID: "test", preferredBoardID: link.boardID)
        #expect(client.approvalURL.fragment?.contains("&board=boards_123") == true)
        #expect(!client.approvalURL.absoluteString.contains("branch_desktop_"))
        #expect(ConnectionLink(URL(string: "joinbranch://connect")!)?.boardID == nil)
    }
    @Test func rejectsRedirectsAndCredentials() {
        for value in ["https://connect?board=a", "joinbranch://evil?board=a", "joinbranch://connect/path?board=a", "joinbranch://connect?board=a&key=secret", "joinbranch://connect?board=a&board=b", "joinbranch://connect?board=a%26b", "joinbranch://connect#key=secret", "joinbranch://user:pass@connect?board=a"] {
            #expect(ConnectionLink(URL(string:value)!) == nil)
        }
        let client = DesktopSyncClient(conversationID: "test", preferredBoardID: "evil&challenge=x")
        #expect(client.approvalURL.fragment?.contains("&board=") == false)
    }
    @Test func omitsControlWindowsFromConversationChoices() {
        #expect(!ChatWindows.isConversationWindow("Computer Use Controls"))
        #expect(!ChatWindows.isConversationWindow("Computer Use"))
        #expect(ChatWindows.isConversationWindow("School — Main"))
    }
}
