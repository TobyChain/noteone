import SwiftUI
#if os(macOS)
import AppKit
#endif

#if os(macOS)
/// macOS main shell: NavigationSplitView with three panes.
///   - sidebar: MainSidebar (markdown files + notes list with search/filter)
///   - center : NoteDetailView, WriterEditorPane, TrashView, or empty placeholder
///   - inspector: collapsible Notty drawer (writer-mode when editing markdown,
///                regular Notty otherwise)
struct MainSplitView: View {
    @EnvironmentObject var authService: AuthService

    @State private var selection: SidebarSelection = .empty
    @State private var notes: [Note] = []
    @State private var mdFiles: [LocalMarkdownFile] = []
    @State private var ascanReports: [AscanReportMeta] = []
    @State private var ascanReportHTML: [String: String] = [:]

    // Active markdown editor state. Lives at the top so the sidebar can react to
    // "writer is active" and so Notty's drawer can bind directly to the document.
    @State private var currentFile: LocalMarkdownFile?
    @State private var mdContent: String = ""
    @State private var mdSelection: NSRange = NSRange(location: 0, length: 0)
    @State private var mdLastSavedAt: Date?
    @State private var mdSaveTask: Task<Void, Never>?

    // Right drawer
    @State private var drawerVisible: Bool = true
    @State private var showMCPInstall = false
    @State private var renameAlert = false
    @State private var renameText = ""
    @State private var renameTarget: LocalMarkdownFile?
    @State private var pollTimer: Timer?
    @State private var ascanRunStatus: AscanRunStatus?
    @State private var ascanPollTimer: Timer?
    @State private var ascanJustFinished = false

    var body: some View {
        NavigationSplitView {
            MainSidebar(
                selection: $selection,
                notes: $notes,
                mdFiles: $mdFiles,
                ascanReports: $ascanReports,
                writerActive: writerActive,
                onInsertCitation: insertAtCaret,
                onCreateMarkdown: { Task { await createMarkdown() } },
                onDeleteMarkdown: { file in Task { await deleteMarkdown(file) } },
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
        .alert("重命名", isPresented: $renameAlert) {
            TextField("标题", text: $renameText)
            Button("取消", role: .cancel) {}
            Button("保存") {
                if let target = renameTarget { Task { await rename(target, to: renameText) } }
            }
        }
        .sheet(isPresented: $showMCPInstall) {
            MCPInstallView()
                .environmentObject(authService)
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
        case .markdown:
            if let file = currentFile {
                WriterEditorPane(
                    fileTitle: file.title,
                    content: $mdContent,
                    selection: $mdSelection,
                    lastSavedAt: mdLastSavedAt,
                    onRename: {
                        renameTarget = file
                        renameText = file.title
                        renameAlert = true
                    },
                    onDelete: { Task { await deleteMarkdown(file) } },
                    onContentChange: scheduleSave
                )
            } else {
                emptyPlaceholder("正在加载文件…")
            }
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
            emptyPlaceholder("从左侧选择笔记或写作文件")
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
        if writerActive {
            // Writer-mode Notty: can read + edit the active markdown document
            VStack(spacing: 0) {
                WriterAssistantView(documentText: $mdContent, selection: $mdSelection)
            }
        } else {
            // Regular Notty (read-only chat with notes)
            NottyView(onClose: { drawerVisible = false })
        }
    }

    // MARK: - Selection handling

    private var writerActive: Bool {
        if case .markdown = selection { return currentFile != nil }
        return false
    }

    private func handleSelectionChange(_ newSelection: SidebarSelection) {
        switch newSelection {
        case .markdown(let file):
            Task { await openMarkdown(file) }
        case .note, .trash, .ascanReports, .ascanReport, .ascanConfig, .empty:
            // Leaving the writer — flush any in-flight save and clear editor state.
            if currentFile != nil {
                let pending = currentFile
                currentFile = nil
                Task {
                    await flushPendingSave(for: pending)
                    mdContent = ""
                    mdSelection = NSRange(location: 0, length: 0)
                    mdLastSavedAt = nil
                }
            }
        }
    }

    // MARK: - Initial load + refresh

    private func initialLoad() async {
        await seedExampleContent()
        async let n: () = refreshNotes()
        async let m: () = refreshMarkdownFiles()
        async let a: () = loadAscanReports()
        _ = await (n, m, a)
        startPollingIfNeeded()
        do {
            let status = try await APIClient.shared.getAscanStatus()
            ascanRunStatus = status
            if status.isRunning { startAscanPolling() }
        } catch {}
    }

    private func seedExampleContent() async {
        // 记实: seed markdown file
        let mdDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NoteOne", isDirectory: true)
        try? FileManager.default.createDirectory(at: mdDir, withIntermediateDirectories: true)
        let seedMd = mdDir.appendingPathComponent("欢迎使用.md")
        if !FileManager.default.fileExists(atPath: seedMd.path) {
            let content = """
# 欢迎使用壹识

壹识是你的赛博古风知识系统。这里是**记实**模块，用于本地 Markdown 写作。

## 功能

- 实时渲染：点击预览区域进入编辑，按 `Escape` 返回渲染视图
- 源码模式：`Cmd+Shift+/` 切换纯源码显示
- 引用插入：在往事中选择笔记，点击插入引用按钮即可引用到写作中

## 语法示例

### 代码块

```python
def hello():
    print("Hello, 壹识!")
```

### 列表

- 记实 — 本地写作
- 往事 — 笔记收藏
- 新知 — 科技日报

### 引用

> 路漫漫其修远兮，吾将上下而求索。

---

点击此文件可进入编辑模式。
"""
            try? content.write(to: seedMd, atomically: true, encoding: .utf8)
        }

        // 往事: seed note (only on first launch, file-based flag persists across reinstalls)
        let seedNoteFlag = mdDir.appendingPathComponent(".seed-note-created")
        if !FileManager.default.fileExists(atPath: seedNoteFlag.path) {
            do {
                _ = try await APIClient.shared.createNote(
                    CreateNoteRequest(content: "这是壹识的往事模块，用于收藏和管理你的笔记。\n\n你可以通过全局快捷键（默认 Cmd+Shift+O）或 iOS 分享扩展随手记录所见所闻，闹闹会自动为你打标、摘要和向量化。\n\n\"问渠那得清如许？为有源头活水来。\"")
                )
                try? "".write(to: seedNoteFlag, atomically: true, encoding: .utf8)
            } catch {}
        }

        // 新知: seed report (server-side)
        let seedReportPath = seedMd.deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("ai.alibaba/noteone/ascan/docs/Ascan-00000000.html")
        // The server handles this — trigger a seed via the trigger endpoint is too heavy.
        // Instead, we'll create a lightweight seed on the server side.
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

    private func revealDocsInFinder() async {
        do {
            let path = try await APIClient.shared.getAscanDocsPath()
            let url = URL(fileURLWithPath: path)
            #if os(macOS)
            NSWorkspace.shared.activateFileViewerSelecting([url])
            #endif
        } catch {
            print("[main] reveal docs failed: \(error)")
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

    private func refreshMarkdownFiles() async {
        do {
            mdFiles = try await LocalFileStore.shared.list()
        } catch {
            print("[main] load md files failed: \(error)")
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

    // MARK: - Markdown actions

    private func openMarkdown(_ file: LocalMarkdownFile) async {
        // If we were already editing another file, save before switching.
        if let prev = currentFile, prev.id != file.id {
            await flushPendingSave(for: prev)
        }
        do {
            let text = try await LocalFileStore.shared.read(file)
            currentFile = file
            mdContent = text
            mdSelection = NSRange(location: 0, length: 0)
            mdLastSavedAt = file.modifiedAt
        } catch {
            print("[main] open md failed: \(error)")
        }
    }

    private func createMarkdown() async {
        if let prev = currentFile { await flushPendingSave(for: prev) }
        do {
            let file = try await LocalFileStore.shared.create()
            mdFiles.insert(file, at: 0)
            currentFile = file
            mdContent = ""
            mdSelection = NSRange(location: 0, length: 0)
            mdLastSavedAt = file.modifiedAt
            selection = .markdown(file)
        } catch {
            print("[main] create md failed: \(error)")
        }
    }

    private func deleteMarkdown(_ file: LocalMarkdownFile) async {
        do {
            try await LocalFileStore.shared.delete(file)
            mdFiles.removeAll { $0.id == file.id }
            if currentFile?.id == file.id {
                currentFile = nil
                mdContent = ""
                selection = .empty
            }
        } catch {
            print("[main] delete md failed: \(error)")
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

    private func rename(_ file: LocalMarkdownFile, to newTitle: String) async {
        let trimmed = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != file.title else { return }
        do {
            // Save current edits before renaming so we don't lose work.
            try await LocalFileStore.shared.write(file, content: mdContent)
            let renamed = try await LocalFileStore.shared.rename(file, to: trimmed)
            await refreshMarkdownFiles()
            currentFile = renamed
            selection = .markdown(renamed)
        } catch {
            print("[main] rename failed: \(error)")
        }
    }

    // MARK: - Save / debounce

    private func scheduleSave() {
        mdSaveTask?.cancel()
        mdSaveTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            if Task.isCancelled { return }
            await persistCurrent()
        }
    }

    private func flushPendingSave(for file: LocalMarkdownFile?) async {
        mdSaveTask?.cancel()
        guard let file else { return }
        do {
            try await LocalFileStore.shared.write(file, content: mdContent)
        } catch {
            print("[main] flush save failed: \(error)")
        }
    }

    private func persistCurrent() async {
        guard let file = currentFile else { return }
        do {
            try await LocalFileStore.shared.write(file, content: mdContent)
            mdLastSavedAt = Date()
            if let i = mdFiles.firstIndex(where: { $0.id == file.id }) {
                mdFiles[i] = LocalMarkdownFile(
                    id: file.id, url: file.url,
                    modifiedAt: Date(), sizeBytes: mdContent.utf8.count
                )
                mdFiles.sort { $0.modifiedAt > $1.modifiedAt }
            }
        } catch {
            print("[main] persist failed: \(error)")
        }
    }

    // MARK: - Insert citation (called by sidebar's note rows)

    private func insertAtCaret(_ text: String) {
        let ns = mdContent as NSString
        let insertAt = min(mdSelection.location, ns.length)
        let newDoc = ns.replacingCharacters(in: NSRange(location: insertAt, length: 0), with: text)
        mdContent = newDoc
        mdSelection = NSRange(location: insertAt + (text as NSString).length, length: 0)
        scheduleSave()
    }
}
#endif
