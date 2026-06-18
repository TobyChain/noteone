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
        VStack(spacing: 16) {
            #if os(macOS)
            Text("顺手记").font(.headline)
            #endif

            if let data = imageData {
                imagePreview(data)
            }

            TextEditor(text: $content)
                .frame(minHeight: 120)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isDropTargeted ? Color.accentColor : Color.secondary.opacity(0.3),
                                lineWidth: isDropTargeted ? 2 : 1)
                )
                .overlay(alignment: .topLeading) {
                    if content.isEmpty {
                        Text("记录你看到的内容…（也可拖入文本/链接/图片）")
                            .foregroundStyle(.tertiary)
                            #if os(macOS)
                            .padding(.top, 8)
                            .padding(.leading, 5)
                            #else
                            .padding(8)
                            #endif
                            .allowsHitTesting(false)
                    }
                }

            TextField("来源链接（可选）", text: $sourceUrl)
                .textFieldStyle(.roundedBorder)

            HStack {
                #if os(macOS)
                Button("取消") { onDismiss?() }
                    .keyboardShortcut(.escape)
                #endif

                Spacer()

                if showSuccess {
                    Label("已保存", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }

                Button(action: save) {
                    if isSaving {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Label("保存", systemImage: "square.and.arrow.down")
                    }
                }
                #if os(macOS)
                .keyboardShortcut(.return)
                #endif
                .disabled(!canSave)
                .buttonStyle(.borderedProminent)
            }
        }
        #if os(macOS)
        .padding(.top, 28)
        .padding(.horizontal)
        .padding(.bottom)
        .frame(width: 460)
        #else
        .padding()
        #endif
        .navigationTitle("记一条")
        .onDrop(of: [.image, .url, .plainText], isTargeted: $isDropTargeted) { providers in
            handleDrop(providers)
        }
        .onAppear {
            if let data = initialImageData {
                imageData = data
            }
            if let text = initialContent, !text.isEmpty {
                content = text
            } else if imageData == nil {
                pasteFromClipboard()
            }
            if let url = initialSourceUrl, !url.isEmpty {
                sourceUrl = url
            }
            if let title = initialSourceTitle, !title.isEmpty, !content.isEmpty {
                content = "[\(title)]\n\n\(content)"
            }
            // Drain any drop payload first — a top-level Drop on App takes priority over
            // explicit init args (used only by the macOS hotkey panel) and clipboard.
            Task {
                if let pending = await DropPayloadStore.shared.consume() {
                    await MainActor.run {
                        if let data = pending.imageData { imageData = data }
                        if let text = pending.text, !text.isEmpty { content = text }
                        if let src = pending.sourceUrl, !src.isEmpty { sourceUrl = src }
                    }
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .droppedPayloadReady)) { _ in
            // Triggered when a drop arrives while CaptureView is already on screen.
            Task {
                if let pending = await DropPayloadStore.shared.consume() {
                    await MainActor.run {
                        if let data = pending.imageData { imageData = data }
                        if let text = pending.text, !text.isEmpty { content = text }
                        if let src = pending.sourceUrl, !src.isEmpty { sourceUrl = src }
                    }
                }
            }
        }
    }

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
        .frame(maxHeight: 160)
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
        // Prefer an image if one was dropped.
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
                    // Text + image together → a "mixed" note (text as body, image as sourceUrl);
                    // image alone → an "image" note.
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
                // Only text notes can be safely queued offline; image upload needs connectivity.
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
                showSuccess = true
                content = ""
                sourceUrl = ""
                imageData = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    showSuccess = false
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
