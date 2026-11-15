import CryptoKit
import Foundation

/// One session key and the hosted endpoints used to approve and write to its board.
struct DesktopSyncClient: Sendable {
    struct Board: Decodable, Sendable {
        let boardId: String
        let boardTitle: String
    }

    struct Saved: Decodable, Sendable {
        let cardId: String
    }

    enum Failure: Error {
        case disconnected, temporary, rejected
    }

    private struct Request: Encodable {
        let key: String
        var updateId: String? = nil
        var title: String? = nil
        var result: String? = nil
    }

    private struct Response<Value: Decodable>: Decodable { let value: Value }
    private struct Acknowledgment: Decodable {}

    // Never follow a redirect that could send the capability or reply to another origin.
    private final class RejectRedirects: NSObject, URLSessionTaskDelegate, Sendable {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    static let origin = URL(string: "https://joinbranch.dev")!
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 8
        return URLSession(configuration: configuration, delegate: RejectRedirects(), delegateQueue: nil)
    }()

    private let key: String
    private let conversationID: String
    let expiresAt: Date

    /// Creates an in-memory capability. Only its hash is presented in the browser.
    init(conversationID: String) {
        self.conversationID = conversationID
        expiresAt = Date().addingTimeInterval(7 * 60 * 60 + 55 * 60)
        let random = SymmetricKey(size: .bits256).withUnsafeBytes { bytes in
            bytes.map { String(format: "%02x", $0) }.joined()
        }
        key = "branch_desktop_\(Int64(expiresAt.timeIntervalSince1970 * 1000))_\(random)"
    }

    /// Opens Branch's authenticated board picker without exposing the write capability.
    var approvalURL: URL {
        var url = URLComponents(url: Self.origin.appendingPathComponent("app"), resolvingAgainstBaseURL: false)!
        url.fragment = "desktop-sync=1&conversation=\(Self.digest(conversationID.lowercased()))&challenge=\(Self.digest(key))"
        return url.url!
    }

    /// Fetches the board approved for this session.
    func status() async throws -> Board {
        try await call("status", Request(key: key))
    }

    /// Saves a completed reply using the same update ID if a request is retried.
    func save(_ reply: ReplyCapture.Reply, title: String) async throws -> Saved {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let suffix = "\n\n[Reply truncated to fit Branch.]"
        let result = reply.body.utf16.count <= 12_000 ? reply.body
            : Self.prefix(reply.body, maxUTF16: 12_000 - suffix.utf16.count) + suffix
        return try await call("save", Request(key: key, updateId: reply.id.uuidString,
            title: name.isEmpty ? "ChatGPT on Mac" : Self.prefix(name, maxUTF16: 120), result: result))
    }

    /// Revokes the capability without removing replies already saved to the board.
    func revoke() async throws {
        let _: Acknowledgment = try await call("stop", Request(key: key))
    }

    /// Returns a link to the board's Context card, without any credentials.
    static func cardURL(board: Board, saved: Saved) -> URL? {
        var url = URLComponents(url: origin.appendingPathComponent("app"), resolvingAgainstBaseURL: false)
        url?.queryItems = [URLQueryItem(name: "board", value: board.boardId), URLQueryItem(name: "context", value: saved.cardId)]
        return url?.url
    }

    private func call<Value: Decodable>(_ operation: String, _ body: Request) async throws -> Value {
        var url = URLComponents(url: Self.origin.appendingPathComponent("api/backend"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "desktop", value: operation)]
        var request = URLRequest(url: url.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response): (Data, URLResponse)
        do { (data, response) = try await Self.session.data(for: request) }
        catch {
            try Task.checkCancellation()
            throw Failure.temporary
        }
        guard let status = (response as? HTTPURLResponse)?.statusCode else { throw Failure.temporary }
        switch status {
        case 200: return try JSONDecoder().decode(Response<Value>.self, from: data).value
        case 401: throw Failure.disconnected
        case 429, 500...599: throw Failure.temporary
        default: throw Failure.rejected
        }
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func prefix(_ text: String, maxUTF16: Int) -> String {
        var count = 0
        let prefix = text.prefix { character in
            count += character.utf16.count
            return count <= maxUTF16
        }
        return String(prefix)
    }
}
