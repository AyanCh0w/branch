import Foundation

/// Generates prompts whose reply markers do not appear verbatim in the prompts.
struct ProbePrompts: Sendable {
    private struct Baseline: Decodable, Sendable {
        let prompt: String
        let reply: String
    }

    private static let desktopBaseline: Baseline = {
        let url = Bundle.main.url(forResource: "desktop-baseline", withExtension: "json")
            ?? Bundle.module.url(forResource: "desktop-baseline", withExtension: "json")
        guard let url,
              let data = try? Data(contentsOf: url),
              let baseline = try? JSONDecoder().decode(Baseline.self, from: data) else {
            preconditionFailure("Missing or invalid desktop baseline resource")
        }
        return baseline
    }()

    let code = Int.random(in: 100_000...999_999)

    var baseline: String { Self.desktopBaseline.reply }
    var firstLine: String { "BRANCH START \(code)" }
    var lastLine: String { "BRANCH FINISH \(code)" }

    var baselinePrompt: String { Self.desktopBaseline.prompt }

    var streamingPrompt: String {
        """
        Use plain text. On the first line, write BRANCH, START, \(code) separated by spaces instead of commas. \
        Then give 30 detailed, numbered tips for organizing a desk. \
        On the very last line, write BRANCH, FINISH, \(code) separated by spaces instead of commas. Omit the final period.
        """
    }
}

/// Records only synthetic marker and control visibility from one complete window sample.
struct WindowSample: Sendable {
    var baseline = false
    var firstLine = false
    var lastLine = false
    var stopControl = false
    var chatURL = false
}

/// Evaluates whether the selected window exposes enough information for automatic capture.
struct ProbeRun {
    enum Stage: Equatable {
        case waitingForBaseline, ready, streaming, passed
    }

    private(set) var stage: Stage = .waitingForBaseline
    private(set) var sawBaseline = false
    private(set) var sawFirstLine = false
    private(set) var sawLastLine = false
    private(set) var sawStreaming = false
    private(set) var sawStopControlDisappear = false
    private(set) var exposedChatURL = false
    private var settledSamples = 0

    /// Uses a clean idle sample to rule out existing replies and captures the stop control transition.
    mutating func record(_ sample: WindowSample) {
        exposedChatURL = exposedChatURL || sample.chatURL
        sawBaseline = sawBaseline || sample.baseline
        if stage == .waitingForBaseline {
            guard sample.baseline, !sample.firstLine, !sample.lastLine, !sample.stopControl else { return }
            stage = .ready
            return
        }
        guard stage != .passed else { return }

        sawFirstLine = sawFirstLine || sample.firstLine
        sawLastLine = sawLastLine || sample.lastLine
        if sample.stopControl {
            sawStreaming = true
            stage = .streaming
        } else if sawStreaming {
            sawStopControlDisappear = true
        }

        if sawStreaming, sawFirstLine, sample.lastLine, !sample.stopControl {
            settledSamples += 1
            if settledSamples == 3 { stage = .passed }
        } else {
            settledSamples = 0
        }
    }

    /// Breaks the streak when the selected window cannot be read completely.
    mutating func skipSample() {
        settledSamples = 0
    }

    /// Returns diagnostic flags only. The report contains no titles, links, or message text.
    func report(outcome: String) -> String {
        let checks = [
            ("Baseline reply readable", sawBaseline),
            ("New reply start readable", sawFirstLine),
            ("New reply end readable", sawLastLine),
            ("Stop control appeared", sawStreaming),
            ("Stop control disappeared", sawStopControlDisappear),
            ("Chat URL exposed to Accessibility", exposedChatURL),
        ]
        return (["Branch Desktop Probe: \(outcome)"] + checks.map { label, passed in
            "\(label): \(passed ? "yes" : "no")"
        }).joined(separator: "\n")
    }
}
