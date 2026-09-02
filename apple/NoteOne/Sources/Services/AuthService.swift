import SwiftUI

enum LocalSessionState: Equatable {
    case starting
    case ready
    case failed(String)
}

/// Establishes the app's internal localhost session. NoteOne has no user-facing
/// account or login: the token only protects calls between the app and its
/// bundled local server, while all user data stays in Application Support.
@MainActor
class LocalSessionService: ObservableObject {
    @Published private(set) var state: LocalSessionState = .starting

    init() {
        // Remove credentials persisted by v0.2.0 and earlier. Local session
        // tokens are now process-only and are recreated on every launch.
        UserDefaults.standard.removeObject(forKey: "jwt_token")
        NotificationCenter.default.addObserver(
            forName: .unauthorized, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.state == .ready else { return }
                await self.prepareLocalSession()
            }
        }
    }

    /// Opens the single local data session after the bundled server is healthy.
    /// A few short retries absorb transient startup delays without trapping the
    /// app behind an endless spinner.
    func prepareLocalSession() async {
        state = .starting

        var lastError: Error?
        for attempt in 0..<3 {
            do {
                let response = try await APIClient.shared.openLocalSession()
                await APIClient.shared.setToken(response.token)
                state = .ready
                return
            } catch {
                lastError = error
                if attempt < 2 {
                    try? await Task.sleep(for: .milliseconds(300 * (attempt + 1)))
                }
            }
        }

        let detail = lastError?.localizedDescription ?? L("未知错误", "Unknown error")
        state = .failed(L("无法打开本地数据：", "Could not open local data: ") + detail)
    }

    func reportStartupFailure(_ message: String) {
        state = .failed(message)
    }
}
