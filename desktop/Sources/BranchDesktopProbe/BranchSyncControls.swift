import AppKit
import CoreText

@MainActor
enum BranchSyncTheme {
    static let ink = NSColor(srgbRed: 0.09, green: 0.10, blue: 0.12, alpha: 1)
    static let muted = NSColor(srgbRed: 0.32, green: 0.36, blue: 0.42, alpha: 1)
    static let line = NSColor(srgbRed: 0.88, green: 0.89, blue: 0.91, alpha: 1)
    static let canvas = NSColor(srgbRed: 0.96, green: 0.97, blue: 0.98, alpha: 1)
    static let blue = NSColor(srgbRed: 0.19, green: 0.36, blue: 0.96, alpha: 1)

    static func logo() -> NSImage? {
        guard let url = Bundle.main.url(forResource: "branch-mark", withExtension: "svg") else { return nil }
        return NSImage(contentsOf: url)
    }

    static func registerFonts() {
        for weight in ["Regular", "DemiBold"] {
            if let url = Bundle.main.url(forResource: "BDOGrotesk-\(weight)", withExtension: "woff2") {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }

    static func font(_ size: CGFloat, strong: Bool = false) -> NSFont {
        let weight = strong ? "DemiBold" : "Regular"
        return NSFont(name: "BDOGrotesk-\(weight)", size: size)
            ?? .systemFont(ofSize: size, weight: strong ? .semibold : .regular)
    }

    static func surface(_ rect: NSRect, radius: CGFloat = 6, fill: NSColor, stroke: NSColor? = nil) {
        let path = NSBezierPath(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: radius, yRadius: radius)
        fill.setFill()
        path.fill()
        if let stroke {
            stroke.setStroke()
            path.lineWidth = 1
            path.stroke()
        }
    }

    static func chromeText(_ title: String, size: CGFloat, color: NSColor, strong: Bool = false) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        return NSAttributedString(string: title, attributes: [
            .font: font(size, strong: strong), .foregroundColor: color, .paragraphStyle: paragraph,
        ])
    }
}

/// Native button behavior with Branch's spacing, typography, and contrast.
@MainActor
final class BranchSyncButton: NSButton {
    override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsetsZero }

    var isPrimary = false {
        didSet { needsDisplay = true }
    }

    override var title: String {
        didSet {
            invalidateIntrinsicContentSize()
            needsDisplay = true
        }
    }

    override var isEnabled: Bool {
        didSet { needsDisplay = true }
    }

    override var intrinsicContentSize: NSSize {
        NSSize(width: ceil(caption.size().width) + 28, height: 36)
    }

    private var caption: NSAttributedString {
        BranchSyncTheme.chromeText(title, size: 13,
                                   color: !isEnabled ? BranchSyncTheme.muted : isPrimary ? .white : BranchSyncTheme.ink,
                                   strong: true)
    }

    override func draw(_ dirtyRect: NSRect) {
        let fill = isPrimary ? (isHighlighted ? BranchSyncTheme.blue : BranchSyncTheme.ink)
            : isHighlighted ? BranchSyncTheme.canvas : .white
        BranchSyncTheme.surface(bounds, fill: fill, stroke: isPrimary ? nil : BranchSyncTheme.line)
        let text = caption
        let size = text.size()
        text.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2))
    }

    override func highlight(_ flag: Bool) {
        super.highlight(flag)
        needsDisplay = true
    }

    override var focusRingMaskBounds: NSRect { bounds }

    override func drawFocusRingMask() {
        BranchSyncTheme.surface(bounds, fill: .black)
    }
}

/// Keeps the system menu and keyboard interaction behind a Branch conversation field.
@MainActor
final class BranchConversationPicker: NSPopUpButton {
    override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsetsZero }
    override var intrinsicContentSize: NSSize { NSSize(width: 220, height: 42) }

    override func draw(_ dirtyRect: NSRect) {
        BranchSyncTheme.surface(bounds, fill: .white, stroke: BranchSyncTheme.line)
        let text = BranchSyncTheme.chromeText(titleOfSelectedItem ?? "", size: 14, color: BranchSyncTheme.ink)
        let textHeight = ceil(text.size().height)
        text.draw(in: NSRect(x: 14, y: (bounds.height - textHeight) / 2, width: bounds.width - 46, height: textHeight))

        let chevron = NSBezierPath()
        let x = bounds.maxX - 18
        let y = bounds.midY
        chevron.move(to: NSPoint(x: x - 4, y: y + 2))
        chevron.line(to: NSPoint(x: x, y: y - 2))
        chevron.line(to: NSPoint(x: x + 4, y: y + 2))
        chevron.lineWidth = 1.5
        BranchSyncTheme.muted.setStroke()
        chevron.stroke()
    }

    override var focusRingMaskBounds: NSRect { bounds }

    override func drawFocusRingMask() {
        BranchSyncTheme.surface(bounds, fill: .black)
    }
}

/// Shows whether Branch is waiting or has started syncing.
@MainActor
final class BranchSyncStatus: NSView {
    private var caption = ""
    private var connected = false
    private var pending = false

    override var intrinsicContentSize: NSSize { NSSize(width: 220, height: 38) }

    func show(_ caption: String, connected: Bool, pending: Bool) {
        guard self.caption != caption || self.connected != connected || self.pending != pending else { return }
        self.caption = caption
        self.connected = connected
        self.pending = pending
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        setAccessibilityValue(caption)
        needsDisplay = true
        if window?.isVisible == true { NSAccessibility.post(element: self, notification: .valueChanged) }
    }

    override func draw(_ dirtyRect: NSRect) {
        BranchSyncTheme.surface(bounds, fill: BranchSyncTheme.canvas)
        let active = NSColor(srgbRed: 0.12, green: 0.45, blue: 0.29, alpha: 1)
        let indicator = connected ? active : pending ? BranchSyncTheme.blue : BranchSyncTheme.muted
        indicator.setFill()
        NSBezierPath(ovalIn: NSRect(x: 14, y: bounds.midY - 4, width: 8, height: 8)).fill()
        let text = BranchSyncTheme.chromeText(caption, size: 13, color: BranchSyncTheme.ink, strong: true)
        text.draw(in: NSRect(x: 30, y: bounds.midY - text.size().height / 2,
                             width: bounds.width - 44, height: ceil(text.size().height)))
    }
}
