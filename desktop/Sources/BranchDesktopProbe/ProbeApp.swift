import AppKit
@preconcurrency import ApplicationServices

/// Runs the one-window diagnostic from a native menu bar item.
@main
@MainActor
final class ProbeApp: NSObject, NSApplicationDelegate {
    private let sampler = ChatWindows()
    private let prompts = ProbePrompts()
    private var run = ProbeRun()
    private var watch: Task<Void, Never>?
    private var isRefreshing = false
    private var report: String?
    private var statusItem: NSStatusItem?
    private var stopSyncItem: NSMenuItem?
    private var syncActive = false
    private lazy var syncPanel = DesktopSyncPanel()

    private let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 500, height: 400),
        styleMask: [.titled, .closable], backing: .buffered, defer: false
    )
    private let choices = NSPopUpButton()
    private let feedback = NSTextField(wrappingLabelWithString: "")
    private lazy var chooseButton = button("Watch selected window", #selector(start))
    private lazy var streamButton = button("Copy streaming prompt", #selector(copyStreamingPrompt))
    private lazy var reportButton = button("Copy results", #selector(copyResults))
    private lazy var stopButton = button("Stop", #selector(stop))

    /// Keeps the delegate alive for the AppKit event loop.
    static func main() {
        let app = NSApplication.shared
        let delegate = ProbeApp()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setUpMenu()
        setUpWindow()
        syncPanel.onActivity = { [weak self] active in
            self?.syncActive = active
            self?.updateMenu()
        }
        syncPanel.onOpenProbe = { [weak self] in self?.showWindow() }
        syncPanel.show()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        watch?.cancel()
        return syncPanel.quitIfSyncing(then: { sender.reply(toApplicationShouldTerminate: true) })
            ? .terminateLater : .terminateNow
    }

    private func setUpMenu() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "Branch"
        let menu = NSMenu()
        let sync = NSMenuItem(title: "ChatGPT Sync…", action: #selector(showSync), keyEquivalent: "")
        sync.target = self
        let show = NSMenuItem(title: "Desktop Sync Probe…", action: #selector(showWindow), keyEquivalent: "")
        show.target = self
        let stop = NSMenuItem(title: "Stop syncing", action: #selector(stopSync), keyEquivalent: "")
        stop.target = self
        stopSyncItem = stop
        menu.autoenablesItems = false
        let quit = NSMenuItem(title: "Quit Branch", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        menu.items = [sync, show, stop, .separator(), quit]
        item.menu = menu
        statusItem = item
        updateMenu()
    }

    private func setUpWindow() {
        window.title = "Branch Desktop Probe"
        window.isReleasedWhenClosed = false
        window.center()

        let intro = label("Check if Branch can detect completed replies in a regular ChatGPT desktop chat.")
        intro.font = .systemFont(ofSize: 14, weight: .semibold)
        let privacy = label("The probe reads only your selected window and reports yes or no for each check.")
        privacy.textColor = .secondaryLabelColor
        let instructions = label("Send the baseline prompt in a new ChatGPT Chat, wait for the reply, then pop that chat out into its own window.")
        let permission = button("Request Accessibility Access…", #selector(requestAccessibility))
        let baseline = button("Copy baseline prompt", #selector(copyBaselinePrompt))
        let refresh = button("Find ChatGPT windows", #selector(refreshWindows))
        choices.setAccessibilityLabel("ChatGPT window")
        choices.addItem(withTitle: "Choose the test chat window")
        choices.isEnabled = false
        choices.target = self
        choices.action = #selector(updateButtons)
        choices.cell?.truncatesLastVisibleLine = true
        feedback.stringValue = "Start with the baseline prompt."
        feedback.setAccessibilityLabel("Probe status")
        feedback.textColor = .secondaryLabelColor

        let content = NSStackView(views: [
            intro, privacy, NSBox.separatorBox(), instructions, row([baseline, permission]),
            row([choices, refresh]), row([chooseButton, streamButton, stopButton]),
            feedback, reportButton,
        ])
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 12
        content.translatesAutoresizingMaskIntoConstraints = false
        let container = NSView()
        container.addSubview(content)
        window.contentView = container
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
            content.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
            content.topAnchor.constraint(equalTo: container.topAnchor, constant: 22),
            content.bottomAnchor.constraint(lessThanOrEqualTo: container.bottomAnchor, constant: -18),
            intro.widthAnchor.constraint(equalTo: content.widthAnchor),
            privacy.widthAnchor.constraint(equalTo: content.widthAnchor),
            instructions.widthAnchor.constraint(equalTo: content.widthAnchor),
            feedback.widthAnchor.constraint(equalTo: content.widthAnchor),
            choices.widthAnchor.constraint(equalToConstant: 275),
        ])
        updateButtons()
    }

    private func label(_ title: String) -> NSTextField {
        NSTextField(wrappingLabelWithString: title)
    }

    private func row(_ views: [NSView]) -> NSStackView {
        let row = NSStackView(views: views)
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 8
        return row
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        NSButton(title: title, target: self, action: action)
    }

    @objc private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    @objc private func showSync() { syncPanel.show() }
    @objc private func stopSync() { syncPanel.stop() }

    @objc private func quitApp() {
        watch?.cancel()
        NSApp.terminate(nil)
    }

    @objc private func requestAccessibility() {
        let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let allowed = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
        let appName = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Branch"
        feedback.stringValue = allowed
            ? "Accessibility is enabled. Find your test window when its baseline reply is visible."
            : "Enable \(appName) under System Settings → Privacy & Security → Accessibility, then click Find ChatGPT windows."
    }

    @objc private func refreshWindows() {
        guard watch == nil, !isRefreshing else { return }
        guard AXIsProcessTrusted() else {
            feedback.stringValue = "Request Accessibility access first."
            return
        }
        isRefreshing = true
        updateButtons()
        Task {
            let titles = await sampler.list()
            choices.removeAllItems()
            choices.addItem(withTitle: "Choose the test chat window")
            choices.addItems(withTitles: titles)
            isRefreshing = false
            feedback.stringValue = titles.isEmpty
                ? "No ChatGPT windows were found. Open the ChatGPT desktop app and find windows again."
                : "Choose the window with the baseline reply and start watching."
            updateButtons()
        }
    }

    @objc private func start() {
        guard watch == nil, !isRefreshing, choices.indexOfSelectedItem > 0 else { return }
        let index = choices.indexOfSelectedItem - 1
        run = ProbeRun()
        report = nil
        feedback.stringValue = "Looking for the baseline reply in the selected window…"
        watch = Task {
            guard await sampler.select(index) else {
                finish("Select the test window again.", outcome: "Window unavailable")
                return
            }
            let clock = ContinuousClock()
            let deadline = clock.now + .seconds(120)
            while !Task.isCancelled, clock.now < deadline {
                let sample = await sampler.sample(matching: prompts)
                guard !Task.isCancelled else { return }
                switch sample {
                case .sample(let snapshot):
                    if !record(snapshot) { return }
                case .incomplete:
                    run.skipSample()
                case .windowChanged:
                    finish("The selected window changed or closed. Find the test window again.", outcome: "Window changed")
                    return
                case .permissionLost:
                    finish("Accessibility access is off.", outcome: "Accessibility unavailable")
                    return
                }
                do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
            }
            guard !Task.isCancelled else { return }
            finish("The probe timed out. Copy the results to see which signals the app exposed.", outcome: "Timed out")
        }
        updateButtons()
    }

    private func record(_ sample: WindowSample) -> Bool {
        let previous = run.stage
        run.record(sample)
        guard previous != run.stage else { return true }
        switch run.stage {
        case .waitingForBaseline: break
        case .ready:
            feedback.stringValue = "Baseline found. Copy the streaming prompt and send it in the same window."
        case .streaming:
            feedback.stringValue = "Reply in progress. Waiting for ChatGPT to finish."
        case .passed:
            finish("Read the new reply and detected when it finished. Copy the results to share them.", outcome: "Passed")
            return false
        }
        updateButtons()
        return true
    }

    private func finish(_ message: String, outcome: String) {
        watch?.cancel()
        watch = nil
        report = run.report(outcome: outcome)
        feedback.stringValue = message
        updateButtons()
    }

    @objc private func updateButtons() {
        choices.isEnabled = watch == nil && !isRefreshing && choices.numberOfItems > 1
        chooseButton.isEnabled = choices.isEnabled && choices.indexOfSelectedItem > 0
        streamButton.isEnabled = watch != nil && run.stage == .ready
        stopButton.isEnabled = watch != nil
        reportButton.isEnabled = report != nil
        updateMenu()
    }

    private func updateMenu() {
        stopSyncItem?.isEnabled = syncActive
        statusItem?.button?.title = watch == nil && !syncActive ? "Branch" : "Branch •"
    }

    @objc private func stop() {
        finish("Stopped. You can still copy the results collected so far.", outcome: "Stopped")
    }

    @objc private func copyBaselinePrompt() { copy(prompts.baselinePrompt) }
    @objc private func copyStreamingPrompt() { copy(prompts.streamingPrompt) }
    @objc private func copyResults() {
        if let report {
            copy(report)
            feedback.stringValue = "Results copied."
        }
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

private extension NSBox {
    static func separatorBox() -> NSBox {
        let separator = NSBox()
        separator.boxType = .separator
        return separator
    }
}
