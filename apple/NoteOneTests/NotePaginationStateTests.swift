import XCTest
@testable import NoteOne

final class NotePaginationStateTests: XCTestCase {
    func testAppendingDeduplicatesNotesAndPreservesOrder() {
        let merged = NotePagination.appending([note("b"), note("c")], to: [note("a"), note("b")])
        XCTAssertEqual(merged.map(\.id), ["a", "b", "c"])
    }

    private func note(_ id: String) -> Note {
        Note(id: id, contentType: .text, title: id, content: id, sourceUrl: nil,
             sourceApp: nil, author: nil, authorOrg: nil, aiSummary: nil, status: .active,
             deletedAt: nil, tags: nil, createdAt: Date(), updatedAt: Date())
    }
}
