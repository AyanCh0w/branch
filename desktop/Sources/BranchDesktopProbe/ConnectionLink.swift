import Foundation

/// A navigation hint only. The authenticated website still approves every pairing.
struct ConnectionLink {
    let boardID: String?

    init?(_ url: URL) {
        guard url.scheme == "joinbranch", url.host == "connect", url.path.isEmpty,
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let items = parts.queryItems ?? []
        guard items.allSatisfy({ $0.name == "board" }), items.count <= 1 else { return nil }
        let board = items.first?.value
        guard board == nil || Self.validBoard(board!) else { return nil }
        boardID = board
    }

    static func validBoard(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 160 && value.unicodeScalars.allSatisfy {
            (48...57).contains($0.value) || (65...90).contains($0.value) ||
            (97...122).contains($0.value) || $0 == "_" || $0 == "-"
        }
    }
}
