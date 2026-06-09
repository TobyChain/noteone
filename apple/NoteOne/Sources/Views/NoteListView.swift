import SwiftUI

struct NoteListView: View {
    @State private var notes: [Note] = []
    @State private var searchText = ""
    @State private var isLoading = false
    @State private var selectedNoteId: String?

    var body: some View {
        List(notes, selection: $selectedNoteId) { note in
            NavigationLink(value: note.id) {
                NoteRowView(note: note)
            }
        }
        .navigationTitle("NoteOne")
        .searchable(text: $searchText, prompt: "搜索笔记...")
        .onSubmit(of: .search) { search() }
        .navigationDestination(for: String.self) { noteId in
            NoteDetailView(noteId: noteId)
        }
        .toolbar {
            #if os(macOS)
            ToolbarItem(placement: .primaryAction) {
                Button(action: {}) {
                    Image(systemName: "arrow.clockwise")
                }
            }
            #endif
        }
        .task { await loadNotes() }
        .refreshable { await loadNotes() }
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
                .lineLimit(1)
            Text(note.aiSummary ?? String(note.content.prefix(100)))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            HStack(spacing: 4) {
                if let tags = note.tags {
                    ForEach(tags.prefix(3), id: \.tagId) { tag in
                        Text(tag.name)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.blue.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                }
                Spacer()
                Text(note.createdAt, style: .date)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }
}
