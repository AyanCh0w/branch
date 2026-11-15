import Foundation
import Testing
@testable import BranchDesktopProbe

struct CodexSyncTests {
    @Test func skipsExistingTurnsAndWaitsForTheFinalReplyInTheSelectedThread() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let executable = directory.appendingPathComponent("codex-fixture")
        let fixture = #"""
        #!/bin/sh
        count=0
        while IFS= read -r request; do
            count=$((count + 1))
            case "$count:$request" in
            1:*'"method":"initialize"'*)
                echo '{"id":1,"result":{}}' ;;
            2:*'"method":"initialized"'*) ;;
            3:*'"method":"thread/list"'*'"searchTerm":"Selected chat"'*|3:*'"searchTerm":"Selected chat"'*'"method":"thread/list"'*)
                echo '{"id":2,"result":{"data":[{"id":"wrong","name":"Selected chat copy"},{"id":"selected","name":"Selected chat"}]}}' ;;
            4:*'"threadId":"selected"'*)
                echo '{"id":3,"result":{"data":[{"id":"old","status":"completed"}]}}' ;;
            5:*'"threadId":"selected"'*)
                echo '{"id":4,"result":{"data":[{"id":"new","status":"interrupted"},{"id":"old","status":"completed"}]}}' ;;
            6:*'"threadId":"selected"'*)
                echo '{"id":5,"result":{"data":[{"id":"new","status":"completed"},{"id":"old","status":"completed"}]}}' ;;
            7:*'"turnId":"new"'*)
                echo '{"id":6,"result":{"data":[{"item":{"type":"userMessage","text":"Private prompt"}},{"item":{"type":"agentMessage","phase":"commentary","text":"Interim update"}},{"item":{"type":"agentMessage","phase":"final_answer","text":"New final reply"}}]}}' ;;
            8:*'"threadId":"selected"'*)
                echo '{"id":7,"result":{"data":[{"id":"new","status":"completed"},{"id":"old","status":"completed"}]}}' ;;
            *) exit 1 ;;
            esac
        done
        """#
        try fixture.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)

        let source = CodexSync(executable: executable)
        #expect(try await source.select(title: "Selected chat") == "codex:selected")
        try await source.start()
        #expect(try await source.readNewReplies(limit: 20).isEmpty)
        #expect(try await source.readNewReplies(limit: 20).map(\.body) == ["New final reply"])
        #expect(try await source.readNewReplies(limit: 20).isEmpty)
    }
}
