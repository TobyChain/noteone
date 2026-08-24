import SwiftUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

extension Notification.Name {
    static let noteCreated = Notification.Name("noteCreated")
}

struct CaptureView: View {
    @State private var content = ""
    @State private var sourceUrl = ""
    @State private var imageData: Data?
    @State private var isSaving = false
    @State private var showSuccess = false
    @State private var showEmptyHint = false
    @State private var captureError: String?
    @State private var isDropTargeted = false
    @Environment(\.dismiss) private var dismiss
    var initialContent: String?
    var initialSourceUrl: String?
    var initialSourceTitle: String?
    var initialImageData: Data?
    /// When false, the editor does NOT prefill from the system clipboard on appear.
    /// The hotkey panel sets this — its captured payload arrives asynchronously a beat
    /// after the view is visible, and an eager clipboard paste would win the race and
    /// block the real selection from landing.
    var allowsClipboardFallback = true
    var onDismiss: (() -> Void)?

    private var isURLContent: Bool {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://")
    }

    private var canSave: Bool {
        !isSaving
    }

    var body: some View {
        ZStack {
            contentView
                #if os(macOS)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(nsColor: .windowBackgroundColor))
                        .shadow(color: .black.opacity(0.15), radius: 20, x: 0, y: 8)
                )
                #endif

            if showSuccess {
                successOverlay
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
            }
        }
        #if os(macOS)
        .frame(width: 460)
        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: showSuccess)
        .animation(.easeInOut(duration: 0.2), value: showEmptyHint)
        #else
        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: showSuccess)
        .animation(.easeInOut(duration: 0.2), value: showEmptyHint)
        #endif
    }

    private var contentView: some View {
        VStack(spacing: 0) {
            header

            if let data = imageData {
                imagePreview(data)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
            }

            textEditorArea
                .padding(.horizontal, 16)
                .padding(.top, 12)

            if isURLContent && !isSaving {
                HStack(spacing: 4) {
                    ProgressView()
                        .controlSize(.mini)
                    Text(L("正在抓取...", "Fetching..."))
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
            }

            if showEmptyHint {
                HStack(spacing: 4) {
                    Image(systemName: "info.circle.fill")
                        .foregroundStyle(Color.warning)
                    Text(L("请输入内容后再保存", "Please enter some content before saving"))
                        .font(.caption)
                        .foregroundStyle(Color.warning)
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .transition(.opacity)
            }

            if let captureError = captureError {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.danger)
                    Text(captureError)
                        .font(.caption)
                        .foregroundStyle(Color.danger)
                    Spacer()
                    Button {
                        self.captureError = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Color.inkTertiary)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .transition(.opacity)
            }

            sourceUrlField
                .padding(.horizontal, 16)
                .padding(.top, 8)

            bottomBar
                .padding(16)
        }
        .padding(.top, 28)
        .padding(.bottom, 8)
        #if os(iOS)
        .padding(.horizontal, 4)
        #endif
        .navigationTitle(L("记一条", "Capture"))
        .onDrop(of: [.image, .url, .plainText], isTargeted: $isDropTargeted) { providers in
            handleDrop(providers)
        }
        .onAppear { handleInitialPayload() }
        .onReceive(NotificationCenter.default.publisher(for: .droppedPayloadReady)) { _ in
            Task { await consumeDropPayload() }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "note.text.badge.plus")
                .font(.system(size: 14))
                .foregroundStyle(Color.accent)
            Text(L("添加到往事", "Add to OldScene"))
                .font(.subheadline.bold())
                .foregroundStyle(Color.ink)
            Spacer()
            if !sourceUrl.isEmpty {
                Text(sourceUrl)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(Color.inkTertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: 120)
            }
            #if os(macOS)
            if let onDismiss {
                Button { onDismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.inkTertiary)
                }
                .buttonStyle(.plain)
                .help(L("关闭", "Close"))
            }
            #endif
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    // MARK: - Text Editor

    private var textEditorArea: some View {
        ZStack(alignment: .topLeading) {
            if content.isEmpty {
                Text(L("粘贴链接、输入文本或拖拽内容到这里...", "Paste a URL, type text, or drag content here..."))
                    .foregroundStyle(Color.inkTertiary)
                    .font(.body)
                    .padding(.top, 8)
                    .padding(.leading, 12)
                    .allowsHitTesting(false)
            }
            TextEditor(text: $content)
                .scrollContentBackground(.hidden)
                .font(.body)
                .frame(minHeight: 100)
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.canvasSecondary.opacity(0.6))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isDropTargeted ? Color.accent : Color.hairline,
                        lineWidth: isDropTargeted ? 2 : 1)
        )
    }

    // MARK: - Source URL field

    private var sourceUrlField: some View {
        HStack(spacing: 6) {
            Image(systemName: "link")
                .font(.caption)
                .foregroundStyle(Color.inkTertiary)
            TextField(L("来源链接（可选）", "Source URL (optional)"), text: $sourceUrl)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.canvasSecondary.opacity(0.4))
        )
    }

    // MARK: - Bottom bar

    private var bottomBar: some View {
        HStack {
            #if os(macOS)
            Button(L("取消", "Cancel")) { onDismiss?() }
                .keyboardShortcut(.escape)
                .buttonStyle(.plain)
                .foregroundStyle(Color.inkSecondary)
            #endif

            Spacer()

            Button(action: save) {
                if isSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Label(L("保存", "Save"), systemImage: "square.and.arrow.down")
                        .font(.subheadline.bold())
                }
            }
            #if os(macOS)
            .keyboardShortcut(.return)
            #endif
            .disabled(!canSave)
            .buttonStyle(.borderedProminent)
            .controlSize(.regular)
        }
    }

    // MARK: - Success overlay

    private var successOverlay: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(Color.success)
            Text(L("已保存到往事", "Saved to OldScene"))
                .font(.headline)
                .foregroundStyle(Color.ink)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        #if os(macOS)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.ultraThinMaterial)
        )
        #else
        .background(.ultraThinMaterial)
        #endif
    }

    // MARK: - Image preview

    @ViewBuilder
    private func imagePreview(_ data: Data) -> some View {
        Group {
            #if os(macOS)
            if let img = NSImage(data: data) {
                Image(nsImage: img).resizable().scaledToFit()
            }
            #else
            if let img = UIImage(data: data) {
                Image(uiImage: img).resizable().scaledToFit()
            }
            #endif
        }
        .frame(maxHeight: 140)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .topTrailing) {
            Button {
                imageData = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.white, .black.opacity(0.5))
            }
            .buttonStyle(.plain)
            .padding(6)
        }
    }

    // MARK: - Actions

    private func handleInitialPayload() {
        if let data = initialImageData { imageData = data }
        if let text = initialContent, !text.isEmpty {
            content = text
        } else if imageData == nil && allowsClipboardFallback {
            pasteFromClipboard()
        }
        if let url = initialSourceUrl, !url.isEmpty { sourceUrl = url }
        if let title = initialSourceTitle, !title.isEmpty, !content.isEmpty {
            content = "[\(title)]\n\n\(content)"
        }
        Task { await consumeDropPayload() }
    }

    private func consumeDropPayload() async {
        guard let pending = await DropPayloadStore.shared.consume() else { return }
        await MainActor.run {
            // Never clobber something the user already typed — the hotkey panel delivers
            // its captured payload asynchronously, a beat after the editor is visible.
            if let data = pending.imageData { imageData = data }
            if let text = pending.text, !text.isEmpty, content.isEmpty { content = text }
            if let src = pending.sourceUrl, !src.isEmpty, sourceUrl.isEmpty { sourceUrl = src }
        }
    }

    private func pasteFromClipboard() {
        #if os(macOS)
        let pb = NSPasteboard.general
        if let text = pb.string(forType: .string), content.isEmpty {
            content = text
        }
        if imageData == nil {
            if let png = pb.data(forType: .png) {
                imageData = png
            } else if let tiff = pb.data(forType: .tiff), let png = NSImage(data: tiff)?.pngData() {
                imageData = png
            }
        }
        #endif
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                guard let data else { return }
                Task { @MainActor in self.imageData = data }
            }
            return true
        }
        for provider in providers {
            if provider.canLoadObject(ofClass: URL.self) {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    guard let url else { return }
                    Task { @MainActor in
                        if self.sourceUrl.isEmpty { self.sourceUrl = url.absoluteString }
                        if self.content.isEmpty { self.content = url.absoluteString }
                    }
                }
                return true
            }
            if provider.canLoadObject(ofClass: String.self) {
                _ = provider.loadObject(ofClass: String.self) { text, _ in
                    guard let text else { return }
                    Task { @MainActor in if self.content.isEmpty { self.content = text } }
                }
                return true
            }
        }
        return false
    }

    private func save() {
        // Show hint when content is empty and no image is attached
        if content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && imageData == nil {
            withAnimation { showEmptyHint = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                withAnimation { showEmptyHint = false }
            }
            return
        }
        isSaving = true
        captureError = nil
        let caption = content
        let droppedImage = imageData
        let urlField = sourceUrl

        Task {
            do {
                let request: CreateNoteRequest
                if let droppedImage {
                    let imageUrl = try await APIClient.shared.uploadImage(
                        data: droppedImage, mimeType: "image/png", fileName: "capture.png"
                    )
                    let hasText = !caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    request = CreateNoteRequest(
                        content: hasText ? caption : "[图片]",
                        contentType: hasText ? "mixed" : "image",
                        sourceUrl: imageUrl
                    )
                } else {
                    request = CreateNoteRequest(
                        content: caption,
                        sourceUrl: urlField.isEmpty ? nil : urlField
                    )
                }
                _ = try await APIClient.shared.createNote(request)
                await MainActor.run {
                    NotificationCenter.default.post(name: .noteCreated, object: nil)
                }
            } catch {
                if droppedImage == nil {
                    let request = CreateNoteRequest(
                        content: caption,
                        sourceUrl: urlField.isEmpty ? nil : urlField
                    )
                    await SyncQueue.shared.enqueue(request)
                    await MainActor.run {
                        captureError = L("网络不可用，已加入离线队列", "Network unavailable, queued for sync")
                    }
                } else {
                    await MainActor.run {
                        captureError = L("保存失败: ", "Save failed: ") + error.localizedDescription
                    }
                }
            }
            await MainActor.run {
                isSaving = false
                if captureError == nil || (droppedImage == nil) {
                    withAnimation { showSuccess = true }
                    content = ""
                    sourceUrl = ""
                    imageData = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                        onDismiss?()
                    }
                }
            }
        }
    }
}

#if os(macOS)
private extension NSImage {
    func pngData() -> Data? {
        guard let tiff = tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }
}
#endif
