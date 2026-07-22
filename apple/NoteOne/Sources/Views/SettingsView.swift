import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct LLMPreset: Identifiable {
    let id: String
    let name: String
    let baseUrl: String
    let model: String
}

let llmPresets: [LLMPreset] = [
    LLMPreset(id: "custom", name: "自定义", baseUrl: "", model: ""),
    LLMPreset(id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini"),
    LLMPreset(id: "dashscope", name: "通义千问 (DashScope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-turbo"),
    LLMPreset(id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat"),
    LLMPreset(id: "glm", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash"),
    LLMPreset(id: "moonshot", name: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k"),
    LLMPreset(id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash"),
    LLMPreset(id: "anthropic", name: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-20241022"),
    LLMPreset(id: "volcengine", name: "火山引擎 (Doubao)", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-pro-32k"),
    LLMPreset(id: "ollama", name: "Ollama (本地)", baseUrl: "http://localhost:11434/v1", model: "llama3.2"),
]

struct SettingsView: View {
    @EnvironmentObject var authService: AuthService
    @AppStorage("appTheme") private var selectedTheme: String = AppTheme.system.rawValue
    @State private var stats: StatsResponse?

    @State private var llmApiKey = ""
    @State private var llmBaseUrl = ""
    @State private var llmModel = ""
    @State private var selectedPreset: String = "custom"
    @State private var llmHasApiKey = false
    @State private var llmSaving = false
    @State private var llmSaved = false

    @State private var showAscanConfig = false
    @State private var showWechatConfig = false
    @State private var wechatHealth: WechatHealthResponse?

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
            appearanceSection
            accountSection

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

            llmSection

            #if !os(macOS)
            reportSection
            #endif

            integrationsSection
            statsSections
        }
        .formStyle(.grouped)
        .navigationTitle("设置")
        .confirmationDialog("注销账号？", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("永久注销", role: .destructive) { performDeleteAccount() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("此操作不可撤销。所有笔记、标签、对话及上传的图片都会被永久删除。如需保留请先“导出我的数据”。")
        }
        .sheet(isPresented: $showAscanConfig) {
            NavigationStack {
                AscanConfigView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("完成") { showAscanConfig = false }
                        }
                    }
            }
            #if os(macOS)
            .frame(minWidth: 560, minHeight: 640)
            #endif
        }
        .sheet(isPresented: $showWechatConfig, onDismiss: {
            Task { await probeWechatHealth() }
        }) {
            WechatConfigSheet()
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
                if let match = llmPresets.first(where: { $0.baseUrl == llmBaseUrl }) {
                    selectedPreset = match.id
                } else {
                    selectedPreset = "custom"
                }
            } catch {}
            await probeWechatHealth()
            #if !os(macOS)
            // Schedule report notification on first load if enabled
            if reportEnabled {
                await ReportScheduler.shared.schedule(hour: reportHour, minute: reportMinute)
            }
            #endif
        }
    }

    // MARK: - Sections

    private var appearanceSection: some View {
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
    }

    private var accountSection: some View {
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
    }

    private var llmSection: some View {
        Section {
            Picker("服务商", selection: $selectedPreset) {
                ForEach(llmPresets) { preset in
                    Text(preset.name).tag(preset.id)
                }
            }
            .pickerStyle(.menu)
            .onChange(of: selectedPreset) { _, newValue in
                if newValue != "custom",
                   let preset = llmPresets.first(where: { $0.id == newValue }) {
                    llmBaseUrl = preset.baseUrl
                    llmModel = preset.model
                }
            }

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
            Text("选择服务商可自动填充 Base URL 和模型名，也可手动修改。填写任一 OpenAI 兼容的 API（DashScope / OpenAI / 自部署 vLLM 等）启用 AI 功能。Base URL 填到版本号即可，系统会自动拼接 /chat/completions 和 /embeddings 端点（不要在 URL 末尾加 /chat/completions）。此 Key 同时用于闹闹聊天、自动打标、摘要和新知 pipeline，无需单独配置。")
        }
    }

    #if !os(macOS)
    private var reportSection: some View {
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
    }
    #endif

    private var integrationsSection: some View {
        Section {
            Button {
                showAscanConfig = true
            } label: {
                HStack {
                    Label("新知配置", systemImage: "antenna.radiowaves.left.and.right")
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button {
                showWechatConfig = true
            } label: {
                HStack {
                    Label("微信公众号", systemImage: "dot.radiowaves.left.and.right")
                    Spacer()
                    wechatStatusBadge
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } header: {
            Label("新知与集成", systemImage: "sparkles")
                .sectionHeaderStyle()
        } footer: {
            Text("微信公众号抓取已内置：点击后扫码登录公众平台并管理订阅的公众号，登录有效期 4 天。")
        }
    }

    @ViewBuilder
    private var wechatStatusBadge: some View {
        if let h = wechatHealth {
            switch h.status {
            case "ready":
                Label(h.nickname?.isEmpty == false ? "\(h.nickname!) · \(h.mpCount ?? 0) 个公众号" : "已就绪", systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.success)
                    .labelStyle(.titleAndIcon)
            case "auth_expired":
                Label("登录过期", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            case "unreachable":
                Label("连接失败", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.danger)
            default:
                Text("未登录")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var statsSections: some View {
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

    // MARK: - Actions

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

    private func probeWechatHealth() async {
        do {
            wechatHealth = try await APIClient.shared.getWechatHealth()
        } catch {
            wechatHealth = WechatHealthResponse(
                status: "unreachable", mpCount: nil, nickname: nil,
                expiresAt: nil, message: error.localizedDescription
            )
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
