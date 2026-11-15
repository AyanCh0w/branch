import AppKit

/// Illustrates the gesture without changing Accessibility permissions.
@MainActor
final class AccessibilityDragDemo: NSView {
    private let icon: NSImage
    private let openHand = NSCursor.openHand.image
    private let closedHand = NSCursor.closedHand.image
    private let dropTime = 2.35
    private let endTime = 3.55
    private var startTime: TimeInterval?
    private var elapsed: TimeInterval = 0
    private var timer: Timer?

    var onMotionPreferenceChange: (() -> Void)?
    var canAnimate: Bool { !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    init(icon: NSImage) {
        self.icon = icon
        super.init(frame: .zero)
        // The nearby instructions already describe the gesture for assistive technology.
        setAccessibilityElement(false)
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(motionPreferenceChanged(_:)),
            name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil
        )
    }

    required init?(coder: NSCoder) { nil }

    override var intrinsicContentSize: NSSize { NSSize(width: 320, height: 106) }

    // Only the actual app tile should respond to a drag.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    /// Plays one short demonstration, then leaves the result visible.
    func play() {
        stop()
        needsDisplay = true
        guard canAnimate else { return }
        startTime = ProcessInfo.processInfo.systemUptime
        timer = Timer.scheduledTimer(timeInterval: 1.0 / 30, target: self,
                                     selector: #selector(updateFrame(_:)), userInfo: nil, repeats: true)
        timer?.tolerance = 0.005
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        startTime = nil
        elapsed = 0
    }

    @objc nonisolated private func motionPreferenceChanged(_ notification: Notification) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            if !canAnimate {
                stop()
                needsDisplay = true
            }
            onMotionPreferenceChange?()
        }
    }

    @objc private func updateFrame(_ timer: Timer) {
        guard let startTime, window?.isVisible == true else { stop(); return }
        elapsed = min(endTime, ProcessInfo.processInfo.systemUptime - startTime)
        needsDisplay = true
        if elapsed >= endTime {
            timer.invalidate()
            self.timer = nil
            self.startTime = nil
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        let example = NSRect(x: bounds.width - 170, y: 12, width: 158, height: 82)
        let dropped = elapsed >= dropTime
        let carrying = elapsed >= 0.8 && !dropped
        let progress = easedProgress(elapsed, from: 1.12, to: dropTime)

        BranchSyncTheme.surface(bounds, radius: 8, fill: BranchSyncTheme.canvas, stroke: BranchSyncTheme.line)
        drawSettings(example, dropped: dropped, hovering: carrying && progress > 0.7)
        drawRoute(to: example.minX)

        let source = NSRect(x: 15, y: 37, width: 48, height: 44)
        BranchSyncTheme.surface(source, fill: .white, stroke: BranchSyncTheme.line)
        icon.draw(in: source.insetBy(dx: 13, dy: 11), from: .zero, operation: .sourceOver, fraction: carrying ? 0.25 : 1)
        drawText("Branch", x: 20, y: 17, size: 11, color: BranchSyncTheme.muted)

        let destination = NSPoint(x: example.minX + 18, y: 34)
        let pickup = NSPoint(x: source.midX, y: source.midY)
        let position = NSPoint(x: pickup.x + (destination.x - pickup.x) * progress,
                               y: pickup.y + (destination.y - pickup.y) * progress + 16 * progress * (1 - progress))
        if carrying {
            let badge = NSRect(x: position.x - 14, y: position.y - 14, width: 28, height: 28)
            BranchSyncTheme.surface(badge, fill: .white, stroke: BranchSyncTheme.blue)
            icon.draw(in: badge.insetBy(dx: 6, dy: 6))
        }

        if elapsed > 0 && elapsed < 3.08 {
            let reach = easedProgress(elapsed, from: 0.1, to: 0.8)
            let leave = easedProgress(elapsed, from: dropTime + 0.15, to: 3.08)
            let hand = carrying ? closedHand : openHand
            hand.draw(in: NSRect(x: position.x + 4 + 16 * leave, y: position.y - 32 + 8 * reach - 12 * leave,
                                 width: 22, height: 22), from: .zero, operation: .sourceOver, fraction: 1 - leave)
        }
    }

    private func drawSettings(_ panel: NSRect, dropped: Bool, hovering: Bool) {
        BranchSyncTheme.surface(panel, radius: 7, fill: .white, stroke: BranchSyncTheme.line)
        drawText("Accessibility", x: panel.minX + 10, y: panel.maxY - 22, size: 12,
                 color: BranchSyncTheme.ink, strong: true)
        BranchSyncTheme.surface(NSRect(x: panel.minX + 10, y: panel.maxY - 36, width: 60, height: 5),
                                radius: 2.5, fill: BranchSyncTheme.line)
        let row = NSRect(x: panel.minX + 8, y: panel.minY + 9, width: panel.width - 16, height: 25)
        BranchSyncTheme.surface(row, radius: 4, fill: BranchSyncTheme.blue.withAlphaComponent(hovering ? 0.13 : 0.055),
                                stroke: BranchSyncTheme.blue.withAlphaComponent(hovering ? 1 : 0.42))
        if dropped {
            icon.draw(in: NSRect(x: row.minX + 5, y: row.minY + 6, width: 12, height: 13))
            drawText("Branch for Mac", x: row.minX + 22, y: row.minY + 5, size: 11, color: BranchSyncTheme.ink, strong: true)
            let toggle = NSRect(x: row.maxX - 25, y: row.midY - 5, width: 18, height: 10)
            BranchSyncTheme.surface(toggle, radius: 5, fill: BranchSyncTheme.line)
            BranchSyncTheme.surface(NSRect(x: toggle.minX + 1, y: toggle.minY + 1, width: 8, height: 8),
                                    radius: 4, fill: .white)
        } else {
            drawText("Drop app here", x: row.minX + 8, y: row.minY + 5, size: 11, color: BranchSyncTheme.muted)
        }
    }

    private func drawRoute(to x: CGFloat) {
        let arrow = NSBezierPath()
        let tip = NSPoint(x: x - 6, y: 34)
        arrow.move(to: NSPoint(x: 69, y: 59))
        arrow.curve(to: tip, controlPoint1: NSPoint(x: 104, y: 59), controlPoint2: NSPoint(x: x - 40, y: 34))
        arrow.setLineDash([3, 4], count: 2, phase: 0)
        arrow.lineWidth = 1.5
        BranchSyncTheme.blue.setStroke()
        arrow.stroke()
        let head = NSBezierPath()
        head.move(to: NSPoint(x: tip.x - 5, y: tip.y + 4))
        head.line(to: tip)
        head.line(to: NSPoint(x: tip.x - 5, y: tip.y - 4))
        head.lineWidth = 1.5
        head.stroke()
    }

    private func drawText(_ text: String, x: CGFloat, y: CGFloat, size: CGFloat, color: NSColor, strong: Bool = false) {
        BranchSyncTheme.chromeText(text, size: size, color: color, strong: strong).draw(at: NSPoint(x: x, y: y))
    }

    private func easedProgress(_ time: TimeInterval, from start: TimeInterval, to end: TimeInterval) -> CGFloat {
        let t = CGFloat(min(1, max(0, (time - start) / (end - start))))
        return t * t * (3 - 2 * t)
    }
}
