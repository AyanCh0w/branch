import Testing
@testable import BranchDesktopProbe

struct ProbeRunTests {
    @Test func markersDoNotAppearInThePrompts() {
        let prompts = ProbePrompts()
        for transcriptPrompt in [prompts.baselinePrompt, prompts.streamingPrompt] {
            #expect(transcriptPrompt.contains(prompts.baseline) == false)
            #expect(transcriptPrompt.contains(prompts.firstLine) == false)
            #expect(transcriptPrompt.contains(prompts.lastLine) == false)
        }
    }

    @Test func anExistingAnswerCannotArmTheProbe() {
        var run = ProbeRun()
        run.record(WindowSample(baseline: true, lastLine: true))
        run.record(WindowSample(baseline: true, stopControl: true))
        #expect(run.stage == .waitingForBaseline)
        run.record(WindowSample(baseline: true))
        #expect(run.stage == .ready)
    }

    @Test func aVisibleAnswerAloneDoesNotProveCompletion() {
        var run = ProbeRun()
        run.record(WindowSample(baseline: true))
        for _ in 0..<4 {
            run.record(WindowSample(firstLine: true, lastLine: true))
        }
        #expect(run.sawLastLine)
        #expect(run.stage == .ready)
    }

    @Test func aShortPartialReadCannotConfirmThatStreamingEnded() {
        var run = ProbeRun()
        run.record(WindowSample(baseline: true))
        run.record(WindowSample(firstLine: true, stopControl: true))
        run.record(WindowSample(lastLine: true, stopControl: true))
        run.record(WindowSample(lastLine: true))
        run.record(WindowSample(lastLine: true))
        run.skipSample()
        run.record(WindowSample(lastLine: true))
        #expect(run.stage == .streaming)
        run.record(WindowSample(lastLine: true))
        run.record(WindowSample(lastLine: true))
        #expect(run.stage == .passed)
        #expect(run.sawStopControlDisappear)
    }

    @Test func aStoppedReplyWithoutItsFinalLineCannotPass() {
        var run = ProbeRun()
        run.record(WindowSample(baseline: true))
        run.record(WindowSample(firstLine: true, stopControl: true))
        for _ in 0..<4 {
            run.record(WindowSample(firstLine: true))
        }
        #expect(run.sawStopControlDisappear)
        #expect(run.stage == .streaming)
    }
}
