import AppKit
@preconcurrency import ApplicationServices

/// Owns one opted-in chat and its in-memory queue for the life of the sync session.
@MainActor
final class DesktopSyncPanel: NSObject, NSWindowDelegate {
    private enum Phase {
        case idle, checking, approval, preparing, connected, paused

        var status: String {
            switch self {
            case .idle: "Not connected"
            case .checking: "Checking the selected chat"
            case .approval: "Waiting for board approval"
            case .preparing: "Getting the chat ready"
            case .connected: "Connected · Sync is on"
            case .paused: "Connected · Waiting for your chat"
            }
        }
    }

    private var phase = Phase.idle
    private let connectionStatus = BranchSyncStatus()
    private let sampler = ChatWindows()
    private let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 500, height: 312),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
    private let content = NSStackView()
    private let heading = NSTextField(labelWithString: "Connect ChatGPT")
    private let intro = NSTextField(wrappingLabelWithString: "")
    private let conversationLabel = NSTextField(labelWithString: "Conversation")
    private let chatPicker = BranchConversationPicker()
    private let status = NSTextField(wrappingLabelWithString: "")
    private lazy var findButton = button("Find ChatGPT windows", #selector(findChats))
    private lazy var settingsButton = button("Open Accessibility Settings", #selector(openAccessibilitySettings))
    private lazy var startButton = button("Connect chat", #selector(start))
    private lazy var stopButton = button("Stop syncing", #selector(stop))
    private lazy var openButton = button("Open in Branch", #selector(openCard))
    private lazy var approvalButton = button("Open board approval", #selector(openApproval))
    private lazy var diagnosticButton = button("Check window compatibility", #selector(openProbe))
    private lazy var chatGPTButton = button("Open ChatGPT", #selector(openChatGPT))

    private var watching: Task<Void, Never>?
    private var uploading: Task<Void, Never>?
    private var permissionCheck: Task<Void, Never>?
    private var discovery: Task<Void, Never>?
    private var preferredBoardID: String?
    private var pendingLink: ConnectionLink?
    private var launchTicket: String?
    private var requestedAccess = false
    private var refreshing = false
    private var connection: DesktopSyncClient?
    private var boardTitle: String?
    private var pending: [(reply: ReplyCapture.Reply, title: String)] = []
    private var cardURL: URL?
    private var chatTitle: String?
    private var savedCount = 0
    private var offersDiagnostics = false
    var onActivity: (Bool) -> Void = { _ in }
    var onOpenProbe: () -> Void = {}

    override init() {
        super.init()
        BranchSyncTheme.registerFonts()
        window.title = "ChatGPT Sync"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .white
        window.appearance = NSAppearance(named: .aqua)
        window.delegate = self
        window.isReleasedWhenClosed = false

        let brand = brandHeader()
        heading.font = BranchSyncTheme.font(32, strong: true)
        heading.textColor = BranchSyncTheme.ink
        intro.font = BranchSyncTheme.font(15)
        intro.textColor = BranchSyncTheme.muted
        conversationLabel.font = BranchSyncTheme.font(13, strong: true)
        conversationLabel.textColor = BranchSyncTheme.ink
        chatPicker.setAccessibilityLabel("ChatGPT conversation")
        chatPicker.addItem(withTitle: "Choose a conversation")
        chatPicker.target = self
        chatPicker.action = #selector(updateControls)
        chatPicker.cell?.truncatesLastVisibleLine = true
        status.font = BranchSyncTheme.font(14)
        status.textColor = BranchSyncTheme.ink
        status.setAccessibilityLabel("Sync status")
        let actions = row([startButton, approvalButton, openButton, findButton, settingsButton, diagnosticButton, stopButton])
        let helpActions = row([chatGPTButton])
        [brand, heading, intro, connectionStatus, conversationLabel, chatPicker, status, actions, helpActions].forEach(content.addArrangedSubview)
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 14
        content.setCustomSpacing(18, after: brand)
        content.setCustomSpacing(6, after: heading)
        content.setCustomSpacing(16, after: intro)
        content.setCustomSpacing(6, after: conversationLabel)
        content.setCustomSpacing(16, after: status)
        content.translatesAutoresizingMaskIntoConstraints = false
        let container = NSView()
        container.addSubview(content)
        window.contentView = container
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 30),
            content.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -30),
            content.topAnchor.constraint(equalTo: container.topAnchor, constant: 14),
            intro.widthAnchor.constraint(equalTo: content.widthAnchor),
            connectionStatus.widthAnchor.constraint(equalTo: content.widthAnchor),
            chatPicker.widthAnchor.constraint(equalTo: content.widthAnchor),
            status.widthAnchor.constraint(equalTo: content.widthAnchor),
        ])
        updateControls()
        window.center()
    }

    /// Brings the sync window to the front while leaving an existing session running.
    func show(link: ConnectionLink? = nil) {
        if watching == nil, let link, link.boardID != nil || link.chatTitle != nil {
            preferredBoardID = link.boardID
            launchTicket = link.ticket
            pendingLink = link.chatTitle == nil ? nil : link
        }
        updateControls()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        if AXIsProcessTrusted() { refresh() }
        startDiscovery()
    }

    func windowDidBecomeKey(_ notification: Notification) {
        if AXIsProcessTrusted() { refresh() }
    }

    func windowWillClose(_ notification: Notification) {
        pendingLink = nil
        if watching == nil { launchTicket = nil }
        permissionCheck?.cancel()
        permissionCheck = nil
        discovery?.cancel()
        discovery = nil
    }

    private func startDiscovery() {
        guard discovery == nil else { return }
        discovery = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.window.isVisible else { return }
                if self.watching == nil && !self.refreshing && self.chatPicker.numberOfItems <= 1 && AXIsProcessTrusted() { self.refresh() }
                do { try await Task.sleep(for: .seconds(3)) } catch { return }
            }
        }
    }

    @objc private func openChatGPT() {
        let apps = ["com.openai.codex", "com.openai.chat"]
        let workspace = NSWorkspace.shared
        let bundleID = apps.first { !NSRunningApplication.runningApplications(withBundleIdentifier: $0).isEmpty }
        guard let url = (bundleID.flatMap { workspace.urlForApplication(withBundleIdentifier: $0) }
            ?? apps.lazy.compactMap { workspace.urlForApplication(withBundleIdentifier: $0) }.first) else {
            status.stringValue = "Open the ChatGPT Mac app and leave your conversation visible. Branch will find it automatically."
            updateControls()
            return
        }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }

    /// Cancels capture, clears unsent data and revokes the current write capability.
    @objc func stop() {
        launchTicket = nil
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
        row.alignment = .centerY
        row.spacing = 8
        return row
    }

    private func brandHeader() -> NSStackView {
        let wordmark = NSTextField(labelWithString: "branch")
        wordmark.font = BranchSyncTheme.font(19, strong: true)
        wordmark.textColor = BranchSyncTheme.ink
        guard let url = Bundle.main.url(forResource: "branch-mark", withExtension: "svg"),
              let image = NSImage(contentsOf: url) else { return row([wordmark]) }
        let mark = NSImageView(image: image)
        mark.imageScaling = .scaleProportionallyUpOrDown
        mark.widthAnchor.constraint(equalToConstant: 21).isActive = true
        mark.heightAnchor.constraint(equalToConstant: 21).isActive = true
        return row([mark, wordmark])
    }

    private func button(_ title: String, _ action: Selector) -> BranchSyncButton {
        let button = BranchSyncButton(title: title, target: self, action: action)
        button.focusRingType = .exterior
        return button
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
        guard watching == nil, !refreshing else { return }
        refreshing = true
        let previous = chatPicker.indexOfSelectedItem > 0 ? chatPicker.titleOfSelectedItem : nil
        if chatPicker.numberOfItems <= 1 { status.stringValue = "Looking for ChatGPT conversations…" }
        updateControls()
        Task {
            let choices = await sampler.list()
            chatPicker.removeAllItems()
            chatPicker.addItem(withTitle: "Choose a conversation")
            chatPicker.addItems(withTitles: choices.map(\.label))
            if let previous, choices.filter({ $0.label == previous }).count == 1 { chatPicker.selectItem(withTitle: previous) }
            else if choices.count == 1 { chatPicker.selectItem(at: 1) }
            refreshing = false
            let link = choices.isEmpty ? nil : pendingLink
            if link != nil { pendingLink = nil }
            if !AXIsProcessTrusted() {
                status.stringValue = "Allow Accessibility to find ChatGPT windows."
            } else if choices.isEmpty {
                status.stringValue = "Open ChatGPT and leave a chat visible. It will appear here automatically."
            } else if let link, let index = link.matchingChat(in: choices.map(\.title)), window.isVisible {
                chatPicker.selectItem(at: index + 1)
                updateControls()
                start()
                return
            } else if link != nil {
                chatPicker.selectItem(at: 0)
                status.stringValue = "Branch couldn’t identify the requested chat. Open it in ChatGPT and choose it here."
            } else {
                status.stringValue = "Choose the chat you want your team to see. Existing replies stay private; only new completed replies are shared."
            }
            updateControls()
        }
    }

    @objc private func start() {
        let index = chatPicker.indexOfSelectedItem - 1
        guard chatPicker.isEnabled, index >= 0 else { return }
        offersDiagnostics = false
        pendingLink = nil
        cardURL = nil
        savedCount = 0
        status.stringValue = "Keep the conversation open in ChatGPT while Branch checks it."
        phase = .checking
        watching = Task {
            do { try await sync(windowIndex: index) }
            catch is CancellationError { return }
            catch DesktopSyncClient.Failure.disconnected { finish("The board disconnected. Pair again to resume.") }
            catch DesktopSyncClient.Failure.temporary { finish("Couldn’t reach Branch. Check your internet connection and try again.") }
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
        let clock = ContinuousClock()
        let deadline = clock.now + .seconds(120)
        var sample = await sampler.syncSample(beginPairing: true)
        var retries = 3
        while clock.now < deadline {
            switch sample {
            case .transcript(let chat, nil) where chat.isGenerating:
                setStatus("Leave this chat open while the reply finishes. Branch will then continue setup.")
            case .incomplete, .transcript(_, nil):
                retries -= 1
            default:
                retries = 0
            }
            guard retries > 0 else { break }
            try await Task.sleep(for: .milliseconds(400))
            sample = await sampler.syncSample(beginPairing: true)
        }
        try Task.checkCancellation()
        guard case .transcript(let first, let pairingID?) = sample else {
            finish(initialFailure(sample), offerDiagnostics: true)
            return
        }
        chatTitle = first.title.isEmpty ? nil : first.title

        let client = DesktopSyncClient(conversationID: pairingID, preferredBoardID: preferredBoardID)
        connection = client
        guard let board = try await connectBoard(using: client) else { return }
        try Task.checkCancellation()
        boardTitle = board.boardTitle
        phase = .preparing
        status.stringValue = "Keep the chat open. Send your next message when this window says Connected."
        updateControls()
        var capture = ReplyCapture()
        var incompleteSamples = 0
        while !Task.isCancelled, Date() < client.expiresAt {
            let sample = await sampler.syncSample()
            try Task.checkCancellation()
            switch sample {
            case .transcript(let transcript, _):
                incompleteSamples = 0
                switch capture.observe(transcript) {
                case .waitingForHistory:
                    if phase != .paused {
                        setStatus("Keep this chat visible and let the current response finish. Branch will then start syncing.")
                    }
                case .ready:
                    if pending.isEmpty { showSavedStatus() }
                    else { showActiveStatus("Saving a reply…") }
                case .generating:
                    if phase != .preparing, pending.isEmpty {
                        showActiveStatus("Waiting for ChatGPT to finish its reply…")
                    }
                case .completed(let reply):
                    guard pending.count < 20 else {
                        finish("Sync stopped because too many replies are waiting to save.")
                        return
                    }
                    pending.append((reply, transcript.title))
                    showActiveStatus("Saving a reply…")
                    upload(using: client, board: board)
                case .historyChanged:
                    capture.pause()
                    showPausedStatus("Branch is checking the visible replies. Sync will resume automatically.")
                }
            case .incomplete where phase != .paused && incompleteSamples < 2:
                incompleteSamples += 1
                capture.interruptSample()
            case .incomplete, .windowChanged:
                capture.pause()
                let chat = chatTitle.map { "“\($0)”" } ?? "the connected conversation"
                showPausedStatus("Return to \(chat) in its ChatGPT window. Sync will resume automatically.")
            case .permissionLost:
                finish("Accessibility access was turned off.")
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
        case .windowChanged: "The selected chat window changed or closed. Reopen it in ChatGPT, then select it again in Branch."
        case .transcript(let transcript, _):
            transcript.isGenerating
                ? "Let ChatGPT finish its reply, then click Connect chat again."
                : "Branch needs to see a completed reply in this chat. Open a chat with an existing reply, then click Connect chat."
        case .incomplete: "Branch couldn’t read the selected chat. Keep it open and visible in ChatGPT, then try again."
        }
    }

    private func connectBoard(using client: DesktopSyncClient) async throws -> DesktopSyncClient.Board? {
        if let launchTicket, let preferredBoardID {
            self.launchTicket = nil
            setStatus("Connecting this chat to your Branch board…")
            do {
                return try await client.redeem(launchTicket, boardID: preferredBoardID)
            } catch DesktopSyncClient.Failure.temporary {
                // The server may have redeemed the ticket before the response was interrupted.
                return try await client.status()
            } catch DesktopSyncClient.Failure.disconnected {
                finish("This board connection expired or was disconnected. Click Connect ChatGPT to this board again.")
                return nil
            }
        }
        guard NSWorkspace.shared.open(client.approvalURL) else {
            finish("Couldn’t open Branch. Check your default browser and try again.")
            return nil
        }
        phase = .approval
        status.stringValue = "In your browser, choose the board where this chat’s new replies should go."
        updateControls()
        if let board = try await approvedBoard(client) { return board }
        finish("Board selection expired. Start a new pairing.")
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
                    finish("Couldn’t save a reply to Branch after retrying. Pair again to resume.")
                    return
                } catch {
                    finish("Branch couldn’t save the reply. Check the board and pair again to resume.")
                    return
                }
            }
            guard !Task.isCancelled else { return }
            uploading = nil
            if phase != .paused { showSavedStatus() }
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
        if savedCount == 0 {
            showActiveStatus("Send a new message in ChatGPT. Its completed reply will appear in the board’s Context view.")
        } else if savedCount == 1 {
            showActiveStatus("1 reply saved to Context.")
        } else {
            showActiveStatus("\(savedCount) replies saved to Context.")
        }
    }

    private func showActiveStatus(_ message: String) {
        if phase != .connected {
            phase = .connected
            updateControls()
        }
        setStatus(message)
    }

    private func showPausedStatus(_ message: String) {
        if phase != .paused {
            phase = .paused
            updateControls()
        }
        setStatus(message)
    }

    private func clearSession() -> DesktopSyncClient? {
        watching?.cancel()
        uploading?.cancel()
        watching = nil
        uploading = nil
        pending.removeAll()
        phase = .idle
        chatTitle = nil
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

    @objc private func openApproval() {
        guard phase == .approval, let connection else { return }
        if !NSWorkspace.shared.open(connection.approvalURL) {
            setStatus("Couldn’t open your browser. Try Open board approval again.")
        }
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
        let contentHeight = ceil(content.frame.height) + 42
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
        stopButton.title = boardTitle != nil ? "Stop syncing" : "Cancel setup"
        stopButton.isHidden = !inSession
        openButton.isHidden = cardURL == nil
        approvalButton.isHidden = phase != .approval
        diagnosticButton.isHidden = inSession || !offersDiagnostics
        chatGPTButton.isHidden = inSession || !trusted
        status.isHidden = status.stringValue.isEmpty

        connectionStatus.show(phase.status, connected: phase == .connected, pending: inSession && phase != .connected)
        switch phase {
        case .idle:
            heading.stringValue = "Connect ChatGPT"
            intro.stringValue = trusted ? "Choose an open chat to send its new replies to a Branch board."
                : "Allow Accessibility once so Branch can find your open ChatGPT windows."
        case .checking:
            heading.stringValue = "Checking your chat"
            intro.stringValue = "Branch is checking that it can read completed replies."
        case .approval:
            heading.stringValue = "Approve a Branch board"
            intro.stringValue = chatTitle.map { "Branch verified “\($0)”." } ?? "Branch verified your chat."
        case .preparing, .connected, .paused:
            heading.stringValue = phase == .preparing ? "Connecting ChatGPT" : "ChatGPT is connected"
            intro.stringValue = "New replies from this chat go to Context on \(boardTitle ?? "your board")."
        }
        let primaryButtons = [startButton, approvalButton, openButton, findButton]
        let primary = primaryButtons.first { !$0.isHidden && $0.isEnabled }
        for button in primaryButtons {
            button.isPrimary = button === primary
        }
        window.defaultButtonCell = primary?.cell as? NSButtonCell
        fitWindow()
        onActivity(inSession)
    }
}
