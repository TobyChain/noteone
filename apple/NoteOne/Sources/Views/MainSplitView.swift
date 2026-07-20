import SwiftUI
#if os(macOS)
import AppKit
#endif

#if os(macOS)
/// macOS main shell: NavigationSplitView with three panes.
///   - sidebar: MainSidebar (notes list with search/filter)
///   - center : NoteDetailView, TrashView, Ascan views, or empty placeholder
///   - inspector: collapsible Notty drawer
struct MainSplitView: View {
    @EnvironmentObject var authService: AuthService

    @State private var selection: SidebarSelection = .empty
    @State private var notes: [Note] = []
    @State private var ascanReports: [AscanReportMeta] = []
    @State private var ascanReportHTML: [String: String] = [:]

    // Right drawer
    @State private var drawerVisible: Bool = true
    @State private var showMCPInstall = false
    @State private var showCreateNote = false
    @State private var pollTimer: Timer?
    @State private var ascanRunStatus: AscanRunStatus?
    @State private var ascanPollTimer: Timer?
    @State private var ascanJustFinished = false

    var body: some View {
        NavigationSplitView {
            MainSidebar(
                selection: $selection,
                notes: $notes,
                ascanReports: $ascanReports,
                onCreateNote: { showCreateNote = true },
                onRefresh: { await refreshNotes(); await loadAscanReports() },
                onDeleteNote: deleteNote,
                onSearch: { q in await searchNotes(q) },
                onShowTrash: { selection = .trash },
                onShowConfig: { selection = .ascanConfig },
                onDeleteAscanReport: { date in Task { await deleteAscanReport(date) } }
            )
            .frame(minWidth: 240)
        } detail: {
            HStack(spacing: 0) {
                centerPane
                    .frame(maxWidth: .infinity)
                if drawerVisible {
                    Divider()
                    drawer
                        .frame(width: 360)
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
                .environmentObject(authService)
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
            .help(drawerVisible ? "隐藏 Notty" : "显示 Notty")
        }
        ToolbarItem(placement: .primaryAction) {
            Button { showMCPInstall = true } label: {
                Image(systemName: "puzzlepiece.extension")
            }
            .help("MCP 一键安装")
        }
    }

    // MARK: - Center pane

    @ViewBuilder
    private var centerPane: some View {
        VStack(spacing: 0) {
            if showsAscanBanner {
                ascanProgressBanner
            }
            centerContent
        }
    }

    private var showsAscanBanner: Bool {
        switch selection {
        case .ascanReports, .ascanReport, .ascanConfig: return true
        default: return false
        }
    }

    @State private var ascanHadError = false
    @State private var ascanLastError: String?

    @ViewBuilder
    private var ascanProgressBanner: some View {
        let isRunning = ascanRunStatus?.isRunning == true
        if isRunning || ascanJustFinished || ascanHadError {
            VStack(spacing: 0) {
                HStack(spacing: DG.sp8) {
                    if isRunning {
                        ProgressView()
                            .controlSize(.small)
                        Text(ascanRunStatus?.recentLog ?? "运行中…")
                            .font(.caption)
                            .foregroundStyle(Color.inkSecondary)
                            .lineLimit(1)
                        Spacer()
                        Button("打断") { Task { await abortAscan() } }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .tint(Color.danger)
                    } else if ascanJustFinished {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(Color.success)
                        Text("新知补充完成")
                            .font(.caption)
                            .foregroundStyle(Color.inkSecondary)
                        Spacer()
                    } else if ascanHadError {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color.danger)
                        Text(ascanLastError ?? "运行出错")
                            .font(.caption)
                            .foregroundStyle(Color.inkSecondary)
                            .lineLimit(2)
                        Spacer()
                        Button("续跑") { Task { await triggerAscan() } }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                }
                .padding(.horizontal, DG.sp16)
                .padding(.vertical, DG.sp8)
                .background(ascanHadError ? Color.danger.opacity(0.05) : Color.canvasSecondary)
                if isRunning, let logs = ascanRunStatus?.recentLogs, !logs.isEmpty {
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

    @ViewBuilder
    private var centerContent: some View {
        switch selection {
        case .note(let id):
            NoteDetailView(noteId: id, initialNote: notes.first { $0.id == id })
        case .trash:
            TrashView()
        case .ascanReports:
            VStack(spacing: DG.sp12) {
                Image(systemName: "globe")
                    .font(.system(size: 42))
                    .foregroundStyle(Color.inkTertiary)
                Text("新知")
                    .font(.headline)
                    .foregroundStyle(Color.inkSecondary)
                Text("从左侧选择一份日报查看")
                    .font(.subheadline)
                    .foregroundStyle(Color.inkTertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ascanReport(let date):
            if let html = ascanReportHTML[date] {
                AscanReportDetailView(htmlContent: html, date: date) {
                    selection = .ascanReports
                }
            } else {
                ProgressView("加载日报…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .task { await loadAscanReportHTML(date: date) }
            }
        case .ascanConfig:
            UnifiedSettingsView()
        case .empty:
            emptyPlaceholder("从左侧选择笔记")
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
        async let a: () = loadAscanReports()
        _ = await (n, a)
        startPollingIfNeeded()
        do {
            let status = try await APIClient.shared.getAscanStatus()
            ascanRunStatus = status
            if status.isRunning { startAscanPolling() }
        } catch {}
    }

    private func seedExampleContent() async {
        // 往事: seed note (only on first launch, file-based flag persists across reinstalls)
        let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NoteOne", isDirectory: true)
        try? FileManager.default.createDirectory(at: docsDir, withIntermediateDirectories: true)
        let seedNoteFlag = docsDir.appendingPathComponent(".seed-note-created")
        if !FileManager.default.fileExists(atPath: seedNoteFlag.path) {
            do {
                _ = try await APIClient.shared.createNote(
                    CreateNoteRequest(content: "这是壹识的往事模块，用于收藏和管理你的笔记。\n\n你可以通过全局快捷键（默认 Cmd+Shift+O）或 iOS 分享扩展随手记录所见所闻，闹闹会自动为你打标、摘要和向量化。\n\n\"问渠那得清如许？为有源头活水来。\"")
                )
                try? "".write(to: seedNoteFlag, atomically: true, encoding: .utf8)
            } catch {}
        }
    }

    private func loadAscanReports() async {
        do {
            ascanReports = try await APIClient.shared.listAscanReports()
        } catch {
            print("[main] load ascan reports failed: \(error)")
        }
    }

    private func loadAscanReportHTML(date: String) async {
        if ascanReportHTML[date] != nil { return }
        do {
            let resp = try await APIClient.shared.getAscanReport(date: date)
            ascanReportHTML[date] = resp.html
        } catch {
            print("[main] load ascan report html failed: \(error)")
        }
    }

    private func triggerAscan() async {
        do {
            _ = try await APIClient.shared.triggerAscan(date: nil)
            ascanJustFinished = false
            ascanHadError = false
            ascanLastError = nil
            startAscanPolling()
        } catch {
            print("[main] trigger ascan failed: \(error)")
        }
    }

    private func abortAscan() async {
        do {
            _ = try await APIClient.shared.abortAscan()
            ascanRunStatus = nil
            ascanJustFinished = false
            ascanHadError = false
            ascanLastError = nil
            stopAscanPolling()
        } catch {
            print("[main] abort ascan failed: \(error)")
        }
    }

    private func startAscanPolling() {
        stopAscanPolling()
        ascanPollTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            Task { @MainActor in
                do {
                    let status = try await APIClient.shared.getAscanStatus()
                    ascanRunStatus = status
                    if !status.isRunning {
                        stopAscanPolling()
                        let logs = status.recentLogs
                        let hasError = logs.last?.contains("失败") == true
                            || logs.last?.contains("error") == true
                            || logs.last?.contains("Error") == true
                            || (status.recentLog?.contains("失败") == true)
                        if hasError {
                            ascanHadError = true
                            ascanLastError = status.recentLog ?? logs.last
                        } else {
                            ascanJustFinished = true
                        }
                        let dateStr = ascanTodayString()
                        try? await APIClient.shared.summarizeAscan(date: dateStr)
                        await loadAscanReports()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                            ascanJustFinished = false
                        }
                    }
                } catch {}
            }
        }
    }

    private func ascanTodayString() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd"
        f.timeZone = TimeZone(identifier: "Asia/Shanghai")
        return f.string(from: Date())
    }

    private func stopAscanPolling() {
        ascanPollTimer?.invalidate()
        ascanPollTimer = nil
    }

    private func refreshNotes() async {
        do {
            notes = try await APIClient.shared.listNotes()
        } catch {
            print("[main] load notes failed: \(error)")
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
        } catch {
            print("[main] search failed: \(error)")
        }
    }

    private func startPollingIfNeeded() {
        let hasPending = notes.contains { $0.status == .pendingAi }
        if hasPending {
            pollTimer?.invalidate()
            pollTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
                Task { @MainActor in
                    do {
                        let updated = try await APIClient.shared.listNotes()
                        let stillPending = updated.contains { $0.status == .pendingAi }
                        notes = updated
                        if !stillPending {
                            pollTimer?.invalidate()
                            pollTimer = nil
                        }
                    } catch {}
                }
            }
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
                print("[main] delete note failed: \(error)")
            }
        }
    }

    private func deleteAscanReport(_ date: String) async {
        do {
            _ = try await APIClient.shared.deleteAscanReport(date: date)
            ascanReports.removeAll { $0.date == date }
            if case .ascanReport(let d) = selection, d == date {
                selection = .ascanReports
            }
            await loadAscanReports()
        } catch {
            print("[main] delete ascan report failed: \(error)")
        }
    }
}
#endif
