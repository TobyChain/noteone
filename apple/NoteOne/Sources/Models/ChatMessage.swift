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

struct ChatRequest: Encodable {
    let messages: [ChatMessagePayload]
    let noteIds: [String]?
}

struct ChatMessagePayload: Encodable {
    let role: String
    let content: String
}

struct ChatResponse: Decodable {
    let message: ChatResponseMessage
}

struct ChatResponseMessage: Decodable {
    let role: String
    let content: String
}
