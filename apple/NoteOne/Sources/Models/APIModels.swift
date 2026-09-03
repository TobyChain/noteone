import Foundation

struct NotesPage: Decodable, Sendable {
    let notes: [Note]
    let nextCursor: String?
}

struct SearchResult: Codable, Identifiable, Sendable {
    let id: String
    var title: String?
    var content: String
    var contentType: String
    var sourceUrl: String?
    var sourceApp: String?
    var author: String?
    var authorOrg: String?
    var aiSummary: String?
    var similarity: Double?
    var createdAt: Date
    var updatedAt: Date
}

struct StatsResponse: Codable, Sendable {
    let totalNotes: Int
    let byContentType: [ContentTypeCount]
    let topTags: [TagCount]
}

struct ContentTypeCount: Codable, Sendable {
    let contentType: String
    let count: Int
}

struct TagCount: Codable, Sendable {
    let name: String
    let dimension: String
    let count: Int
}

struct SettingsResponse: Codable, Sendable {
    let llm: LLMSettingsInfo
}

struct LLMSettingsInfo: Codable, Sendable {
    let baseUrl: String?
    let model: String?
    let hasApiKey: Bool
}
