import SwiftUI

struct NoteListView: View {
    @State private var notes: [Note] = []
    @State private var searchText = ""
    @State private var isLoading = false

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
            }
            #endif
        }
        .task { await loadNotes() }
        .refreshable { await loadNotes() }
        .onReceive(NotificationCenter.default.publisher(for: .noteCreated)) { _ in
            Task { await loadNotes() }
        }
    }

    private func loadNotes() async {
        isLoading = true
        do {
            notes = try await APIClient.shared.listNotes()
        } catch {
            print("Load failed: \(error)")
        }
        isLoading = false
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
            Text(note.title ?? "无标题")
                .font(.headline)
                .foregroundStyle(Color.ink)
                .lineLimit(1)
            Text(note.aiSummary ?? String(note.content.prefix(100)))
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
                .lineLimit(2)
            HStack(spacing: 4) {
                if let tags = note.tags {
                    ForEach(tags.prefix(3), id: \.tagId) { tag in
                        Text(tag.name)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.tagBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
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
