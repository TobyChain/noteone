import Foundation

/// Local-only markdown file store. Files live in the app's Documents directory
/// (`~/Documents/NoteOne/` on macOS, the app sandbox Documents on iOS), are real
/// `.md` files that other editors can open, and are never synced to the server.
struct LocalMarkdownFile: Identifiable, Sendable, Hashable {
    let id: String          // basename without extension
    let url: URL
    let modifiedAt: Date
    let sizeBytes: Int

    var title: String { id }
}

actor LocalFileStore {
    static let shared = LocalFileStore()

    private let directory: URL

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        self.directory = docs.appendingPathComponent("NoteOne", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    var rootDirectory: URL { directory }

    func list() throws -> [LocalMarkdownFile] {
        let urls = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        )
        return urls
            .filter { $0.pathExtension.lowercased() == "md" }
            .compactMap { url -> LocalMarkdownFile? in
                let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                let id = url.deletingPathExtension().lastPathComponent
                return LocalMarkdownFile(
                    id: id,
                    url: url,
                    modifiedAt: values?.contentModificationDate ?? Date.distantPast,
                    sizeBytes: values?.fileSize ?? 0
                )
            }
            .sorted { $0.modifiedAt > $1.modifiedAt }
    }

    func read(_ file: LocalMarkdownFile) throws -> String {
        try String(contentsOf: file.url, encoding: .utf8)
    }

    /// Create a new empty file with a unique title. Returns the created file.
    func create(title: String = "未命名笔记") throws -> LocalMarkdownFile {
        let safe = sanitize(title)
        let url = uniqueURL(for: safe)
        try "".write(to: url, atomically: true, encoding: .utf8)
        let id = url.deletingPathExtension().lastPathComponent
        return LocalMarkdownFile(id: id, url: url, modifiedAt: Date(), sizeBytes: 0)
    }

    /// Write content to an existing file. Idempotent.
    func write(_ file: LocalMarkdownFile, content: String) throws {
        try content.write(to: file.url, atomically: true, encoding: .utf8)
    }

    /// Rename the file (changes its id/url). Returns the renamed file or throws if
    /// the target name already exists.
    func rename(_ file: LocalMarkdownFile, to newTitle: String) throws -> LocalMarkdownFile {
        let safe = sanitize(newTitle)
        let target = directory.appendingPathComponent(safe).appendingPathExtension("md")
        if FileManager.default.fileExists(atPath: target.path) {
            throw NSError(domain: "LocalFileStore", code: 1, userInfo: [NSLocalizedDescriptionKey: "已存在同名文件"])
        }
        try FileManager.default.moveItem(at: file.url, to: target)
        return LocalMarkdownFile(id: safe, url: target, modifiedAt: Date(), sizeBytes: file.sizeBytes)
    }

    func delete(_ file: LocalMarkdownFile) throws {
        try FileManager.default.removeItem(at: file.url)
    }

    // MARK: - Helpers

    /// Strip path separators and other reserved characters from a free-form title so it
    /// becomes a safe basename. Trims to 80 chars.
    private func sanitize(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let stripped = trimmed.replacingOccurrences(
            of: "[/:\\\\?%*|\"<>\\x00-\\x1f]",
            with: "",
            options: .regularExpression
        )
        let limited = String(stripped.prefix(80))
        return limited.isEmpty ? "未命名笔记" : limited
    }

    /// If a file with that name already exists, append " 2", " 3", … until we find a free slot.
    private func uniqueURL(for basename: String) -> URL {
        let base = directory.appendingPathComponent(basename).appendingPathExtension("md")
        if !FileManager.default.fileExists(atPath: base.path) { return base }
        for i in 2...999 {
            let candidate = directory
                .appendingPathComponent("\(basename) \(i)")
                .appendingPathExtension("md")
            if !FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        }
        return base
    }
}
