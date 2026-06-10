import SwiftUI

struct NoteDetailView: View {
    let noteId: String
    @State private var note: Note?
    @State private var isEditing = false
    @State private var editTitle = ""
    @State private var editContent = ""
    @State private var showDeleteConfirm = false
    @State private var isDeleted = false
    @State private var pollTimer: Timer?

    var body: some View {
        Group {
            if isDeleted {
                VStack(spacing: 12) {
                    Image(systemName: "trash")
                        .font(.largeTitle)
                        .foregroundStyle(Color.inkTertiary)
                    Text("笔记已删除")
                        .foregroundStyle(Color.inkSecondary)
                }
            } else if let note = note {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if note.status == .pendingAi {
                            AIProcessingBanner()
                        }

                        if isEditing {
                            editingSection(note)
                        } else {
                            displaySection(note)
                        }
                    }
                    .padding()
                }
            } else {
                ProgressView("加载中...")
            }
        }
        .toolbar {
            if note != nil && !isDeleted {
                ToolbarItemGroup(placement: .primaryAction) {
                    if isEditing {
                        Button("取消") {
                            isEditing = false
                        }
                        Button("保存") {
                            saveEdit()
                        }
                        .buttonStyle(.borderedProminent)
                    } else {
                        Button { startEditing() } label: {
                            Image(systemName: "pencil")
                        }
                        Button { showDeleteConfirm = true } label: {
                            Image(systemName: "trash")
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
        }
        .confirmationDialog("确定删除这条笔记吗？", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("删除", role: .destructive) { deleteNote() }
            Button("取消", role: .cancel) {}
        }
        .task { await loadNote() }
        .onDisappear { stopPolling() }
    }

    @ViewBuilder
    private func displaySection(_ note: Note) -> some View {
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

        if let tags = note.tags, !tags.isEmpty {
            FlowTagsView(tags: tags)
        }

        Divider()

        Text(note.content)
            .font(.body)
            .foregroundStyle(Color.ink)
            .textSelection(.enabled)

        Divider()

        MetaSection(note: note)
    }

    @ViewBuilder
    private func editingSection(_ note: Note) -> some View {
        TextField("标题", text: $editTitle)
            .font(.title)
            .textFieldStyle(.plain)

        Divider()

        TextEditor(text: $editContent)
            .font(.body)
            .frame(minHeight: 200)
            .scrollContentBackground(.hidden)
    }

    private func startEditing() {
        guard let note else { return }
        editTitle = note.title ?? ""
        editContent = note.content
        isEditing = true
    }

    private func saveEdit() {
        guard let note else { return }
        let newTitle = editTitle.isEmpty ? nil : editTitle
        Task {
            do {
                let updated = try await APIClient.shared.updateNote(
                    id: note.id,
                    title: newTitle,
                    content: editContent
                )
                await MainActor.run {
                    self.note = updated
                    isEditing = false
                }
            } catch {
                print("Save failed: \(error)")
            }
        }
    }

    private func deleteNote() {
        Task {
            do {
                try await APIClient.shared.deleteNote(id: noteId)
                await MainActor.run {
                    isDeleted = true
                    NotificationCenter.default.post(name: .noteCreated, object: nil)
                }
            } catch {
                print("Delete failed: \(error)")
            }
        }
    }

    private func loadNote() async {
        do {
            note = try await APIClient.shared.getNote(id: noteId)
            if note?.status == .pendingAi {
                startPolling()
            }
        } catch {
            print("Load note failed: \(error)")
        }
    }

    private func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            Task { @MainActor in
                do {
                    let updated = try await APIClient.shared.getNote(id: noteId)
                    note = updated
                    if updated.status != .pendingAi {
                        stopPolling()
                    }
                } catch {}
            }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }
}

private struct AIProcessingBanner: View {
    @State private var animating = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles")
                .foregroundStyle(Color.accent)
                .symbolEffect(.pulse, options: .repeating)
            Text("AI 正在分析并生成标签和标题...")
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
            Spacer()
        }
        .padding(12)
        .background(Color.accent.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct FlowTagsView: View {
    let tags: [NoteTag]

    var body: some View {
        HStack(spacing: 0) {
            let wrapped = wrappedTags()
            VStack(alignment: .leading, spacing: 6) {
                ForEach(wrapped.indices, id: \.self) { rowIdx in
                    HStack(spacing: 6) {
                        ForEach(wrapped[rowIdx], id: \.tagId) { tag in
                            Text("#\(tag.name)")
                                .font(.callout)
                                .foregroundStyle(colorForDimension(tag.dimension))
                        }
                    }
                }
            }
            Spacer()
        }
    }

    private func wrappedTags() -> [[NoteTag]] {
        var rows: [[NoteTag]] = [[]]
        for tag in tags {
            rows[rows.count - 1].append(tag)
            if rows[rows.count - 1].count >= 5 {
                rows.append([])
            }
        }
        return rows.filter { !$0.isEmpty }
    }

    private func colorForDimension(_ dimension: String) -> Color {
        switch dimension {
        case "format": return .blue
        case "topic": return .green
        case "domain": return .orange
        case "module": return .purple
        default: return Color.inkSecondary
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
        .foregroundStyle(Color.inkSecondary)
    }
}
