#if os(macOS)
import AppKit
import SwiftUI
import ApplicationServices

/// User-configurable quick-capture hotkey, persisted in UserDefaults so both the global
/// monitor (HotkeyManager) and the recorder UI (SettingsView) read the same source of truth.
enum HotkeyConfig {
    static let keyCodeKey = "hotkeyKeyCode"
    static let modifiersKey = "hotkeyModifiers"
    static let keyLabelKey = "hotkeyKeyLabel"

    // Default: ⌘⇧O.
    static let defaultKeyCode = 31 // 'o'
    static let defaultModifiers = Int(NSEvent.ModifierFlags([.command, .shift]).rawValue)
    static let defaultKeyLabel = "O"

    /// Only these flags participate in matching; ignore caps lock, fn, numeric pad, etc.
    static let relevantMask: NSEvent.ModifierFlags = [.command, .option, .control, .shift]

    static var keyCode: Int { UserDefaults.standard.object(forKey: keyCodeKey) as? Int ?? defaultKeyCode }
    static var modifiers: Int { UserDefaults.standard.object(forKey: modifiersKey) as? Int ?? defaultModifiers }
}

@MainActor
class HotkeyManager: ObservableObject {
    static let shared = HotkeyManager()
    private var panel: FloatingPanel?
    private var monitor: Any?

    func register() {
        monitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let mods = event.modifierFlags.intersection(HotkeyConfig.relevantMask)
            if Int(event.keyCode) == HotkeyConfig.keyCode && Int(mods.rawValue) == HotkeyConfig.modifiers {
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

    /// Re-arm the global monitor after the user changes the hotkey in Settings.
    func reload() {
        unregister()
        register()
    }

    func togglePanel() {
        if let panel = panel, panel.isVisible {
            panel.close()
            self.panel = nil
            return
        }

        let browserMeta = captureBrowserMeta()
        let captured = captureSelection()

        let captureView = CaptureView(
            initialContent: captured.text,
            initialSourceUrl: browserMeta?.url,
            initialSourceTitle: browserMeta?.title,
            initialImageData: captured.image,
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

    struct CapturedSelection {
        var text: String?
        var image: Data?
    }

    private nonisolated func captureSelection() -> CapturedSelection {
        let pasteboard = NSPasteboard.general

        // If the user already copied an image, use it directly. Reading the clipboard needs
        // no Accessibility permission, and we must NOT fire a synthetic Cmd+C here — that would
        // clobber the image they deliberately put on the clipboard.
        if let image = readClipboardImage(pasteboard) {
            var result = CapturedSelection()
            result.image = image
            // Keep any text copied alongside the image (mixed selection) — don't drop it.
            result.text = pasteboard.string(forType: .string)
            return result
        }

        // Synthetic Cmd+C requires Accessibility permission; guide the user if it's missing.
        guard ensureAccessibilityPermission() else {
            return CapturedSelection()
        }

        // The hotkey is typically ⌘⇧O / ⌘⌥X / etc — when togglePanel runs, the user's
        // shift/control/option keys may still be physically held. Some apps (notably Electron
        // / web shells like Yuque, Notion, Obsidian) read the *real* hardware modifier state
        // when interpreting our synthetic ⌘C, so the keystroke arrives as ⌘⇧C and gets
        // misrouted. Wait briefly for the non-command modifiers to be released before
        // synthesizing the copy.
        let extraneousMask: NSEvent.ModifierFlags = [.shift, .control, .option]
        let modifierDeadline = Date().addingTimeInterval(0.5)
        while !NSEvent.modifierFlags.intersection(extraneousMask).isEmpty && Date() < modifierDeadline {
            Thread.sleep(forTimeInterval: 0.02)
        }
        if !NSEvent.modifierFlags.intersection(extraneousMask).isEmpty {
            // User is still holding modifiers — bail rather than fire a misinterpreted ⌘+...+C.
            return CapturedSelection()
        }

        let originalChangeCount = pasteboard.changeCount
        let originalContent = pasteboard.string(forType: .string)

        let source = CGEventSource(stateID: .combinedSessionState)
        guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0x08, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0x08, keyDown: false) else {
            return CapturedSelection()
        }
        keyDown.flags = .maskCommand
        keyUp.flags = .maskCommand
        keyDown.post(tap: .cgSessionEventTap)
        keyUp.post(tap: .cgSessionEventTap)

        // Poll for the pasteboard to update instead of a fixed sleep. 1s gives slower
        // Electron-based apps (Yuque, Notion, etc.) enough time to round-trip the copy.
        let deadline = Date().addingTimeInterval(1.0)
        while pasteboard.changeCount == originalChangeCount && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.02)
        }

        var result = CapturedSelection()
        if pasteboard.changeCount != originalChangeCount {
            result.text = pasteboard.string(forType: .string)
            result.image = readClipboardImage(pasteboard)
        }

        pasteboard.clearContents()
        if let original = originalContent {
            pasteboard.setString(original, forType: .string)
        }

        return result
    }

    /// Returns PNG data for any image currently on the pasteboard (normalizing TIFF → PNG),
    /// or nil if the clipboard holds no image.
    private nonisolated func readClipboardImage(_ pasteboard: NSPasteboard) -> Data? {
        if let png = pasteboard.data(forType: .png) {
            return png
        }
        if let tiff = pasteboard.data(forType: .tiff),
           let bitmap = NSBitmapImageRep(data: tiff) {
            return bitmap.representation(using: .png, properties: [:])
        }
        return nil
    }

    private nonisolated func ensureAccessibilityPermission() -> Bool {
        let trusted = AXIsProcessTrusted()
        if !trusted {
            // Prompt once and point the user at System Settings. Use the literal option
            // key to avoid referencing the non-Sendable global CFString constant.
            _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        }
        return trusted
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
