import SwiftUI

/// Notes-reference panel for the writer view: shows the user's notes grouped by the four
/// tag dimensions (format / topic / domain / module) as filter chips, plus the filtered
/// note list. Clicking a note offers "insert citation" which drops a tidy markdown block
/// (title, summary, source) at the writer's caret via the `onInsert` callback.
struct NoteReferenceView: View {
    /// Insert markdown into the writer's editor at the caret. Set by the parent.
    var onInsert: (String) -> Void

    @State private var notes: [Note] = []
    @State private var selectedTags: Set<String> = []     // tag id set; AND-intersection
    @State private var searchText: String = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !allTags.isEmpty {
                        tagSections
                    }
                    Divider()
                    notesList
                }
                .padding(12)
            }
        }
        .task { await load() }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "books.vertical")
                .foregroundStyle(Color.accent)
            Text("笔记参考")
                .font(.subheadline.bold())
            Spacer()
            Button {
                Task { await load() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.plain)
            .disabled(isLoading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Tag sections

    /// Flatten all unique tags across all notes into [(dimension, [tag])].
    private var allTags: [(dimension: String, tags: [NoteTag])] {
        var byDim: [String: [String: NoteTag]] = [:]    // dim → tagId → tag
        for note in notes {
            for tag in note.tags ?? [] {
                byDim[tag.dimension, default: [:]][tag.tagId] = tag
            }
        }
        let ordering = ["topic", "domain", "module", "format"]
        return ordering.compactMap { dim in
            guard let tags = byDim[dim]?.values, !tags.isEmpty else { return nil }
            let sorted = tags.sorted { ($0.name) < ($1.name) }
            return (dimension: dim, tags: sorted)
        }
    }

    private var tagSections: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(allTags, id: \.dimension) { section in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(displayName(section.dimension))
                            .font(.caption.bold())
                            .foregroundStyle(Color.inkSecondary)
                        if let selectedInDim = section.tags.first(where: { selectedTags.contains($0.tagId) }) {
                            // Show a small "clear this dim" affordance once anything's filtered.
                            Spacer()
                            Button("清除") {
                                for tag in section.tags { selectedTags.remove(tag.tagId) }
                            }
                            .buttonStyle(.plain)
                            .font(.caption2)
                            .foregroundStyle(Color.inkTertiary)
                            // silences "unused" warning when clearing
                            let _ = selectedInDim
                        }
                    }
                    FlowLayout(spacing: 6) {
                        ForEach(section.tags, id: \.tagId) { tag in
                            tagChip(tag, selected: selectedTags.contains(tag.tagId))
                        }
                    }
                }
            }
            if !selectedTags.isEmpty {
                Button("清除全部筛选") { selectedTags.removeAll() }
                    .buttonStyle(.plain)
                    .font(.caption)
                    .foregroundStyle(Color.accent)
            }
        }
    }

    private func tagChip(_ tag: NoteTag, selected: Bool) -> some View {
        Button {
            if selected { selectedTags.remove(tag.tagId) } else { selectedTags.insert(tag.tagId) }
        } label: {
            Text("#\(tag.name)")
                .font(.caption)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(selected ? Color.accent : Color.tagBackground)
                .foregroundStyle(selected ? Color.white : Color.inkSecondary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Notes list

    private var filteredNotes: [Note] {
        notes.filter { note in
            // Tag intersection: every selected tag must be present on the note.
            if !selectedTags.isEmpty {
                let noteTagIds = Set((note.tags ?? []).map { $0.tagId })
                if !selectedTags.isSubset(of: noteTagIds) { return false }
            }
            // Plain-text search across title + summary + body prefix.
            let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if !q.isEmpty {
                let haystack = [
                    note.title ?? "",
                    note.aiSummary ?? "",
                    String(note.content.prefix(200)),
                ].joined(separator: "\n").lowercased()
                if !haystack.contains(q) { return false }
            }
            return true
        }
    }

    private var notesList: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("笔记")
                    .font(.caption.bold())
                    .foregroundStyle(Color.inkSecondary)
                Text("(\(filteredNotes.count) / \(notes.count))")
                    .font(.caption2)
                    .foregroundStyle(Color.inkTertiary)
            }
            TextField("搜索…", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
            if isLoading && notes.isEmpty {
                ProgressView().controlSize(.small)
            } else if filteredNotes.isEmpty {
                Text(notes.isEmpty ? "还没有笔记" : "没有符合筛选条件的笔记")
                    .font(.caption)
                    .foregroundStyle(Color.inkTertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 20)
            } else {
                ForEach(filteredNotes.prefix(50)) { note in
                    noteRow(note)
                }
                if filteredNotes.count > 50 {
                    Text("还有 \(filteredNotes.count - 50) 条未显示，使用筛选缩小范围")
                        .font(.caption2)
                        .foregroundStyle(Color.inkTertiary)
                }
            }
        }
    }

    private func noteRow(_ note: Note) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(note.title ?? "无标题")
                .font(.callout.bold())
                .foregroundStyle(Color.ink)
                .lineLimit(1)
            if let summary = note.aiSummary, !summary.isEmpty {
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(Color.inkSecondary)
                    .lineLimit(3)
            }
            if let tags = note.tags, !tags.isEmpty {
                HStack(spacing: 4) {
                    ForEach(tags.prefix(4), id: \.tagId) { t in
                        Text("#\(t.name)")
                            .font(.caption2)
                            .foregroundStyle(Color.accent)
                    }
                }
            }
            HStack(spacing: 8) {
                Spacer()
                Button {
                    onInsert(citation(for: note))
                } label: {
                    Label("插入引用", systemImage: "text.append")
                        .font(.caption2)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .padding(8)
        .background(Color.canvasSecondary.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Helpers

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

    private func displayName(_ dimension: String) -> String {
        switch dimension {
        case "format": return "格式"
        case "topic": return "主题"
        case "domain": return "领域"
        case "module": return "模块"
        default: return dimension
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            notes = try await APIClient.shared.listNotes(limit: 100, offset: 0)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Tiny flow layout for tag chips

/// Simple HStack-with-wrapping layout. SwiftUI doesn't ship one and we want chips to flow.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        var rowHeight: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if rowWidth + size.width > maxWidth, rowWidth > 0 {
                totalHeight += rowHeight + spacing
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        totalHeight += rowHeight
        return CGSize(width: maxWidth.isFinite ? maxWidth : rowWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            sub.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
