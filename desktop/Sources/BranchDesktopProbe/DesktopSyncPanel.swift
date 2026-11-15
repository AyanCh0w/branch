import AppKit
@preconcurrency import ApplicationServices

/// Owns one opted-in chat and its in-memory queue for the life of the sync session.
@MainActor
final class DesktopSyncPanel: NSObject, NSWindowDelegate {
    private let sampler = ChatWindows()
    private let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 500, height: 312),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
    private let content = NSStackView()
    private let heading = NSTextField(labelWithString: "Connect ChatGPT")
    private let intro = NSTextField(wrappingLabelWithString: "")
    private let conversationLabel = NSTextField(labelWithString: "Conversation")
    private let chatPicker = NSPopUpButton()
    private let status = NSTextField(wrappingLabelWithString: "")
    private lazy var findButton = button("Find ChatGPT windows", #selector(findChats))
    private lazy var settingsButton = button("Open Accessibility Settings", #selector(openAccessibilitySettings))
    private lazy var startButton = button("Connect chat", #selector(start))
    private lazy var stopButton = button("Stop syncing", #selector(stop))
    private lazy var openButton = button("Open in Branch", #selector(openCard))
    private lazy var copyButton = button("Copy pairing prompt", #selector(copyPairingPrompt))
    private lazy var diagnosticButton = button("Check window compatibility", #selector(openProbe))

    private var watching: Task<Void, Never>?
    private var uploading: Task<Void, Never>?
    private var permissionCheck: Task<Void, Never>?
    private var requestedAccess = false
    private var refreshing = false
    private var connection: DesktopSyncClient?
    private var boardTitle: String?
    private var pending: [(reply: ReplyCapture.Reply, title: String)] = []
    private var cardURL: URL?
    private var pairingPrompt: String?
    private var savedCount = 0
    private var offersDiagnostics = false
    var onActivity: (Bool) -> Void = { _ in }
    var onOpenProbe: () -> Void = {}

    override init() {
        super.init()
        window.title = "ChatGPT Sync"
        window.delegate = self
        window.isReleasedWhenClosed = false

        heading.font = .systemFont(ofSize: 25, weight: .semibold)
        intro.textColor = .secondaryLabelColor
        conversationLabel.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
        chatPicker.setAccessibilityLabel("ChatGPT conversation")
        chatPicker.addItem(withTitle: "Choose a conversation")
        chatPicker.target = self
        chatPicker.action = #selector(updateControls)
        chatPicker.cell?.truncatesLastVisibleLine = true
        status.setAccessibilityLabel("Sync status")
        let divider = NSBox()
        divider.boxType = .separator
        let actions = row([startButton, copyButton, openButton, findButton, settingsButton, diagnosticButton, stopButton])
        [heading, intro, divider, conversationLabel, chatPicker, status, actions].forEach(content.addArrangedSubview)
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 12
        content.setCustomSpacing(6, after: heading)
        content.setCustomSpacing(16, after: intro)
        content.setCustomSpacing(6, after: conversationLabel)
        content.setCustomSpacing(16, after: status)
        content.translatesAutoresizingMaskIntoConstraints = false
        let container = NSView()
        container.addSubview(content)
        window.contentView = container
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 28),
            content.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -28),
            content.topAnchor.constraint(equalTo: container.topAnchor, constant: 26),
            intro.widthAnchor.constraint(equalTo: content.widthAnchor),
            divider.widthAnchor.constraint(equalTo: content.widthAnchor),
            chatPicker.widthAnchor.constraint(equalTo: content.widthAnchor),
            status.widthAnchor.constraint(equalTo: content.widthAnchor),
        ])
        updateControls()
        window.center()
    }

    /// Brings the sync window to the front while leaving an existing session running.
    func show() {
        updateControls()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func windowWillClose(_ notification: Notification) {
        permissionCheck?.cancel()
        permissionCheck = nil
    }

    /// Cancels capture, clears unsent data and revokes the current write capability.
    @objc func stop() {
        finish(boardTitle == nil ? "Setup canceled." : "Sync stopped.")
    }

    /// Signals that the running app should wait for one revocation attempt before quitting.
    func quitIfSyncing(then reply: @escaping @MainActor () -> Void) -> Bool {
        guard let client = clearSession() else { return false }
        Task {
            try? await client.revoke()
            reply()
        }
        return true
    }

    private func row(_ views: [NSView]) -> NSStackView {
        let row = NSStackView(views: views)
        row.orientation = .horizontal
        row.spacing = 8
        return row
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        NSButton(title: title, target: self, action: action)
    }

    @objc private func findChats() {
        guard watching == nil, !refreshing else { return }
        offersDiagnostics = false
        permissionCheck?.cancel()
        permissionCheck = nil
        if AXIsProcessTrusted() {
            refresh()
            return
        }

        let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
        let appName = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Branch"
        requestedAccess = true
        status.stringValue = "Turn on \(appName) in Accessibility. We’ll look for conversations once you approve."
        updateControls()
        permissionCheck = Task {
            let clock = ContinuousClock()
            let deadline = clock.now + .seconds(120)
            while !AXIsProcessTrusted(), clock.now < deadline {
                do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
            }
            guard !Task.isCancelled else { return }
            permissionCheck = nil
            if AXIsProcessTrusted() {
                refresh()
            } else {
                status.stringValue = "Accessibility approval is still needed. Select Allow Accessibility to continue."
                updateControls()
            }
        }
    }

    @objc private func openAccessibilitySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
        if permissionCheck == nil { findChats() }
    }

    private func refresh() {
        refreshing = true
        status.stringValue = "Looking for ChatGPT windows…"
        updateControls()
        Task {
            let choices = await sampler.list()
            chatPicker.removeAllItems()
            chatPicker.addItem(withTitle: "Choose a conversation")
            chatPicker.addItems(withTitles: choices)
            if choices.count == 1 { chatPicker.selectItem(at: 1) }
            refreshing = false
            if !AXIsProcessTrusted() {
                status.stringValue = "Allow Accessibility to find ChatGPT windows."
            } else {
                status.stringValue = choices.isEmpty ? "Open a conversation in the ChatGPT desktop app, then try again." : ""
            }
            updateControls()
        }
    }

    @objc private func start() {
        let index = chatPicker.indexOfSelectedItem - 1
        guard chatPicker.isEnabled, index >= 0 else { return }
        offersDiagnostics = false
        cardURL = nil
        savedCount = 0
        status.stringValue = "Checking the selected chat…"
        watching = Task {
            do { try await sync(windowIndex: index) }
            catch is CancellationError { return }
            catch DesktopSyncClient.Failure.disconnected { finish("The board disconnected. Pair again to resume.") }
            catch DesktopSyncClient.Failure.temporary { finish("Couldn’t reach local Branch. Check that it is running on port 4390.") }
            catch { finish("Branch could not approve this chat. Start a new pairing and try again.") }
        }
        updateControls()
    }

    private func sync(windowIndex: Int) async throws {
        guard await sampler.select(windowIndex) else {
            finish("Find and select the chat window again.")
            return
        }
        try Task.checkCancellation()
        let initial = await sampler.syncSample()
        try Task.checkCancellation()
        guard case .transcript(let first) = initial else {
            finish(initialFailure(initial), offerDiagnostics: true)
            return
        }
        guard let identity = try await verifyIdentity(in: first) else { return }

        let client = DesktopSyncClient(conversationID: identity.pairingID)
        connection = client
        guard NSWorkspace.shared.open(client.approvalURL) else {
            finish("Couldn’t open the local Branch board picker.")
            return
        }
        status.stringValue = "Select a board in your browser and approve the connection."
        updateControls()
        guard let board = try await approvedBoard(client) else {
            finish("Board approval expired. Start a new pairing.")
            return
        }
        boardTitle = board.boardTitle
        status.stringValue = "Preparing to sync. Wait until the status says Syncing before sending your next message."
        updateControls()
        var capture = ReplyCapture()
        var unreadableSamples = 0
        while !Task.isCancelled, Date() < client.expiresAt {
            let sample = await sampler.syncSample()
            try Task.checkCancellation()
            switch sample {
            case .transcript(let transcript) where identity.matches(transcript):
                unreadableSamples = 0
                switch capture.observe(transcript) {
                case .waitingForHistory:
                    setStatus("Waiting for the selected chat to finish and show its replies.")
                case .ready:
                    if pending.isEmpty { showSavedStatus() }
                case .generating: break
                case .completed(let reply):
                    guard pending.count < 20 else {
                        finish("Sync stopped because too many replies are waiting to save.")
                        return
                    }
                    pending.append((reply, transcript.title))
                    setStatus("Saving a reply…")
                    upload(using: client, board: board)
                case .historyChanged:
                    finish("The visible replies changed or a streaming cycle was missed. Pair this chat again to resume.")
                    return
                }
            case .incomplete:
                capture.interruptSample()
                unreadableSamples += 1
                if unreadableSamples >= 12 {
                    finish("The selected chat is no longer readable. Reopen the chat and pair again.")
                    return
                }
            case .permissionLost:
                finish("Accessibility access was turned off.")
                return
            default:
                finish("The selected chat changed or closed. Pair again to resume.")
                return
            }
            try await Task.sleep(for: .milliseconds(350))
        }
        try Task.checkCancellation()
        finish("The sync session expired. Pair the chat again to resume.")
    }

    private func initialFailure(_ sample: ChatWindows.SyncRead) -> String {
        switch sample {
        case .permissionLost: "Enable Accessibility access and try again."
        default: "The selected chat couldn’t be read. Keep it visible in ChatGPT and find its window again."
        }
    }

    private func verifyIdentity(in first: ChatTranscript) async throws -> DesktopChatIdentity? {
        if let identity = DesktopChatIdentity.verifiedURL(in: first) { return identity }

        let code = UUID().uuidString.lowercased()
        let identity = DesktopChatIdentity.marker("BRANCH DESKTOP \(code)")
        pairingPrompt = "Reply with exactly these three items separated by spaces. Omit commas and punctuation. BRANCH, DESKTOP, \(code)"
        status.stringValue = "Copy the prompt, then paste and send it in the selected ChatGPT conversation."
        updateControls()
        let clock = ContinuousClock()
        let deadline = clock.now + .seconds(120)
        while clock.now < deadline {
            let read = await sampler.syncSample()
            try Task.checkCancellation()
            switch read {
            case .transcript(let transcript):
                if !transcript.isGenerating, identity.matches(transcript) {
                    pairingPrompt = nil
                    updateControls()
                    return transcript.conversationID.map(DesktopChatIdentity.url) ?? identity
                }
            case .incomplete: break
            case .windowChanged, .permissionLost:
                finish(initialFailure(read))
                return nil
            }
            try await Task.sleep(for: .milliseconds(400))
        }
        finish("Branch couldn’t verify the test reply in this window.", offerDiagnostics: true)
        return nil
    }

    private func approvedBoard(_ client: DesktopSyncClient) async throws -> DesktopSyncClient.Board? {
        let clock = ContinuousClock()
        let deadline = clock.now + .seconds(120)
        var reachedBranch = false
        while clock.now < deadline {
            try Task.checkCancellation()
            do { return try await client.status() }
            catch DesktopSyncClient.Failure.disconnected { reachedBranch = true }
            catch DesktopSyncClient.Failure.temporary {}
            try await Task.sleep(for: .seconds(2))
        }
        if !reachedBranch { throw DesktopSyncClient.Failure.temporary }
        return nil
    }

    private func upload(using client: DesktopSyncClient, board: DesktopSyncClient.Board) {
        guard uploading == nil else { return }
        uploading = Task {
            while !Task.isCancelled, let item = pending.first {
                do {
                    let saved = try await saveWithRetry(item, using: client)
                    try Task.checkCancellation()
                    pending.removeFirst()
                    savedCount += 1
                    cardURL = DesktopSyncClient.cardURL(board: board, saved: saved)
                    updateControls()
                } catch is CancellationError {
                    return
                } catch DesktopSyncClient.Failure.disconnected {
                    finish("The board disconnected. Pair again to resume.")
                    return
                } catch DesktopSyncClient.Failure.temporary {
                    finish("Couldn’t save a reply to local Branch after retrying. Pair again to resume.")
                    return
                } catch {
                    finish("Branch couldn’t save the reply. Check the board and pair again to resume.")
                    return
                }
            }
            guard !Task.isCancelled else { return }
            uploading = nil
            showSavedStatus()
        }
    }

    private func saveWithRetry(_ item: (reply: ReplyCapture.Reply, title: String),
                               using client: DesktopSyncClient) async throws -> DesktopSyncClient.Saved {
        for delay in [1, 2, 4] {
            try Task.checkCancellation()
            do { return try await client.save(item.reply, title: item.title) }
            catch DesktopSyncClient.Failure.temporary { try await Task.sleep(for: .seconds(delay)) }
        }
        try Task.checkCancellation()
        return try await client.save(item.reply, title: item.title)
    }

    private func showSavedStatus() {
        setStatus(savedCount == 0 ? "Syncing. Send a message in ChatGPT to get started."
            : "Syncing. Replies saved: \(savedCount).")
    }

    private func clearSession() -> DesktopSyncClient? {
        watching?.cancel()
        uploading?.cancel()
        watching = nil
        uploading = nil
        pending.removeAll()
        pairingPrompt = nil
        boardTitle = nil
        let client = connection
        connection = nil
        return client
    }

    private func finish(_ message: String, offerDiagnostics: Bool = false) {
        let client = clearSession()
        offersDiagnostics = offerDiagnostics
        status.stringValue = message
        updateControls()
        guard let client else { return }
        Task { try? await client.revoke() }
    }

    @objc private func openCard() {
        if let cardURL { NSWorkspace.shared.open(cardURL) }
    }

    @objc private func openProbe() { onOpenProbe() }

    @objc private func copyPairingPrompt() {
        guard let pairingPrompt else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairingPrompt, forType: .string)
        setStatus("Prompt copied. Paste and send it in the selected conversation, then wait for the board picker.")
    }

    private func setStatus(_ message: String) {
        guard status.stringValue != message else { return }
        status.stringValue = message
        status.isHidden = message.isEmpty
        fitWindow()
    }

    private func fitWindow() {
        guard let container = window.contentView else { return }
        container.layoutSubtreeIfNeeded()
        let contentHeight = ceil(content.frame.height) + 48
        var frame = window.frame
        let delta = contentHeight - container.bounds.height
        guard abs(delta) >= 1 else { return }
        frame.size.height += delta
        frame.origin.y -= delta
        window.setFrame(frame, display: window.isVisible)
    }

    @objc private func updateControls() {
        let trusted = AXIsProcessTrusted()
        let inSession = watching != nil
        let hasChoices = trusted && chatPicker.numberOfItems > 1
        findButton.title = !trusted ? "Allow Accessibility…" : hasChoices ? "Refresh list" : "Find ChatGPT windows"
        findButton.isHidden = inSession
        findButton.isEnabled = !refreshing
        settingsButton.isHidden = inSession || trusted || !requestedAccess
        conversationLabel.isHidden = inSession || !hasChoices
        chatPicker.isHidden = conversationLabel.isHidden
        chatPicker.isEnabled = !chatPicker.isHidden && !refreshing
        startButton.isHidden = chatPicker.isHidden
        startButton.isEnabled = chatPicker.isEnabled && chatPicker.indexOfSelectedItem > 0
        stopButton.title = boardTitle == nil ? "Cancel setup" : "Stop syncing"
        stopButton.isHidden = !inSession
        openButton.isHidden = cardURL == nil
        copyButton.isHidden = pairingPrompt == nil
        diagnosticButton.isHidden = inSession || !offersDiagnostics
        status.isHidden = status.stringValue.isEmpty

        if let boardTitle {
            heading.stringValue = "ChatGPT Sync"
            intro.stringValue = "New replies go to the Context view on \(boardTitle)."
        } else if connection != nil {
            heading.stringValue = "Choose a Branch board"
            intro.stringValue = "Your board receives new replies from this conversation once you approve it."
        } else if pairingPrompt != nil {
            heading.stringValue = "Verify the conversation"
            intro.stringValue = "A test reply helps Branch confirm it’s reading the chat you chose."
        } else {
            heading.stringValue = "Connect ChatGPT"
            intro.stringValue = trusted ? "Send new replies from a ChatGPT conversation to a Branch board."
                : "Allow Accessibility so Branch can find your ChatGPT conversation."
        }
        let primary = [startButton, copyButton, openButton, findButton].first { !$0.isHidden && $0.isEnabled }
        window.defaultButtonCell = primary?.cell as? NSButtonCell
        fitWindow()
        onActivity(inSession)
    }
}
