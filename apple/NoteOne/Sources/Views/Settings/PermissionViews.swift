#if os(macOS)
import AppKit
import SwiftUI

/// One-time explanation shown before NoteOne ever asks macOS for protected access.
struct PermissionOnboardingView: View {
    @ObservedObject var coordinator: PermissionCoordinator
    let onContinue: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                Image(systemName: "hand.raised.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(Color.accent)
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("使用前说明", "Before You Start"))
                        .font(.title2.bold())
                    Text(L(
                        "壹识只在对应功能需要时请求系统权限。",
                        "NoteOne requests system access only when a feature needs it."
                    ))
                    .foregroundStyle(.secondary)
                }
            }

            permissionRow(
                icon: "keyboard",
                title: L("全局快捷键", "Global hotkey"),
                detail: L(
                    "默认 ⌘⇧O，可直接打开顺手记，不需要辅助功能权限。",
                    "Press ⌘⇧O to open Quick Capture. This does not require Accessibility access."
                )
            )
            permissionRow(
                icon: "text.cursor",
                title: L("捕获其他 App 的选中文本", "Capture selected text from other apps"),
                detail: L(
                    "需要辅助功能权限。你可以现在启用，也可以稍后在设置中启用。",
                    "This needs Accessibility access. Enable it now or later in Settings."
                )
            )
            permissionRow(
                icon: "folder",
                title: L("文件与浏览器信息", "Files and browser information"),
                detail: L(
                    "导入或导出时访问你选择的位置；只有你明确要求闹闹查找内容时，才读取文稿、桌面或下载目录。浏览器信息仅在捕获对应页面时按需请求。",
                    "Import and export use locations you choose. Documents, Desktop, or Downloads are read only when you explicitly ask Notty to find content. Browser access is requested only when capturing a browser page."
                )
            )

            HStack {
                if coordinator.accessibilityGranted {
                    Label(L("辅助功能已启用", "Accessibility enabled"), systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Color.success)
                } else {
                    Button(L("启用选中文本捕获", "Enable Selected Text Capture")) {
                        coordinator.requestAccessibility()
                    }
                    .buttonStyle(.bordered)
                }

                Spacer()

                Button(L("继续使用壹识", "Continue to NoteOne")) {
                    coordinator.completeOnboarding()
                    onContinue()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(28)
        .frame(width: 560)
        .interactiveDismissDisabled()
    }

    /// Render one permission capability without implying that access has already been granted.
    private func permissionRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .frame(width: 24)
                .foregroundStyle(Color.accent)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

/// Settings rows for live permission and system-hotkey diagnostics.
struct PermissionSettingsView: View {
    @ObservedObject private var coordinator = PermissionCoordinator.shared
    @ObservedObject private var hotkeyManager = HotkeyManager.shared

    var body: some View {
        HotkeyRecorderField()

        LabeledContent(L("全局快捷键状态", "Global hotkey status")) {
            if hotkeyManager.isRegistered {
                Label(L("已注册", "Registered"), systemImage: "checkmark.circle.fill")
                    .foregroundStyle(Color.success)
            } else {
                Button(L("重试注册", "Retry Registration")) {
                    hotkeyManager.reload()
                }
            }
        }

        if let error = hotkeyManager.registrationError {
            Text(error)
                .font(.caption)
                .foregroundStyle(Color.danger)
        }

        LabeledContent(L("选中文本捕获", "Selected text capture")) {
            if coordinator.accessibilityGranted {
                Label(L("已授权", "Allowed"), systemImage: "checkmark.circle.fill")
                    .foregroundStyle(Color.success)
            } else {
                HStack {
                    Button(L("请求权限", "Request Access")) {
                        coordinator.requestAccessibility()
                    }
                    Button(L("打开系统设置", "Open System Settings")) {
                        coordinator.openAccessibilitySettings()
                    }
                }
            }
        }
        .onAppear { coordinator.refresh() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            coordinator.refresh()
        }
    }
}
#endif
