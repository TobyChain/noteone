import SwiftUI
#if os(macOS)
import AppKit
#endif

#if os(macOS)
/// macOS main shell: NavigationSplitView with three panes.
///   - sidebar: MainSidebar (notes list with search/filter)
///   - center : NoteDetailView, TrashView, NewLore views, or empty placeholder
///   - inspector: collapsible Notty drawer
struct MainSplitView: View {
    @EnvironmentObject var localSession: LocalSessionService

    @State private var selection: SidebarSelection = .farView
    @State private var notes: [Note] = []
    @State private var newloreReports: [NewLoreReportMeta] = []
    @State private var newloreReportHTML: [String: String] = [:]

    // Right drawer
    @State private var drawerVisible: Bool = true
    @State private var drawerWidth: CGFloat = {
        let stored = UserDefaults.standard.object(forKey: "nottyDrawerWidth") as? CGFloat
        return stored ?? 360
    }()
    @State private var isHoveringDivider: Bool = false
    @State private var isDraggingDrawer: Bool = false
    @State private var dragStartWidth: CGFloat = 360
    private var showsResizeCursor: Bool { isHoveringDivider || isDraggingDrawer }
    @State private var showMCPInstall = false
    @State private var showCreateNote = false
    @State private var pollTimer: Timer?
    @State private var newloreRunStatus: NewLoreRunStatus?
    @State private var newlorePollTimer: Timer?
    @State private var newloreJustFinished = false
    @State private var mainError: String?
    @State private var hasMoreNotes = true
    @State private var isLoadingMoreNotes = false
    @State private var nextNotesCursor: String?
    private let notePageSize = 50

    var body: some View {
        NavigationSplitView {
            MainSidebar(
                selection: $selection,
                notes: $notes,
                newloreReports: $newloreReports,
                onCreateNote: { showCreateNote = true },
                onRefresh: { await refreshNotes(); await loadNewLoreReports() },
                onDeleteNote: deleteNote,
                onSearch: { q in await searchNotes(q) },
                onLoadMore: { await loadMoreNotes() },
                hasMoreNotes: hasMoreNotes,
                isLoadingMore: isLoadingMoreNotes,
                onShowTrash: { selection = .trash },
                onShowConfig: { selection = .newloreConfig },
                onDeleteNewLoreReport: { date in Task { await deleteNewLoreReport(date) } }
            )
            .frame(minWidth: 240)
        } detail: {
            HStack(spacing: 0) {
                centerPane
                    .frame(maxWidth: .infinity)
                if drawerVisible {
                    Rectangle()
                        .fill(Color.clear)
                        .frame(width: 6)
                        .overlay(Rectangle().fill(Color.hairline).frame(width: 1))
                        .contentShape(Rectangle())
                        .onHover { hovering in isHoveringDivider = hovering }
                        .onChange(of: showsResizeCursor) { _, show in
                            #if os(macOS)
                            // set() instead of push/pop: the cursor only changes on a real
                            // state transition, so it never flickers while the thin divider
                            // slides under the pointer during an active drag.
                            if show { NSCursor.resizeLeftRight.set() } else { NSCursor.arrow.set() }
                            #endif
                        }
                        .gesture(
                            DragGesture(minimumDistance: 2)
                                .onChanged { value in
                                    if !isDraggingDrawer {
                                        isDraggingDrawer = true
                                        dragStartWidth = drawerWidth
                                    }
                                    drawerWidth = min(max(dragStartWidth - value.translation.width, 280), 640)
                                }
                                .onEnded { _ in
                                    isDraggingDrawer = false
                                    UserDefaults.standard.set(drawerWidth, forKey: "nottyDrawerWidth")
                                }
                        )
                    drawer
                        .frame(width: min(max(drawerWidth, 280), 640))
                }
            }
        }
        .toolbar { toolbarContent }
        .task { await initialLoad() }
        .onChange(of: selection) { _, newSelection in handleSelectionChange(newSelection) }
        .onReceive(NotificationCenter.default.publisher(for: .noteCreated)) { _ in
            Task {
                try? await Task.sleep(for: .milliseconds(500))
                await refreshNotes()
                startPollingIfNeeded()
            }
        }
        .sheet(isPresented: $showMCPInstall) {
            MCPInstallView()
                .environmentObject(localSession)
        }
        .sheet(isPresented: $showCreateNote) {
            CaptureView(onDismiss: { showCreateNote = false })
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button {
                drawerVisible.toggle()
            } label: {
                Image(systemName: drawerVisible ? "sidebar.right" : "sidebar.right")
                    .symbolVariant(drawerVisible ? .fill : .none)
            }
            .help(drawerVisible ? L("隐藏 Notty", "Hide Notty") : L("显示 Notty", "Show Notty"))
        }
        ToolbarItem(placement: .primaryAction) {
            Button { showMCPInstall = true } label: {
                Image(systemName: "puzzlepiece.extension")
            }
            .help(L("MCP 一键安装", "MCP Quick Install"))
        }
    }

    // MARK: - Center pane

    @ViewBuilder
    private var centerPane: some View {
        VStack(spacing: 0) {
            if let mainError {
                InlineErrorBanner(message: mainError, retryTitle: L("重试", "Retry")) {
                    self.mainError = nil
                    Task { await initialLoad() }
                }
            }
            if showsNewLoreBanner {
                newloreProgressBanner
            }
            centerContent
        }
    }

    private var showsNewLoreBanner: Bool {
        switch selection {
        case .newloreReports, .newloreReport, .newloreConfig: return true
        default: return false
        }
    }

    @State private var newloreHadError = false
    @State private var newloreLastError: String?

    @ViewBuilder
    private var newloreProgressBanner: some View {
        let isRunning = newloreRunStatus?.isRunning == true
        if isRunning || newloreJustFinished || newloreHadError {
            VStack(spacing: 0) {
                HStack(spacing: DG.sp8) {
                    if isRunning {
                        ProgressView()
                            .controlSize(.small)

                        let supplement = newloreRunStatus?.supplement
                        let moduleLabel = moduleDisplayName(supplement?.currentLabel)
                        let doneCount = supplement?.doneCount ?? 0
                        let totalCount = supplement?.modules.count ?? 0
                        let progressText = totalCount > 0
                            ? L("正在运行 \(moduleLabel)… (\(doneCount)/\(totalCount))",
                               "Running \(moduleLabel)… (\(doneCount)/\(totalCount))")
                            : (newloreRunStatus?.recentLog ?? L("正在运行 \(moduleLabel)…", "Running \(moduleLabel)…"))

                        Text(progressText)
                            .font(.caption)
                            .foregroundStyle(Color.inkSecondary)
                            .lineLimit(1)
                        Spacer()
                        Button(L("打断", "Abort")) { Task { await abortNewLore() } }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .tint(Color.danger)
                    } else if newloreJustFinished {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(Color.success)
                        Text(L("新知补充完成", "NewLore Update Complete"))
                            .font(.caption)
                            .foregroundStyle(Color.inkSecondary)
                        Spacer()
                    } else if newloreHadError {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color.danger)
                        Text(newloreLastError ?? L("运行出错", "Error"))
                            .font(.caption)
                            .foregroundStyle(Color.inkSecondary)
                            .lineLimit(2)
                        Spacer()
                        Button(L("续跑", "Resume")) { Task { await triggerNewLore() } }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                }
                .padding(.horizontal, DG.sp16)
                .padding(.vertical, DG.sp8)
                .background(newloreHadError ? Color.danger.opacity(0.05) : Color.canvasSecondary)

                if newloreHadError, let logs = newloreRunStatus?.recentLogs, !logs.isEmpty {
                    Text(logs.suffix(2).joined(separator: "\n"))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Color.danger)
                        .lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, DG.sp16)
                        .padding(.bottom, DG.sp4)
                        .background(Color.danger.opacity(0.05))
                }

                // Progress bar
                if isRunning, let supplement = newloreRunStatus?.supplement, !supplement.modules.isEmpty {
                    let doneCount = supplement.doneCount
                    let totalCount = supplement.modules.count
                    let progress = totalCount > 0 ? Double(doneCount) / Double(totalCount) : 0
                    ProgressView(value: progress)
                        .progressViewStyle(.linear)
                        .tint(Color.accent)
                        .padding(.horizontal, DG.sp16)
                        .padding(.bottom, DG.sp4)
                }

                if isRunning, let logs = newloreRunStatus?.recentLogs, !logs.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: DG.sp12) {
                            ForEach(Array(logs.enumerated()), id: \.offset) { _, line in
                                Text(line)
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(line.contains("失败") || line.contains("error") ? Color.danger : Color.inkTertiary)
                                    .lineLimit(1)
                            }
                        }
                        .padding(.horizontal, DG.sp16)
                        .padding(.bottom, DG.sp4)
                    }
                    .frame(height: 20)
                }
                Divider()
            }
        }
    }

    /// Translates server-side Chinese module labels to English when needed.
    private func moduleDisplayName(_ label: String?) -> String {
        guard let label else { return L("准备中", "Preparing") }
        let lang = UserDefaults.standard.string(forKey: "appLanguage") ?? "zh"
        guard lang == "en" else { return label }
        switch label {
        case "合并日报": return "Merging Report"
        case "准备中": return "Preparing"
        case "ArXiv": return "ArXiv"
        case "GitHub": return "GitHub"
        case "博客": return "Blog"
        case "会议论文": return "Conference Papers"
        case "微信公众号": return "WeChat"
        case "官方文档": return "Official Docs"
        default: return label
        }
    }

    @ViewBuilder
    private var centerContent: some View {
        switch selection {
        case .note(let id):
            NoteDetailView(noteId: id, initialNote: notes.first { $0.id == id })
        case .trash:
            TrashView()
        case .newloreReports:
            VStack(spacing: DG.sp12) {
                Image(systemName: "globe")
                    .font(.system(size: 42))
                    .foregroundStyle(Color.inkTertiary)
                Text(L("新知", "NewLore"))
                    .font(.headline)
                    .foregroundStyle(Color.inkSecondary)
                Text(L("从左侧选择一份日报查看", "Select a report from the left to view"))
                    .font(.subheadline)
                    .foregroundStyle(Color.inkTertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .newloreReport(let date):
            if let html = newloreReportHTML[date] {
                NewLoreReportDetailView(htmlContent: html, date: date) {
                    selection = .newloreReports
                }
            } else {
                ProgressView(L("加载日报…", "Loading report…"))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .task { await loadNewLoreReportHTML(date: date) }
            }
        case .newloreConfig:
            UnifiedSettingsView()
        case .farView:
            FarViewView()
        case .empty:
            emptyPlaceholder(L("从左侧选择笔记", "Select a note from the left"))
        }
    }

    private func emptyPlaceholder(_ text: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "doc.text")
                .font(.system(size: 42))
                .foregroundStyle(Color.inkTertiary)
            Text(text).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Right drawer (Notty)

    @ViewBuilder
    private var drawer: some View {
        NottyView(onClose: { drawerVisible = false })
    }

    // MARK: - Selection handling

    private func handleSelectionChange(_ newSelection: SidebarSelection) {
        // No writer state to flush anymore — selection switches are immediate.
    }

    // MARK: - Initial load + refresh

    private func initialLoad() async {
        await seedExampleContent()
        async let n: () = refreshNotes()
        async let a: () = loadNewLoreReports()
        _ = await (n, a)
        startPollingIfNeeded()
        do {
            let status = try await APIClient.shared.getNewLoreStatus()
            newloreRunStatus = status
            if status.isRunning { startNewLorePolling() }
        } catch {}
    }

    /// Seed a note only for an empty store and persist the decision without probing user folders.
    private func seedExampleContent() async {
        let seedNoteCreatedKey = "seedExampleNoteCreated"
        guard !UserDefaults.standard.bool(forKey: seedNoteCreatedKey) else { return }

        do {
            let stats = try await APIClient.shared.getStats()
            if stats.totalNotes == 0 {
                _ = try await APIClient.shared.createNote(
                    CreateNoteRequest(content: "这是壹识的往事模块，用于收藏和管理你的笔记。\n\n你可以通过全局快捷键（默认 Cmd+Shift+O）或 iOS 分享扩展随手记录所见所闻，闹闹会自动为你打标、摘要和向量化。\n\n\"问渠那得清如许？为有源头活水来。\"")
                )
            }
            UserDefaults.standard.set(true, forKey: seedNoteCreatedKey)
        } catch {
            // Leave the flag unset so a transient local-server failure can retry next launch.
        }
    }

    private func loadNewLoreReports() async {
        do {
            newloreReports = try await APIClient.shared.listNewLoreReports()
        } catch {
            mainError = error.localizedDescription
        }
    }

    private func loadNewLoreReportHTML(date: String) async {
        if newloreReportHTML[date] != nil { return }
        do {
            let resp = try await APIClient.shared.getNewLoreReport(date: date)
            newloreReportHTML[date] = resp.html
        } catch {
            mainError = error.localizedDescription
        }
    }

    private func triggerNewLore() async {
        do {
            _ = try await APIClient.shared.triggerNewLore(date: nil)
            newloreJustFinished = false
            newloreHadError = false
            newloreLastError = nil
            startNewLorePolling()
        } catch {
            mainError = error.localizedDescription
        }
    }

    private func abortNewLore() async {
        do {
            _ = try await APIClient.shared.abortNewLore()
            newloreRunStatus = nil
            newloreJustFinished = false
            newloreHadError = false
            newloreLastError = nil
            stopNewLorePolling()
        } catch {
            mainError = error.localizedDescription
        }
    }

    private func startNewLorePolling() {
        stopNewLorePolling()
        newlorePollTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            Task { @MainActor in
                do {
                    let status = try await APIClient.shared.getNewLoreStatus()
                    newloreRunStatus = status
                    if !status.isRunning {
                        stopNewLorePolling()
                        let logs = status.recentLogs
                        let hasError = logs.last?.contains("失败") == true
                            || logs.last?.contains("error") == true
                            || logs.last?.contains("Error") == true
                            || (status.recentLog?.contains("失败") == true)
                        if hasError {
                            newloreHadError = true
                            newloreLastError = status.recentLog ?? logs.last
                        } else {
                            newloreJustFinished = true
                        }
                        let dateStr = newloreTodayString()
                        _ = try? await APIClient.shared.summarizeNewLore(date: dateStr)
                        await loadNewLoreReports()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                            newloreJustFinished = false
                        }
                    }
                } catch {}
            }
        }
    }

    private func newloreTodayString() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd"
        f.timeZone = .current
        return f.string(from: Date())
    }

    private func stopNewLorePolling() {
        newlorePollTimer?.invalidate()
        newlorePollTimer = nil
    }

    private func refreshNotes() async {
        do {
            let page = try await APIClient.shared.listNotesPage(limit: notePageSize)
            notes = page.notes
            nextNotesCursor = page.nextCursor
            hasMoreNotes = page.nextCursor != nil
        } catch {
            mainError = error.localizedDescription
        }
    }

    private func searchNotes(_ query: String) async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { await refreshNotes(); return }
        do {
            let results = try await APIClient.shared.searchNotes(query: q)
            notes = results.map { r in
                Note(
                    id: r.id,
                    contentType: ContentType(rawValue: r.contentType) ?? .text,
                    title: r.title,
                    content: r.content,
                    sourceUrl: r.sourceUrl,
                    sourceApp: r.sourceApp,
                    author: r.author,
                    authorOrg: r.authorOrg,
                    aiSummary: r.aiSummary,
                    status: .active,
                    deletedAt: nil,
                    tags: nil,
                    createdAt: r.createdAt,
                    updatedAt: r.updatedAt
                )
            }
            hasMoreNotes = false
            nextNotesCursor = nil
        } catch {
            mainError = error.localizedDescription
        }
    }

    private func startPollingIfNeeded() {
        let hasPending = notes.contains { $0.status == .pendingAi }
        if hasPending {
            pollTimer?.invalidate()
            pollTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
                Task { @MainActor in
                    do {
                        let pendingIds = notes.filter { $0.status == .pendingAi }.map(\.id)
                        let updated = try await APIClient.shared.getNoteStatuses(ids: pendingIds)
                        for note in updated {
                            if let index = notes.firstIndex(where: { $0.id == note.id }) { notes[index] = note }
                        }
                        let stillPending = updated.contains { $0.status == .pendingAi }
                        if !stillPending {
                            pollTimer?.invalidate()
                            pollTimer = nil
                        }
                    } catch {}
                }
            }
        }
    }

    private func loadMoreNotes() async {
        guard hasMoreNotes, !isLoadingMoreNotes else { return }
        isLoadingMoreNotes = true
        defer { isLoadingMoreNotes = false }
        do {
            let page = try await APIClient.shared.listNotesPage(limit: notePageSize, cursor: nextNotesCursor)
            notes = NotePagination.appending(page.notes, to: notes)
            nextNotesCursor = page.nextCursor
            hasMoreNotes = page.nextCursor != nil
        } catch {
            mainError = error.localizedDescription
        }
    }

    // MARK: - Note actions

    private func deleteNote(_ note: Note) {
        Task {
            do {
                try await APIClient.shared.deleteNote(id: note.id)
                notes.removeAll { $0.id == note.id }
                if case .note(let id) = selection, id == note.id {
                    selection = .empty
                }
            } catch {
                mainError = error.localizedDescription
            }
        }
    }

    private func deleteNewLoreReport(_ date: String) async {
        do {
            _ = try await APIClient.shared.deleteNewLoreReport(date: date)
            newloreReports.removeAll { $0.date == date }
            if case .newloreReport(let d) = selection, d == date {
                selection = .newloreReports
            }
            await loadNewLoreReports()
        } catch {
            mainError = error.localizedDescription
        }
    }
}
#endif
