import AppKit
import CoreText

@MainActor
enum BranchSyncTheme {
    static let ink = NSColor(srgbRed: 0.09, green: 0.10, blue: 0.12, alpha: 1)
    static let muted = NSColor(srgbRed: 0.32, green: 0.36, blue: 0.42, alpha: 1)
    static let line = NSColor(srgbRed: 0.88, green: 0.89, blue: 0.91, alpha: 1)
    static let canvas = NSColor(srgbRed: 0.96, green: 0.97, blue: 0.98, alpha: 1)
    static let blue = NSColor(srgbRed: 0.19, green: 0.36, blue: 0.96, alpha: 1)

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

/// Shows where replies will go before the board has been chosen.
@MainActor
final class BranchSyncRoute: NSView {
    override var intrinsicContentSize: NSSize { NSSize(width: 220, height: 44) }

    override func draw(_ dirtyRect: NSRect) {
        BranchSyncTheme.surface(bounds, fill: BranchSyncTheme.canvas)
        let source = BranchSyncTheme.chromeText("ChatGPT", size: 12, color: BranchSyncTheme.ink, strong: true)
        let target = BranchSyncTheme.chromeText("Board Context", size: 12, color: BranchSyncTheme.ink, strong: true)
        let sourceX: CGFloat = 16
        let targetX = bounds.width - target.size().width - 16
        source.draw(at: NSPoint(x: sourceX, y: (bounds.height - source.size().height) / 2))
        target.draw(at: NSPoint(x: targetX, y: (bounds.height - target.size().height) / 2))

        let start = sourceX + source.size().width + 16
        let end = targetX - 16
        let y = bounds.midY
        let wire = NSBezierPath()
        wire.move(to: NSPoint(x: start, y: y))
        wire.line(to: NSPoint(x: end - 7, y: y))
        wire.setLineDash([3, 3], count: 2, phase: 0)
        BranchSyncTheme.blue.setStroke()
        wire.stroke()
        let arrow = NSBezierPath()
        arrow.move(to: NSPoint(x: end - 4, y: y + 3))
        arrow.line(to: NSPoint(x: end, y: y))
        arrow.line(to: NSPoint(x: end - 4, y: y - 3))
        arrow.stroke()
    }
}
