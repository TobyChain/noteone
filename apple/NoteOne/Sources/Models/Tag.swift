import Foundation

enum TagDimension: String, Codable, CaseIterable, Sendable {
    case format, topic, domain, module
}

struct Tag: Codable, Identifiable, Sendable {
    let id: String
    var name: String
    var dimension: TagDimension
    var parentId: String?
    var description: String?
}
