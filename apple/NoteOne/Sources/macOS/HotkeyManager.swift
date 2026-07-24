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
    private var closeObserver: NSObjectProtocol?

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

        // Drain any stale drop payload so the panel starts clean.
        Task { _ = await DropPayloadStore.shared.consume() }

        let captureView = CaptureView(allowsClipboardFallback: false, onDismiss: { [weak self] in
            self?.panel?.close()
            self?.panel = nil
        })

        let hostingView = NSHostingView(rootView: captureView)
        let panel = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 480, height: 320))
        panel.contentView = hostingView
        // Show immediately WITHOUT stealing focus — the synthetic ⌘C below must land
        // in the app the user was just working in, not in this panel.
        panel.orderFront(nil)
        self.panel = panel
        if let closeObserver { NotificationCenter.default.removeObserver(closeObserver) }
        closeObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification, object: panel, queue: .main
        ) { [weak self] _ in
            self?.panel = nil
        }

        // Capture the selection + browser context off the main thread (AppleScript and
        // the modifier-release wait can take over a second), then hand the result to the
        // already-visible CaptureView and only then activate the app.
        Task.detached { [self, panel] in
            let captured = captureSelection()
            let meta = captureBrowserMeta()

            var text = captured.text
            if let title = meta?.title, !title.isEmpty, let body = text, !body.isEmpty {
                text = "[\(title)]\n\n\(body)"
            }
            let payload = DroppedPayload(text: text, sourceUrl: meta?.url, imageData: captured.image)
            let hasPayload = payload.text != nil || payload.sourceUrl != nil || payload.imageData != nil

            await MainActor.run {
                // The user may have closed the panel while the capture was in flight.
                guard panel.isVisible else { return }
                Task {
                    if hasPayload {
                        await DropPayloadStore.shared.set(payload)
                        NotificationCenter.default.post(name: .droppedPayloadReady, object: nil)
                    }
                    panel.makeKeyAndOrderFront(nil)
                    activateApp()
                }
            }
        }
    }

    private func activateApp() {
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
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
        // synthesizing the copy. The panel is already on screen at this point, so the
        // user naturally releases the chord — give them a generous budget.
        let extraneousMask: NSEvent.ModifierFlags = [.shift, .control, .option]
        let modifierDeadline = Date().addingTimeInterval(1.2)
        while !NSEvent.modifierFlags.intersection(extraneousMask).isEmpty && Date() < modifierDeadline {
            Thread.sleep(forTimeInterval: 0.02)
        }
        if !NSEvent.modifierFlags.intersection(extraneousMask).isEmpty {
            // User is still holding modifiers — bail rather than fire a misinterpreted ⌘+...+C.
            return CapturedSelection()
        }

        let originalChangeCount = pasteboard.changeCount
        let originalString = pasteboard.string(forType: .string)
        // Snapshot ALL clipboard types (not just the string) so the synthetic ⌘C never
        // destroys something the user deliberately copied earlier — images, files, rich text.
        let snapshot: [(NSPasteboard.PasteboardType, Data)] = (pasteboard.pasteboardItems ?? []).flatMap { item in
            item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }
        }

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
        } else {
            // Nothing was selected (the copy left the clipboard untouched) — fall back to
            // whatever the user last copied, matching the long-standing panel behavior.
            result.text = originalString
        }

        pasteboard.clearContents()
        for (type, data) in snapshot {
            pasteboard.setData(data, forType: type)
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
