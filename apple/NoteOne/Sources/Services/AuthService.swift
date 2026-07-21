import SwiftUI

@MainActor
class AuthService: ObservableObject {
    @Published var isAuthenticated = false
    @Published var userName: String?
    @Published var userId: String?

    init() {
        if let token = KeychainHelper.load(key: "jwt_token") {
            self.userId = Self.decodeUserId(from: token)
            Task {
                await APIClient.shared.setToken(token)
                self.isAuthenticated = true
            }
        }
        NotificationCenter.default.addObserver(
            forName: .unauthorized, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isAuthenticated else { return }
                self.signOut()
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

    func signOut() {
        KeychainHelper.delete(key: "jwt_token")
        isAuthenticated = false
        userName = nil
        userId = nil
    }

    func devLogin(name: String) {
        Task {
            do {
                let response = try await APIClient.shared.devLogin(name: name)
                KeychainHelper.save(key: "jwt_token", value: response.token)
                await APIClient.shared.setToken(response.token)
                self.isAuthenticated = true
                self.userName = response.user.name
                self.userId = response.user.id
            } catch {
                print("Login failed: \(error)")
            }
        }
    }
}
