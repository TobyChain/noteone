import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct SettingsView: View {
    @EnvironmentObject var authService: AuthService
    @AppStorage("appTheme") private var selectedTheme: String = AppTheme.system.rawValue
    @State private var serverURL = "http://localhost:3000"
    @State private var stats: StatsResponse?

    @State private var llmApiKey = ""
    @State private var llmBaseUrl = ""
    @State private var llmModel = ""
    @State private var llmHasApiKey = false
    @State private var llmSaving = false
    @State private var llmSaved = false

    @State private var isExporting = false
    @State private var exportError: String?
    @State private var showDeleteConfirm = false
    @State private var isDeletingAccount = false
    @State private var deleteError: String?
    #if !os(macOS)
    @State private var exportedFileURL: URL?
    @State private var showShareSheet = false
    #endif

    private var theme: AppTheme {
        AppTheme(rawValue: selectedTheme) ?? .system
    }

    var body: some View {
        Form {
            Section("外观") {
                Picker("主题", selection: $selectedTheme) {
                    ForEach(AppTheme.allCases, id: \.rawValue) { t in
                        Text(t.label).tag(t.rawValue)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section("账户") {
                if let name = authService.userName {
                    Text("已登录: \(name)")
                }
                Button("退出登录", role: .destructive) {
                    authService.signOut()
                }

                Button {
                    exportMyData()
                } label: {
                    HStack {
                        if isExporting {
                            ProgressView().controlSize(.small)
                            Text("正在生成导出…")
                        } else {
                            Label("导出我的数据", systemImage: "square.and.arrow.up")
                        }
                    }
                }
                .disabled(isExporting)
                if let exportError = exportError {
                    Text(exportError).font(.caption).foregroundStyle(.red)
                }

                Button(role: .destructive) {
                    showDeleteConfirm = true
                } label: {
                    if isDeletingAccount {
                        HStack {
                            ProgressView().controlSize(.small)
                            Text("正在注销…")
                        }
                    } else {
                        Label("注销账号", systemImage: "person.crop.circle.badge.xmark")
                    }
                }
                .disabled(isDeletingAccount)
                if let deleteError = deleteError {
                    Text(deleteError).font(.caption).foregroundStyle(.red)
                }
            }

            Section("服务器") {
                TextField("API 地址", text: $serverURL)
            }

            #if os(macOS)
            Section {
                HotkeyRecorderField()
            } header: {
                Text("顺手记快捷键")
            } footer: {
                Text("全局按下即可唤起顺手记;若剪贴板里已复制图片,会自动带入并在保存时上传为图片链接。")
            }
            #endif

            Section("AI 模型（留空则用服务端默认）") {
                SecureField(llmHasApiKey ? "API Key（已设置，输入可替换）" : "API Key", text: $llmApiKey)
                TextField("Base URL", text: $llmBaseUrl)
                TextField("模型名", text: $llmModel)
                HStack {
                    if llmSaved {
                        Label("已保存", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.caption)
                    }
                    Spacer()
                    Button(action: saveLLMSettings) {
                        if llmSaving { ProgressView().controlSize(.small) } else { Text("保存模型设置") }
                    }
                    .disabled(llmSaving)
                }
            }

            if let stats = stats {
                Section("统计") {
                    LabeledContent("总笔记数", value: "\(stats.totalNotes)")
                    ForEach(stats.byContentType, id: \.contentType) { item in
                        LabeledContent(item.contentType, value: "\(item.count)")
                    }
                }

                Section("热门标签") {
                    ForEach(stats.topTags.prefix(10), id: \.name) { tag in
                        LabeledContent(tag.name, value: "\(tag.count)")
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("设置")
        .confirmationDialog("注销账号？", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("永久注销", role: .destructive) { performDeleteAccount() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("此操作不可撤销。所有笔记、标签、对话及上传的图片都会被永久删除。如需保留请先“导出我的数据”。")
        }
        #if !os(macOS)
        .sheet(isPresented: $showShareSheet) {
            if let url = exportedFileURL {
                ShareSheet(items: [url])
            }
        }
        #endif
        .task {
            do { stats = try await APIClient.shared.getStats() } catch {}
            do {
                let settings = try await APIClient.shared.getSettings()
                llmBaseUrl = settings.llm.baseUrl ?? ""
                llmModel = settings.llm.model ?? ""
                llmHasApiKey = settings.llm.hasApiKey
            } catch {}
        }
    }

    private func saveLLMSettings() {
        llmSaving = true
        // Only send apiKey when the user typed one (avoids overwriting with empty/masked).
        let key = llmApiKey.isEmpty ? nil : llmApiKey
        Task {
            do {
                let updated = try await APIClient.shared.updateLLMSettings(
                    apiKey: key, baseUrl: llmBaseUrl, model: llmModel
                )
                await MainActor.run {
                    llmHasApiKey = updated.llm.hasApiKey
                    llmApiKey = ""
                    llmSaving = false
                    llmSaved = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { llmSaved = false }
                }
            } catch {
                await MainActor.run { llmSaving = false }
            }
        }
    }

    private func exportMyData() {
        isExporting = true
        exportError = nil
        Task {
            do {
                let url = try await APIClient.shared.exportData()
                await MainActor.run {
                    isExporting = false
                    #if os(macOS)
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                    #else
                    exportedFileURL = url
                    showShareSheet = true
                    #endif
                }
            } catch {
                await MainActor.run {
                    isExporting = false
                    exportError = "导出失败: \(error.localizedDescription)"
                }
            }
        }
    }

    private func performDeleteAccount() {
        isDeletingAccount = true
        deleteError = nil
        Task {
            do {
                try await APIClient.shared.deleteAccount()
                await MainActor.run {
                    isDeletingAccount = false
                    authService.signOut()
                }
            } catch {
                await MainActor.run {
                    isDeletingAccount = false
                    deleteError = "注销失败: \(error.localizedDescription)"
                }
            }
        }
    }
}

#if os(macOS)
import AppKit

/// Records a global hotkey combo. Click "修改", press the desired ⌘/⌥/⌃/⇧ + key,
/// and the new binding is persisted and re-armed immediately. Esc cancels recording.
struct HotkeyRecorderField: View {
    @AppStorage(HotkeyConfig.keyCodeKey) private var keyCode: Int = HotkeyConfig.defaultKeyCode
    @AppStorage(HotkeyConfig.modifiersKey) private var modifiers: Int = HotkeyConfig.defaultModifiers
    @AppStorage(HotkeyConfig.keyLabelKey) private var keyLabel: String = HotkeyConfig.defaultKeyLabel

    @State private var recording = false
    @State private var monitor: Any?

    var body: some View {
        HStack {
            Text("快捷键")
            Spacer()
            Text(displayString)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(recording ? Color.accent : Color.ink)
            Button(recording ? "按下组合键…(Esc 取消)" : "修改") {
                recording ? stopRecording() : startRecording()
            }
        }
        .onDisappear { stopRecording() }
    }

    private var displayString: String {
        let m = NSEvent.ModifierFlags(rawValue: UInt(modifiers))
        var s = ""
        if m.contains(.control) { s += "⌃" }
        if m.contains(.option) { s += "⌥" }
        if m.contains(.shift) { s += "⇧" }
        if m.contains(.command) { s += "⌘" }
        return s + keyLabel
    }

    private func startRecording() {
        recording = true
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            // Esc cancels without changing the binding.
            if event.keyCode == 53 {
                stopRecording()
                return nil
            }
            let mods = event.modifierFlags.intersection(HotkeyConfig.relevantMask)
            // Require at least one modifier so the global hotkey can't be a bare key.
            guard !mods.isEmpty else { return nil }

            keyCode = Int(event.keyCode)
            modifiers = Int(mods.rawValue)
            keyLabel = (event.charactersIgnoringModifiers ?? "").uppercased()
            stopRecording()
            HotkeyManager.shared.reload()
            return nil // swallow the event
        }
    }

    private func stopRecording() {
        recording = false
        if let monitor = monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }
}
#endif

#if !os(macOS)
/// SwiftUI wrapper around UIActivityViewController so the user can save / share the
/// exported zip file.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#endif
