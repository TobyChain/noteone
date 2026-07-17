import SwiftUI

struct MarkdownPreview: View {
    let markdown: String

    private var blocks: [Block] {
        MarkdownParser.parse(markdown)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DG.sp16) {
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
                .padding(.top, level <= 2 ? DG.sp20 : DG.sp12)
                .padding(.bottom, level <= 2 ? DG.sp4 : 0)

        case .paragraph:
            Text(inline(block.text))
                .font(.system(size: 16))
                .lineSpacing(4)
                .foregroundStyle(Color.ink)
                .textSelection(.enabled)

        case .blockquote:
            HStack(alignment: .top, spacing: DG.sp12) {
                Rectangle()
                    .fill(Color.accent.opacity(0.4))
                    .frame(width: 3)
                Text(inline(block.text))
                    .font(.system(size: 15))
                    .foregroundStyle(Color.inkSecondary)
                    .italic()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(DG.sp12)
            .background(Color.accent.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: DG.r8))

        case .codeBlock(let lang):
            VStack(alignment: .leading, spacing: 0) {
                if let lang, !lang.isEmpty {
                    HStack {
                        Text(lang)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Color.inkTertiary)
                        Spacer()
                    }
                    .padding(.horizontal, DG.sp16)
                    .padding(.top, DG.sp8)
                    .padding(.bottom, DG.sp4)
                    Divider()
                }
                Text(block.text)
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundStyle(Color.ink)
                    .padding(DG.sp16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .background(Color.canvasSecondary)
            .clipShape(RoundedRectangle(cornerRadius: DG.r8))
            .overlay(
                RoundedRectangle(cornerRadius: DG.r8)
                    .stroke(Color.hairline, lineWidth: 0.5)
            )

        case .listItem(let ordered, let index):
            HStack(alignment: .firstTextBaseline, spacing: DG.sp8) {
                Text(ordered ? "\(index)." : "\u{2022}")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.inkSecondary)
                    .frame(width: 22, alignment: .trailing)
                Text(inline(block.text))
                    .font(.system(size: 16))
                    .lineSpacing(4)
                    .foregroundStyle(Color.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

        case .horizontalRule:
            HStack {
                Rectangle()
                    .fill(Color.hairline)
                    .frame(height: 1)
            }
            .padding(.vertical, DG.sp8)

        case .image(let url):
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: DG.r8))
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
        case .table(let headers, let rows, let alignments):
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 0) {
                    ForEach(Array(headers.enumerated()), id: \.offset) { i, h in
                        Text(inline(h))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.ink)
                            .frame(maxWidth: .infinity, alignment: frameAlignment(safeAlign(alignments, i)))
                            .padding(.horizontal, DG.sp8)
                            .padding(.vertical, DG.sp4)
                    }
                }
                .background(Color.canvasSecondary)
                ForEach(Array(rows.enumerated()), id: \.offset) { ri, row in
                    HStack(spacing: 0) {
                        ForEach(Array(row.enumerated()), id: \.offset) { ci, cell in
                            Text(inline(cell))
                                .font(.system(size: 14))
                                .foregroundStyle(Color.ink)
                                .frame(maxWidth: .infinity, alignment: frameAlignment(safeAlign(alignments, ci)))
                                .padding(.horizontal, DG.sp8)
                                .padding(.vertical, DG.sp4)
                        }
                    }
                    .background(ri % 2 == 0 ? Color.clear : Color.canvasSecondary.opacity(0.5))
                    .overlay(Rectangle().fill(Color.hairline).frame(height: 0.5), alignment: .top)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: DG.r6))
            .overlay(RoundedRectangle(cornerRadius: DG.r6).stroke(Color.hairline, lineWidth: 0.5))
        }
    }

    private func frameAlignment(_ a: HAlignment) -> Alignment {
        switch a { case .left: return .leading; case .center: return .center; case .right: return .trailing }
    }

    private func safeAlign(_ alignments: [HAlignment], _ i: Int) -> HAlignment {
        i < alignments.count ? alignments[i] : .left
    }

    private func inline(_ text: String) -> AttributedString {
        let opts = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        if let attr = try? AttributedString(markdown: text, options: opts) {
            return attr
        }
        return AttributedString(text)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: return .system(size: 30, weight: .bold)
        case 2: return .system(size: 24, weight: .semibold)
        case 3: return .system(size: 20, weight: .semibold)
        case 4: return .system(size: 17, weight: .semibold)
        default: return .system(size: 16, weight: .medium)
        }
    }
}

struct Block: Identifiable {
    enum Kind {
        case heading(Int)
        case paragraph
        case blockquote
        case codeBlock(String?)
        case listItem(ordered: Bool, index: Int)
        case horizontalRule
        case image(URL?)
        case table(headers: [String], rows: [[String]], alignments: [HAlignment])
    }
    let id: Int
    let kind: Kind
    let text: String
}

enum HAlignment { case left, center, right }

enum MarkdownParser {
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

            // Table: consecutive lines starting with |
            if trimmed.hasPrefix("|") && idx + 1 < lines.count && lines[idx + 1].trimmingCharacters(in: .whitespaces).hasPrefix("|") && lines[idx + 1].contains("-") {
                flushParagraph()
                var tableLines: [String] = []
                while idx < lines.count && lines[idx].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    tableLines.append(lines[idx])
                    idx += 1
                }
                if tableLines.count >= 2 {
                    let headers = parseTableRow(tableLines[0])
                    let aligns = parseTableAligns(tableLines[1])
                    let rows = Array(tableLines.dropFirst(2)).map { parseTableRow($0) }
                    blocks.append(Block(id: blockId, kind: .table(headers: headers, rows: rows, alignments: aligns), text: ""))
                    blockId += 1
                }
                continue
            }

            if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                flushParagraph()
                blocks.append(Block(id: blockId, kind: .horizontalRule, text: ""))
                blockId += 1
                idx += 1
                continue
            }

            if let match = trimmed.range(of: "^#{1,6}\\s+", options: .regularExpression) {
                flushParagraph()
                let hashCount = trimmed.distance(from: trimmed.startIndex, to: match.upperBound) - 1
                let text = String(trimmed[match.upperBound...])
                blocks.append(Block(id: blockId, kind: .heading(hashCount), text: text))
                blockId += 1
                idx += 1
                continue
            }

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

            if trimmed.hasPrefix("> ") {
                flushParagraph()
                let text = String(trimmed.dropFirst(2))
                blocks.append(Block(id: blockId, kind: .blockquote, text: text))
                blockId += 1
                idx += 1
                continue
            }

            if let m = trimmed.range(of: "^\\d+[.)]\\s+", options: .regularExpression) {
                flushParagraph()
                orderedCounter += 1
                let text = String(trimmed[m.upperBound...])
                blocks.append(Block(id: blockId, kind: .listItem(ordered: true, index: orderedCounter), text: text))
                blockId += 1
                idx += 1
                continue
            }

            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
                flushParagraph()
                let text = String(trimmed.dropFirst(2))
                blocks.append(Block(id: blockId, kind: .listItem(ordered: false, index: 0), text: text))
                blockId += 1
                idx += 1
                continue
            }

            paragraphBuffer.append(line)
            idx += 1
        }

        if inCodeBlock {
            blocks.append(Block(id: blockId, kind: .codeBlock(codeLang), text: codeBuffer.joined(separator: "\n")))
            blockId += 1
        }
        flushParagraph()

        return blocks
    }

    private static func parseTableRow(_ line: String) -> [String] {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let withoutEdges = trimmed.hasPrefix("|") ? String(trimmed.dropFirst()) : trimmed
        let final = withoutEdges.hasSuffix("|") ? String(withoutEdges.dropLast()) : withoutEdges
        return final.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func parseTableAligns(_ line: String) -> [HAlignment] {
        parseTableRow(line).map { cell in
            let s = cell.trimmingCharacters(in: .whitespaces)
            let left = s.hasPrefix(":")
            let right = s.hasSuffix(":")
            if left && right { return .center }
            if right { return .right }
            return .left
        }
    }

    private static func imageURL(from path: String) -> URL? {
        if let url = URL(string: path), url.scheme != nil {
            return url
        }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NoteOne", isDirectory: true)
        return docs.appendingPathComponent(path)
    }
}
