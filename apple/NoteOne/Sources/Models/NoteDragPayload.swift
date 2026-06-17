import Foundation
import CoreTransferable
import UniformTypeIdentifiers

/// Transferable payload exported when the user drags a note row out of NoteOne to
/// another app (Notes, Mail, a document, etc). We only export a plain-text
/// representation — image bytes would require an async network fetch via sourceUrl,
/// which Transferable can't cleanly drive from a row view. Receiving apps that want
/// the image can still drop the note's source link and follow it themselves.
struct NoteDragPayload: Codable, Sendable {
    let title: String?
    let summary: String?
    let content: String
    let sourceUrl: String?
    let author: String?

    init(note: Note) {
        self.title = note.title
        self.summary = note.aiSummary
        self.content = note.content
        self.sourceUrl = note.sourceUrl
        self.author = note.author
    }

    /// A readable rendering for the receiving app's text field: title, summary, body,
    /// then a citation footer if any source metadata is present.
    var formattedText: String {
        var lines: [String] = []
        if let title, !title.isEmpty {
            lines.append(title)
            lines.append("")
        }
        if let summary, !summary.isEmpty {
            lines.append(summary)
            lines.append("")
        }
        lines.append(content)
        var citation: [String] = []
        if let author, !author.isEmpty { citation.append(author) }
        if let sourceUrl, !sourceUrl.isEmpty { citation.append(sourceUrl) }
        if !citation.isEmpty {
            lines.append("")
            lines.append("— " + citation.joined(separator: " · "))
        }
        return lines.joined(separator: "\n")
    }
}

extension NoteDragPayload: Transferable {
    static var transferRepresentation: some TransferRepresentation {
        // Plain text — accepted by virtually every drop target. Receivers that prefer
        // URL/file representations can detect a URL in the body and act accordingly.
        ProxyRepresentation(exporting: \.formattedText)
    }
}
