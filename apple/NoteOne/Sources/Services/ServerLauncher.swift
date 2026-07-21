#if os(macOS)
import Foundation
import AppKit

/// Launches the bundled NoteOne server (Resources/server) when no server is
/// already listening on localhost:3000, and terminates it on app exit.
/// In development (repo checkout, `npm run dev` running) the health check
/// succeeds and the bundled server is never started.
@MainActor
final class ServerLauncher {
    static let shared = ServerLauncher()

    private var process: Process?
    private let port = 3000

    private var serverResources: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("server")
    }

    /// True when this build ships an embedded server.
    var isEmbeddedBuild: Bool {
        guard let dir = serverResources else { return false }
        return FileManager.default.fileExists(atPath: dir.appendingPathComponent("server.mjs").path)
    }

    func ensureRunning() async {
        guard isEmbeddedBuild else { return }
        if await isHealthy() { return }
        start()
        // Wait for the embedded server to come up (PGlite migration on first boot).
        for _ in 0..<40 {
            try? await Task.sleep(nanoseconds: 500_000_000)
            if await isHealthy() { return }
        }
        NSLog("[ServerLauncher] server did not become healthy in 20s")
    }

    func terminate() {
        process?.terminate()
        process = nil
    }

    private func isHealthy() async -> Bool {
        guard let url = URL(string: "http://localhost:\(port)/health") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func start() {
        guard process == nil, let dir = serverResources else { return }
        let dataDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NoteOne")

        let p = Process()
        p.executableURL = dir.appendingPathComponent("node")
        p.arguments = [dir.appendingPathComponent("server.mjs").path]
        p.currentDirectoryURL = dataDir
        var env = ProcessInfo.processInfo.environment
        env["NOTEONE_DATA_DIR"] = dataDir.path
        env["PORT"] = String(port)
        env["NODE_ENV"] = "production"
        env["NOTEONE_MIGRATIONS_DIR"] = dir.appendingPathComponent("drizzle").path
        env["NOTEONE_PUBLIC_DIR"] = dir.appendingPathComponent("public").path
        env["ASCAN_SCHEMA_PATH"] = dir.appendingPathComponent("config.schema.json").path
        env["ASCAN_DATA_DIR"] = dir.appendingPathComponent("data").path
        p.environment = env

        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        let logURL = dataDir.appendingPathComponent("server.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        if let handle = try? FileHandle(forWritingTo: logURL) {
            handle.seekToEndOfFile()
            p.standardOutput = handle
            p.standardError = handle
        }

        do {
            try p.run()
            process = p
            NSLog("[ServerLauncher] embedded server started pid=%d", p.processIdentifier)
        } catch {
            NSLog("[ServerLauncher] failed to start embedded server: %@", error.localizedDescription)
        }
    }
}
#endif
