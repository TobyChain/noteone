import SwiftUI

struct NoteListView: View {
    @State private var searchText = ""
    @State private var isLoading = false
    @State private var pollTimer: Timer?
    @State private var filterType: ContentType?
    @State private var showCreateNote = false

    #if os(macOS)
    @Binding var selectedNoteId: String?
    @Binding var notes: [Note]
    #else
    @State private var selectedNoteId: String?
    @State private var notes: [Note] = []

    init() {
        _selectedNoteId = State(initialValue: nil)
    }
    #endif

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
        List(selection: $selectedNoteId) {
            ForEach(groupedNotes, id: \.0) { section in
                Section {
                    ForEach(section.1) { note in
                        #if os(macOS)
                        NoteRowView(note: note)
                            .tag(note.id)
                        #else
                        NavigationLink(value: note.id) {
                            NoteRowView(note: note)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                deleteNote(note)
                            } label: {
                                Label(L("垃圾箱", "Trash"), systemImage: "trash")
                            }
                        }
                        #endif
                    }
                } header: {
                    Text(LDateGroup(section.0))
                }
            }
        }
        .navigationTitle(L("往事", "OldScene"))
        .searchable(text: $searchText, prompt: L("搜索往事...", "Search OldScene..."))
        .onSubmit(of: .search) { search() }
        #if !os(macOS)
        .navigationDestination(for: String.self) { noteId in
            NoteDetailView(noteId: noteId, initialNote: notes.first { $0.id == noteId })
        }
        .safeAreaInset(edge: .bottom) {
            NavigationLink {
                TrashView()
            } label: {
                HStack {
                    Image(systemName: "trash")
                    Text(L("垃圾箱", "Trash"))
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                }
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
                .padding(.horizontal)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial)
            }
        }
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showCreateNote = true } label: {
                    Image(systemName: "square.and.pencil")
                }
                .help(L("新建笔记", "New Note"))
            }
            #if os(macOS)
            ToolbarItem(placement: .primaryAction) {
                Button(action: { Task { await loadNotes() } }) {
                    Image(systemName: "arrow.clockwise")
                }
                .help(L("刷新笔记列表", "Refresh Notes"))
            }
            #endif
            ToolbarItem(placement: .automatic) {
                Menu {
                    Button {
                        filterType = nil
                    } label: {
                        if filterType == nil {
                            Label(L("全部类型", "All Types"), systemImage: "checkmark")
                        } else {
                            Text(L("全部类型", "All Types"))
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
                    Image(systemName: filterType == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .help(L("按类型筛选", "Filter by Type"))
            }
        }
        .task { await loadNotes() }
        .refreshable { await loadNotes() }
        .overlay {
            if !isLoading && filteredNotes.isEmpty && searchText.isEmpty {
                EmptyStateView(
                    icon: "note.text",
                    title: L("还没有笔记", "No Notes Yet"),
                    subtitle: L("使用全局快捷键或拖拽内容到窗口来捕获第一条笔记。", "Use the global hotkey or drag content to capture your first note."),
                    actionTitle: L("记一条", "Capture"),
                    action: { showCreateNote = true }
                )
            }
        }
        .sheet(isPresented: $showCreateNote) {
            #if os(macOS)
            CaptureView(onDismiss: { showCreateNote = false })
                .frame(width: 480, height: 420)
            #else
            NavigationStack {
                CaptureView(onDismiss: { showCreateNote = false })
            }
            #endif
        }
        .onReceive(NotificationCenter.default.publisher(for: .noteCreated)) { _ in
            Task {
                try? await Task.sleep(for: .milliseconds(500))
                await loadNotes()
                startPollingIfNeeded()
            }
        }
        .onDisappear { stopPolling() }
    }

    private func loadNotes() async {
        isLoading = true
        do {
            notes = try await APIClient.shared.listNotes()
        } catch {
            print("Load failed: \(error)")
        }
        isLoading = false
        startPollingIfNeeded()
    }

    private func startPollingIfNeeded() {
        let hasPending = notes.contains { $0.status == .pendingAi }
        if hasPending {
            stopPolling()
            pollTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
                Task { @MainActor in
                    do {
                        let updated = try await APIClient.shared.listNotes()
                        let stillPending = updated.contains { $0.status == .pendingAi }
                        notes = updated
                        if !stillPending { stopPolling() }
                    } catch {}
                }
            }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func deleteNote(_ note: Note) {
        Task {
            do {
                try await APIClient.shared.deleteNote(id: note.id)
                await MainActor.run {
                    notes.removeAll { $0.id == note.id }
                    if selectedNoteId == note.id { selectedNoteId = nil }
                }
            } catch {
                print("Delete failed: \(error)")
            }
        }
    }

    private func search() {
        guard !searchText.isEmpty else {
            Task { await loadNotes() }
            return
        }
        Task {
            do {
                let results = try await APIClient.shared.searchNotes(query: searchText, contentType: filterType?.rawValue)
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
                print("Search failed: \(error)")
            }
        }
    }
}

struct NoteRowView: View {
    let note: Note

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: note.contentType.iconName)
                    .font(.caption)
                    .foregroundStyle(Color.inkTertiary)
                    .frame(width: 16)

                Text(note.title ?? L("无标题", "Untitled"))
                    .font(.headline)
                    .foregroundStyle(Color.ink)
                    .lineLimit(1)

                if note.status == .pendingAi {
                    Image(systemName: "sparkles")
                        .font(.caption)
                        .foregroundStyle(Color.accent)
                        .symbolEffect(.pulse, options: .repeating)
                } else if note.status == .failed {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(Color.danger)
                }
            }
            Text(note.aiSummary ?? String(note.content.prefix(100)))
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
                .lineLimit(2)
                .padding(.leading, 22)
            HStack(spacing: DG.sp4) {
                if let tags = note.tags {
                    ForEach(tags.prefix(3), id: \.tagId) { tag in
                        TagPill(text: "#\(tag.name)", color: TagDimension.color(fromDimension: tag.dimension))
                    }
                }
                Spacer()
                Text(note.createdAt, style: .date)
                    .font(.caption2)
                    .foregroundStyle(Color.inkTertiary)
            }
            .padding(.leading, 22)
        }
        .padding(.vertical, 4)
        // Long-press to drag the note out as plain text — lets users re-use captured
        // fragments in any app (Notes, Mail, a document) without copy/paste.
        .draggable(NoteDragPayload(note: note)) {
            Label(note.title ?? L("无标题", "Untitled"), systemImage: note.contentType.iconName)
                .font(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.thinMaterial)
                .clipShape(Capsule())
        }
    }
}

extension ContentType {
    var displayName: String {
        switch self {
        case .text: return L("文本", "Text")
        case .image: return L("图片", "Image")
        case .video: return L("视频", "Video")
        case .link: return L("链接", "Link")
        case .mixed: return L("混合", "Mixed")
        }
    }

    var iconName: String {
        switch self {
        case .text: return "doc.text"
        case .image: return "photo"
        case .video: return "video"
        case .link: return "link"
        case .mixed: return "doc.on.doc"
        }
    }
}
