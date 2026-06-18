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

// MARK: - Writer-mode chat (Notty acting on the local markdown document)

struct WriterSelectionRange: Codable, Sendable {
    let start: Int
    let end: Int
}

struct WriterChatRequest: Encodable {
    let message: String
    let documentText: String
    let selection: WriterSelectionRange?
}

enum WriterActionType: String, Codable, Sendable {
    case insertText = "insert_text"
    case appendText = "append_text"
    case replaceSelection = "replace_selection"
    case rewriteDocument = "rewrite_document"
}

struct WriterAction: Codable, Sendable {
    let type: WriterActionType
    let text: String
}

struct WriterChatResponse: Decodable, Sendable {
    let message: ChatResponseMessage
    let action: WriterAction?
}
