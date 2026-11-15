import AppKit
import CryptoKit
import Darwin
import Foundation

/// Reads only the selected local Codex thread through the App Server's stdio API.
actor CodexSync {
    enum Failure: Error {
        case missingThread, ambiguousThread, unavailable
    }

    struct Turn: Decodable {
        let id: String
        let status: String

        var isTerminal: Bool { ["completed", "failed", "interrupted"].contains(status) }
    }

    struct Item: Decodable {
        let type: String
        let phase: String?
        let text: String?
    }

    private struct Thread: Decodable {
        let id: String
        let name: String?
    }

    private struct TurnItem: Decodable { let item: Item }
    private struct Page<Element: Decodable>: Decodable {
        let data: [Element]
        let nextCursor: String?
    }

    @MainActor
    static func executable() -> URL? {
        let resources = ChatWindows.supportedBundleIDs.compactMap {
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0)
        }
        let paths = [
            "Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
            "Contents/Resources/codex",
        ]
        return resources.flatMap { app in paths.map { app.appendingPathComponent($0) } }
            .first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    private let executable: URL
    private var server: Server?
    private var threadID: String?
    private var cursor: String?

    init(executable: URL) {
        self.executable = executable
    }

    func select(title: String) throws -> String {
        guard !title.isEmpty else { throw Failure.missingThread }
        let server = try localServer()
        var matches = Set<String>()
        var next: String?
        var seenCursors = Set<String>()
        repeat {
            var params: [String: Any] = [
                "searchTerm": title, "sourceKinds": ["appServer", "cli", "vscode", "unknown"],
                "useStateDbOnly": true, "limit": 50,
            ]
            if let next { params["cursor"] = next }
            let result: Page<Thread> = try server.request("thread/list", params)
            for thread in result.data where thread.name == title { matches.insert(thread.id) }
            if matches.count > 1 { throw Failure.ambiguousThread }
            next = result.nextCursor
            if let next, !seenCursors.insert(next).inserted { throw Failure.unavailable }
        } while next != nil
        guard let match = matches.first else { throw Failure.missingThread }
        threadID = match
        return "codex:" + match
    }

    /// Records a boundary after board approval so older turns are never sent.
    func start() throws {
        guard let threadID else { throw Failure.missingThread }
        let page = try turns(in: threadID, limit: 1)
        cursor = page.data.first?.id
    }

    func readNewReplies(limit: Int) throws -> [ReplyCapture.Reply] {
        guard limit > 0, let threadID else { return [] }
        let boundary = cursor
        do {
            var new: [Turn] = []
            var next: String?
            var foundCursor = boundary == nil
            var newest: String?
            repeat {
                let page = try turns(in: threadID, limit: 30, cursor: next)
                if newest == nil { newest = page.data.first?.id }
                new += page.data.prefix { $0.id != boundary }
                foundCursor = boundary == nil || page.data.contains { $0.id == boundary }
                next = page.nextCursor
            } while next != nil && (boundary == nil || !foundCursor) && new.count < 300

            // History can be rewritten or truncated. Without the prior boundary, skip the gap.
            guard foundCursor, new.count < 300 else {
                cursor = newest
                return []
            }

            var replies: [ReplyCapture.Reply] = []
            var last = boundary
            for turn in new.reversed() {
                guard turn.isTerminal, replies.count < limit else { break }
                // A different App Server can see the live turn as interrupted until it is flushed.
                if turn.status == "interrupted", turn.id == newest { break }
                if turn.status == "completed", let reply = try finalReply(threadID: threadID, turnID: turn.id) {
                    replies.append(reply)
                }
                last = turn.id
            }
            cursor = last
            return replies
        } catch {
            server = nil
            throw error
        }
    }

    private func turns(in thread: String, limit: Int, cursor: String? = nil) throws -> Page<Turn> {
        var params: [String: Any] = ["threadId": thread, "limit": limit, "itemsView": "notLoaded"]
        if let cursor { params["cursor"] = cursor }
        return try localServer().request("thread/turns/list", params)
    }

    private func finalReply(threadID: String, turnID: String) throws -> ReplyCapture.Reply? {
        var next: String?
        repeat {
            var params: [String: Any] = [
                "threadId": threadID, "turnId": turnID, "sortDirection": "desc", "limit": 10,
            ]
            if let next { params["cursor"] = next }
            let result: Page<TurnItem> = try localServer().request("thread/items/list", params)
            if let body = Self.finalText(result.data.map(\.item)) {
                let digest = Array(SHA256.hash(data: Data("\(threadID):\(turnID)".utf8)))
                let id = UUID(uuid: (digest[0], digest[1], digest[2], digest[3], digest[4], digest[5],
                                     (digest[6] & 0x0f) | 0x50, digest[7], (digest[8] & 0x3f) | 0x80,
                                     digest[9], digest[10], digest[11], digest[12], digest[13], digest[14], digest[15]))
                return ReplyCapture.Reply(id: id, body: body)
            }
            next = result.nextCursor
        } while next != nil
        return nil
    }

    static func finalText(_ items: [Item]) -> String? {
        items.lazy.filter { $0.type == "agentMessage" && $0.phase == "final_answer" }
            .compactMap { $0.text?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
    }

    private func localServer() throws -> Server {
        try Task.checkCancellation()
        if let server { return server }
        let server = try Server(executable: executable)
        self.server = server
        return server
    }

    /// Owned by the actor. The deadline keeps a stalled child process from blocking sync.
    private final class Server {
        private let process = Process()
        private let input = Pipe()
        private let output = Pipe()
        private var buffer = Data()
        private var id = 0

        private struct Response<Value: Decodable>: Decodable {
            let result: Value?
        }
        private struct Header: Decodable { let id: Int? }
        private struct Initialized: Decodable {}

        init(executable: URL) throws {
            process.executableURL = executable
            process.arguments = ["app-server", "--listen", "stdio://"]
            process.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
            process.standardInput = input
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            guard fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1) != -1 else {
                throw Failure.unavailable
            }
            try process.run()
            do {
                let _: Initialized = try request("initialize", [
                    "clientInfo": ["name": "branch_local_sync", "title": "Branch for Mac",
                                   "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.5.6"],
                ])
                try send(["method": "initialized"])
            } catch {
                if process.isRunning { process.terminate() }
                throw error
            }
        }

        deinit {
            if process.isRunning { process.terminate() }
        }

        func request<Value: Decodable>(_ method: String, _ params: [String: Any]) throws -> Value {
            try Task.checkCancellation()
            id += 1
            try send(["id": id, "method": method, "params": params])
            let clock = ContinuousClock()
            let deadline = clock.now + .seconds(6)
            let decoder = JSONDecoder()
            var bytes = [UInt8](repeating: 0, count: 32_768)
            while clock.now < deadline {
                try Task.checkCancellation()
                if let newline = buffer.firstIndex(of: 10) {
                    let line = buffer[..<newline]
                    buffer.removeSubrange(...newline)
                    guard let header = try? decoder.decode(Header.self, from: line), header.id == id else { continue }
                    guard let response = try decoder.decode(Response<Value>.self, from: line).result else {
                        throw Failure.unavailable
                    }
                    return response
                }
                var descriptor = pollfd(fd: output.fileHandleForReading.fileDescriptor, events: Int16(POLLIN), revents: 0)
                let result = Darwin.poll(&descriptor, 1, 100)
                if result < 0, errno != EINTR { throw Failure.unavailable }
                if result > 0 {
                    let count = bytes.withUnsafeMutableBytes { raw in
                        Darwin.read(descriptor.fd, raw.baseAddress, raw.count)
                    }
                    if count < 0, errno == EINTR { continue }
                    guard count > 0 else { throw Failure.unavailable }
                    buffer.append(contentsOf: bytes.prefix(count))
                    guard buffer.count <= 16 * 1024 * 1024 else { throw Failure.unavailable }
                }
            }
            throw Failure.unavailable
        }

        private func send(_ message: [String: Any]) throws {
            var data = try JSONSerialization.data(withJSONObject: message, options: .withoutEscapingSlashes)
            data.append(10)
            try input.fileHandleForWriting.write(contentsOf: data)
        }
    }
}
