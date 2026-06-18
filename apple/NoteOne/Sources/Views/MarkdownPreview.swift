import SwiftUI

/// Lightweight Markdown preview built on Apple's native `AttributedString(markdown:)`
/// for inline formatting (bold/italic/code/links) and a hand-rolled block parser for
/// headings, lists, blockquotes, code blocks, horizontal rules, and image refs.
///
/// We don't want to pull in a heavy markdown library — Obsidian-grade rendering is out
/// of scope for the local writer; we just want a comfortable read-mode that mirrors what
/// the user types.
struct MarkdownPreview: View {
    let markdown: String

    private var blocks: [Block] {
        MarkdownParser.parse(markdown)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(blocks) { block in
                blockView(block)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: Block) -> some View {
        switch block.kind {
        case .heading(let level):
            Text(inline(block.text))
                .font(headingFont(level))
                .foregroundStyle(Color.ink)
                .padding(.top, level == 1 ? 8 : 4)
        case .paragraph:
            Text(inline(block.text))
                .font(.body)
                .foregroundStyle(Color.ink)
                .textSelection(.enabled)
        case .blockquote:
            HStack(alignment: .top, spacing: 8) {
                Rectangle()
                    .fill(Color.accent.opacity(0.5))
                    .frame(width: 3)
                Text(inline(block.text))
                    .font(.body)
                    .foregroundStyle(Color.inkSecondary)
                    .italic()
            }
        case .codeBlock(let lang):
            VStack(alignment: .leading, spacing: 0) {
                if let lang, !lang.isEmpty {
                    Text(lang)
                        .font(.caption2.monospaced())
                        .foregroundStyle(Color.inkTertiary)
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                }
                Text(block.text)
                    .font(.body.monospaced())
                    .foregroundStyle(Color.ink)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .background(Color.canvasSecondary)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        case .listItem(let ordered, let index):
            HStack(alignment: .top, spacing: 8) {
                Text(ordered ? "\(index)." : "•")
                    .font(.body)
                    .foregroundStyle(Color.inkSecondary)
                    .frame(width: 20, alignment: .trailing)
                Text(inline(block.text))
                    .font(.body)
                    .foregroundStyle(Color.ink)
            }
        case .horizontalRule:
            Divider().padding(.vertical, 4)
        case .image(let url):
            // Local file:// images relative to the document directory render via AsyncImage.
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFit()
                    case .failure:
                        Label("图片加载失败", systemImage: "photo")
                            .foregroundStyle(Color.inkTertiary)
                    case .empty:
                        ProgressView()
                    @unknown default:
                        EmptyView()
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    /// Inline formatting via the system markdown parser (bold/italic/code/links).
    /// Falls back to plain text on parse failure.
    private func inline(_ text: String) -> AttributedString {
        if let attr = try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return attr
        }
        return AttributedString(text)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: return .system(size: 28, weight: .bold)
        case 2: return .system(size: 22, weight: .semibold)
        case 3: return .system(size: 18, weight: .semibold)
        default: return .system(size: 16, weight: .medium)
        }
    }
}

// MARK: - Block model

struct Block: Identifiable {
    enum Kind {
        case heading(Int)
        case paragraph
        case blockquote
        case codeBlock(String?)
        case listItem(ordered: Bool, index: Int)
        case horizontalRule
        case image(URL?)
    }
    let id: Int
    let kind: Kind
    let text: String
}

// MARK: - Block parser

enum MarkdownParser {
    /// Parse a markdown string into a flat list of blocks. We keep this dead simple:
    /// we only recognize block-level constructs that visibly differ in layout. Inline
    /// markdown inside paragraphs is left to the system parser at render time.
    static func parse(_ source: String) -> [Block] {
        var blocks: [Block] = []
        let lines = source.components(separatedBy: "\n")
        var idx = 0
        var blockId = 0
        var inCodeBlock = false
        var codeLang: String? = nil
        var codeBuffer: [String] = []
        var paragraphBuffer: [String] = []
        var orderedCounter = 0

        func flushParagraph() {
            if !paragraphBuffer.isEmpty {
                blocks.append(Block(id: blockId, kind: .paragraph, text: paragraphBuffer.joined(separator: "\n")))
                blockId += 1
                paragraphBuffer.removeAll()
            }
            orderedCounter = 0
        }

        while idx < lines.count {
            let line = lines[idx]

            // Code block fence
            if line.hasPrefix("```") {
                if inCodeBlock {
                    blocks.append(Block(id: blockId, kind: .codeBlock(codeLang), text: codeBuffer.joined(separator: "\n")))
                    blockId += 1
                    codeBuffer.removeAll()
                    codeLang = nil
                    inCodeBlock = false
                } else {
                    flushParagraph()
                    inCodeBlock = true
                    let lang = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                    codeLang = lang.isEmpty ? nil : lang
                }
                idx += 1
                continue
            }
            if inCodeBlock {
                codeBuffer.append(line)
                idx += 1
                continue
            }

            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty {
                flushParagraph()
                idx += 1
                continue
            }

            // Horizontal rule
            if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                flushParagraph()
                blocks.append(Block(id: blockId, kind: .horizontalRule, text: ""))
                blockId += 1
                idx += 1
                continue
            }

            // Heading
            if let match = trimmed.range(of: "^#{1,6}\\s+", options: .regularExpression) {
                flushParagraph()
                let hashCount = trimmed.distance(from: trimmed.startIndex, to: match.upperBound) - 1
                let text = String(trimmed[match.upperBound...])
                blocks.append(Block(id: blockId, kind: .heading(hashCount), text: text))
                blockId += 1
                idx += 1
                continue
            }

            // Image-only line: ![alt](path)
            if let imgMatch = trimmed.range(of: "^!\\[[^\\]]*\\]\\(([^)]+)\\)\\s*$", options: .regularExpression) {
                flushParagraph()
                let raw = String(trimmed[imgMatch])
                if let openParen = raw.firstIndex(of: "("), let closeParen = raw.lastIndex(of: ")") {
                    let pathStart = raw.index(after: openParen)
                    let path = String(raw[pathStart..<closeParen])
                    let url = imageURL(from: path)
                    blocks.append(Block(id: blockId, kind: .image(url), text: path))
                    blockId += 1
                }
                idx += 1
                continue
            }

            // Blockquote
            if trimmed.hasPrefix("> ") {
                flushParagraph()
                let text = String(trimmed.dropFirst(2))
                blocks.append(Block(id: blockId, kind: .blockquote, text: text))
                blockId += 1
                idx += 1
                continue
            }

            // Ordered list item
            if let m = trimmed.range(of: "^\\d+[.)]\\s+", options: .regularExpression) {
                flushParagraph()
                orderedCounter += 1
                let text = String(trimmed[m.upperBound...])
                blocks.append(Block(id: blockId, kind: .listItem(ordered: true, index: orderedCounter), text: text))
                blockId += 1
                idx += 1
                continue
            }

            // Unordered list item
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
                flushParagraph()
                let text = String(trimmed.dropFirst(2))
                blocks.append(Block(id: blockId, kind: .listItem(ordered: false, index: 0), text: text))
                blockId += 1
                idx += 1
                continue
            }

            // Default: paragraph line (group consecutive lines)
            paragraphBuffer.append(line)
            idx += 1
        }

        // Flush any trailing buffers
        if inCodeBlock {
            blocks.append(Block(id: blockId, kind: .codeBlock(codeLang), text: codeBuffer.joined(separator: "\n")))
            blockId += 1
        }
        flushParagraph()

        return blocks
    }

    /// Resolve a markdown image path against the document directory so relative paths
    /// (`./foo.png`, `images/foo.png`) work the same as in Obsidian / VS Code.
    private static func imageURL(from path: String) -> URL? {
        if let url = URL(string: path), url.scheme != nil {
            return url
        }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NoteOne", isDirectory: true)
        return docs.appendingPathComponent(path)
    }
}
