#if os(macOS)
import AppKit
import ApplicationServices
import Combine
import OSLog

/// Owns NoteOne's macOS permission state and ensures system prompts only follow user intent.
@MainActor
final class PermissionCoordinator: ObservableObject {
    static let shared = PermissionCoordinator()

    @Published private(set) var accessibilityGranted: Bool

    private let accessibilityStatus: () -> Bool
    private let accessibilityRequest: () -> Bool
    private let logger = Logger(subsystem: "com.noteone.app", category: "permissions")

    /// Create a coordinator backed by the supplied defaults suite.
    init(
        accessibilityStatus: @escaping () -> Bool = { AXIsProcessTrusted() },
        accessibilityRequest: @escaping () -> Bool = {
            AXIsProcessTrustedWithOptions(
                ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            )
        }
    ) {
        self.accessibilityStatus = accessibilityStatus
        self.accessibilityRequest = accessibilityRequest
        accessibilityGranted = accessibilityStatus()
    }

    /// Refresh the observable permission state after NoteOne or System Settings becomes active.
    func refresh() {
        accessibilityGranted = accessibilityStatus()
    }

    /// Request Accessibility after an explicit user action in onboarding or Settings.
    @discardableResult
    func requestAccessibility() -> Bool {
        let granted = accessibilityRequest()
        accessibilityGranted = granted
        logger.info("Accessibility permission requested; granted=\(granted, privacy: .public)")
        return granted
    }

    /// Check existing access without ever opening a system prompt.
    func canCaptureSelectionWithoutPrompt() -> Bool {
        refresh()
        return accessibilityGranted
    }

    /// Open the precise System Settings page where the user can change Accessibility access.
    func openAccessibilitySettings() {
        guard let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        ) else { return }
        NSWorkspace.shared.open(url)
    }

}
#endif
