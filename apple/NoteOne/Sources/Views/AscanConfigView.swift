import SwiftUI

struct AscanConfigView: View {
    @State private var config: AscanConfig?
    @State private var isSaving = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var saveMessage: String?

    // Editable copies
    @State private var llmModel = ""
    @State private var llmMaxConcurrency = 5
    @State private var githubTopicsText = ""
    @State private var githubMaxRepos = 8
    @State private var githubMinStars = 500
    @State private var githubTopAnalyze = 20
    @State private var arxivSubjectsText = ""
    @State private var arxivOffsetDays = 1
    @State private var maxPapersPerSubject = 200
    @State private var maxTotalPapers = 500
    @State private var conferenceLookbackDays = 30
    @State private var conferenceRankFilterText = ""
    @State private var conferenceCategoriesText = ""
    @State private var blogMaxPerSource = 2
    @State private var logLevel = "INFO"

    // API keys (masked on load, editable)
    @State private var llmApiKey = ""
    @State private var githubToken = ""
    @State private var semanticScholarApiKey = ""

    var body: some View {
        Form {
            if isLoading {
                Section { ProgressView("加载配置…") }
            } else if let config {
                configSections(config)
            } else if let err = errorMessage {
                Section {
                    Label(err, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("新知配置")
        .task { await loadConfig() }
        .toolbar {
            #if os(macOS)
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await saveConfig() }
                } label: {
                    if isSaving {
                        ProgressView()
                    } else {
                        Text("保存")
                    }
                }
                .disabled(isSaving || config == nil)
            }
            #endif
        }
    }

    @ViewBuilder
    private func configSections(_ config: AscanConfig) -> some View {
        // LLM 配置
        Section {
            SecureField("LLM API Key", text: $llmApiKey)
                .textFieldStyle(.roundedBorder)
            TextField("Base URL", text: Binding(
                get: { config.llmBaseUrl },
                set: { _ in }
            ))
            .textFieldStyle(.roundedBorder)
            .disabled(true)
            TextField("模型名称", text: $llmModel)
                .textFieldStyle(.roundedBorder)
            Stepper("最大并发: \(llmMaxConcurrency)", value: $llmMaxConcurrency, in: 1...50)
        } header: {
            Label("LLM 配置", systemImage: "cpu")
                .sectionHeaderStyle()
        }

        // ArXiv 配置
        Section {
            TextField("分类列表 (逗号分隔)", text: $arxivSubjectsText)
                .textFieldStyle(.roundedBorder)
            Stepper("日期偏移: \(arxivOffsetDays) 天", value: $arxivOffsetDays, in: 0...7)
            Stepper("每分类最大论文: \(maxPapersPerSubject)", value: $maxPapersPerSubject, in: 10...500, step: 10)
            Stepper("总最大论文: \(maxTotalPapers)", value: $maxTotalPapers, in: 50...2000, step: 50)
        } header: {
            Label("ArXiv 配置", systemImage: "doc.text.magnifyingglass")
                .sectionHeaderStyle()
        }

        // GitHub 配置
        Section {
            SecureField("Token", text: $githubToken)
                .textFieldStyle(.roundedBorder)
            TextField("Topic 列表 (逗号分隔)", text: $githubTopicsText)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...6)
            Stepper("每 Topic 最大仓库: \(githubMaxRepos)", value: $githubMaxRepos, in: 1...50)
            Stepper("最低 Star 数: \(githubMinStars)", value: $githubMinStars, in: 0...5000, step: 100)
            Stepper("LLM 分析 Top N: \(githubTopAnalyze)", value: $githubTopAnalyze, in: 5...100, step: 5)
        } header: {
            Label("GitHub 配置", systemImage: "chevron.left.forwardslash.chevron.right")
                .sectionHeaderStyle()
        }

        // 会议论文配置
        Section {
            SecureField("Semantic Scholar API Key", text: $semanticScholarApiKey)
                .textFieldStyle(.roundedBorder)
            Stepper("回溯天数: \(conferenceLookbackDays) 天", value: $conferenceLookbackDays, in: 7...90)
            TextField("会议等级 (逗号分隔)", text: $conferenceRankFilterText)
                .textFieldStyle(.roundedBorder)
            TextField("方向分类 (逗号分隔)", text: $conferenceCategoriesText)
                .textFieldStyle(.roundedBorder)
        } header: {
            Label("会议论文配置", systemImage: "graduationcap")
                .sectionHeaderStyle()
        }

        // 博客
        Section {
            Stepper("每源最大文章: \(blogMaxPerSource)", value: $blogMaxPerSource, in: 1...10)
        } header: {
            Label("博客", systemImage: "rss")
                .sectionHeaderStyle()
        }

        // 日志
        Section {
            Picker("日志级别", selection: $logLevel) {
                ForEach(["DEBUG", "INFO", "WARNING", "ERROR"], id: \.self) { level in
                    Text(level).tag(level)
                }
            }
        } header: {
            Label("日志", systemImage: "text.line.last.and.rectangle.triangle")
                .sectionHeaderStyle()
        }

        if let msg = saveMessage {
            Section {
                Label(msg, systemImage: "checkmark.circle.fill")
                    .foregroundStyle(Color.success)
            }
        }
        if let err = errorMessage {
            Section {
                Label(err, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(Color.danger)
            }
        }

        #if os(iOS)
        Section {
            Button {
                Task { await saveConfig() }
            } label: {
                if isSaving {
                    ProgressView("保存中…")
                } else {
                    Text("保存配置")
                        .font(.headline)
                }
            }
            .disabled(isSaving)
        }
        #endif
    }

    // MARK: - Actions

    private func loadConfig() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let c = try await APIClient.shared.getAscanConfig()
            config = c
            llmModel = c.llmModel
            llmMaxConcurrency = c.llmMaxConcurrency
            githubTopicsText = c.githubTopics.joined(separator: ", ")
            githubMaxRepos = c.githubMaxReposPerTopic
            githubMinStars = c.githubMinStars
            githubTopAnalyze = c.githubTopAnalyze
            arxivSubjectsText = c.arxivSubjects.joined(separator: ", ")
            arxivOffsetDays = c.arxivDateOffsetDays
            maxPapersPerSubject = c.maxPapersPerSubject
            maxTotalPapers = c.maxTotalPapers
            conferenceLookbackDays = c.conferenceLookbackDays
            conferenceRankFilterText = c.conferenceRankFilter.joined(separator: ", ")
            conferenceCategoriesText = c.conferenceCategories.joined(separator: ", ")
            blogMaxPerSource = c.blogMaxPerSource
            logLevel = c.logLevel
            llmApiKey = c.llmApiKey
            githubToken = c.githubToken
            semanticScholarApiKey = c.semanticScholarApiKey
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveConfig() async {
        isSaving = true
        saveMessage = nil
        errorMessage = nil
        defer { isSaving = false }

        var updates: [String: Any] = [:]
        updates["llm_model"] = llmModel
        updates["llm_max_concurrency"] = llmMaxConcurrency
        updates["github_topics"] = githubTopicsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        updates["github_max_repos_per_topic"] = githubMaxRepos
        updates["github_min_stars"] = githubMinStars
        updates["github_top_analyze"] = githubTopAnalyze
        updates["arxiv_subjects"] = arxivSubjectsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        updates["arxiv_date_offset_days"] = arxivOffsetDays
        updates["max_papers_per_subject"] = maxPapersPerSubject
        updates["max_total_papers"] = maxTotalPapers
        updates["conference_lookback_days"] = conferenceLookbackDays
        updates["conference_rank_filter"] = conferenceRankFilterText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        updates["conference_categories"] = conferenceCategoriesText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        updates["blog_max_per_source"] = blogMaxPerSource
        updates["log_level"] = logLevel

        // Only send API keys if user actually changed them (not "***")
        if llmApiKey != "***" && !llmApiKey.isEmpty {
            updates["llm_api_key"] = llmApiKey
        }
        if githubToken != "***" && !githubToken.isEmpty {
            updates["github_token"] = githubToken
        }
        if semanticScholarApiKey != "***" && !semanticScholarApiKey.isEmpty {
            updates["semantic_scholar_api_key"] = semanticScholarApiKey
        }

        do {
            let updated = try await APIClient.shared.updateAscanConfig(updates: updates)
            config = updated
            llmApiKey = updated.llmApiKey
            githubToken = updated.githubToken
            semanticScholarApiKey = updated.semanticScholarApiKey
            saveMessage = "配置已保存"
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
