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
    @AppStorage("appLanguage") private var appLanguage = "zh"
    @AppStorage("hasSeenOnboarding") private var hasSeenOnboarding = false
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
            if !llmHasApiKey {
                Section {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text(L("AI 模型未配置，AI 功能将不可用", "AI model not configured, AI features will be unavailable"))
                            .font(.caption)
                    }
                }
            }
            onboardingSection
            languageSection
            appearanceSection
            accountSection

            #if os(macOS)
            Section {
                HotkeyRecorderField()
            } header: {
                Label(L("顺手记快捷键", "Quick Capture Hotkey"), systemImage: "keyboard")
                    .sectionHeaderStyle()
            } footer: {
                Text(L("全局按下即可唤起顺手记;若剪贴板里已复制图片,会自动带入并在保存时上传为图片链接。", "Press globally to summon Quick Capture; if an image is in the clipboard, it will be included and uploaded as an image link on save."))
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
        .navigationTitle(L("设置", "Settings"))
        .confirmationDialog(L("注销账号？", "Delete Account?"), isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button(L("永久注销", "Delete Permanently"), role: .destructive) { performDeleteAccount() }
            Button(L("取消", "Cancel"), role: .cancel) {}
        } message: {
            Text(L("此操作不可撤销。所有笔记、标签、对话及上传的图片都会被永久删除。如需保留请先\"导出我的数据\"。", "This action cannot be undone. All notes, tags, conversations, and uploaded images will be permanently deleted. To keep your data, please \"Export My Data\" first."))
        }
        .sheet(isPresented: $showAscanConfig) {
            AscanConfigSheet()
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
        .onChange(of: llmHasApiKey) { _, configured in
            if configured && !hasSeenOnboarding {
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                    withAnimation { hasSeenOnboarding = true }
                }
            }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private var onboardingSection: some View {
        if !hasSeenOnboarding {
            Section {
                // Step 1: Language
                HStack(spacing: DG.sp8) {
                    Image(systemName: "1.circle.fill")
                        .font(.title3)
                        .foregroundStyle(Color.accent)
                    Text(L("选择语言", "Select language"))
                        .font(.subheadline)
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.success)
                        .font(.caption)
                }

                // Step 2: LLM
                HStack(spacing: DG.sp8) {
                    Image(systemName: llmHasApiKey ? "2.circle.fill" : "2.circle")
                        .font(.title3)
                        .foregroundStyle(llmHasApiKey ? Color.success : Color.accent)
                    Text(L("配置 AI 模型", "Configure AI model"))
                        .font(.subheadline)
                    Spacer()
                    if llmHasApiKey {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(Color.success)
                            .font(.caption)
                    } else {
                        Image(systemName: "arrow.down")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }

                // Step 3: NewSee (optional)
                Button {
                    showAscanConfig = true
                } label: {
                    HStack(spacing: DG.sp8) {
                        Image(systemName: "3.circle")
                            .font(.title3)
                            .foregroundStyle(.tertiary)
                        Text(L("配置新知（可选）", "Configure NewSee (optional)"))
                            .font(.subheadline)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                // Step 4: WeChat (optional)
                Button {
                    showWechatConfig = true
                } label: {
                    HStack(spacing: DG.sp8) {
                        Image(systemName: "4.circle")
                            .font(.title3)
                            .foregroundStyle(.tertiary)
                        Text(L("配置微信公众号（可选）", "Configure WeChat (optional)"))
                            .font(.subheadline)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } header: {
                Label(L("快速入门", "Quick Start"), systemImage: "lightbulb")
                    .sectionHeaderStyle()
            } footer: {
                Text(L("完成前两步即可开始使用。配置 AI 模型后此引导将自动关闭。", "Complete the first two steps to get started. This guide will auto-dismiss after configuring an AI model."))
            }
        }
    }

    private var languageSection: some View {
        Section {
            Picker(L("语言", "Language"), selection: $appLanguage) {
                Text("中文").tag("zh")
                Text("English").tag("en")
            }
            .pickerStyle(.segmented)
            .onChange(of: appLanguage) { _, newValue in
                UserDefaults.standard.set([newValue], forKey: "AppleLanguages")
            }
        } header: {
            Label(L("语言", "Language"), systemImage: "globe")
                .sectionHeaderStyle()
        }
    }

    private var appearanceSection: some View {
        Section {
            Picker(L("主题", "Theme"), selection: $selectedTheme) {
                ForEach(AppTheme.allCases, id: \.rawValue) { t in
                    Text(t.label).tag(t.rawValue)
                }
            }
            .pickerStyle(.segmented)
        } header: {
            Label(L("外观", "Appearance"), systemImage: "paintbrush")
                .sectionHeaderStyle()
        }
    }

    private var accountSection: some View {
        Section {
            if let name = authService.userName {
                Text(L("已登录: ", "Signed in: ") + name)
            }
            Button(L("退出登录", "Sign Out"), role: .destructive) {
                authService.signOut()
            }

            Button {
                exportMyData()
            } label: {
                HStack {
                    if isExporting {
                        ProgressView().controlSize(.small)
                        Text(L("正在生成导出…", "Generating export…"))
                    } else {
                        Label(L("导出我的数据", "Export My Data"), systemImage: "square.and.arrow.up")
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
                        Text(L("正在注销…", "Deleting…"))
                    }
                } else {
                    Label(L("注销账号", "Delete Account"), systemImage: "person.crop.circle.badge.xmark")
                }
            }
            .disabled(isDeletingAccount)
            if let deleteError = deleteError {
                Text(deleteError).font(.caption).foregroundStyle(Color.danger)
            }
        } header: {
            Label(L("账户", "Account"), systemImage: "person.circle")
                .sectionHeaderStyle()
        }
    }

    private var llmSection: some View {
        Section {
            Picker(L("服务商", "Provider"), selection: $selectedPreset) {
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

            SecureField(llmHasApiKey ? L("API Key（已设置，输入可替换）", "API Key (set, type to replace)") : L("API Key", "API Key"), text: $llmApiKey)
            TextField(L("Base URL（如 https://api.openai.com/v1）", "Base URL (e.g. https://api.openai.com/v1)"), text: $llmBaseUrl)
            TextField(L("模型名", "Model Name"), text: $llmModel)
            HStack {
                if llmSaved {
                    Label(L("已保存", "Saved"), systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Color.success)
                        .font(.caption)
                }
                Spacer()
                Button(action: saveLLMSettings) {
                    if llmSaving { ProgressView().controlSize(.small) } else { Text(L("保存模型设置", "Save Model Settings")) }
                }
                .disabled(llmSaving)
            }
        } header: {
            Label(L("AI 模型（自带 API Key）", "AI Model (BYOK)"), systemImage: "cpu")
                .sectionHeaderStyle()
        } footer: {
            Text(L("选择服务商可自动填充 Base URL 和模型名，也可手动修改。填写任一 OpenAI 兼容的 API（DashScope / OpenAI / 自部署 vLLM 等）启用 AI 功能。Base URL 填到版本号即可，系统会自动拼接 /chat/completions 和 /embeddings 端点（不要在 URL 末尾加 /chat/completions）。此 Key 同时用于闹闹聊天、自动打标、摘要和新知 pipeline，无需单独配置。", "Selecting a provider auto-fills the Base URL and model name; you can also edit manually. Enter any OpenAI-compatible API (DashScope / OpenAI / self-hosted vLLM, etc.) to enable AI features. Fill the Base URL up to the version number — the system will automatically append /chat/completions and /embeddings endpoints (do not add /chat/completions at the end of the URL). This key is shared across Notty chat, auto-tagging, summarization, and the NewSee pipeline — no separate configuration needed."))
        }
    }

    #if !os(macOS)
    private var reportSection: some View {
        Section {
            Toggle(L("启用每日报告", "Enable Daily Report"), isOn: $reportEnabled)
            if reportEnabled {
                DatePicker(L("推送时间", "Push Time"), selection: $reportTime, displayedComponents: .hourAndMinute)
                    .onChange(of: reportTime) { _, _ in saveReportSchedule() }
            }
        } header: {
            Label(L("每日报告", "Daily Report"), systemImage: "chart.bar.doc.horizontal")
                .sectionHeaderStyle()
        } footer: {
            Text(L("Notty 会在指定时间提醒你生成今日灵感报告。报告风格和深度可在报告页面调整。", "Notty will remind you to generate today's inspiration report at the specified time. Report style and depth can be adjusted on the Reports page."))
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
                    Label(L("新知配置", "NewSee Config"), systemImage: "antenna.radiowaves.left.and.right")
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
                    Label(L("微信公众号", "WeChat Official Account"), systemImage: "dot.radiowaves.left.and.right")
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
            Label(L("新知与集成", "NewSee & Integrations"), systemImage: "sparkles")
                .sectionHeaderStyle()
        } footer: {
            Text(L("微信公众号抓取已内置：点击后扫码登录公众平台并管理订阅的公众号，登录有效期 4 天。", "WeChat Official Account scraping is built-in: tap to scan-login to the platform and manage subscribed accounts. Login is valid for 4 days."))
        }
    }

    @ViewBuilder
    private var wechatStatusBadge: some View {
        if let h = wechatHealth {
            switch h.status {
            case "ready":
                Label(h.nickname?.isEmpty == false ? "\(h.nickname!) · \(h.mpCount ?? 0) " + L("个公众号", "accounts") : L("已就绪", "Ready"), systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.success)
                    .labelStyle(.titleAndIcon)
            case "auth_expired":
                Label(L("登录过期", "Login Expired"), systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            case "unreachable":
                Label(L("连接失败", "Connection Failed"), systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.danger)
            default:
                Text(L("未登录", "Not Logged In"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var statsSections: some View {
        if let stats = stats {
            Section {
                LabeledContent(L("总笔记数", "Total Notes"), value: "\(stats.totalNotes)")
                ForEach(stats.byContentType, id: \.contentType) { item in
                    LabeledContent(item.contentType, value: "\(item.count)")
                }
            } header: {
                Label(L("统计", "Statistics"), systemImage: "chart.pie")
                    .sectionHeaderStyle()
            }

            Section {
                ForEach(stats.topTags.prefix(10), id: \.name) { tag in
                    LabeledContent(tag.name, value: "\(tag.count)")
                }
            } header: {
                Label(L("热门标签", "Popular Tags"), systemImage: "tag")
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
                    exportError = L("导出失败: ", "Export failed: ") + error.localizedDescription
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
                    deleteError = L("注销失败: ", "Delete failed: ") + error.localizedDescription
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
