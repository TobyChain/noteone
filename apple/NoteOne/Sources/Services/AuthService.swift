import SwiftUI
import AuthenticationServices

@MainActor
class AuthService: NSObject, ObservableObject {
    @Published var isAuthenticated = false
    @Published var userName: String?

    override init() {
        super.init()
        if let token = KeychainHelper.load(key: "jwt_token") {
            Task {
                await APIClient.shared.setToken(token)
                self.isAuthenticated = true
            }
        }
    }

    func signInWithApple(credential: ASAuthorizationAppleIDCredential) {
        let appleId = credential.user
        let email = credential.email
        let name = credential.fullName?.givenName

        Task {
            do {
                let response = try await APIClient.shared.signInWithApple(
                    appleId: appleId, email: email, name: name
                )
                KeychainHelper.save(key: "jwt_token", value: response.token)
                await APIClient.shared.setToken(response.token)
                self.isAuthenticated = true
                self.userName = response.user.name
            } catch {
                print("Auth failed: \(error)")
            }
        }
    }

    func signOut() {
        KeychainHelper.delete(key: "jwt_token")
        isAuthenticated = false
        userName = nil
    }

    func devLogin(name: String) {
        Task {
            do {
                let response = try await APIClient.shared.devLogin(name: name)
                KeychainHelper.save(key: "jwt_token", value: response.token)
                await APIClient.shared.setToken(response.token)
                self.isAuthenticated = true
                self.userName = response.user.name
            } catch {
                print("Dev login failed: \(error)")
            }
        }
    }
}
