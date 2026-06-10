import SwiftUI

struct NoteDetailView: View {
    let noteId: String
    @State private var note: Note?
    @State private var tags: [NoteTag] = []

    var body: some View {
        Group {
            if let note = note {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(note.title ?? "无标题")
                            .font(.title)
                            .foregroundStyle(Color.ink)

                        if let summary = note.aiSummary {
                            Text(summary)
                                .font(.subheadline)
                                .foregroundStyle(Color.inkSecondary)
                                .padding()
                                .background(Color.canvasSecondary)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }

                        Divider()

                        Text(note.content)
                            .font(.body)
                            .foregroundStyle(Color.ink)
                            .textSelection(.enabled)

                        Divider()

                        MetaSection(note: note)

                        if !tags.isEmpty {
                            TagsSection(tags: tags)
                        }
                    }
                    .padding()
                }
            } else {
                ProgressView("加载中...")
            }
        }
        .task { await loadNote() }
    }

    private func loadNote() async {
        do {
            note = try await APIClient.shared.getNote(id: noteId)
            tags = note?.tags ?? []
        } catch {
            print("Load note failed: \(error)")
        }
    }
}

private struct MetaSection: View {
    let note: Note

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let url = note.sourceUrl {
                Label(url, systemImage: "link")
            }
            if let author = note.author {
                Label(author, systemImage: "person")
            }
            if let org = note.authorOrg {
                Label(org, systemImage: "building.2")
            }
            Label(note.createdAt.formatted(), systemImage: "calendar")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }
}

private struct TagsSection: View {
    let tags: [NoteTag]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("标签").font(.headline)
            FlowLayoutView(tags: tags)
        }
    }
}

private struct FlowLayoutView: View {
    let tags: [NoteTag]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80))], spacing: 8) {
            ForEach(tags, id: \.tagId) { tag in
                Text(tag.name)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(colorForDimension(tag.dimension))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private func colorForDimension(_ dimension: String) -> Color {
        switch dimension {
        case "format": return .tagBackground
        case "topic": return .green.opacity(0.12)
        case "domain": return .orange.opacity(0.12)
        case "module": return .purple.opacity(0.12)
        default: return Color.canvasSecondary
        }
    }
}
