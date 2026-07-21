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
    @State private var isDropTargeted = false
    @Environment(\.dismiss) private var dismiss
    var initialContent: String?
    var initialSourceUrl: String?
    var initialSourceTitle: String?
    var initialImageData: Data?
    var onDismiss: (() -> Void)?

    private var canSave: Bool {
        !isSaving && (!content.isEmpty || imageData != nil)
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
        #else
        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: showSuccess)
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
        .navigationTitle("记一条")
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
            Text("添加到往事")
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
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    // MARK: - Text Editor

    private var textEditorArea: some View {
        ZStack(alignment: .topLeading) {
            if content.isEmpty {
                Text("记录你看到的内容…（也可拖入文本/链接/图片）")
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
            TextField("来源链接（可选）", text: $sourceUrl)
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
            Button("取消") { onDismiss?() }
                .keyboardShortcut(.escape)
                .buttonStyle(.plain)
                .foregroundStyle(Color.inkSecondary)
            #endif

            Spacer()

            Button(action: save) {
                if isSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Label("保存", systemImage: "square.and.arrow.down")
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
            Text("已保存到往事")
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
        } else if imageData == nil {
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
            if let data = pending.imageData { imageData = data }
            if let text = pending.text, !text.isEmpty { content = text }
            if let src = pending.sourceUrl, !src.isEmpty { sourceUrl = src }
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
        isSaving = true
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
                }
            }
            await MainActor.run {
                isSaving = false
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

#if os(macOS)
private extension NSImage {
    func pngData() -> Data? {
        guard let tiff = tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }
}
#endif
