import SwiftUI

/// Sidebar selection model for the main split view: either a server note, a local
/// markdown file, the trash bin, or nothing selected.
enum SidebarSelection: Hashable {
    case note(String)               // note id
    case markdown(LocalMarkdownFile)
    case trash
    case ascanReports
    case ascanConfig
    case empty
}

/// Combined macOS sidebar: top section is the local markdown writer's files; bottom is
/// the server-backed notes list with search and content-type filter. When the user is
/// editing a markdown file, each note row shows an "插入引用" button that calls
/// `onInsertCitation` with a markdown citation block — keeping the right-drawer purely
/// for Notty.
struct MainSidebar: View {
    @Binding var selection: SidebarSelection
    @Binding var notes: [Note]
    @Binding var mdFiles: [LocalMarkdownFile]

    /// True when the user is actively editing a markdown file — drives the "insert ref"
    /// button visibility on each note row.
    var writerActive: Bool

    /// Called with a markdown citation snippet when the user taps a row's "insert ref".
    var onInsertCitation: (String) -> Void
    var onCreateMarkdown: () -> Void
    var onDeleteMarkdown: (LocalMarkdownFile) -> Void
    var onRefresh: () async -> Void
    var onDeleteNote: (Note) -> Void
    var onSearch: (String) async -> Void
    var onShowTrash: () -> Void

    @State private var searchText = ""
    @State private var filterType: ContentType?

    private var filteredNotes: [Note] {
        guard let filter = filterType else { return notes }
        return notes.filter { $0.contentType == filter }
    }

    private var groupedNotes: [(String, [Note])] {
        let calendar = Calendar.current
        let now = Date()
        var groups: [String: [Note]] = [:]
        let order = ["今天", "昨天", "本周", "本月", "更早"]

        for note in filteredNotes {
            let key: String
            if calendar.isDateInToday(note.createdAt) {
                key = "今天"
            } else if calendar.isDateInYesterday(note.createdAt) {
                key = "昨天"
            } else if let weekAgo = calendar.date(byAdding: .day, value: -7, to: now),
                      note.createdAt >= weekAgo {
                key = "本周"
            } else if let monthAgo = calendar.date(byAdding: .month, value: -1, to: now),
                      note.createdAt >= monthAgo {
                key = "本月"
            } else {
                key = "更早"
            }
            groups[key, default: []].append(note)
        }
        return order.compactMap { key in
            guard let notes = groups[key], !notes.isEmpty else { return nil }
            return (key, notes)
        }
    }

    var body: some View {
        List(selection: bindingSelection) {
            // --- Markdown writer files ---
            Section {
                if mdFiles.isEmpty {
                    Text("暂无写作文件")
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                        .listRowBackground(Color.clear)
                } else {
                    ForEach(mdFiles) { file in
                        markdownRow(file)
                            .tag(SidebarSelection.markdown(file))
                            .contextMenu {
                                Button(role: .destructive) {
                                    onDeleteMarkdown(file)
                                } label: {
                                    Label("删除", systemImage: "trash")
                                }
                            }
                    }
                }
            } header: {
                HStack {
                    Label("写作文件", systemImage: "pencil.and.outline")
                        .font(.caption.bold())
                    Spacer()
                    Button(action: onCreateMarkdown) {
                        Image(systemName: "plus.circle")
                    }
                    .buttonStyle(.plain)
                    .help("新建 Markdown 文件")
                }
            }

            // --- Notes (with inline insert-ref when writer is active) ---
            Section {
                ForEach(groupedNotes, id: \.0) { (title, sectionNotes) in
                    Section {
                        ForEach(sectionNotes) { note in
                            HStack(spacing: 6) {
                                NoteRowView(note: note)
                                if writerActive {
                                    Button {
                                        onInsertCitation(citation(for: note))
                                    } label: {
                                        Image(systemName: "text.append")
                                            .font(.caption)
                                    }
                                    .buttonStyle(.borderless)
                                    .help("插入引用到写作")
                                }
                            }
                            .contentShape(Rectangle())
                            .onTapGesture { selection = .note(note.id) }
                            .tag(SidebarSelection.note(note.id))
                            .contextMenu {
                                Button(role: .destructive) {
                                    onDeleteNote(note)
                                } label: {
                                    Label("移到垃圾箱", systemImage: "trash")
                                }
                            }
                        }
                    } header: {
                        Text(title).font(.caption2)
                    }
                }
            } header: {
                HStack {
                    Label("笔记", systemImage: "note.text")
                        .font(.caption.bold())
                    Spacer()
                    Menu {
                        Button {
                            filterType = nil
                        } label: {
                            if filterType == nil {
                                Label("全部类型", systemImage: "checkmark")
                            } else {
                                Text("全部类型")
                            }
                        }
                        Divider()
                        ForEach(ContentType.allCases, id: \.rawValue) { type in
                            Button {
                                filterType = type
                            } label: {
                                if filterType == type {
                                    Label(type.displayName, systemImage: "checkmark")
                                } else {
                                    Text(type.displayName)
                                }
                            }
                        }
                    } label: {
                        Image(systemName: filterType == nil
                              ? "line.3.horizontal.decrease.circle"
                              : "line.3.horizontal.decrease.circle.fill")
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .help("按类型筛选")
                    Button(action: { Task { await onRefresh() } }) {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.plain)
                    .help("刷新笔记列表")
                }
            }

            // --- Ascan ---
            Section {
                Label("日报浏览", systemImage: "doc.text")
                    .tag(SidebarSelection.ascanReports)
                Label("配置管理", systemImage: "gearshape")
                    .tag(SidebarSelection.ascanConfig)
            } header: {
                Label("Ascan", systemImage: "globe")
                    .font(.caption.bold())
            }
        }
        .searchable(text: $searchText, prompt: "搜索笔记...")
        .onSubmit(of: .search) { Task { await onSearch(searchText) } }
        .onChange(of: searchText) { _, newValue in
            if newValue.isEmpty { Task { await onSearch("") } }
        }
        .safeAreaInset(edge: .bottom) {
            Button(action: onShowTrash) {
                HStack {
                    Image(systemName: "trash")
                    Text("垃圾箱")
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(Color.inkTertiary)
                }
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(.ultraThinMaterial)
            }
            .buttonStyle(.plain)
        }
    }

    // SwiftUI's List(selection:) wants a non-optional Hashable; we map .empty <-> nil.
    private var bindingSelection: Binding<SidebarSelection?> {
        Binding(
            get: { selection == .empty ? nil : selection },
            set: { selection = $0 ?? .empty }
        )
    }

    private func markdownRow(_ file: LocalMarkdownFile) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.text")
                .font(.caption)
                .foregroundStyle(Color.inkTertiary)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.title)
                    .font(.body)
                    .foregroundStyle(Color.ink)
                    .lineLimit(1)
                Text(file.modifiedAt, format: .relative(presentation: .numeric))
                    .font(.caption2)
                    .foregroundStyle(Color.inkTertiary)
            }
            Spacer()
        }
        .padding(.vertical, 2)
    }

    private func citation(for note: Note) -> String {
        var lines: [String] = []
        lines.append("> **\(note.title ?? "无标题")**")
        if let summary = note.aiSummary, !summary.isEmpty {
            lines.append("> \(summary)")
        }
        var meta: [String] = []
        if let author = note.author, !author.isEmpty { meta.append(author) }
        if let url = note.sourceUrl, !url.isEmpty { meta.append(url) }
        if !meta.isEmpty {
            lines.append("> — " + meta.joined(separator: " · "))
        }
        return "\n" + lines.joined(separator: "\n") + "\n"
    }
}
