import Foundation

/// Cross-platform handoff for content the user dragged onto NoteOne (iOS Drop on App / iPad Slide-Over,
/// macOS window drop). The top-level view stores the latest payload here; CaptureView consumes it on
/// next appear so users land in the confirm-and-save sheet with the dropped content prefilled.
///
/// Stays in-memory only — drops are session-scoped, never persisted.
struct DroppedPayload: Sendable {
    var text: String?
    var sourceUrl: String?
    var imageData: Data?
}

actor DropPayloadStore {
    static let shared = DropPayloadStore()

    private var pending: DroppedPayload?

    func set(_ payload: DroppedPayload) {
        pending = payload
    }

    /// Atomically take the pending payload and clear it. Subsequent calls return nil.
    func consume() -> DroppedPayload? {
        let value = pending
        pending = nil
        return value
    }

    var hasPending: Bool { pending != nil }
}
