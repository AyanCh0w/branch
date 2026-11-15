import AppKit

/// Keeps the running app within reach while the user grants access in System Settings.
@MainActor
final class AccessibilitySetupPanel: NSPanel {
    private let appURL: URL

    init(appURL: URL = Bundle.main.bundleURL) {
        self.appURL = appURL
        let size = NSSize(width: 360, height: 288)
        super.init(contentRect: NSRect(origin: .zero, size: size),
                   styleMask: [.titled, .closable, .nonactivatingPanel], backing: .buffered, defer: false)
        title = "Branch Accessibility Setup"
        isFloatingPanel = true
        level = .floating
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        backgroundColor = .white
        appearance = NSAppearance(named: .aqua)

        let appName = appURL.deletingPathExtension().lastPathComponent
        let heading = NSTextField(labelWithString: "Allow Accessibility")
        heading.font = BranchSyncTheme.font(24, strong: true)
        heading.textColor = BranchSyncTheme.ink
        let instructions = label("Drag the app into the Accessibility list in System Settings, then turn it on.")
        let tile = AppBundleDragTile(appURL: appURL, appName: appName)
        let fallback = label("If the app is already listed, just turn it on. You can also add it using the + button in System Settings.")
        let finder = BranchSyncButton(title: "Show in Finder", target: self, action: #selector(showInFinder))
        let stack = NSStackView(views: [heading, instructions, tile, fallback, finder])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        let container = NSView(frame: NSRect(origin: .zero, size: size))
        container.addSubview(stack)
        contentView = container
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -20),
            instructions.widthAnchor.constraint(equalTo: stack.widthAnchor),
            tile.widthAnchor.constraint(equalTo: stack.widthAnchor),
            fallback.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
    }

    /// Opens the system permission pane and keeps the drag source alongside it.
    func show(on screen: NSScreen?) {
        if !isVisible, let frame = screen?.visibleFrame {
            setFrameTopLeftPoint(NSPoint(x: frame.minX + 20, y: frame.maxY - 70))
        }
        if let settings = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(settings)
        }
        makeKeyAndOrderFront(nil)
    }

    /// Reveals the same running bundle for the System Settings Add button or a Finder drag.
    @objc private func showInFinder() {
        NSWorkspace.shared.activateFileViewerSelecting([appURL])
    }

    private func label(_ text: String) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = BranchSyncTheme.font(13)
        label.textColor = BranchSyncTheme.muted
        return label
    }
}

/// Drags a Finder-compatible file URL. No file is copied, moved, or exported by Branch.
@MainActor
private final class AppBundleDragTile: NSView, NSDraggingSource {
    private let appURL: URL
    private let appName: String
    private let icon: NSImage

    init(appURL: URL, appName: String) {
        self.appURL = appURL
        self.appName = appName
        icon = BranchSyncTheme.logo() ?? NSWorkspace.shared.icon(forFile: appURL.path)
        super.init(frame: .zero)
        setAccessibilityElement(true)
        setAccessibilityRole(.image)
        setAccessibilityLabel(appName)
        setAccessibilityHelp("Drag this app into Accessibility, or use Show in Finder and the Add button in System Settings.")
    }

    required init?(coder: NSCoder) { nil }

    override var intrinsicContentSize: NSSize { NSSize(width: 320, height: 58) }

    override func draw(_ dirtyRect: NSRect) {
        BranchSyncTheme.surface(bounds, fill: BranchSyncTheme.canvas, stroke: BranchSyncTheme.line)
        icon.draw(in: NSRect(x: 13, y: 13, width: 32, height: 32))
        BranchSyncTheme.chromeText(appName, size: 14, color: BranchSyncTheme.ink, strong: true)
            .draw(at: NSPoint(x: 58, y: 30))
        BranchSyncTheme.chromeText("Drag into Accessibility", size: 12, color: BranchSyncTheme.muted)
            .draw(at: NSPoint(x: 58, y: 13))
    }

    override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) {}

    override func mouseDragged(with event: NSEvent) {
        let pointer = convert(event.locationInWindow, from: nil)
        let item = NSDraggingItem(pasteboardWriter: appURL as NSURL)
        item.setDraggingFrame(NSRect(x: pointer.x - 20, y: pointer.y - 20, width: 40, height: 40), contents: icon)
        beginDraggingSession(with: [item], event: event, source: self)
    }

    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        context == .outsideApplication ? .copy : []
    }
}
