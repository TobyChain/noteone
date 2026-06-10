#if os(macOS)
import AppKit
import SwiftUI

@MainActor
class HotkeyManager: ObservableObject {
    static let shared = HotkeyManager()
    private var panel: FloatingPanel?
    private var monitor: Any?

    func register() {
        monitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.modifierFlags.contains([.command, .shift]) && event.keyCode == 45 {
                DispatchQueue.main.async { self?.togglePanel() }
            }
        }
    }

    func unregister() {
        if let monitor = monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }

    func togglePanel() {
        if let panel = panel, panel.isVisible {
            panel.close()
            self.panel = nil
            return
        }

        let selectedText = captureSelectedText()

        let captureView = CaptureView(
            initialContent: selectedText,
            onDismiss: { [weak self] in
                self?.panel?.close()
                self?.panel = nil
            }
        )

        let hostingView = NSHostingView(rootView: captureView)
        let panel = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 480, height: 320))
        panel.contentView = hostingView
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.panel = panel
    }

    private nonisolated func captureSelectedText() -> String? {
        let pasteboard = NSPasteboard.general
        let originalChangeCount = pasteboard.changeCount
        let originalContent = pasteboard.string(forType: .string)

        let source = CGEventSource(stateID: .combinedSessionState)
        guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0x08, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0x08, keyDown: false) else {
            return nil
        }
        keyDown.flags = .maskCommand
        keyUp.flags = .maskCommand
        keyDown.post(tap: .cgSessionEventTap)
        keyUp.post(tap: .cgSessionEventTap)

        Thread.sleep(forTimeInterval: 0.1)

        let selectedText: String?
        if pasteboard.changeCount != originalChangeCount {
            selectedText = pasteboard.string(forType: .string)
        } else {
            selectedText = nil
        }

        pasteboard.clearContents()
        if let original = originalContent {
            pasteboard.setString(original, forType: .string)
        }

        return selectedText
    }
}
#endif
