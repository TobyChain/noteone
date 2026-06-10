import Foundation

actor SyncQueue {
    static let shared = SyncQueue()

    private let fileURL: URL
    private var queue: [CreateNoteRequest] = []

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NoteOne", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("sync_queue.json")
    }

    func warmUp() {
        loadFromDisk()
    }

    func enqueue(_ request: CreateNoteRequest) {
        queue.append(request)
        saveToDisk()
    }

    func flush() async {
        guard !queue.isEmpty else { return }
        var failed: [CreateNoteRequest] = []

        for item in queue {
            do {
                _ = try await APIClient.shared.createNote(item)
            } catch {
                failed.append(item)
            }
        }

        queue = failed
        saveToDisk()
    }

    var pendingCount: Int { queue.count }

    private func loadFromDisk() {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        queue = (try? JSONDecoder().decode([CreateNoteRequest].self, from: data)) ?? []
    }

    private func saveToDisk() {
        try? JSONEncoder().encode(queue).write(to: fileURL)
    }
}
