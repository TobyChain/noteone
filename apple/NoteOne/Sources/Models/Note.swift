import Foundation

enum ContentType: String, Codable, CaseIterable, Sendable {
    case text, image, video, link, mixed
}

enum NoteStatus: String, Codable, Sendable {
    case pendingAi = "pending_ai"
    case active
    case archived
}

struct Note: Codable, Identifiable, Sendable {
    let id: String
    var contentType: ContentType
    var title: String?
    var content: String
    var sourceUrl: String?
    var sourceApp: String?
    var author: String?
    var authorOrg: String?
    var aiSummary: String?
    var status: NoteStatus
    var tags: [NoteTag]?
    var createdAt: Date
    var updatedAt: Date
}

struct NoteTag: Codable, Sendable {
    let tagId: String
    let name: String
    let dimension: String
    let confidence: Double?
    let isManual: Bool
}

struct CreateNoteRequest: Codable, Sendable {
    let content: String
    var contentType: String = "text"
    var title: String?
    var sourceUrl: String?
    var sourceApp: String?
    var author: String?
    var authorOrg: String?
}
