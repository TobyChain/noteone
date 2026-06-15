import SwiftUI

struct NoteDetailView: View {
    let noteId: String
    let initialNote: Note?
    @State private var note: Note?
    @State private var isEditing = false
    @State private var editTitle = ""
    @State private var editContent = ""
    @State private var showDeleteConfirm = false
    @State private var isDeleted = false
    @State private var pollTimer: Timer?

    init(noteId: String, initialNote: Note? = nil) {
        self.noteId = noteId
        self.initialNote = initialNote
        _note = State(initialValue: initialNote)
    }

    var body: some View {
        Group {
            if isDeleted {
                VStack(spacing: 12) {
                    Image(systemName: "trash")
                        .font(.largeTitle)
                        .foregroundStyle(Color.inkTertiary)
                    Text("已移入垃圾箱")
                        .foregroundStyle(Color.inkSecondary)
                    Text("30 天后自动清理")
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                }
            } else if let note = note {
                ScrollView {
                    // LazyVStack so long notes only lay out the paragraphs near the viewport,
                    // instead of rendering the whole body up front (the source of switch lag).
                    LazyVStack(alignment: .leading, spacing: 16) {
                        if note.status == .trashed {
                            TrashedBanner(onRestore: restoreNote, onPermanentDelete: permanentDeleteNote)
                        } else if note.status == .pendingAi {
                            AIProcessingBanner()
                        } else if note.status == .failed {
                            FailedBanner(onRetry: retryNote)
                        }

                        if isEditing {
                            editingSection(note)
                        } else {
                            noteHeader(note)

                            Divider()

                            // Chunked content as direct children of the LazyVStack → only the
                            // visible chunks of a long note are laid out.
                            ForEach(contentChunks(note.content)) { chunk in
                                Text(chunk.text.isEmpty ? " " : chunk.text)
                                    .font(.body)
                                    .foregroundStyle(Color.ink)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }

                            Divider()

                            MetaSection(note: note)
                        }
                    }
                    .padding()
                }
            } else {
                ProgressView("加载中...")
            }
        }
        .toolbar {
            if let note, !isDeleted {
                ToolbarItemGroup(placement: .primaryAction) {
                    if note.status == .trashed {
                        Button { restoreNote() } label: {
                            Image(systemName: "arrow.uturn.backward")
                        }
                        .help("恢复")
                    } else if isEditing {
                        Button("取消") { isEditing = false }
                        Button("保存") { saveEdit() }
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
        .confirmationDialog("移入垃圾箱？", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("移入垃圾箱", role: .destructive) { deleteNote() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("笔记将在 30 天后自动清理，期间可随时恢复")
        }
        .onChange(of: noteId) {
            // Identity is stable across selections now (no .id()), so explicitly swap to the
            // newly-selected note instantly and reset transient UI — no teardown/rebuild.
            note = initialNote
            isEditing = false
            isDeleted = false
            stopPolling()
        }
        .task(id: noteId) { await loadNote() }
        .onDisappear { stopPolling() }
    }

    @ViewBuilder
    private func noteHeader(_ note: Note) -> some View {
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

        if (note.contentType == .image || note.contentType == .mixed), let urlString = note.sourceUrl, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                case .failure:
                    Label("图片加载失败", systemImage: "photo")
                        .foregroundStyle(Color.inkTertiary)
                case .empty:
                    ProgressView()
                @unknown default:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private struct ContentChunk: Identifiable {
        let id: Int
        let text: String
    }

    /// Splits note content into bounded chunks (by paragraph, then by length at a whitespace
    /// boundary when possible) so a long body renders as many small, lazily-laid-out Texts.
    private func contentChunks(_ content: String, maxLen: Int = 800) -> [ContentChunk] {
        var chunks: [ContentChunk] = []
        var idx = 0
        for paragraph in content.components(separatedBy: "\n") {
            if paragraph.count <= maxLen {
                chunks.append(ContentChunk(id: idx, text: paragraph)); idx += 1
                continue
            }
            var remainder = Substring(paragraph)
            while remainder.count > maxLen {
                let limit = remainder.index(remainder.startIndex, offsetBy: maxLen)
                // Prefer breaking at the last space before the limit; CJK text has none, so
                // fall back to a hard cut at the character boundary.
                let splitAt = remainder[..<limit].lastIndex(of: " ") ?? limit
                chunks.append(ContentChunk(id: idx, text: String(remainder[..<splitAt]))); idx += 1
                remainder = remainder[splitAt...].drop(while: { $0 == " " })
            }
            if !remainder.isEmpty {
                chunks.append(ContentChunk(id: idx, text: String(remainder))); idx += 1
            }
        }
        return chunks
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
                    id: note.id, title: newTitle, content: editContent
                )
                await MainActor.run {
                    self.note = updated
                    isEditing = false
                    // Refresh the list so its cached copy (used as initialNote on re-selection)
                    // reflects the edit.
                    NotificationCenter.default.post(name: .noteCreated, object: nil)
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

    private func restoreNote() {
        Task {
            do {
                let restored = try await APIClient.shared.restoreNote(id: noteId)
                await MainActor.run {
                    note = restored
                    NotificationCenter.default.post(name: .noteCreated, object: nil)
                }
            } catch {
                print("Restore failed: \(error)")
            }
        }
    }

    private func retryNote() {
        Task {
            do {
                let retried = try await APIClient.shared.retryNote(id: noteId)
                await MainActor.run {
                    note = retried
                    if retried.status == .pendingAi { startPolling() }
                    NotificationCenter.default.post(name: .noteCreated, object: nil)
                }
            } catch {
                print("Retry failed: \(error)")
            }
        }
    }

    private func permanentDeleteNote() {
        Task {
            do {
                try await APIClient.shared.permanentDeleteNote(id: noteId)
                await MainActor.run {
                    isDeleted = true
                    NotificationCenter.default.post(name: .noteCreated, object: nil)
                }
            } catch {
                print("Permanent delete failed: \(error)")
            }
        }
    }

    private func loadNote() async {
        // Make sure we're showing the selected note (covers first load and the nil case).
        if note?.id != noteId { note = initialNote }
        // The note list already carries full note data, so skip a network round-trip on every
        // switch — only fetch when we genuinely have nothing to show.
        if note == nil {
            do {
                note = try await APIClient.shared.getNote(id: noteId)
            } catch {
                print("Load note failed: \(error)")
            }
        }
        if note?.status == .pendingAi {
            startPolling()
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
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles")
                .foregroundStyle(Color.accent)
                .symbolEffect(.pulse, options: .repeating)
            Text("Notty 正在细品...")
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
            Spacer()
        }
        .padding(12)
        .background(Color.accent.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct FailedBanner: View {
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text("生成失败")
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
            Spacer()
            Button("重试", action: onRetry)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
        .padding(12)
        .background(Color.red.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct TrashedBanner: View {
    let onRestore: () -> Void
    let onPermanentDelete: () -> Void
    @State private var showPermanentConfirm = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "trash")
                .foregroundStyle(.red)
            Text("此笔记在垃圾箱中")
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
            Spacer()
            Button("恢复", action: onRestore)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            Button("永久删除") { showPermanentConfirm = true }
                .foregroundStyle(.red)
                .controlSize(.small)
        }
        .padding(12)
        .background(Color.red.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .confirmationDialog("永久删除？", isPresented: $showPermanentConfirm, titleVisibility: .visible) {
            Button("永久删除", role: .destructive, action: onPermanentDelete)
            Button("取消", role: .cancel) {}
        } message: {
            Text("此操作不可撤销")
        }
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
            if let app = note.sourceApp {
                Label("来自 \(app)", systemImage: "app")
            }
            if let author = note.author {
                Label(author, systemImage: "person")
            }
            if let org = note.authorOrg {
                Label(org, systemImage: "building.2")
            }
            Label(note.createdAt.formatted(), systemImage: "calendar")
            if note.updatedAt.timeIntervalSince(note.createdAt) > 60 {
                Label("编辑于 \(note.updatedAt.formatted())", systemImage: "pencil.circle")
            }
        }
        .font(.caption)
        .foregroundStyle(Color.inkSecondary)
    }
}
