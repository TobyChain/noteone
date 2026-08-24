import Foundation

/// Checks GitHub Releases for a newer NoteOne build.
///
/// NoteOne is distributed as a self-contained DMG; user data lives in
/// ~/Library/Application Support/NoteOne (PGlite), outside the app bundle, so
/// installing a new build never touches stored notes/reports.
struct UpdateInfo: Sendable {
    let version: String
    let downloadURL: String
    let releaseNotes: String
    let releasePage: String
}

enum UpdateError: Error {
    case invalidURL
    case badResponse
    case noNewerVersion
}

struct UpdateChecker: Sendable {
    static let shared = UpdateChecker()

    private let repo = "TobyChain/noteone"
    private let apiURL = "https://api.github.com/repos/TobyChain/noteone/releases/latest"

    /// The currently installed version, read from the app bundle (e.g. "0.1.0").
    var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    /// Query GitHub for the latest release; returns info only when it is newer than installed.
    func checkForUpdate() async throws -> UpdateInfo {
        guard let url = URL(string: apiURL) else { throw UpdateError.invalidURL }
        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw UpdateError.badResponse
        }

        let release = try JSONDecoder().decode(Release.self, from: data)
        let latest = release.tagName.hasPrefix("v") ? String(release.tagName.dropFirst()) : release.tagName

        guard isNewer(latest, than: currentVersion) else { throw UpdateError.noNewerVersion }

        // Prefer the .dmg asset; fall back to the release page.
        let dmg = release.assets.first { $0.name.hasSuffix(".dmg") }
        return UpdateInfo(
            version: latest,
            downloadURL: dmg?.browserDownloadURL ?? release.htmlURL,
            releaseNotes: release.body ?? "",
            releasePage: release.htmlURL
        )
    }

    /// Semantic-ish comparison: split on dots, compare numerically segment by segment.
    private func isNewer(_ candidate: String, than current: String) -> Bool {
        let a = candidate.split(separator: ".").compactMap { Int($0) }
        let b = current.split(separator: ".").compactMap { Int($0) }
        let n = max(a.count, b.count)
        for i in 0..<n {
            let x = i < a.count ? a[i] : 0
            let y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    private struct Release: Decodable {
        let tagName: String
        let htmlURL: String
        let body: String?
        let assets: [Asset]
        enum CodingKeys: String, CodingKey {
            case tagName = "tag_name"
            case htmlURL = "html_url"
            case body, assets
        }
    }

    private struct Asset: Decodable {
        let name: String
        let browserDownloadURL: String
        enum CodingKeys: String, CodingKey {
            case name
            case browserDownloadURL = "browser_download_url"
        }
    }
}
