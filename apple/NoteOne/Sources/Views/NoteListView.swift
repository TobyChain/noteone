import SwiftUI

struct NoteListView: View {
    @State private var notes: [Note] = []
    @State private var searchText = ""
    @State private var isLoading = false
    @State private var pollTimer: Timer?

    #if os(macOS)
    @Binding var selectedNoteId: String?
    #else
    @State private var selectedNoteId: String?

    init() {
        _selectedNoteId = State(initialValue: nil)
    }
    #endif

    var body: some View {
        List(notes, selection: $selectedNoteId) { note in
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
                    Label("删除", systemImage: "trash")
                }
            }
            #endif
        }
        .navigationTitle("NoteOne")
        .searchable(text: $searchText, prompt: "搜索笔记...")
        .onSubmit(of: .search) { search() }
        #if !os(macOS)
        .navigationDestination(for: String.self) { noteId in
            NoteDetailView(noteId: noteId)
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
                let results = try await APIClient.shared.searchNotes(query: searchText)
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
                Text(note.title ?? "无标题")
                    .font(.headline)
                    .foregroundStyle(Color.ink)
                    .lineLimit(1)

                if note.status == .pendingAi {
                    Image(systemName: "sparkles")
                        .font(.caption)
                        .foregroundStyle(Color.accent)
                        .symbolEffect(.pulse, options: .repeating)
                }
            }
            Text(note.aiSummary ?? String(note.content.prefix(100)))
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
                .lineLimit(2)
            HStack(spacing: 6) {
                if let tags = note.tags {
                    ForEach(tags.prefix(3), id: \.tagId) { tag in
                        Text("#\(tag.name)")
                            .font(.caption2)
                            .foregroundStyle(Color.accent)
                    }
                }
                Spacer()
                Text(note.createdAt, style: .date)
                    .font(.caption2)
                    .foregroundStyle(Color.inkTertiary)
            }
        }
        .padding(.vertical, 4)
    }
}
