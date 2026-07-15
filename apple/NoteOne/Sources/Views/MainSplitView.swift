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

    var body: some View {
        NavigationSplitView {
            MainSidebar(
                selection: $selection,
                notes: $notes,
                mdFiles: $mdFiles,
                writerActive: writerActive,
                onInsertCitation: insertAtCaret,
                onCreateMarkdown: { Task { await createMarkdown() } },
                onDeleteMarkdown: { file in Task { await deleteMarkdown(file) } },
                onRefresh: { await refreshNotes() },
                onDeleteNote: deleteNote,
                onSearch: { q in await searchNotes(q) },
                onShowTrash: { selection = .trash }
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
            AscanReportListView()
        case .ascanConfig:
            AscanConfigView()
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
        case .note, .trash, .ascanReports, .ascanConfig, .empty:
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
        async let n: () = refreshNotes()
        async let m: () = refreshMarkdownFiles()
        _ = await (n, m)
        startPollingIfNeeded()
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
