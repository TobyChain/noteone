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

        let browserMeta = captureBrowserMeta()
        let selectedText = captureSelectedText()

        let captureView = CaptureView(
            initialContent: selectedText,
            initialSourceUrl: browserMeta?.url,
            initialSourceTitle: browserMeta?.title,
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

    struct BrowserMeta {
        let url: String
        let title: String
    }

    private nonisolated func captureBrowserMeta() -> BrowserMeta? {
        guard let frontApp = NSWorkspace.shared.frontmostApplication,
              let bundleId = frontApp.bundleIdentifier else { return nil }

        let chromiumIds: Set<String> = [
            "com.google.Chrome",
            "com.microsoft.edgemac",
            "company.thebrowser.Browser",
            "com.brave.Browser",
            "com.vivaldi.Vivaldi",
            "com.operasoftware.Opera"
        ]

        let script: String
        let appName = frontApp.localizedName ?? ""

        if bundleId == "com.apple.Safari" {
            script = """
            tell application "Safari"
                set pageURL to URL of current tab of window 1
                set pageTitle to name of current tab of window 1
                return pageURL & "\n" & pageTitle
            end tell
            """
        } else if chromiumIds.contains(bundleId) {
            script = """
            tell application "\(appName)"
                set pageURL to URL of active tab of window 1
                set pageTitle to title of active tab of window 1
                return pageURL & "\n" & pageTitle
            end tell
            """
        } else if bundleId == "org.mozilla.firefox" {
            script = """
            tell application "System Events"
                tell process "Firefox"
                    set pageTitle to name of window 1
                end tell
            end tell
            return pageTitle
            """
            if let appleScript = NSAppleScript(source: script) {
                var error: NSDictionary?
                let result = appleScript.executeAndReturnError(&error)
                if error == nil {
                    let title = result.stringValue ?? ""
                    return BrowserMeta(url: "", title: title)
                }
            }
            return nil
        } else {
            return nil
        }

        guard let appleScript = NSAppleScript(source: script) else { return nil }
        var error: NSDictionary?
        let result = appleScript.executeAndReturnError(&error)
        guard error == nil, let output = result.stringValue else { return nil }

        let parts = output.split(separator: "\n", maxSplits: 1)
        guard parts.count == 2 else { return nil }

        return BrowserMeta(url: String(parts[0]), title: String(parts[1]))
    }
}
#endif
