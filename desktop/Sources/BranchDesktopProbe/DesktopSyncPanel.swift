import AppKit
@preconcurrency import ApplicationServices

/// Owns one opted-in chat and its in-memory queue for the life of the sync session.
@MainActor
final class DesktopSyncPanel: NSObject, NSWindowDelegate {
    private let sampler = ChatWindows()
    private let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 294),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
    private let chatPicker = NSPopUpButton()
    private let status = NSTextField(wrappingLabelWithString: "Open a conversation in the ChatGPT desktop app to get started.")
    private lazy var findButton = button("Find ChatGPT windows", #selector(findChats))
    private lazy var settingsButton = button("Open Accessibility Settings", #selector(openAccessibilitySettings))
    private lazy var startButton = button("Sync selected chat", #selector(start))
    private lazy var stopButton = button("Stop syncing", #selector(stop))
    private lazy var openButton = button("Open Context card", #selector(openCard))
    private lazy var copyButton = button("Copy pairing prompt", #selector(copyPairingPrompt))

    private var watching: Task<Void, Never>?
    private var uploading: Task<Void, Never>?
    private var permissionCheck: Task<Void, Never>?
    private var requestedAccess = false
    private var refreshing = false
    private var connection: DesktopSyncClient?
    private var pending: [(reply: ReplyCapture.Reply, title: String)] = []
    private var cardURL: URL?
    private var pairingPrompt: String?
    private var savedCount = 0
    var onActivity: (Bool) -> Void = { _ in }

    override init() {
        super.init()
        window.title = "ChatGPT Sync"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()

        let intro = NSTextField(wrappingLabelWithString:
            "Allow Accessibility so Branch can find your ChatGPT window. Only the conversation you choose will sync new replies to your Branch board.")
        let tools = row([findButton, settingsButton])
        chatPicker.setAccessibilityLabel("ChatGPT window")
        chatPicker.addItem(withTitle: "Choose a ChatGPT window")
        chatPicker.target = self
        chatPicker.action = #selector(updateControls)
        chatPicker.cell?.truncatesLastVisibleLine = true
        status.setAccessibilityLabel("Sync status")
        status.textColor = .secondaryLabelColor

        let content = NSStackView(views: [intro, tools, chatPicker, row([startButton, stopButton, openButton]), status, copyButton])
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 14
        content.translatesAutoresizingMaskIntoConstraints = false
        let container = NSView()
        container.addSubview(content)
        window.contentView = container
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
            content.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
            content.topAnchor.constraint(equalTo: container.topAnchor, constant: 22),
            intro.widthAnchor.constraint(equalTo: content.widthAnchor),
            chatPicker.widthAnchor.constraint(equalTo: content.widthAnchor),
            status.widthAnchor.constraint(equalTo: content.widthAnchor),
        ])
        updateControls()
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
        finish("Sync stopped.")
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
        status.stringValue = "Allow \(appName) in Accessibility. Branch will find ChatGPT windows as soon as access is approved."
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
            chatPicker.addItem(withTitle: "Choose a ChatGPT window")
            chatPicker.addItems(withTitles: choices)
            refreshing = false
            if !AXIsProcessTrusted() {
                status.stringValue = "Allow Accessibility to find ChatGPT windows."
            } else {
                status.stringValue = choices.isEmpty ? "Open a conversation in the ChatGPT desktop app, then find windows again."
                    : "Select the conversation you want to sync."
            }
            updateControls()
        }
    }

    @objc private func start() {
        let index = chatPicker.indexOfSelectedItem - 1
        guard chatPicker.isEnabled, index >= 0 else { return }
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
            finish(initialFailure(initial))
            return
        }
        guard !first.isGenerating, !first.replies.isEmpty else {
            finish("Select a chat with a readable, completed reply. Use Desktop Sync Probe if the chat already has a reply.")
            return
        }
        guard let identity = try await verifyIdentity(in: first) else { return }

        let client = DesktopSyncClient(conversationID: identity.pairingID)
        connection = client
        guard NSWorkspace.shared.open(client.approvalURL) else {
            finish("Couldn’t open the local Branch board picker.")
            return
        }
        status.stringValue = "Approve a board in your browser, then return to the selected chat."
        guard let board = try await approvedBoard(client) else {
            finish("Board approval expired. Start a new pairing.")
            return
        }
        status.stringValue = "Connecting to \(board.boardTitle). Wait for Syncing before sending a new message."
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
                    status.stringValue = "Waiting for the selected chat to finish and show its replies."
                case .ready:
                    if pending.isEmpty { showSavedStatus(for: board) }
                case .generating: break
                case .completed(let reply):
                    guard pending.count < 20 else {
                        finish("Sync stopped because too many replies are waiting to save.")
                        return
                    }
                    pending.append((reply, transcript.title))
                    status.stringValue = "Saving a reply to \(board.boardTitle)…"
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
        if let conversationID = first.conversationID { return .url(conversationID) }

        let code = UUID().uuidString.lowercased()
        let identity = DesktopChatIdentity.marker("BRANCH DESKTOP \(code)")
        pairingPrompt = "Reply with exactly these three items separated by spaces. Omit commas and punctuation. BRANCH, DESKTOP, \(code)"
        status.stringValue = "Copy the pairing prompt and send it once in the selected chat so Branch can tell this window from other chats."
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
        finish("The pairing reply wasn’t found in the selected chat. Try again or use Desktop Sync Probe.")
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
            showSavedStatus(for: board)
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

    private func showSavedStatus(for board: DesktopSyncClient.Board) {
        status.stringValue = savedCount == 0 ? "Syncing new replies to \(board.boardTitle)."
            : "Syncing to \(board.boardTitle). Replies saved: \(savedCount)."
    }

    private func clearSession() -> DesktopSyncClient? {
        watching?.cancel()
        uploading?.cancel()
        watching = nil
        uploading = nil
        pending.removeAll()
        pairingPrompt = nil
        let client = connection
        connection = nil
        updateControls()
        return client
    }

    private func finish(_ message: String) {
        let client = clearSession()
        status.stringValue = message
        guard let client else { return }
        Task { try? await client.revoke() }
    }

    @objc private func openCard() {
        if let cardURL { NSWorkspace.shared.open(cardURL) }
    }

    @objc private func copyPairingPrompt() {
        guard let pairingPrompt else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairingPrompt, forType: .string)
        status.stringValue = "Pairing prompt copied. Send it in the selected ChatGPT chat."
    }

    @objc private func updateControls() {
        let trusted = AXIsProcessTrusted()
        findButton.title = trusted ? "Find ChatGPT windows" : "Allow Accessibility…"
        findButton.isEnabled = watching == nil && !refreshing
        settingsButton.isHidden = trusted || !requestedAccess
        chatPicker.isEnabled = trusted && watching == nil && !refreshing && chatPicker.numberOfItems > 1
        startButton.isEnabled = chatPicker.isEnabled && chatPicker.indexOfSelectedItem > 0
        stopButton.isEnabled = watching != nil
        openButton.isEnabled = cardURL != nil
        copyButton.isHidden = pairingPrompt == nil
        onActivity(watching != nil)
    }
}
