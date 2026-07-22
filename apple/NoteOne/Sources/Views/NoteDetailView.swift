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
                    Text(L("已移入垃圾箱", "Moved to Trash"))
                        .foregroundStyle(Color.inkSecondary)
                    Text(L("30 天后自动清理", "Auto-cleaned in 30 days"))
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                }
            } else if let note = note {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        if note.status == .trashed {
                            TrashedBanner(onRestore: restoreNote, onPermanentDelete: permanentDeleteNote)
                        } else if note.status == .pendingAi {
                            AIProcessingBanner()
                        } else if note.status == .failed {
                            FailedBanner(onRetry: retryNote)
                        }

                        if isEditing {
                            TextField(L("标题", "Title"), text: $editTitle)
                                .font(.title)
                                .textFieldStyle(.plain)
                                .foregroundStyle(Color.ink)
                                .padding(.bottom, 8)

                            Divider()

                            TextEditor(text: $editContent)
                                .font(.body)
                                .frame(minHeight: 400)
                                .scrollContentBackground(.hidden)
                                .padding(.top, 4)
                        } else {
                            noteHeader(note)
                                .padding(.bottom, 8)

                            Divider()

                            ForEach(contentChunks(note.content)) { chunk in
                                Text(chunk.text)
                                    .font(.body)
                                    .foregroundStyle(Color.ink)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }

                            Divider()
                                .padding(.top, 8)

                            MetaSection(note: note)
                        }
                    }
                    .padding()
                }
            } else {
                ProgressView(L("加载中...", "Loading..."))
            }
        }
        .toolbar {
            if let note, !isDeleted {
                ToolbarItemGroup(placement: .primaryAction) {
                    if note.status == .trashed {
                        Button { restoreNote() } label: {
                            Image(systemName: "arrow.uturn.backward")
                        }
                        .help(L("恢复", "Restore"))
                    } else if isEditing {
                        Button(L("取消", "Cancel")) { isEditing = false }
                        Button(L("保存", "Save")) { saveEdit() }
                            .buttonStyle(.borderedProminent)
                    } else {
                        Button { startEditing() } label: {
                            Image(systemName: "pencil")
                        }
                        .help(L("编辑", "Edit"))
                        Button { showDeleteConfirm = true } label: {
                            Image(systemName: "trash")
                                .foregroundStyle(Color.danger)
                        }
                        .help(L("移入垃圾箱", "Move to Trash"))
                    }
                }
            }
        }
        .confirmationDialog(L("移入垃圾箱？", "Move to Trash?"), isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button(L("移入垃圾箱", "Move to Trash"), role: .destructive) { deleteNote() }
            Button(L("取消", "Cancel"), role: .cancel) {}
        } message: {
            Text(L("笔记将在 30 天后自动清理，期间可随时恢复", "The note will be auto-cleaned in 30 days. You can restore it anytime during this period."))
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
        Text(note.title ?? L("无标题", "Untitled"))
            .font(.title)
            .foregroundStyle(Color.ink)
            .textSelection(.enabled)

        if let summary = note.aiSummary {
            Text(summary)
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .cardStyle(padding: DG.sp12)
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
                    Label(L("图片加载失败", "Image load failed"), systemImage: "photo")
                        .foregroundStyle(Color.inkTertiary)
                case .empty:
                    ProgressView()
                @unknown default:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: DG.r8))
        }
    }

    private struct ContentChunk: Identifiable {
        let id: Int
        let text: String
    }

    /// Splits note content into paragraph-level chunks (split on blank lines, i.e. `\n\n`+)
    /// so only real paragraph breaks get the LazyVStack spacing. Single `\n` is preserved
    /// within each chunk and rendered by Text as a normal line break.
    private func contentChunks(_ content: String, maxLen: Int = 800) -> [ContentChunk] {
        // Collapse 3+ consecutive newlines into exactly 2 (one paragraph break).
        let normalized = content.replacingOccurrences(
            of: "\\n{3,}", with: "\n\n", options: .regularExpression
        )
        let paragraphs = normalized.components(separatedBy: "\n\n")
        var chunks: [ContentChunk] = []
        var idx = 0
        for paragraph in paragraphs {
            let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            if trimmed.count <= maxLen {
                chunks.append(ContentChunk(id: idx, text: trimmed)); idx += 1
                continue
            }
            var remainder = Substring(trimmed)
            while remainder.count > maxLen {
                let limit = remainder.index(remainder.startIndex, offsetBy: maxLen)
                let splitAt = remainder[..<limit].lastIndex(of: " ")
                    ?? remainder[..<limit].lastIndex(of: "\n")
                    ?? limit
                chunks.append(ContentChunk(id: idx, text: String(remainder[..<splitAt]))); idx += 1
                remainder = remainder[splitAt...].drop(while: { $0 == " " || $0 == "\n" })
            }
            if !remainder.isEmpty {
                chunks.append(ContentChunk(id: idx, text: String(remainder))); idx += 1
            }
        }
        return chunks
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
        HStack(spacing: DG.sp8) {
            Image(systemName: "sparkles")
                .foregroundStyle(Color.accent)
                .symbolEffect(.pulse, options: .repeating)
            Text(L("Notty 正在细品...", "Notty is processing..."))
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
            Spacer()
        }
        .bannerStyle(tint: Color.accent)
    }
}

private struct FailedBanner: View {
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: DG.sp8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.danger)
            Text(L("生成失败", "Generation Failed"))
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
            Spacer()
            Button(L("重试", "Retry"), action: onRetry)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
        .bannerStyle(tint: Color.danger)
    }
}

private struct TrashedBanner: View {
    let onRestore: () -> Void
    let onPermanentDelete: () -> Void
    @State private var showPermanentConfirm = false

    var body: some View {
        HStack(spacing: DG.sp8) {
            Image(systemName: "trash")
                .foregroundStyle(Color.danger)
            Text(L("此笔记在垃圾箱中", "This note is in the Trash"))
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
            Spacer()
            Button(L("恢复", "Restore"), action: onRestore)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            Button(L("永久删除", "Delete Permanently")) { showPermanentConfirm = true }
                .foregroundStyle(Color.danger)
                .controlSize(.small)
        }
        .bannerStyle(tint: Color.danger)
        .confirmationDialog(L("永久删除？", "Delete Permanently?"), isPresented: $showPermanentConfirm, titleVisibility: .visible) {
            Button(L("永久删除", "Delete Permanently"), role: .destructive, action: onPermanentDelete)
            Button(L("取消", "Cancel"), role: .cancel) {}
        } message: {
            Text(L("此操作不可撤销", "This action cannot be undone"))
        }
    }
}

private struct FlowTagsView: View {
    let tags: [NoteTag]

    var body: some View {
        HStack(spacing: 0) {
            let wrapped = wrappedTags()
            VStack(alignment: .leading, spacing: DG.sp4) {
                ForEach(wrapped.indices, id: \.self) { rowIdx in
                    HStack(spacing: DG.sp4) {
                        ForEach(wrapped[rowIdx], id: \.tagId) { tag in
                            TagPill(text: "#\(tag.name)", color: colorForDimension(tag.dimension))
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
        case "format": return .tagFormat
        case "topic": return .tagTopic
        case "domain": return .tagDomain
        case "module": return .tagModule
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
                Label(L("来自 ", "From ") + app, systemImage: "app")
            }
            if let author = note.author {
                Label(author, systemImage: "person")
            }
            if let org = note.authorOrg {
                Label(org, systemImage: "building.2")
            }
            Label(note.createdAt.formatted(), systemImage: "calendar")
            if note.updatedAt.timeIntervalSince(note.createdAt) > 60 {
                Label(L("编辑于 ", "Edited at ") + note.updatedAt.formatted(), systemImage: "pencil.circle")
            }
        }
        .font(.caption)
        .foregroundStyle(Color.inkSecondary)
        .textSelection(.enabled)
    }
}
