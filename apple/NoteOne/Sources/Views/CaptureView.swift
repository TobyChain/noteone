import SwiftUI

struct CaptureView: View {
    @State private var content = ""
    @State private var sourceUrl = ""
    @State private var isSaving = false
    @State private var showSuccess = false
    @Environment(\.dismiss) private var dismiss
    var onDismiss: (() -> Void)?

    var body: some View {
        VStack(spacing: 16) {
            #if os(macOS)
            Text("顺手记").font(.headline)
            #endif

            TextEditor(text: $content)
                .frame(minHeight: 120)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.secondary.opacity(0.3))
                )
                .overlay(alignment: .topLeading) {
                    if content.isEmpty {
                        Text("记录你看到的内容...")
                            .foregroundStyle(.tertiary)
                            .padding(8)
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
                .disabled(content.isEmpty || isSaving)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
        #if os(macOS)
        .frame(width: 460)
        #endif
        .navigationTitle("记一条")
        .onAppear { pasteFromClipboard() }
    }

    private func pasteFromClipboard() {
        #if os(macOS)
        if let text = NSPasteboard.general.string(forType: .string), content.isEmpty {
            content = text
        }
        #endif
    }

    private func save() {
        isSaving = true
        let request = CreateNoteRequest(
            content: content,
            sourceUrl: sourceUrl.isEmpty ? nil : sourceUrl
        )

        Task {
            do {
                _ = try await APIClient.shared.createNote(request)
            } catch {
                await SyncQueue.shared.enqueue(request)
            }
            await MainActor.run {
                isSaving = false
                showSuccess = true
                content = ""
                sourceUrl = ""
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    showSuccess = false
                    onDismiss?()
                }
            }
        }
    }
}
