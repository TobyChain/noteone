import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct SettingsView: View {
    @EnvironmentObject var authService: AuthService
    @AppStorage("appTheme") private var selectedTheme: String = AppTheme.system.rawValue
    @State private var serverPort = "3000"
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
    @State private var reportEnabled = UserDefaults.standard.reportEnabled
    @State private var reportTime: Date = {
        var comps = DateComponents()
        comps.hour = UserDefaults.standard.reportHour
        comps.minute = UserDefaults.standard.reportMinute
        return Calendar.current.date(from: comps) ?? Date()
    }()
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
                HStack {
                    Text("端口")
                    TextField("3000", text: $serverPort)
                        .frame(width: 80)
                    #if os(macOS)
                        .onChange(of: serverPort) { _, newValue in
                            let filtered = newValue.filter { $0.isNumber }
                            if filtered != newValue { serverPort = filtered }
                            if let p = Int(filtered), p < 1 || p > 65535 {
                                serverPort = String(filtered.prefix(5))
                            }
                            if let port = Int(serverPort) {
                                Task { await APIClient.shared.setPort(port) }
                            }
                        }
                    #endif
                    Text("本地服务端口，默认 3000")
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                }
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

            Section {
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
            } header: {
                Text("AI 模型（自带 API Key）")
            } footer: {
                Text("NoteOne 开源版不内置 LLM 服务，请填写任一 OpenAI 兼容的 API（DashScope / OpenAI / 自部署 vLLM 等）启用 AI 功能。未配置时笔记仍可正常保存，但 Notty 聊天、自动打标、摘要、报告等功能将不可用。")
            }

            #if !os(macOS)
            Section {
                Toggle("启用每日报告", isOn: $reportEnabled)
                if reportEnabled {
                    DatePicker("推送时间", selection: $reportTime, displayedComponents: .hourAndMinute)
                        .onChange(of: reportTime) { _, _ in saveReportSchedule() }
                }
            } header: {
                Text("每日报告")
            } footer: {
                Text("Notty 会在指定时间提醒你生成今日灵感报告。报告风格和深度可在报告页面调整。")
            }
            .onChange(of: reportEnabled) { _, newValue in
                UserDefaults.standard.reportEnabled = newValue
                if newValue {
                    Task { await ReportScheduler.shared.schedule(hour: reportHour, minute: reportMinute) }
                } else {
                    ReportScheduler.shared.cancel()
                }
            }
            #endif

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
            #if !os(macOS)
            // Schedule report notification on first load if enabled
            if reportEnabled {
                await ReportScheduler.shared.schedule(hour: reportHour, minute: reportMinute)
            }
            #endif
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

    #if !os(macOS)
    private var reportHour: Int {
        Calendar.current.component(.hour, from: reportTime)
    }

    private var reportMinute: Int {
        Calendar.current.component(.minute, from: reportTime)
    }

    private func saveReportSchedule() {
        UserDefaults.standard.reportHour = reportHour
        UserDefaults.standard.reportMinute = reportMinute
        Task {
            await ReportScheduler.shared.schedule(hour: reportHour, minute: reportMinute)
        }
    }
    #endif
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
        HStack(spacing: 12) {
            Text("快捷键")
            Spacer()
            Text(displayString)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(recording ? Color.accent : Color.ink)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.canvasSecondary)
                .clipShape(RoundedRectangle(cornerRadius: 6))
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
