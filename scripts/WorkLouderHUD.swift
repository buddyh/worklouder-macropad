import AppKit
import Foundation

struct Options {
    let title: String
    let detail: String?
    let duration: TimeInterval

    static func parse(_ arguments: [String]) -> Options {
        var title: String?
        var detail: String?
        var duration: TimeInterval = 0.8
        var index = 1

        while index < arguments.count {
            let value = arguments[index]
            if value == "--detail", index + 1 < arguments.count {
                detail = arguments[index + 1]
                index += 2
            } else if value == "--duration", index + 1 < arguments.count {
                duration = min(max(Double(arguments[index + 1]) ?? 0.8, 0.2), 5)
                index += 2
            } else if title == nil {
                title = value
                index += 1
            } else {
                index += 1
            }
        }

        return Options(
            title: title ?? "Work Louder",
            detail: detail,
            duration: duration
        )
    }
}

final class HUDDelegate: NSObject, NSApplicationDelegate {
    private let options: Options
    private var panel: NSPanel?

    init(options: Options) {
        self.options = options
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let title = NSTextField(labelWithString: options.title)
        title.font = .systemFont(ofSize: 18, weight: .semibold)
        title.textColor = .labelColor
        title.alignment = .center
        title.lineBreakMode = .byTruncatingTail

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 3
        stack.addArrangedSubview(title)

        if let detail = options.detail, !detail.isEmpty {
            let subtitle = NSTextField(labelWithString: detail)
            subtitle.font = .systemFont(ofSize: 12, weight: .medium)
            subtitle.textColor = .secondaryLabelColor
            subtitle.alignment = .center
            subtitle.lineBreakMode = .byTruncatingTail
            stack.addArrangedSubview(subtitle)
        }

        stack.translatesAutoresizingMaskIntoConstraints = false
        let effect = NSVisualEffectView()
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = 14
        effect.layer?.masksToBounds = true
        effect.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: effect.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: effect.trailingAnchor, constant: -22),
            stack.topAnchor.constraint(equalTo: effect.topAnchor, constant: 13),
            stack.bottomAnchor.constraint(equalTo: effect.bottomAnchor, constant: -13),
            title.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
        ])

        effect.layoutSubtreeIfNeeded()
        let fitting = stack.fittingSize
        let size = NSSize(
            width: min(max(fitting.width + 44, 180), 480),
            height: min(max(fitting.height + 26, 48), 100)
        )
        let screen = activeScreen()
        let frame = NSRect(
            x: screen.visibleFrame.midX - size.width / 2,
            y: screen.visibleFrame.maxY - size.height - 46,
            width: size.width,
            height: size.height
        )

        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentView = effect
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = true
        panel.level = .statusBar
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .transient,
            .ignoresCycle,
        ]
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        self.panel = panel

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.12
            panel.animator().alphaValue = 1
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + options.duration) {
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = 0.15
                panel.animator().alphaValue = 0
            }, completionHandler: {
                panel.close()
                NSApplication.shared.terminate(nil)
            })
        }
    }

    private func activeScreen() -> NSScreen {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) })
            ?? NSScreen.main
            ?? NSScreen.screens[0]
    }
}

let options = Options.parse(CommandLine.arguments)
let application = NSApplication.shared
let delegate = HUDDelegate(options: options)
application.setActivationPolicy(.accessory)
application.delegate = delegate
application.run()
