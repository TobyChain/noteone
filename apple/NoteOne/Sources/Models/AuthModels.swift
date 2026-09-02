import Foundation

struct LocalSessionResponse: Codable, Sendable {
    let token: String
    let user: LocalDataOwner
}

/// Internal database owner for this installation. This is not an account.
struct LocalDataOwner: Codable, Sendable {
    let id: String
    let name: String?
    let email: String?
}
