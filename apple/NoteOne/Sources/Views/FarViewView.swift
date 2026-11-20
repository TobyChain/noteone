import SwiftUI

struct FarViewView: View {
    @State private var response: FarViewOverviewResponse?
    @State private var isLoading = true
    @State private var isRefreshing = false
    @State private var errorMessage: String?
    @State private var selectedTopic: FarViewTopic?

    var body: some View {
        Group {
            if let selectedTopic {
                FarViewTopicDetailView(topic: selectedTopic) { self.selectedTopic = nil }
            } else {
                overview
            }
        }
        .navigationTitle(L("高见", "FarView"))
        .task { await load() }
    }

    @ViewBuilder
    private var overview: some View {
        if isLoading {
            ProgressView(L("读取热度榜…", "Loading topic heat…"))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, response?.snapshot == nil {
            EmptyStateView(
                icon: "exclamationmark.triangle",
                title: L("高见加载失败", "FarView could not load"),
                subtitle: errorMessage,
                actionTitle: L("重试", "Retry"),
                action: { Task { await load() } }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if response?.state == "not_generated" {
            EmptyStateView(
                icon: "chart.line.uptrend.xyaxis",
                title: L("还没有热度榜", "No topic ranking yet"),
                subtitle: L("采集内容后即可计算最近 7 天内热度最高的 10 个话题。",
                            "Collect content to rank the ten hottest topics from the last seven days."),
                actionTitle: isRefreshing ? L("正在计算…", "Calculating…") : L("生成高见", "Generate FarView"),
                action: { Task { await refresh() } }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let snapshot = response?.snapshot {
            VStack(spacing: 0) {
                if let errorMessage {
                    InlineErrorBanner(message: errorMessage, retryTitle: L("重试", "Retry")) {
                        Task { await refresh() }
                    }
                }
                snapshotView(snapshot)
            }
        } else {
            EmptyStateView(
                icon: "tray",
                title: L("数据不足", "Insufficient data"),
                subtitle: L("先运行新知采集，完成后高见会自动重新计算。",
                            "Run NewLore first; FarView recalculates automatically when it finishes."),
                actionTitle: L("重新检查", "Check again"),
                action: { Task { await load() } }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func snapshotView(_ snapshot: FarViewSnapshot) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: DG.sp16) {
                header(snapshot)
                if snapshot.topics.isEmpty {
                    EmptyStateView(
                        icon: "chart.line.uptrend.xyaxis",
                        title: L("最近 7 天暂无有效话题", "No qualified topics in the last 7 days"),
                        subtitle: L("已读取数据，但没有话题达到最低独立条目数。",
                                    "Data was processed, but no topic met the minimum unique-item count.")
                    )
                    .frame(maxWidth: .infinity, minHeight: 260)
                } else {
                    Text(L("最近 7 天热门话题", "Top topics from the last 7 days"))
                        .font(.headline)
                    ForEach(Array(snapshot.topics.enumerated()), id: \.element.id) { rank, topic in
                        Button { selectedTopic = topic } label: {
                            FarViewTopicRow(rank: rank + 1, topic: topic)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(DG.sp20)
            .frame(maxWidth: 820, alignment: .leading)
        }
        .refreshable { await refresh() }
    }

    private func header(_ snapshot: FarViewSnapshot) -> some View {
        VStack(alignment: .leading, spacing: DG.sp8) {
            HStack {
                Label(L("高见", "FarView"), systemImage: "chart.line.uptrend.xyaxis")
                    .font(.title2.bold())
                Spacer()
                Button { Task { await refresh() } } label: {
                    if isRefreshing { ProgressView().controlSize(.small) }
                    else { Label(L("刷新", "Refresh"), systemImage: "arrow.clockwise") }
                }
                .disabled(isRefreshing)
            }
            Text(L("按最近 7 天的独立内容量和来源覆盖计算热度，最多展示 10 个话题。",
                   "Heat is calculated from unique items and source coverage over the last seven days, with up to ten topics."))
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
            Text(L("覆盖 \(snapshot.totalItems) 条内容，\(snapshot.periodStart) 至 \(snapshot.periodEnd)",
                   "\(snapshot.totalItems) items, \(snapshot.periodStart) to \(snapshot.periodEnd)"))
                .font(.caption)
                .foregroundStyle(Color.inkTertiary)
        }
        .cardStyle()
    }

    @MainActor
    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            async let overview = APIClient.shared.getFarViewOverview()
            async let status = APIClient.shared.getFarViewStatus()
            let (loadedOverview, loadedStatus) = try await (overview, status)
            response = loadedOverview
            if loadedStatus.isRunning {
                isLoading = false
                isRefreshing = true
                await waitForRefreshCompletion()
                return
            }
        }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    @MainActor
    private func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        errorMessage = nil
        do {
            _ = try await APIClient.shared.refreshFarView()
            await waitForRefreshCompletion()
        } catch { errorMessage = error.localizedDescription }
        isRefreshing = false
    }

    @MainActor
    private func waitForRefreshCompletion() async {
        do {
            for _ in 0..<60 {
                try? await Task.sleep(for: .milliseconds(500))
                let status = try await APIClient.shared.getFarViewStatus()
                if !status.isRunning {
                    if let error = status.error { throw APIError.serverMessage(statusCode: 500, message: error) }
                    response = try await APIClient.shared.getFarViewOverview()
                    isRefreshing = false
                    return
                }
            }
            throw APIError.serverMessage(
                statusCode: 408,
                message: L("热度榜仍在后台计算，请稍后重新检查", "Topic ranking is still being calculated; check again shortly")
            )
        } catch {
            errorMessage = error.localizedDescription
            isRefreshing = false
        }
    }
}

private struct FarViewTopicRow: View {
    let rank: Int
    let topic: FarViewTopic

    var body: some View {
        HStack(alignment: .top, spacing: DG.sp12) {
            Text("#\(rank)").font(.headline.monospacedDigit()).foregroundStyle(Color.accent)
            VStack(alignment: .leading, spacing: DG.sp8) {
                HStack {
                    Text(topic.name).font(.headline).foregroundStyle(Color.ink)
                    if topic.relevance == "related" {
                        Text(L("与你相关", "For you"))
                            .font(.caption2.bold())
                            .foregroundStyle(Color.accent)
                    }
                    Spacer()
                    Text(L("热度 \(topic.formattedScore)", "Heat \(topic.formattedScore)"))
                        .font(.caption.bold()).foregroundStyle(Color.accent)
                }
                HStack(spacing: DG.sp12) {
                    Label(L("\(topic.currentCount) 条内容", "\(topic.currentCount) items"), systemImage: "doc.text")
                    Label(L("\(topic.sourceDiversity) 类来源", "\(topic.sourceDiversity) source types"), systemImage: "square.stack.3d.up")
                }
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
            }
        }
        .cardStyle()
    }

}

private struct FarViewTopicDetailView: View {
    let topic: FarViewTopic
    let onBack: () -> Void
    @State private var response: FarViewTopicResponse?
    @State private var isLoadingEvidence = true
    @State private var errorMessage: String?

    /// Keep the selected ranking visible while loading its current source evidence.
    private var displayedTopic: FarViewTopic {
        if let loaded = response?.topic, loaded.id == topic.id { return loaded }
        return topic
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DG.sp16) {
                Button(action: onBack) { Label(L("返回榜单", "Back to ranking"), systemImage: "chevron.left") }
                Text(displayedTopic.name).font(.largeTitle.bold())
                HStack(spacing: DG.sp16) {
                    Label(L("最近 7 天 \(displayedTopic.currentCount) 条", "\(displayedTopic.currentCount) items in 7 days"), systemImage: "doc.text")
                    Label(L("\(displayedTopic.sourceDiversity) 类来源", "\(displayedTopic.sourceDiversity) source types"), systemImage: "square.stack.3d.up")
                    Text(L("热度 \(displayedTopic.formattedScore)", "Heat \(displayedTopic.formattedScore)"))
                }
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
                if let snapshot = response?.snapshot {
                    Text("\(snapshot.periodStart) — \(snapshot.periodEnd)")
                        .font(.subheadline)
                        .foregroundStyle(Color.inkSecondary)
                }
                Text(L("来源构成", "Source mix")).font(.headline)
                ForEach(displayedTopic.sourceCounts.keys.sorted(), id: \.self) { source in
                    HStack { Text(sourceName(source)); Spacer(); Text("\(displayedTopic.sourceCounts[source] ?? 0)") }
                }
                HStack {
                    Text(L("代表内容", "Representative items")).font(.headline)
                    Spacer()
                    if isLoadingEvidence { ProgressView().controlSize(.small) }
                }
                if let errorMessage {
                    InlineErrorBanner(message: errorMessage, retryTitle: L("重试", "Retry")) {
                        Task { await loadEvidence() }
                    }
                }
                ForEach(displayedTopic.representatives) { item in
                    representativeLabel(item)
                        .cardStyle(padding: DG.sp16)
                }
            }
            .padding(DG.sp20)
            .frame(maxWidth: 820, alignment: .leading)
        }
        .task(id: topic.id) { await loadEvidence() }
    }

    /// Display the supporting summary separately so its text stays selectable.
    private func representativeLabel(_ item: FarViewRepresentative) -> some View {
        VStack(alignment: .leading, spacing: DG.sp8) {
            HStack(alignment: .top) {
                Text(item.title).font(.subheadline.bold()).foregroundStyle(Color.ink)
                Spacer()
                if let url = sourceURL(item.url) {
                    Link(destination: url) {
                        Image(systemName: "arrow.up.right").foregroundStyle(Color.accent)
                    }
                    .help(L("打开来源", "Open source"))
                }
            }
            Text(L("\(sourceName(item.sourceType))，收录于 \(item.observedDate)",
                   "\(sourceName(item.sourceType)), observed \(item.observedDate)"))
                .font(.caption).foregroundStyle(Color.inkSecondary)
            if let summary = item.summary?.trimmingCharacters(in: .whitespacesAndNewlines), !summary.isEmpty {
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(Color.ink)
                    .textSelection(.enabled)
            }
            if let url = sourceURL(item.url) {
                Link(url.host ?? url.absoluteString, destination: url)
                    .font(.caption)
                    .textSelection(.enabled)
            }
        }
    }

    /// Open article links using the same HTTP boundary as the source service.
    private func sourceURL(_ raw: String?) -> URL? {
        guard let raw, let url = URL(string: raw),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return nil }
        return url
    }

    /// Keep source categories consistent with the five NewLore modules.
    private func sourceName(_ source: String) -> String {
        switch source {
        case "paper": return L("arXiv 精选", "arXiv")
        case "conference": return L("会议期刊", "Conferences and journals")
        case "github": return L("GitHub 项目", "GitHub projects")
        case "blog": return L("个人博客", "Personal blogs")
        case "official": return L("官方动态", "Official updates")
        default: return source
        }
    }

    /// Load evidence for the selected topic without changing the ranking or calling a model.
    @MainActor
    private func loadEvidence() async {
        guard !Task.isCancelled else { return }
        isLoadingEvidence = true
        errorMessage = nil
        if response?.topic.id != topic.id { response = nil }
        do {
            let loaded = try await APIClient.shared.getFarViewTopic(id: topic.id)
            try Task.checkCancellation()
            response = loaded
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
        isLoadingEvidence = false
    }
}

private extension FarViewTopic {
    /// Keep heat labels compact and consistent across overview and detail views.
    var formattedScore: String {
        score.formatted(.number.precision(.fractionLength(2)))
    }
}
