import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct NoteDetailView: View {
    let noteId: String
    let initialNote: Note?
    @State private var note: Note?
    @State private var isEditing = false
    @State private var editTitle = ""
    @State private var editContent = ""
    @State private var mdPreviewMode = false
    @State private var showDeleteConfirm = false
    @State private var isDeleted = false
    @State private var pollTimer: Timer?
    @State private var errorMessage: String?
    @State private var isSelectingParagraphs = false
    @State private var selectedParagraphIDs: Set<Int> = []
    @State private var copiedText = false

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
                switch note.contentType {
                case .html:
                    htmlNoteView(note)
                case .md:
                    mdNoteView(note)
                default:
                    textNoteView(note)
                }
            } else if let errorMessage {
                ErrorStateView(message: errorMessage, retryTitle: L("重试", "Retry")) {
                    self.errorMessage = nil
                    Task { await loadNote() }
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
                        if note.contentType == .md {
                            Toggle(L("预览", "Preview"), isOn: $mdPreviewMode)
                                .toggleStyle(.button)
                        }
                        Button(L("取消", "Cancel")) { isEditing = false }
                        Button(L("保存", "Save")) { saveEdit() }
                            .buttonStyle(.borderedProminent)
                    } else if note.contentType != .html {
                        Button { startEditing() } label: {
                            Image(systemName: "pencil")
                        }
                        .help(L("编辑", "Edit"))
                        Button { showDeleteConfirm = true } label: {
                            Image(systemName: "trash")
                                .foregroundStyle(Color.danger)
                        }
                        .help(L("移入垃圾箱", "Move to Trash"))
                    } else {
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
            isSelectingParagraphs = false
            selectedParagraphIDs = []
            stopPolling()
        }
        .task(id: noteId) { await loadNote() }
        .onDisappear { stopPolling() }
    }

    // MARK: - HTML note view (read-only WKWebView)

    @ViewBuilder
    private func htmlNoteView(_ note: Note) -> some View {
        VStack(spacing: 0) {
            if note.status == .trashed {
                TrashedBanner(onRestore: restoreNote, onPermanentDelete: permanentDeleteNote)
                    .padding()
            }
            noteHeader(note)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, 48)
                .padding(.top, 44)
                .padding(.bottom, DG.sp20)
            Divider()
            NewLoreWebView(htmlContent: note.content) { _ in }
            Divider()
            MetaSection(note: note)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, 48)
                .padding(.vertical, DG.sp20)
        }
    }

    // MARK: - MD note view (editable + preview)

    @ViewBuilder
    private func mdNoteView(_ note: Note) -> some View {
        VStack(spacing: 0) {
            if note.status == .trashed {
                TrashedBanner(onRestore: restoreNote, onPermanentDelete: permanentDeleteNote)
                    .padding()
            }
            if isEditing {
                HStack {
                    TextField(L("标题", "Title"), text: $editTitle)
                        .font(.system(size: 34, weight: .bold))
                        .textFieldStyle(.plain)
                    Spacer()
                }
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 48)
                .padding(.vertical, DG.sp20)
                Divider()
                if mdPreviewMode {
                    NewLoreWebView(htmlContent: MarkdownRenderer.render(markdown: editContent, title: editTitle)) { _ in }
                } else {
                    TextEditor(text: $editContent)
                        .font(.body)
                        .frame(minHeight: 400)
                        .scrollContentBackground(.hidden)
                        .frame(maxWidth: 760)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 48)
                }
            } else {
                noteHeader(note)
                    .frame(maxWidth: 760, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, 48)
                    .padding(.top, 44)
                    .padding(.bottom, DG.sp20)
                Divider()
                NewLoreWebView(htmlContent: MarkdownRenderer.render(markdown: note.content, title: note.title)) { _ in }
                Divider()
                MetaSection(note: note)
                    .frame(maxWidth: 760, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, 48)
                    .padding(.vertical, DG.sp20)
            }
        }
    }

    // MARK: - Text note view (existing rendering)

    @ViewBuilder
    private func textNoteView(_ note: Note) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if note.status == .trashed {
                    TrashedBanner(onRestore: restoreNote, onPermanentDelete: permanentDeleteNote)
                } else if note.status == .pendingAi {
                    AIProcessingBanner()
                } else if note.status == .failed {
                    FailedBanner(onRetry: retryNote)
                }

                if isEditing {
                    TextField(L("标题", "Title"), text: $editTitle)
                        .font(.system(size: 34, weight: .bold))
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
                        .padding(.bottom, DG.sp20)

                    HStack(spacing: DG.sp8) {
                        Button { toggleParagraphSelection() } label: {
                            Label(
                                isSelectingParagraphs ? L("取消选择", "Cancel selection") : L("选择段落", "Select paragraphs"),
                                systemImage: isSelectingParagraphs ? "xmark" : "text.badge.plus"
                            )
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)

                        if isSelectingParagraphs {
                            Text(L("已选 \(selectedParagraphIDs.count) 段", "\(selectedParagraphIDs.count) selected"))
                                .font(.caption)
                                .foregroundStyle(Color.inkSecondary)
                        }

                        Spacer()

                        Button { copyReaderText(note) } label: {
                            Label(copiedText ? L("已复制", "Copied") : L("复制", "Copy"), systemImage: copiedText ? "checkmark" : "doc.on.doc")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(isSelectingParagraphs && selectedParagraphIDs.isEmpty)
                    }
                    .padding(.vertical, DG.sp8)
                    .overlay(alignment: .bottom) { Divider() }
                    .padding(.bottom, DG.sp16)

                    ForEach(contentChunks(note.content)) { chunk in
                        paragraphView(chunk)
                    }

                    Divider()
                        .padding(.top, DG.sp24)

                    MetaSection(note: note)
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.horizontal, 48)
            .padding(.vertical, 52)
        }
        .background(Color.canvas)
    }

    @ViewBuilder
    private func noteHeader(_ note: Note) -> some View {
        Text(note.title ?? L("无标题", "Untitled"))
            .font(.system(size: 36, weight: .bold))
            .foregroundStyle(Color.ink)
            .textSelection(.enabled)
            .lineSpacing(2)

        HStack(spacing: DG.sp8) {
            if let app = note.sourceApp { Label(app, systemImage: "square.stack.3d.up") }
            if let author = note.author { Label(author, systemImage: "person") }
            Label(note.createdAt.formatted(date: .abbreviated, time: .omitted), systemImage: "calendar")
        }
        .font(.caption)
        .foregroundStyle(Color.inkTertiary)

        if let summary = note.aiSummary {
            Text(summary)
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, DG.sp8)
                .padding(.leading, DG.sp12)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Color.accent.opacity(0.55)).frame(width: 3)
                }
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

    @ViewBuilder
    private func paragraphView(_ chunk: ContentChunk) -> some View {
        if isSelectingParagraphs {
            Button { toggleParagraph(chunk.id) } label: {
                HStack(alignment: .top, spacing: DG.sp12) {
                    Image(systemName: selectedParagraphIDs.contains(chunk.id) ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selectedParagraphIDs.contains(chunk.id) ? Color.accent : Color.inkTertiary)
                        .padding(.top, 4)
                    Text(chunk.text)
                        .font(.system(size: 17))
                        .lineSpacing(7)
                        .foregroundStyle(Color.ink)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(DG.sp12)
                .background(selectedParagraphIDs.contains(chunk.id) ? Color.accent.opacity(0.08) : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: DG.r8))
            }
            .buttonStyle(.plain)
            .padding(.vertical, 3)
        } else {
            Text(chunk.text)
                .font(.system(size: 17))
                .lineSpacing(7)
                .foregroundStyle(Color.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, DG.sp16)
        }
    }

    private func toggleParagraphSelection() {
        isSelectingParagraphs.toggle()
        selectedParagraphIDs.removeAll()
    }

    private func toggleParagraph(_ id: Int) {
        if selectedParagraphIDs.contains(id) { selectedParagraphIDs.remove(id) }
        else { selectedParagraphIDs.insert(id) }
    }

    private func copyReaderText(_ note: Note) {
        let text = isSelectingParagraphs
            ? contentChunks(note.content).filter { selectedParagraphIDs.contains($0.id) }.map(\.text).joined(separator: "\n\n")
            : note.content
        guard !text.isEmpty else { return }
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
        copiedText = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copiedText = false }
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
        mdPreviewMode = false
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
                await MainActor.run { errorMessage = error.localizedDescription }
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
                await MainActor.run { errorMessage = error.localizedDescription }
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
                await MainActor.run { errorMessage = error.localizedDescription }
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
                await MainActor.run { errorMessage = error.localizedDescription }
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
                await MainActor.run { errorMessage = error.localizedDescription }
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
                errorMessage = error.localizedDescription
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
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DG.sp8) {
                ForEach(tags, id: \.tagId) { tag in
                    TagPill(text: "#\(tag.name)", color: colorForDimension(tag.dimension))
                        .fixedSize()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
