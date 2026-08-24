import Foundation

struct AuthResponse: Codable, Sendable {
    let token: String
    let user: UserInfo
}

struct UserInfo: Codable, Sendable {
    let id: String
    let name: String?
    let email: String?
}
