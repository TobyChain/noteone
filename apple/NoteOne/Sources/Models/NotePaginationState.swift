import Foundation

enum NotePagination {
    static func appending(_ page: [Note], to existing: [Note]) -> [Note] {
        let known = Set(existing.map(\.id))
        return existing + page.filter { !known.contains($0.id) }
    }
}
