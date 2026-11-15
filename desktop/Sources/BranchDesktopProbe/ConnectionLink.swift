import Foundation

/// A navigation hint only. The authenticated website still approves every pairing.
struct ConnectionLink {
    let boardID: String?
    let chatTitle: String?

    init?(_ url: URL) {
        guard url.scheme == "joinbranch", url.host == "connect", url.path.isEmpty,
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let items = parts.queryItems ?? []
        guard items.allSatisfy({ ["board", "chat"].contains($0.name) }),
              Set(items.map(\.name)).count == items.count else { return nil }
        let board = items.first { $0.name == "board" }
        let chat = items.first { $0.name == "chat" }
        if let board {
            guard let id = board.value, Self.validBoard(id) else { return nil }
        }
        if let chat {
            guard let title = chat.value, !title.trimmingCharacters(in: .whitespaces).isEmpty,
                  title.count <= 240, title.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
        }
        boardID = board?.value
        chatTitle = chat?.value
    }

    func matchingChat(in titles: [String]) -> Int? {
        guard let chatTitle else { return nil }
        let matches = titles.indices.filter { titles[$0] == chatTitle }
        return matches.count == 1 ? matches.first : nil
    }

    static func validBoard(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 160 && value.unicodeScalars.allSatisfy {
            (48...57).contains($0.value) || (65...90).contains($0.value) ||
            (97...122).contains($0.value) || $0 == "_" || $0 == "-"
        }
    }
}
