import SwiftUI

/// Three-pane local markdown writer:
///   - left: file list (local `.md` files under ~/Documents/NoteOne/)
///   - center: editor + preview (selection-aware so Notty can do precise edits)
///   - right: collapsible drawer with Notty assistant / notes reference (tab switch)
///
/// On iOS the drawer becomes a sheet to keep the editor full-width.
struct WriterView: View {
    /// Optional callback the host (e.g. macOS sheet) can pass to dismiss the writer.
    var onClose: (() -> Void)? = nil

    @State private var files: [LocalMarkdownFile] = []
    @State private var selectedFile: LocalMarkdownFile?
    @State private var content: String = ""
    @State private var selection: NSRange = NSRange(location: 0, length: 0)
    @State private var displayMode: DisplayMode = .edit
    @State private var saveTask: Task<Void, Never>?
    @State private var lastSavedAt: Date?
    @State private var showRename = false
    @State private var renameTitle = ""
    @State private var errorMessage: String?

    // Right drawer
    @State private var drawerVisible: Bool = true
    @State private var drawerTab: DrawerTab = .notty
    // iOS-only: drawer is presented as a sheet
    @State private var iOSDrawerSheet: DrawerTab? = nil

    enum DisplayMode: String, CaseIterable {
        case edit = "编辑"
        case preview = "预览"
        case split = "并排"
    }

    enum DrawerTab: String, CaseIterable, Identifiable {
        case notty = "闹闹"
        case notes = "往事"
        var id: String { rawValue }
    }

    var body: some View {
        #if os(macOS)
        macOSBody
        #else
        iOSBody
        #endif
    }

    // MARK: - macOS layout (3 panes)

    #if os(macOS)
    private var macOSBody: some View {
        NavigationSplitView {
            fileList
                .frame(minWidth: 200)
        } detail: {
            HStack(spacing: 0) {
                editorPane
                    .frame(maxWidth: .infinity)
                if drawerVisible {
                    Divider()
                    rightDrawer
                        .frame(width: 360)
                }
            }
        }
        .navigationTitle("写作")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                if let onClose {
                    Button {
                        Task { await flushPendingSave(); onClose() }
                    } label: {
                        Label("返回笔记", systemImage: "chevron.left")
                    }
                    .help("返回笔记")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    drawerVisible.toggle()
                } label: {
                    Image(systemName: drawerVisible ? "sidebar.right" : "sidebar.right")
                        .symbolVariant(drawerVisible ? .fill : .none)
                }
                .help(drawerVisible ? "隐藏侧栏" : "显示侧栏")
            }
        }
        .task { await loadFiles() }
    }
    #endif

    // MARK: - iOS layout

    #if !os(macOS)
    private var iOSBody: some View {
        NavigationStack {
            if selectedFile != nil {
                editorPane
                    .toolbar {
                        ToolbarItem(placement: .navigationBarLeading) {
                            Button {
                                Task {
                                    await flushPendingSave()
                                    selectedFile = nil
                                }
                            } label: {
                                Label("文件列表", systemImage: "chevron.left")
                            }
                        }
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Menu {
                                Button { iOSDrawerSheet = .notty } label: {
                                    Label("Notty 助手", systemImage: "sparkles")
                                }
                                Button { iOSDrawerSheet = .notes } label: {
                                    Label("笔记参考", systemImage: "books.vertical")
                                }
                            } label: {
                                Image(systemName: "wand.and.stars")
                            }
                        }
                    }
                    .sheet(item: $iOSDrawerSheet) { tab in
                        NavigationStack {
                            drawerContent(for: tab)
                                .toolbar {
                                    ToolbarItem(placement: .topBarTrailing) {
                                        Button("完成") { iOSDrawerSheet = nil }
                                    }
                                }
                                .navigationTitle(tab.rawValue)
                        }
                    }
            } else {
                fileList
                    .navigationTitle("写作")
            }
        }
        .task { await loadFiles() }
    }
    #endif

    // MARK: - File list (left pane)

    private var fileList: some View {
        List(selection: bindingForSelection) {
            Section {
                if files.isEmpty {
                    Text("还没有文件")
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 24)
                        .listRowBackground(Color.clear)
                } else {
                    ForEach(files) { file in
                        fileRow(file)
                            .tag(file)
                    }
                }
            }
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await createNew() } } label: {
                    Image(systemName: "square.and.pencil")
                }
                .help("新建文件")
            }
        }
    }

    private func fileRow(_ file: LocalMarkdownFile) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(file.title)
                .font(.body)
                .foregroundStyle(Color.ink)
                .lineLimit(1)
            HStack(spacing: 6) {
                Text(file.modifiedAt, format: .relative(presentation: .numeric))
                Text("·")
                Text("\(file.sizeBytes) B")
            }
            .font(.caption2)
            .foregroundStyle(Color.inkTertiary)
        }
        .padding(.vertical, 2)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task { await deleteFile(file) }
            } label: {
                Label("删除", systemImage: "trash")
            }
        }
        #if !os(macOS)
        .contentShape(Rectangle())
        .onTapGesture { Task { await select(file) } }
        #endif
    }

    private var bindingForSelection: Binding<LocalMarkdownFile?> {
        Binding(
            get: { selectedFile },
            set: { newValue in
                if let newValue { Task { await select(newValue) } }
                else { selectedFile = nil }
            }
        )
    }

    // MARK: - Editor pane (center)

    @ViewBuilder
    private var editorPane: some View {
        if let file = selectedFile {
            VStack(spacing: 0) {
                editorToolbar(for: file)
                Divider()
                switch displayMode {
                case .edit:
                    editor
                case .preview:
                    previewArea
                case .split:
                    #if os(macOS)
                    HStack(spacing: 0) {
                        editor
                        Divider()
                        previewArea
                    }
                    #else
                    editor
                    #endif
                }
            }
            .navigationTitle(file.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        } else {
            VStack(spacing: 12) {
                Image(systemName: "doc.text")
                    .font(.system(size: 48))
                    .foregroundStyle(Color.inkTertiary)
                Text("选择左侧文件，或新建一个")
                    .foregroundStyle(Color.inkSecondary)
                Button("新建文件") { Task { await createNew() } }
                    .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func editorToolbar(for file: LocalMarkdownFile) -> some View {
        HStack(spacing: 12) {
            Picker("", selection: $displayMode) {
                ForEach(availableModes, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: macOSToolbarWidth)

            Spacer()

            if let saved = lastSavedAt {
                Text("已保存 \(saved, format: .relative(presentation: .numeric))")
                    .font(.caption)
                    .foregroundStyle(Color.inkTertiary)
            }

            Button {
                renameTitle = file.title
                showRename = true
            } label: {
                Image(systemName: "pencil")
            }
            .help("重命名")

            Button(role: .destructive) {
                Task { await deleteFile(file) }
            } label: {
                Image(systemName: "trash")
                    .foregroundStyle(.red)
            }
            .help("删除")
        }
        .padding(8)
        .alert("重命名", isPresented: $showRename) {
            TextField("标题", text: $renameTitle)
            Button("取消", role: .cancel) {}
            Button("保存") { Task { await rename(file, to: renameTitle) } }
        }
    }

    private var availableModes: [DisplayMode] {
        #if os(macOS)
        return DisplayMode.allCases
        #else
        return [.edit, .preview]
        #endif
    }

    private var macOSToolbarWidth: CGFloat {
        #if os(macOS)
        return 220
        #else
        return 160
        #endif
    }

    private var editor: some View {
        SelectionAwareTextView(text: $content, selection: $selection)
            .onChange(of: content) { _, _ in scheduleSave() }
    }

    private var previewArea: some View {
        ScrollView {
            MarkdownPreview(markdown: content)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Right drawer (Notty / notes reference)

    @ViewBuilder
    private var rightDrawer: some View {
        VStack(spacing: 0) {
            Picker("", selection: $drawerTab) {
                ForEach(DrawerTab.allCases) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(8)
            Divider()
            drawerContent(for: drawerTab)
        }
    }

    @ViewBuilder
    private func drawerContent(for tab: DrawerTab) -> some View {
        switch tab {
        case .notty:
            WriterAssistantView(documentText: $content, selection: $selection)
        case .notes:
            NoteReferenceView(onInsert: insertAtCaret)
        }
    }

    /// Insert a string at the current caret (used by NoteReferenceView's "插入引用").
    private func insertAtCaret(_ text: String) {
        let ns = content as NSString
        let insertAt = min(selection.location, ns.length)
        let newDoc = ns.replacingCharacters(in: NSRange(location: insertAt, length: 0), with: text)
        content = newDoc
        selection = NSRange(location: insertAt + (text as NSString).length, length: 0)
    }

    // MARK: - Actions

    private func loadFiles() async {
        do {
            files = try await LocalFileStore.shared.list()
        } catch {
            errorMessage = "加载文件失败: \(error.localizedDescription)"
        }
    }

    private func select(_ file: LocalMarkdownFile) async {
        await flushPendingSave()
        selectedFile = file
        do {
            content = try await LocalFileStore.shared.read(file)
            selection = NSRange(location: 0, length: 0)
            lastSavedAt = file.modifiedAt
        } catch {
            content = ""
            errorMessage = "读取失败: \(error.localizedDescription)"
        }
    }

    private func createNew() async {
        await flushPendingSave()
        do {
            let file = try await LocalFileStore.shared.create()
            files.insert(file, at: 0)
            selectedFile = file
            content = ""
            selection = NSRange(location: 0, length: 0)
            lastSavedAt = file.modifiedAt
        } catch {
            errorMessage = "创建失败: \(error.localizedDescription)"
        }
    }

    private func deleteFile(_ file: LocalMarkdownFile) async {
        do {
            try await LocalFileStore.shared.delete(file)
            files.removeAll { $0.id == file.id }
            if selectedFile?.id == file.id {
                selectedFile = nil
                content = ""
            }
        } catch {
            errorMessage = "删除失败: \(error.localizedDescription)"
        }
    }

    private func rename(_ file: LocalMarkdownFile, to newTitle: String) async {
        let trimmed = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != file.title else { return }
        do {
            try await LocalFileStore.shared.write(file, content: content)
            let renamed = try await LocalFileStore.shared.rename(file, to: trimmed)
            await loadFiles()
            selectedFile = renamed
        } catch {
            errorMessage = "重命名失败: \(error.localizedDescription)"
        }
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            if Task.isCancelled { return }
            await persist()
        }
    }

    private func flushPendingSave() async {
        saveTask?.cancel()
        await persist()
    }

    private func persist() async {
        guard let file = selectedFile else { return }
        do {
            try await LocalFileStore.shared.write(file, content: content)
            lastSavedAt = Date()
            if let i = files.firstIndex(where: { $0.id == file.id }) {
                files[i] = LocalMarkdownFile(
                    id: file.id,
                    url: file.url,
                    modifiedAt: Date(),
                    sizeBytes: content.utf8.count
                )
                files.sort { $0.modifiedAt > $1.modifiedAt }
            }
        } catch {
            errorMessage = "保存失败: \(error.localizedDescription)"
        }
    }
}
