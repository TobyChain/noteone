import Foundation

struct ChatMessage: Codable, Identifiable, Sendable {
    let id: UUID
    var role: String
    var content: String

    init(role: String, content: String) {
        self.id = UUID()
        self.role = role
        self.content = content
    }
}

struct ChatResponseMessage: Decodable {
    let id: String?
    let role: String
    let content: String
}

struct ChatSession: Codable, Identifiable, Sendable {
    let id: String
    let userId: String
    var title: String?
    let createdAt: Date
    var updatedAt: Date
}

struct ChatSessionDetail: Codable, Sendable {
    let id: String
    let userId: String
    var title: String?
    let createdAt: Date
    var updatedAt: Date
    let messages: [ServerChatMessage]
}

struct ServerChatMessage: Codable, Identifiable, Sendable {
    let id: String
    let sessionId: String
    let role: String
    let content: String
    let isSummary: Bool
    let createdAt: Date
}
