import Foundation

enum NewLoreHighlightStyle: String, Codable, Sendable, CaseIterable {
    case bold, underline, highlight

    var label: String {
        switch self {
        case .bold: return L("加粗", "Bold")
        case .underline: return L("划线", "Underline")
        case .highlight: return L("高亮", "Highlight")
        }
    }
}

struct NewLoreHighlightSegment: Codable, Equatable, Sendable {
    let materialKey: String
    let field: String
    let start: Int
    let end: Int
    let text: String
    let contextBefore: String?
    let contextAfter: String?
    let sourceUrl: String?
}

struct NewLoreHighlightSelection: Decodable, Equatable, Sendable {
    let text: String
    let segments: [NewLoreHighlightSegment]
}

struct NewLoreHighlight: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let text: String
    let segments: [NewLoreHighlightSegment]
    let style: NewLoreHighlightStyle
    let createdAt: String
    let quickNoted: Bool
}

struct NewLoreHighlightRequest: Encodable, Sendable {
    let text: String
    let segments: [NewLoreHighlightSegment]
    let style: NewLoreHighlightStyle
    let requestId: String

    /// Keep the request identity stable while a failed save is retried.
    init(selection: NewLoreHighlightSelection, style: NewLoreHighlightStyle) {
        text = selection.text
        segments = selection.segments
        self.style = style
        requestId = UUID().uuidString.lowercased()
    }
}

struct NewLoreHighlightsResponse: Decodable, Sendable {
    let noteId: String?
    let status: String?
    let highlights: [NewLoreHighlight]
    let highlight: NewLoreHighlight?
    let created: Bool?
    let deduplicated: Bool?
}

struct NewLoreHighlightEvent: Decodable {
    let action: String
    let selection: NewLoreHighlightSelection?
    let style: NewLoreHighlightStyle?
    let ids: [String]?
    let unresolved: Int?
}
