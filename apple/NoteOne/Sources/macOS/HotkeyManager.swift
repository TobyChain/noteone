#if os(macOS)
import AppKit
import ApplicationServices
import SwiftUI
import Carbon.HIToolbox
import OSLog

/// User-configurable quick-capture hotkey shared by the Carbon registration and Settings UI.
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

    /// Convert AppKit modifier flags to the Carbon mask required by RegisterEventHotKey.
    static func carbonModifiers(from rawValue: Int) -> UInt32 {
        let modifiers = NSEvent.ModifierFlags(rawValue: UInt(rawValue))
        var result: UInt32 = 0
        if modifiers.contains(.command) { result |= UInt32(cmdKey) }
        if modifiers.contains(.option) { result |= UInt32(optionKey) }
        if modifiers.contains(.control) { result |= UInt32(controlKey) }
        if modifiers.contains(.shift) { result |= UInt32(shiftKey) }
        return result
    }
}

@MainActor
class HotkeyManager: ObservableObject {
    static let shared = HotkeyManager()

    @Published private(set) var isRegistered = false
    @Published private(set) var registrationError: String?

    private var panel: FloatingCaptureWindow?
    private var captureTask: Task<Void, Never>?
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?
    private var closeObserver: NSObjectProtocol?
    private let logger = Logger(subsystem: "com.noteone.app", category: "hotkey")
    private let hotKeyID = EventHotKeyID(signature: 0x4E4F5445, id: 1)

    /// Carbon dispatches registered hotkeys without keyboard-monitoring or Accessibility access.
    private nonisolated static let eventHandler: EventHandlerUPP = { _, event, userData in
        guard let event, let userData else { return OSStatus(eventNotHandledErr) }
        var receivedID = EventHotKeyID()
        let status = GetEventParameter(
            event,
            EventParamName(kEventParamDirectObject),
            EventParamType(typeEventHotKeyID),
            nil,
            MemoryLayout<EventHotKeyID>.size,
            nil,
            &receivedID
        )
        guard status == noErr, receivedID.signature == 0x4E4F5445, receivedID.id == 1 else {
            return OSStatus(eventNotHandledErr)
        }

        let manager = Unmanaged<HotkeyManager>.fromOpaque(userData).takeUnretainedValue()
        DispatchQueue.main.async { @MainActor in
            manager.togglePanel()
        }
        return noErr
    }

    /// Register the configured shortcut with macOS independently of app bootstrap and permissions.
    func register() {
        unregister()

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let userData = Unmanaged.passUnretained(self).toOpaque()
        let handlerStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            Self.eventHandler,
            1,
            &eventType,
            userData,
            &eventHandlerRef
        )
        guard handlerStatus == noErr else {
            reportRegistrationFailure(handlerStatus)
            return
        }

        let registrationStatus = RegisterEventHotKey(
            UInt32(HotkeyConfig.keyCode),
            HotkeyConfig.carbonModifiers(from: HotkeyConfig.modifiers),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        guard registrationStatus == noErr else {
            if let eventHandlerRef { RemoveEventHandler(eventHandlerRef) }
            eventHandlerRef = nil
            reportRegistrationFailure(registrationStatus)
            return
        }

        isRegistered = true
        registrationError = nil
        logger.info("Global hotkey registered")
    }

    /// Remove the Carbon registration and handler before reload or termination.
    func unregister() {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let eventHandlerRef { RemoveEventHandler(eventHandlerRef) }
        hotKeyRef = nil
        eventHandlerRef = nil
        isRegistered = false
    }

    /// Re-register the system hotkey after the user changes its key combination.
    func reload() {
        register()
    }

    /// Publish a concrete registration error for Settings instead of silently losing the shortcut.
    private func reportRegistrationFailure(_ status: OSStatus) {
        isRegistered = false
        registrationError = L(
            "全局快捷键注册失败（错误 \(status)）。该组合键可能已被其他应用占用，请修改后重试。",
            "Global hotkey registration failed (error \(status)). Another app may own this shortcut; change it and retry."
        )
        logger.error("Global hotkey registration failed with status \(status, privacy: .public)")
    }

    func togglePanel() {
        if let panel = panel, panel.isVisible {
            panel.close()
            self.panel = nil
            return
        }
        guard captureTask == nil else { return }

        let sourceApp = NSWorkspace.shared.frontmostApplication
        let canCaptureSelection = PermissionCoordinator.shared.prepareForSelectionCapture()

        captureTask = Task { [weak self] in
            guard let self else { return }
            let (captured, meta) = await Task.detached { [self] in
                let captured = canCaptureSelection
                    ? captureSelection(from: sourceApp?.processIdentifier)
                    : clipboardSelection(outcome: .permissionDenied)
                let meta = captureBrowserMeta(
                    bundleID: sourceApp?.bundleIdentifier,
                    appName: sourceApp?.localizedName
                )
                return (captured, meta)
            }.value
            guard !Task.isCancelled else {
                captureTask = nil
                return
            }
            var text = captured.text
            if let title = meta?.title, !title.isEmpty, let body = text, !body.isEmpty {
                text = "[\(title)]\n\n\(body)"
            }
            presentPanel(
                text: text,
                sourceURL: meta?.url,
                imageData: captured.image,
                notice: captureNotice(for: captured.outcome)
            )
            captureTask = nil
        }
    }

    /// Create the panel only after capture finishes so its initial editor state is deterministic.
    private func presentPanel(text: String?, sourceURL: String?, imageData: Data?, notice: String?) {
        let captureView = CaptureView(
            initialContent: text,
            initialSourceUrl: sourceURL,
            initialImageData: imageData,
            initialNotice: notice,
            allowsClipboardFallback: false,
            onDismiss: { [weak self] in self?.panel?.close() }
        )
        let hostingView = NSHostingView(rootView: captureView)
        let panel = FloatingCaptureWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 320))
        panel.contentView = hostingView
        self.panel = panel
        if let closeObserver { NotificationCenter.default.removeObserver(closeObserver) }
        closeObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification, object: panel, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.panel = nil }
        }
        activateApp()
        panel.makeKeyAndOrderFront(nil)
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .captureEditorFocusRequested, object: nil)
        }
    }

    /// Explain why automatic filling was unavailable without presenting another system prompt.
    private func captureNotice(for outcome: CaptureOutcome) -> String? {
        switch outcome {
        case .accessibilitySelection, .syntheticCopy:
            return nil
        case .permissionDenied:
            return L(
                "无法自动读取选中文字。请在系统设置中为壹识启用辅助功能权限，然后重新选择文字并按快捷键。",
                "Selected text could not be read. Enable Accessibility for NoteOne in System Settings, then select the text and press the shortcut again."
            )
        case .noSelection:
            return L(
                "没有读取到选中文字。你可以重新选择后再按快捷键，或直接粘贴内容。",
                "No selected text was detected. Select the text and try the shortcut again, or paste it here."
            )
        }
    }

    /// Bring NoteOne forward after the source application has handled the synthetic copy.
    private func activateApp() {
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    enum CaptureOutcome: String, Sendable {
        case accessibilitySelection
        case syntheticCopy
        case permissionDenied
        case noSelection
    }

    struct CapturedSelection: Sendable {
        var text: String?
        var image: Data?
        let outcome: CaptureOutcome

        init(text: String? = nil, image: Data? = nil, outcome: CaptureOutcome) {
            self.text = text
            self.image = image
            self.outcome = outcome
        }
    }

    /// Copy the current selection while preserving all existing pasteboard representations.
    private nonisolated func captureSelection(from applicationPID: pid_t?) -> CapturedSelection {
        let pasteboard = NSPasteboard.general

        if let selectedText = selectedTextFromFocusedElement(applicationPID: applicationPID) {
            return CapturedSelection(text: selectedText, outcome: .accessibilitySelection)
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
            return CapturedSelection(outcome: .noSelection)
        }

        // Snapshot ALL clipboard types (not just the string) so the synthetic ⌘C never
        // destroys something the user deliberately copied earlier — images, files, rich text.
        let snapshot: [(NSPasteboard.PasteboardType, Data)] = (pasteboard.pasteboardItems ?? []).flatMap { item in
            item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }
        }

        let source = CGEventSource(stateID: .combinedSessionState)
        guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0x08, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0x08, keyDown: false) else {
            return CapturedSelection(outcome: .noSelection)
        }
        pasteboard.clearContents()
        let clearedChangeCount = pasteboard.changeCount
        keyDown.flags = .maskCommand
        keyUp.flags = .maskCommand
        postCopy(keyDown: keyDown, keyUp: keyUp, applicationPID: applicationPID)
        var changed = waitForPasteboardChange(after: clearedChangeCount, timeout: 0.7)
        if !changed {
            keyDown.post(tap: .cghidEventTap)
            keyUp.post(tap: .cghidEventTap)
            changed = waitForPasteboardChange(after: clearedChangeCount, timeout: 0.5)
        }

        var result = CapturedSelection(outcome: .noSelection)
        if changed {
            result.text = pasteboard.string(forType: .string)
            result.image = readClipboardImage(pasteboard)
            if result.text != nil || result.image != nil {
                result = CapturedSelection(text: result.text, image: result.image, outcome: .syntheticCopy)
            }
        }

        pasteboard.clearContents()
        for (type, data) in snapshot {
            pasteboard.setData(data, forType: type)
        }

        return result
    }

    /// Return the user's existing clipboard as a permission-free fallback.
    private nonisolated func clipboardSelection(outcome: CaptureOutcome) -> CapturedSelection {
        let pasteboard = NSPasteboard.general
        return CapturedSelection(
            text: pasteboard.string(forType: .string),
            image: readClipboardImage(pasteboard),
            outcome: outcome
        )
    }

    /// Send Command-C directly to the app that owned the selection at shortcut time.
    private nonisolated func postCopy(
        keyDown: CGEvent,
        keyUp: CGEvent,
        applicationPID: pid_t?
    ) {
        if let applicationPID {
            keyDown.postToPid(applicationPID)
            keyUp.postToPid(applicationPID)
        } else {
            keyDown.post(tap: .cghidEventTap)
            keyUp.post(tap: .cghidEventTap)
        }
    }

    /// Wait until the source app publishes a new pasteboard item.
    private nonisolated func waitForPasteboardChange(after changeCount: Int, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while NSPasteboard.general.changeCount == changeCount && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.02)
        }
        return NSPasteboard.general.changeCount != changeCount
    }

    /// Read the focused control's selected text directly before falling back to synthetic copy.
    private nonisolated func selectedTextFromFocusedElement(applicationPID: pid_t?) -> String? {
        let application = applicationPID.map(AXUIElementCreateApplication) ?? AXUIElementCreateSystemWide()
        var focusedValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            application, "AXFocusedUIElement" as CFString, &focusedValue
        ) == .success, let focusedValue else { return nil }

        guard CFGetTypeID(focusedValue) == AXUIElementGetTypeID() else { return nil }
        let focusedElement = unsafeDowncast(focusedValue as AnyObject, to: AXUIElement.self)
        var selectedValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            focusedElement, "AXSelectedText" as CFString, &selectedValue
        ) == .success, let selectedText = selectedValue as? String else { return nil }
        let trimmed = selectedText.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : selectedText
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

    struct BrowserMeta {
        let url: String
        let title: String
    }

    /// Read the active browser tab only when Quick Capture is invoked from a supported browser.
    private nonisolated func captureBrowserMeta(bundleID: String?, appName: String?) -> BrowserMeta? {
        guard let bundleId = bundleID else { return nil }

        let chromiumIds: Set<String> = [
            "com.google.Chrome",
            "com.microsoft.edgemac",
            "company.thebrowser.Browser",
            "com.brave.Browser",
            "com.vivaldi.Vivaldi",
            "com.operasoftware.Opera"
        ]

        let script: String
        let appName = appName ?? ""

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
