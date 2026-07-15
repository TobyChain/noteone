import Foundation
import SwiftUI

enum TagDimension: String, Codable, CaseIterable, Sendable {
    case format, topic, domain, module

    var color: Color {
        switch self {
        case .format: .tagFormat
        case .topic: .tagTopic
        case .domain: .tagDomain
        case .module: .tagModule
        }
    }

    static func color(fromDimension dimension: String) -> Color {
        TagDimension(rawValue: dimension)?.color ?? Color.inkSecondary
    }
}

struct Tag: Codable, Identifiable, Sendable {
    let id: String
    var name: String
    var dimension: TagDimension
    var parentId: String?
    var description: String?
}
