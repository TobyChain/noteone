import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct SettingsView: View {
    @EnvironmentObject var authService: AuthService
    @AppStorage("appTheme") private var selectedTheme: String = AppTheme.system.rawValue
    @State private var stats: StatsResponse?

    @State private var llmApiKey = ""
    @State private var llmBaseUrl = ""
    @State private var llmModel = ""
    @State private var llmHasApiKey = false
    @State private var llmSaving = false
    @State private var llmSaved = false

    // 新知配置
    @State private var ascanConfig: AscanConfig?
    @State private var ascanGithubTopics = ""
    @State private var ascanArxivSubjects = ""
    @State private var ascanMaxPapers = 200
    @State private var ascanMaxTotal = 500
    @State private var ascanGithubMinStars = 500
    @State private var ascanGithubTopAnalyze = 20
    @State private var ascanGithubToken = ""
    @State private var ascanSemanticScholarKey = ""
    @State private var ascanConferenceLookback = 30
    @State private var ascanLogLevel = "INFO"
    @State private var isAscanSaving = false
    @State private var ascanSaved = false

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
            Section {
                Picker("主题", selection: $selectedTheme) {
                    ForEach(AppTheme.allCases, id: \.rawValue) { t in
                        Text(t.label).tag(t.rawValue)
                    }
                }
                .pickerStyle(.segmented)
            } header: {
                Label("外观", systemImage: "paintbrush")
                    .sectionHeaderStyle()
            }

            Section {
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
                    Text(exportError).font(.caption).foregroundStyle(Color.danger)
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
                    Text(deleteError).font(.caption).foregroundStyle(Color.danger)
                }
            } header: {
                Label("账户", systemImage: "person.circle")
                    .sectionHeaderStyle()
            }

            #if os(macOS)
            Section {
                HotkeyRecorderField()
            } header: {
                Label("顺手记快捷键", systemImage: "keyboard")
                    .sectionHeaderStyle()
            } footer: {
                Text("全局按下即可唤起顺手记;若剪贴板里已复制图片,会自动带入并在保存时上传为图片链接。")
            }
            #endif

            Section {
                SecureField(llmHasApiKey ? "API Key（已设置，输入可替换）" : "API Key", text: $llmApiKey)
                TextField("Base URL（如 https://api.openai.com/v1）", text: $llmBaseUrl)
                TextField("模型名", text: $llmModel)
                HStack {
                    if llmSaved {
                        Label("已保存", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(Color.success)
                            .font(.caption)
                    }
                    Spacer()
                    Button(action: saveLLMSettings) {
                        if llmSaving { ProgressView().controlSize(.small) } else { Text("保存模型设置") }
                    }
                    .disabled(llmSaving)
                }
            } header: {
                Label("AI 模型（自带 API Key）", systemImage: "cpu")
                    .sectionHeaderStyle()
            } footer: {
                Text("填写任一 OpenAI 兼容的 API（DashScope / OpenAI / 自部署 vLLM 等）启用 AI 功能。Base URL 填到版本号即可，系统会自动拼接 /chat/completions 和 /embeddings 端点（不要在 URL 末尾加 /chat/completions）。此 Key 同时用于闹闹聊天、自动打标、摘要和新知 pipeline，无需单独配置。")
            }

            #if !os(macOS)
            Section {
                Toggle("启用每日报告", isOn: $reportEnabled)
                if reportEnabled {
                    DatePicker("推送时间", selection: $reportTime, displayedComponents: .hourAndMinute)
                        .onChange(of: reportTime) { _, _ in saveReportSchedule() }
                }
            } header: {
                Label("每日报告", systemImage: "chart.bar.doc.horizontal")
                    .sectionHeaderStyle()
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

            // 新知配置
            if ascanConfig != nil {
                Section {
                    SecureField(ascanGithubToken == "***" ? "Token（已设置）" : "GitHub Token", text: $ascanGithubToken)
                    TextField("Topic 列表 (逗号分隔)", text: $ascanGithubTopics)
                        .lineLimit(2...4)
                    Stepper("最低 Star: \(ascanGithubMinStars)", value: $ascanGithubMinStars, in: 0...5000, step: 100)
                    Stepper("分析 Top N: \(ascanGithubTopAnalyze)", value: $ascanGithubTopAnalyze, in: 5...100, step: 5)
                } header: {
                    Label("新知 · GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                        .sectionHeaderStyle()
                }

                Section {
                    TextField("ArXiv 分类 (逗号分隔)", text: $ascanArxivSubjects)
                    Stepper("每分类最大: \(ascanMaxPapers)", value: $ascanMaxPapers, in: 10...500, step: 10)
                    Stepper("总最大: \(ascanMaxTotal)", value: $ascanMaxTotal, in: 50...2000, step: 50)
                } header: {
                    Label("新知 · ArXiv", systemImage: "doc.text.magnifyingglass")
                        .sectionHeaderStyle()
                }

                Section {
                    SecureField(ascanSemanticScholarKey == "***" ? "S2 Key（已设置）" : "Semantic Scholar Key", text: $ascanSemanticScholarKey)
                    Stepper("回溯天数: \(ascanConferenceLookback)", value: $ascanConferenceLookback, in: 7...90)
                } header: {
                    Label("新知 · 会议论文", systemImage: "graduationcap")
                        .sectionHeaderStyle()
                }

                Section {
                    Picker("日志级别", selection: $ascanLogLevel) {
                        ForEach(["DEBUG", "INFO", "WARNING", "ERROR"], id: \.self) { Text($0).tag($0) }
                    }
                    HStack {
                        if ascanSaved {
                            Label("已保存", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(Color.success)
                                .font(.caption)
                        }
                        Spacer()
                        Button {
                            Task { await saveAscanConfig() }
                        } label: {
                            if isAscanSaving { ProgressView().controlSize(.small) } else { Text("保存新知配置") }
                        }
                        .disabled(isAscanSaving)
                    }
                } header: {
                    Label("新知 · 日志与保存", systemImage: "text.line.last.and.rectangle.triangle")
                        .sectionHeaderStyle()
                }
            }

            if let stats = stats {
                Section {
                    LabeledContent("总笔记数", value: "\(stats.totalNotes)")
                    ForEach(stats.byContentType, id: \.contentType) { item in
                        LabeledContent(item.contentType, value: "\(item.count)")
                    }
                } header: {
                    Label("统计", systemImage: "chart.pie")
                        .sectionHeaderStyle()
                }

                Section {
                    ForEach(stats.topTags.prefix(10), id: \.name) { tag in
                        LabeledContent(tag.name, value: "\(tag.count)")
                    }
                } header: {
                    Label("热门标签", systemImage: "tag")
                        .sectionHeaderStyle()
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
            await loadAscanConfig()
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

    private func loadAscanConfig() async {
        do {
            let c = try await APIClient.shared.getAscanConfig()
            ascanConfig = c
            ascanGithubTopics = c.githubTopics.joined(separator: ", ")
            ascanArxivSubjects = c.arxivSubjects.joined(separator: ", ")
            ascanMaxPapers = c.maxPapersPerSubject
            ascanMaxTotal = c.maxTotalPapers
            ascanGithubMinStars = c.githubMinStars
            ascanGithubTopAnalyze = c.githubTopAnalyze
            ascanGithubToken = c.githubToken
            ascanSemanticScholarKey = c.semanticScholarApiKey
            ascanConferenceLookback = c.conferenceLookbackDays
            ascanLogLevel = c.logLevel
        } catch {}
    }

    private func saveAscanConfig() async {
        isAscanSaving = true
        ascanSaved = false
        defer { isAscanSaving = false }
        var updates: [String: Any] = [:]
        updates["github_topics"] = ascanGithubTopics.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        updates["arxiv_subjects"] = ascanArxivSubjects.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        updates["max_papers_per_subject"] = ascanMaxPapers
        updates["max_total_papers"] = ascanMaxTotal
        updates["github_min_stars"] = ascanGithubMinStars
        updates["github_top_analyze"] = ascanGithubTopAnalyze
        updates["conference_lookback_days"] = ascanConferenceLookback
        updates["log_level"] = ascanLogLevel
        if ascanGithubToken != "***" && !ascanGithubToken.isEmpty { updates["github_token"] = ascanGithubToken }
        if ascanSemanticScholarKey != "***" && !ascanSemanticScholarKey.isEmpty { updates["semantic_scholar_api_key"] = ascanSemanticScholarKey }
        do {
            let updated = try await APIClient.shared.updateAscanConfig(updates: updates)
            ascanConfig = updated
            ascanGithubToken = updated.githubToken
            ascanSemanticScholarKey = updated.semanticScholarApiKey
            ascanSaved = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { ascanSaved = false }
        } catch {}
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
