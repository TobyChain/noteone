import SwiftUI

struct NoteListView: View {
    @State private var searchText = ""
    @State private var isLoading = false
    @State private var pollTimer: Timer?
    @State private var filterType: ContentType?

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
                                Label("垃圾箱", systemImage: "trash")
                            }
                        }
                        #endif
                    }
                } header: {
                    Text(section.0)
                }
            }
        }
        .navigationTitle("往事")
        .searchable(text: $searchText, prompt: "搜索往事...")
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
                    Text("垃圾箱")
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
            #if os(macOS)
            ToolbarItem(placement: .primaryAction) {
                Button(action: { Task { await loadNotes() } }) {
                    Image(systemName: "arrow.clockwise")
                }
                .help("刷新笔记列表")
            }
            #endif
            ToolbarItem(placement: .automatic) {
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
                    Image(systemName: filterType == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                .help("按类型筛选")
            }
        }
        .task { await loadNotes() }
        .refreshable { await loadNotes() }
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

                Text(note.title ?? "无标题")
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
            Label(note.title ?? "无标题", systemImage: note.contentType.iconName)
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
        case .text: return "文本"
        case .image: return "图片"
        case .video: return "视频"
        case .link: return "链接"
        case .mixed: return "混合"
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
