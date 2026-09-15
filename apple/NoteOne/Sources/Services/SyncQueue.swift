import Foundation

/// An image captured by the Share Extension, pending upload + note creation.
struct PendingImage: Codable, Sendable {
    let caption: String
    let fileName: String  // file stored under the shared share-images directory
}

actor SyncQueue {
    static let shared = SyncQueue()

    private static let appGroupId = "group.com.noteone.app"
    private let pendingNotesKey = "pendingNotes"
    private let fileURL: URL
    private let imageQueueURL: URL
    private let shareImagesDir: URL
    private var queue: [CreateNoteRequest] = []
    private var imageQueue: [PendingImage] = []
    private var lastSyncError: String?
    private var lastSyncedAt: Date?

    private init() {
        let fm = FileManager.default
        let dir = Self.storageDirectory(
            applicationSupportDirectory: fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0],
            appGroupContainer: { fm.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupId) }
        )
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("sync_queue.json")
        self.imageQueueURL = dir.appendingPathComponent("image_queue.json")
        self.shareImagesDir = dir.appendingPathComponent("share-images", isDirectory: true)
        try? fm.createDirectory(at: shareImagesDir, withIntermediateDirectories: true)
    }

    static func storageDirectory(
        applicationSupportDirectory: URL,
        appGroupContainer: () -> URL?
    ) -> URL {
        #if os(iOS)
        if let container = appGroupContainer() {
            return container.appendingPathComponent("NoteOne", isDirectory: true)
        }
        #endif
        return applicationSupportDirectory.appendingPathComponent("NoteOne", isDirectory: true)
    }

    func warmUp() {
        loadFromDisk()
        drainSharedPending()
    }

    func enqueue(_ request: CreateNoteRequest) {
        queue.append(request)
        saveToDisk()
    }

    /// Pull notes captured by the iOS Share Extension (written to App Group UserDefaults)
    /// into the unified queue so the main app actually syncs them.
    private func drainSharedPending() {
        #if os(iOS)
        guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return }
        let pending = defaults.array(forKey: pendingNotesKey) as? [[String: String]] ?? []
        guard !pending.isEmpty else { return }

        for entry in pending {
            // Image entries carry a file reference instead of inline content.
            if let imagePath = entry["imagePath"], !imagePath.isEmpty {
                imageQueue.append(PendingImage(
                    caption: entry["content"] ?? "[图片]",
                    fileName: imagePath
                ))
                continue
            }
            guard let content = entry["content"], !content.isEmpty else { continue }
            let url = entry["sourceUrl"]
            queue.append(CreateNoteRequest(
                content: content,
                contentType: entry["contentType"] ?? "text",
                sourceUrl: (url?.isEmpty == false) ? url : nil
            ))
        }
        defaults.removeObject(forKey: pendingNotesKey)
        saveToDisk()
        #endif
    }

    /// Flush queued notes (and pending images) to the server. Returns count synced.
    @discardableResult
    func flush() async -> Int {
        drainSharedPending()
        var synced = 0
        lastSyncError = nil

        // 1) Image notes: upload the file, then create an image note; delete file on success.
        if !imageQueue.isEmpty {
            var remainingImages: [PendingImage] = []
            for item in imageQueue {
                let fileURL = shareImagesDir.appendingPathComponent(item.fileName)
                guard let data = try? Data(contentsOf: fileURL) else {
                    continue  // file gone — drop the entry
                }
                do {
                    let imageUrl = try await APIClient.shared.uploadImage(
                        data: data, mimeType: "image/png", fileName: item.fileName
                    )
                    _ = try await APIClient.shared.createNote(CreateNoteRequest(
                        content: item.caption.isEmpty ? "[图片]" : item.caption,
                        contentType: "image",
                        sourceUrl: imageUrl
                    ))
                    try? FileManager.default.removeItem(at: fileURL)
                    synced += 1
                } catch {
                    lastSyncError = error.localizedDescription
                    remainingImages.append(item)
                }
            }
            imageQueue = remainingImages
        }

        // 2) Text/link notes.
        if !queue.isEmpty {
            var failed: [CreateNoteRequest] = []
            for item in queue {
                do {
                    _ = try await APIClient.shared.createNote(item)
                    synced += 1
                } catch {
                    lastSyncError = error.localizedDescription
                    failed.append(item)
                }
            }
            queue = failed
        }

        saveToDisk()
        if synced > 0 { lastSyncedAt = Date() }
        return synced
    }

    var pendingCount: Int { queue.count + imageQueue.count }

    func status() -> SyncStatus {
        SyncStatus(pendingCount: pendingCount, lastError: lastSyncError, lastSyncedAt: lastSyncedAt)
    }

    private func loadFromDisk() {
        if let data = try? Data(contentsOf: fileURL) {
            queue = (try? JSONDecoder().decode([CreateNoteRequest].self, from: data)) ?? []
        }
        if let data = try? Data(contentsOf: imageQueueURL) {
            imageQueue = (try? JSONDecoder().decode([PendingImage].self, from: data)) ?? []
        }
    }

    private func saveToDisk() {
        try? JSONEncoder().encode(queue).write(to: fileURL)
        try? JSONEncoder().encode(imageQueue).write(to: imageQueueURL)
    }
}

struct SyncStatus: Sendable {
    let pendingCount: Int
    let lastError: String?
    let lastSyncedAt: Date?
}
