#if os(macOS)
import AppKit
import ApplicationServices
import Combine
import OSLog

/// Owns NoteOne's macOS permission state and ensures system prompts only follow user intent.
@MainActor
final class PermissionCoordinator: ObservableObject {
    static let shared = PermissionCoordinator()

    static let onboardingCompletedKey = "permissionOnboardingCompleted"
    static let accessibilityPromptedBuildKey = "accessibilityPermissionPromptedBuild"

    @Published private(set) var accessibilityGranted: Bool

    private let defaults: UserDefaults
    private let accessibilityStatus: () -> Bool
    private let accessibilityRequest: () -> Bool
    private let appFingerprint: String
    private let logger = Logger(subsystem: "com.noteone.app", category: "permissions")

    /// Create a coordinator backed by the supplied defaults suite.
    init(
        defaults: UserDefaults = .standard,
        accessibilityStatus: @escaping () -> Bool = { AXIsProcessTrusted() },
        accessibilityRequest: @escaping () -> Bool = {
            AXIsProcessTrustedWithOptions(
                ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            )
        },
        appFingerprint: String = PermissionCoordinator.currentAppFingerprint()
    ) {
        self.defaults = defaults
        self.accessibilityStatus = accessibilityStatus
        self.accessibilityRequest = accessibilityRequest
        self.appFingerprint = appFingerprint
        accessibilityGranted = accessibilityStatus()
    }

    /// Whether the explanatory permission sheet still needs to be shown on this installation.
    var shouldPresentOnboarding: Bool {
        !defaults.bool(forKey: Self.onboardingCompletedKey)
    }

    /// Refresh the observable permission state after NoteOne or System Settings becomes active.
    func refresh() {
        accessibilityGranted = accessibilityStatus()
    }

    /// Record that the user finished the one-time explanation without requesting a system prompt.
    func completeOnboarding() {
        defaults.set(true, forKey: Self.onboardingCompletedKey)
    }

    /// Request Accessibility after an explicit user action in onboarding or Settings.
    @discardableResult
    func requestAccessibility() -> Bool {
        defaults.set(appFingerprint, forKey: Self.accessibilityPromptedBuildKey)
        let granted = accessibilityRequest()
        accessibilityGranted = granted
        logger.info("Accessibility permission requested; granted=\(granted, privacy: .public)")
        return granted
    }

    /// Check permission for a shortcut-driven selection capture and prompt at most once implicitly.
    func prepareForSelectionCapture() -> Bool {
        refresh()
        guard !accessibilityGranted else { return true }

        if defaults.string(forKey: Self.accessibilityPromptedBuildKey) != appFingerprint {
            return requestAccessibility()
        }
        return false
    }

    /// Open the precise System Settings page where the user can change Accessibility access.
    func openAccessibilitySettings() {
        guard let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        ) else { return }
        NSWorkspace.shared.open(url)
    }

    /// Identify the installed binary so an ad-hoc rebuild can request its own TCC entry once.
    nonisolated static func currentAppFingerprint() -> String {
        guard let executable = Bundle.main.executableURL,
              let values = try? executable.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        else { return Bundle.main.bundlePath }
        return "\(executable.path)|\(values.fileSize ?? 0)|\(values.contentModificationDate?.timeIntervalSince1970 ?? 0)"
    }
}
#endif
