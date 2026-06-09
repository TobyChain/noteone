#if os(macOS)
import AppKit
import SwiftUI

class HotkeyManager: ObservableObject {
    static let shared = HotkeyManager()
    private var panel: FloatingPanel?
    private var monitor: Any?

    func register() {
        monitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            // ⌘⇧N (keyCode 45 = N)
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

    private func togglePanel() {
        if let panel = panel, panel.isVisible {
            panel.close()
            self.panel = nil
            return
        }

        let captureView = CaptureView(onDismiss: { [weak self] in
            self?.panel?.close()
            self?.panel = nil
        })

        let hostingView = NSHostingView(rootView: captureView)
        let panel = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 480, height: 320))
        panel.contentView = hostingView
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.panel = panel
    }
}
#endif
