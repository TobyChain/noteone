import Foundation

struct ChatMessage: Codable, Identifiable, Sendable {
    let id: UUID
    var role: String
    var content: String
    var toolActivities: [ToolActivity]

    init(role: String, content: String, toolActivities: [ToolActivity] = []) {
        self.id = UUID()
        self.role = role
        self.content = content
        self.toolActivities = toolActivities
    }
}

/// One tool invocation by Notty, rendered as a collapsible row in the chat flow.
struct ToolActivity: Codable, Identifiable, Sendable, Equatable {
    let id: UUID
    var name: String
    var argsSummary: String?
    var resultPreview: String?
    var durationMs: Int?
    var isRunning: Bool

    init(name: String, argsSummary: String? = nil) {
        self.id = UUID()
        self.name = name
        self.argsSummary = argsSummary
        self.isRunning = true
    }
}

/// tool_calls entries persisted on intermediate assistant messages (OpenAI wire format).
struct StoredToolCall: Codable, Sendable {
    let id: String
    let function: Function

    struct Function: Codable, Sendable {
        let name: String
        let arguments: String
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
    let toolCalls: [StoredToolCall]?
    let toolCallId: String?
    let createdAt: Date
}
