import SwiftUI

@MainActor
class AuthService: ObservableObject {
    @Published var isAuthenticated = false
    @Published var userName: String?
    @Published var userId: String?

    // The JWT is stored in UserDefaults, not the Keychain. The app is ad-hoc
    // signed, so every rebuild produces a new cdhash — the new binary can't
    // silently read a Keychain item written by the old binary, which is what
    // triggered the "wants to access confidential information" password prompt
    // on every launch. For a single-user localhost app, UserDefaults is fine.
    private let tokenKey = "jwt_token"

    init() {
        if let token = UserDefaults.standard.string(forKey: tokenKey) {
            self.userId = Self.decodeUserId(from: token)
            Task {
                await APIClient.shared.setToken(token)
                self.isAuthenticated = true
            }
        } else {
            Task { await localLogin() }
        }
        NotificationCenter.default.addObserver(
            forName: .unauthorized, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isAuthenticated else { return }
                // Token expired (30d) or the local user was wiped — silently
                // re-login instead of bouncing back to a login screen.
                await self.localLogin()
            }
        }
    }

    private static func decodeUserId(from token: String) -> String? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let userId = json["userId"] as? String
        else { return nil }
        return userId
    }

    /// Silent auto-login against POST /auth/local — no login UI. The server
    /// reuses the first existing user, or creates one on first launch named
    /// after the local macOS account.
    func localLogin() async {
        do {
            let response = try await APIClient.shared.localLogin(name: Self.systemUserName())
            UserDefaults.standard.set(response.token, forKey: tokenKey)
            await APIClient.shared.setToken(response.token)
            self.isAuthenticated = true
            self.userName = response.user.name
            self.userId = response.user.id
        } catch {
            print("Auto-login failed: \(error)")
        }
    }

    private static func systemUserName() -> String {
        #if os(macOS)
        let name = NSFullUserName().trimmingCharacters(in: .whitespaces)
        if !name.isEmpty { return name }
        #endif
        return "本地用户"
    }
}
