import UIKit
import SwiftUI
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()

        let hostingController = UIHostingController(rootView: ShareView(
            extensionContext: extensionContext
        ))

        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            hostingController.view.topAnchor.constraint(equalTo: view.topAnchor),
            hostingController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hostingController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hostingController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        hostingController.didMove(toParent: self)
    }
}

struct ShareView: View {
    let extensionContext: NSExtensionContext?
    @State private var content = ""
    @State private var sourceUrl = ""
    @State private var contentType = "text"
    @State private var isSaving = false
    @State private var isLoading = true

    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                if isLoading {
                    ProgressView("正在读取内容...")
                } else {
                    TextEditor(text: $content)
                        .frame(minHeight: 120)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.secondary.opacity(0.3))
                        )

                    if !sourceUrl.isEmpty {
                        HStack {
                            Image(systemName: "link")
                                .foregroundStyle(.secondary)
                            Text(sourceUrl)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }

                    HStack {
                        Label(contentType, systemImage: iconForType(contentType))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                }
            }
            .padding()
            .navigationTitle("顺手记")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { cancel() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { save() }
                        .disabled(content.isEmpty || isSaving)
                        .bold()
                }
            }
        }
        .task { await extractContent() }
    }

    private func extractContent() async {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            isLoading = false
            return
        }

        for item in items {
            guard let attachments = item.attachments else { continue }

            for attachment in attachments {
                if attachment.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    if let url = try? await attachment.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                        sourceUrl = url.absoluteString
                        contentType = "link"
                        if content.isEmpty {
                            content = url.absoluteString
                        }
                    }
                } else if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    if let text = try? await attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                        content = text
                        contentType = "text"
                    }
                } else if attachment.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    contentType = "image"
                    if let url = try? await attachment.loadItem(forTypeIdentifier: UTType.image.identifier) as? URL {
                        sourceUrl = url.absoluteString
                        if content.isEmpty {
                            content = "图片: \(url.lastPathComponent)"
                        }
                    }
                }
            }

            if let attributedContent = item.attributedContentText {
                if content.isEmpty {
                    content = attributedContent.string
                }
            }
        }

        isLoading = false
    }

    private func save() {
        isSaving = true

        let sharedDefaults = UserDefaults(suiteName: "group.com.noteone.app")
        var queue = loadQueue(from: sharedDefaults)

        let entry: [String: String] = [
            "content": content,
            "contentType": contentType,
            "sourceUrl": sourceUrl,
        ]
        queue.append(entry)
        saveQueue(queue, to: sharedDefaults)

        extensionContext?.completeRequest(returningItems: nil)
    }

    private func cancel() {
        extensionContext?.cancelRequest(withError: NSError(
            domain: "com.noteone.app.share", code: 0
        ))
    }

    private func loadQueue(from defaults: UserDefaults?) -> [[String: String]] {
        return defaults?.array(forKey: "pendingNotes") as? [[String: String]] ?? []
    }

    private func saveQueue(_ queue: [[String: String]], to defaults: UserDefaults?) {
        defaults?.set(queue, forKey: "pendingNotes")
    }

    private func iconForType(_ type: String) -> String {
        switch type {
        case "image": return "photo"
        case "video": return "video"
        case "link": return "link"
        default: return "doc.text"
        }
    }
}
