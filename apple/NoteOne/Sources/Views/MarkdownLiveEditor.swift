import SwiftUI
#if os(macOS)
import AppKit

/// Commands that the format bar and keyboard shortcuts can issue to the editor.
/// Text-mutating cases are performed by `MarkdownLiveEditor.perform(_:in:)`;
/// `requestLinkDialog` / `requestImagePicker` bubble up to the host view to
/// present a sheet / file picker before the actual insert command is issued.
enum EditorCommand: Equatable {
    case heading(Int)        // 0 = body (clear heading), 1/2/3 = levels
    case bold
    case italic
    case inlineCode
    case bulletList
    case numberedList
    case checklist
    case quote
    case insertTable
    case insertImage(String)
    case insertLink(text: String, url: String)
    case requestLinkDialog
    case requestImagePicker
}

/// Obsidian-style live markdown editor with a clean, monochrome aesthetic.
/// Inspired by ant-design/x-markdown: one accent color (links only),
/// opacity-based backgrounds, modest type scale, no rainbow syntax.
struct MarkdownLiveEditor: NSViewRepresentable {
    @Binding var text: String
    var onContentChange: (() -> Void)? = nil
    var command: EditorCommand? = nil
    var onCommandHandled: (() -> Void)? = nil
    var onShortcut: ((EditorCommand) -> Void)? = nil

    func makeNSView(context: Context) -> NSScrollView {
        let tv = MarkdownTextView()
        let scrollView = NSScrollView()
        scrollView.documentView = tv
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = false
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder

        tv.delegate = context.coordinator
        tv.isRichText = true
        tv.allowsUndo = true
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticSpellingCorrectionEnabled = false
        tv.isAutomaticTextReplacementEnabled = false
        tv.font = .systemFont(ofSize: 15)
        tv.textContainerInset = NSSize(width: 24, height: 24)
        tv.textContainer?.widthTracksTextView = true
        tv.minSize = NSSize(width: 0, height: 0)
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        tv.autoresizingMask = [.width]
        tv.isVerticallyResizable = true
        tv.isHorizontallyResizable = false

        let coord = context.coordinator
        tv.onShortcut = { [weak coord] cmd in coord?.onShortcut?(cmd) }

        coord.isApplyingProgrammaticChange = true
        tv.string = text
        coord.applyHighlighting(in: tv)
        coord.isApplyingProgrammaticChange = false

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let tv = scrollView.documentView as? NSTextView else { return }
        guard !tv.hasMarkedText() else { return }

        // Keep the coordinator's shortcut forwarder fresh.
        context.coordinator.onShortcut = onShortcut

        // Perform a pending command issued from the format bar.
        if let cmd = command, cmd != context.coordinator.lastHandledCommand {
            context.coordinator.lastHandledCommand = cmd
            if cmd == .requestLinkDialog || cmd == .requestImagePicker {
                onShortcut?(cmd)
            } else {
                MarkdownLiveEditor.perform(cmd, in: tv)
            }
            onCommandHandled?()
        } else if command == nil {
            context.coordinator.lastHandledCommand = nil
        }

        if tv.string != text {
            let oldSel = tv.selectedRange()
            context.coordinator.isApplyingProgrammaticChange = true
            tv.string = text
            let newLen = (text as NSString).length
            let clamped = min(oldSel.location, newLen)
            tv.setSelectedRange(NSRange(location: clamped, length: 0))
            context.coordinator.applyHighlighting(in: tv)
            context.coordinator.isApplyingProgrammaticChange = false
        } else if tv.selectedRange() != context.coordinator.lastSelection {
            context.coordinator.updateCursorHiding(in: tv)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    // MARK: - Color palette (monochrome, opacity-based)

    private static let baseSize: CGFloat = 15
    private static let textFont = NSFont.systemFont(ofSize: 15, weight: .regular)
    private static let textColor = NSColor.labelColor
    private static let mutedColor = NSColor.secondaryLabelColor
    private static let hairlineColor = NSColor.separatorColor
    private static let codeBg = NSColor.labelColor.withAlphaComponent(0.04)
    private static let quoteBg = NSColor.labelColor.withAlphaComponent(0.05)
    private static let quoteBorder = NSColor.labelColor.withAlphaComponent(0.15)

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MarkdownLiveEditor
        var isApplyingProgrammaticChange = false
        var lastSelection = NSRange(location: 0, length: 0)
        var markerRanges: [NSRange] = []
        var onShortcut: ((EditorCommand) -> Void)? = nil
        var lastHandledCommand: EditorCommand? = nil

        init(_ parent: MarkdownLiveEditor) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard !isApplyingProgrammaticChange,
                  let tv = notification.object as? NSTextView else { return }
            parent.text = tv.string
            applyHighlighting(in: tv)
            parent.onContentChange?()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard !isApplyingProgrammaticChange,
                  let tv = notification.object as? NSTextView else { return }
            let r = tv.selectedRange()
            if lastSelection != r {
                updateCursorHiding(in: tv)
                lastSelection = r
            }
        }

        // MARK: - Full highlighting

        func applyHighlighting(in tv: NSTextView) {
            guard let storage = tv.textStorage else { return }
            let fullText = tv.string
            let ns = fullText as NSString
            let total = ns.length
            let cursor = tv.selectedRange()
            lastSelection = cursor
            markerRanges.removeAll()

            let baseFont = MarkdownLiveEditor.textFont
            let baseColor = MarkdownLiveEditor.textColor

            isApplyingProgrammaticChange = true
            storage.beginEditing()

            // Reset everything
            for key in [NSAttributedString.Key.font, .foregroundColor, .backgroundColor,
                        .paragraphStyle, .obliqueness, .strikethroughStyle] {
                storage.removeAttribute(key, range: NSRange(location: 0, length: total))
            }
            storage.addAttribute(.font, value: baseFont, range: NSRange(location: 0, length: total))
            storage.addAttribute(.foregroundColor, value: baseColor, range: NSRange(location: 0, length: total))

            let lines = fullText.components(separatedBy: "\n")
            var loc = 0
            var inCodeFence = false
            var inTable = false
            var tableRowIndex = 0
            var lineIdx = -1

            for line in lines {
                lineIdx += 1
                let lineLen = (line as NSString).length
                let lineRange = NSRange(location: loc, length: lineLen)
                defer { loc += lineLen + 1 }
                let trimmed = line.trimmingCharacters(in: .whitespaces)

                // Code fence
                if line.hasPrefix("```") {
                    inCodeFence.toggle()
                    markerRanges.append(lineRange)
                    let mono = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
                    storage.addAttribute(.font, value: mono, range: lineRange)
                    storage.addAttribute(.foregroundColor, value: MarkdownLiveEditor.mutedColor, range: lineRange)
                    storage.addAttribute(.backgroundColor, value: MarkdownLiveEditor.codeBg, range: lineRange)
                    continue
                }

                if inCodeFence {
                    let mono = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
                    storage.addAttribute(.font, value: mono, range: lineRange)
                    storage.addAttribute(.backgroundColor, value: MarkdownLiveEditor.codeBg, range: lineRange)
                    continue
                }

                // Table: lines starting with |, detect start when next line has -
                if trimmed.hasPrefix("|") && !inTable {
                    let nextIdx = lineIdx + 1
                    if nextIdx < lines.count && lines[nextIdx].trimmingCharacters(in: .whitespaces).hasPrefix("|") && lines[nextIdx].contains("-") {
                        inTable = true
                        tableRowIndex = 0
                    }
                }

                if inTable && trimmed.hasPrefix("|") {
                    let mono = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
                    storage.addAttribute(.font, value: mono, range: lineRange)
                    storage.addAttribute(.backgroundColor, value: MarkdownLiveEditor.codeBg, range: lineRange)
                    // Mute separator row
                    if tableRowIndex == 1 || line.replacingOccurrences(of: "|", with: "").replacingOccurrences(of: "-", with: "").replacingOccurrences(of: ":", with: "").replacingOccurrences(of: " ", with: "").isEmpty {
                        storage.addAttribute(.foregroundColor, value: MarkdownLiveEditor.mutedColor, range: lineRange)
                    }
                    tableRowIndex += 1
                    continue
                } else if inTable && !trimmed.hasPrefix("|") {
                    inTable = false
                    // Fall through to process this line normally
                }

                // Heading: # Title
                if let m = line.range(of: "^(#{1,6})\\s+", options: .regularExpression) {
                    let hashCount = line.distance(from: line.startIndex, to: m.lowerBound) + line[m].count - 1
                    let hashes = String(line[m])
                    let markerRange = ns.range(of: hashes, range: lineRange)
                    let contentStart = loc + (line.distance(from: line.startIndex, to: m.upperBound))
                    let contentRange = NSRange(location: contentStart, length: loc + lineLen - contentStart)

                    let sizes: [CGFloat] = [24, 20, 18, 16, 15, 14]
                    let fontSize = sizes[min(max(hashCount - 1, 0), 5)]
                    let headingFont = NSFont.systemFont(ofSize: fontSize, weight: .semibold)

                    markerRanges.append(markerRange)
                    dimRange(storage, range: markerRange, cursor: cursor)
                    storage.addAttribute(.font, value: headingFont, range: contentRange)
                    // Headings are same color as body text — no color coding

                    let para = NSMutableParagraphStyle()
                    para.paragraphSpacingBefore = hashCount <= 2 ? 16 : 8
                    para.paragraphSpacing = 4
                    storage.addAttribute(.paragraphStyle, value: para, range: lineRange)

                    applyInlineMarkers(storage, text: String(line[m.upperBound...]), lineStart: contentStart, cursor: cursor)
                    continue
                }

                // Blockquote: > text — Vue/ant-design style: subtle bar + faint bg
                if line.hasPrefix("> ") {
                    let barRange = NSRange(location: loc, length: 1)
                    let spaceRange = NSRange(location: loc + 1, length: 1)
                    let contentRange = NSRange(location: loc + 2, length: lineLen - 2)

                    markerRanges.append(spaceRange)
                    dimRange(storage, range: spaceRange, cursor: cursor)

                    // > as a muted thick bar character
                    storage.addAttribute(.font, value: NSFont.systemFont(ofSize: 16, weight: .bold), range: barRange)
                    storage.addAttribute(.foregroundColor, value: MarkdownLiveEditor.quoteBorder, range: barRange)

                    // Content: indented, slightly muted
                    let para = NSMutableParagraphStyle()
                    para.headIndent = 14
                    para.paragraphSpacing = 4
                    storage.addAttribute(.paragraphStyle, value: para, range: contentRange)
                    storage.addAttribute(.font, value: NSFont.systemFont(ofSize: 15, weight: .regular), range: contentRange)
                    storage.addAttribute(.foregroundColor, value: MarkdownLiveEditor.mutedColor, range: contentRange)
                    storage.addAttribute(.backgroundColor, value: MarkdownLiveEditor.quoteBg, range: lineRange)
                    applyInlineMarkers(storage, text: String(line.dropFirst(2)), lineStart: loc + 2, cursor: cursor)
                    continue
                }

                // Unordered list: - text, * text, + text
                if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") {
                    let markerRange = NSRange(location: loc, length: 2)
                    let contentStart = loc + 2
                    let para = NSMutableParagraphStyle()
                    para.headIndent = 16
                    para.paragraphSpacing = 2
                    storage.addAttribute(.paragraphStyle, value: para, range: lineRange)
                    storage.addAttribute(.foregroundColor, value: MarkdownLiveEditor.mutedColor, range: markerRange)
                    applyInlineMarkers(storage, text: String(line.dropFirst(2)), lineStart: contentStart, cursor: cursor)
                    continue
                }

                // Ordered list: 1. text
                if let m = line.range(of: "^\\d+[.)]\\s+", options: .regularExpression) {
                    let markerStr = String(line[m])
                    let markerRange = ns.range(of: markerStr, range: lineRange)
                    let contentStart = loc + (line.distance(from: line.startIndex, to: m.upperBound))

                    let para = NSMutableParagraphStyle()
                    para.headIndent = 20
                    para.paragraphSpacing = 2
                    storage.addAttribute(.paragraphStyle, value: para, range: lineRange)
                    storage.addAttribute(.font, value: NSFont.systemFont(ofSize: 15, weight: .medium), range: markerRange)
                    storage.addAttribute(.foregroundColor, value: MarkdownLiveEditor.mutedColor, range: markerRange)
                    applyInlineMarkers(storage, text: String(line[m.upperBound...]), lineStart: contentStart, cursor: cursor)
                    continue
                }

                // Horizontal rule
                if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                    storage.addAttribute(.foregroundColor, value: MarkdownLiveEditor.hairlineColor, range: lineRange)
                    continue
                }

                // Regular line
                applyInlineMarkers(storage, text: line, lineStart: loc, cursor: cursor)
            }

            storage.endEditing()
            isApplyingProgrammaticChange = false
        }

        // MARK: - Cursor-aware update (no jitter)

        func updateCursorHiding(in tv: NSTextView) {
            guard let storage = tv.textStorage else { return }
            let cursor = tv.selectedRange()
            lastSelection = cursor

            isApplyingProgrammaticChange = true
            storage.beginEditing()
            for markerRange in markerRanges {
                if isCursorNear(cursor, markerRange) {
                    storage.removeAttribute(.foregroundColor, range: markerRange)
                    storage.addAttribute(.foregroundColor, value: MarkdownLiveEditor.textColor, range: markerRange)
                } else {
                    storage.addAttribute(.foregroundColor, value: MarkdownLiveEditor.hairlineColor, range: markerRange)
                }
            }
            storage.endEditing()
            isApplyingProgrammaticChange = false
        }

        private func isCursorNear(_ cursor: NSRange, _ range: NSRange) -> Bool {
            let expanded = NSRange(location: max(0, range.location - 1), length: range.length + 2)
            return NSIntersectionRange(expanded, cursor).length > 0
                || cursor.location == range.location
                || cursor.location == range.location + range.length
        }

        // MARK: - Inline markers

        private func applyInlineMarkers(_ storage: NSTextStorage, text: String, lineStart: Int, cursor: NSRange, skipRange: NSRange? = nil) {
            applyPairedMarker(storage, text: text, lineStart: lineStart, marker: "**", cursor: cursor, skipRange: skipRange) { _ in
                NSFontManager.shared.convert(NSFont.systemFont(ofSize: 15, weight: .regular), toHaveTrait: .boldFontMask)
            }
            applyPairedMarker(storage, text: text, lineStart: lineStart, marker: "*", cursor: cursor, skipRange: skipRange, skipIfDouble: true) { _ in
                NSFontManager.shared.convert(NSFont.systemFont(ofSize: 15, weight: .regular), toHaveTrait: .italicFontMask)
            }
            applyPairedMarker(storage, text: text, lineStart: lineStart, marker: "`", cursor: cursor, skipRange: skipRange, codeBlock: true) { _ in
                NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
            }
            applyPairedMarker(storage, text: text, lineStart: lineStart, marker: "~~", cursor: cursor, skipRange: skipRange) { _ in
                NSFont.systemFont(ofSize: 15, weight: .regular)
            }
            applyStrikethrough(storage, text: text, lineStart: lineStart, cursor: cursor, skipRange: skipRange)
        }

        private func applyPairedMarker(_ storage: NSTextStorage, text: String, lineStart: Int, marker: String, cursor: NSRange, skipRange: NSRange? = nil, skipIfDouble: Bool = false, codeBlock: Bool = false, contentFont: (NSRange) -> NSFont) {
            let nsLine = text as NSString
            var searchRange = NSRange(location: 0, length: nsLine.length)

            while searchRange.length > marker.count {
                guard let firstRange = nsLine.range(of: marker, options: .literal, range: searchRange).valid,
                      firstRange.location != NSNotFound else { break }

                if skipIfDouble && marker == "*" {
                    if firstRange.location + 1 < nsLine.length {
                        let next = nsLine.substring(with: NSRange(location: firstRange.location + 1, length: 1))
                        if next == "*" {
                            searchRange = NSRange(location: firstRange.location + 2, length: searchRange.length - firstRange.location - 2)
                            continue
                        }
                    }
                    if firstRange.location > 0 {
                        let prev = nsLine.substring(with: NSRange(location: firstRange.location - 1, length: 1))
                        if prev == "*" {
                            searchRange = NSRange(location: firstRange.location + 1, length: searchRange.length - firstRange.location - 1)
                            continue
                        }
                    }
                }

                let afterFirst = NSRange(location: firstRange.location + marker.count, length: searchRange.length - firstRange.location - marker.count)
                guard let secondRange = nsLine.range(of: marker, options: .literal, range: afterFirst).valid,
                      secondRange.location != NSNotFound else { break }

                let m1 = NSRange(location: lineStart + firstRange.location, length: marker.count)
                let m2 = NSRange(location: lineStart + secondRange.location, length: marker.count)
                let content = NSRange(location: lineStart + firstRange.location + marker.count,
                                      length: secondRange.location - firstRange.location - marker.count)

                if let skip = skipRange, NSIntersectionRange(m1, skip).length > 0 {
                    searchRange = NSRange(location: secondRange.location + marker.count, length: searchRange.length - secondRange.location - marker.count)
                    continue
                }

                markerRanges.append(m1)
                markerRanges.append(m2)
                dimRange(storage, range: m1, cursor: cursor)
                dimRange(storage, range: m2, cursor: cursor)

                if content.length > 0 {
                    storage.addAttribute(.font, value: contentFont(content), range: content)
                    if codeBlock {
                        storage.addAttribute(.backgroundColor, value: MarkdownLiveEditor.codeBg, range: content)
                    }
                }

                searchRange = NSRange(location: secondRange.location + marker.count, length: searchRange.length - secondRange.location - marker.count)
            }
        }

        private func applyStrikethrough(_ storage: NSTextStorage, text: String, lineStart: Int, cursor: NSRange, skipRange: NSRange?) {
            let nsLine = text as NSString
            var searchRange = NSRange(location: 0, length: nsLine.length)
            while searchRange.length > 2 {
                guard let first = nsLine.range(of: "~~", options: .literal, range: searchRange).valid,
                      first.location != NSNotFound else { break }
                let after = NSRange(location: first.location + 2, length: searchRange.length - first.location - 2)
                guard let second = nsLine.range(of: "~~", options: .literal, range: after).valid,
                      second.location != NSNotFound else { break }
                let content = NSRange(location: lineStart + first.location + 2, length: second.location - first.location - 2)
                if content.length > 0 {
                    storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: content)
                }
                searchRange = NSRange(location: second.location + 2, length: searchRange.length - second.location - 2)
            }
        }

        private func dimRange(_ storage: NSTextStorage, range: NSRange, cursor: NSRange) {
            if isCursorNear(cursor, range) { return }
            storage.addAttribute(.foregroundColor, value: MarkdownLiveEditor.hairlineColor, range: range)
        }
    }

    // MARK: - Command execution

    /// Perform a text-mutating command on the given text view. UI-only commands
    /// (`requestLinkDialog` / `requestImagePicker`) are no-ops here; they are
    /// forwarded to the host by `updateNSView`.
    static func perform(_ cmd: EditorCommand, in tv: NSTextView) {
        switch cmd {
        case .heading(let n): toggleHeading(in: tv, level: n)
        case .bold: wrapSelection(in: tv, marker: "**")
        case .italic: wrapSelection(in: tv, marker: "*", disambiguate: true)
        case .inlineCode: wrapSelection(in: tv, marker: "`")
        case .bulletList: togglePrefix(in: tv, pattern: "^[-*+]\\s", prefix: "- ")
        case .numberedList: toggleNumbered(in: tv)
        case .checklist: togglePrefix(in: tv, pattern: "^-\\s\\[[ xX]\\]\\s", prefix: "- [ ] ")
        case .quote: togglePrefix(in: tv, pattern: "^>\\s", prefix: "> ")
        case .insertTable: insertTable(in: tv)
        case .insertImage(let path): insertImage(in: tv, path: path)
        case .insertLink(let text, let url): insertLink(in: tv, text: text, url: url)
        case .requestLinkDialog, .requestImagePicker: break
        }
    }

    private static func commit(_ tv: NSTextView) {
        tv.didChangeText()
    }

    private static func lineRanges(in tv: NSTextView, for range: NSRange) -> [NSRange] {
        let ns = tv.string as NSString
        let total = ns.length
        if total == 0 { return [NSRange(location: 0, length: 0)] }
        let start = min(range.location, total)
        let end = min(range.location + range.length, total)
        var ranges: [NSRange] = []
        var loc = start
        while loc <= end {
            let probe = min(loc, total)
            let lr = ns.lineRange(for: NSRange(location: probe, length: 0))
            ranges.append(lr)
            let next = NSMaxRange(lr)
            if next >= end || next <= loc { break }
            loc = next
        }
        if ranges.isEmpty {
            ranges.append(ns.lineRange(for: NSRange(location: start, length: 0)))
        }
        return ranges
    }

    private static func toggleHeading(in tv: NSTextView, level n: Int) {
        let ns = tv.string as NSString
        let sel = tv.selectedRange()
        let lrs = lineRanges(in: tv, for: sel)
        guard let first = lrs.first, let last = lrs.last else { return }
        let combinedRange = NSRange(location: first.location, length: NSMaxRange(last) - first.location)
        let combined = ns.substring(with: combinedRange)
        var newLines: [String] = []
        for line in combined.components(separatedBy: "\n") {
            var stripped = line
            var prevLevel = 0
            if let m = line.range(of: "^(#{1,6})\\s+", options: .regularExpression) {
                prevLevel = line[m].filter { $0 == "#" }.count
                stripped = String(line[m.upperBound...])
            }
            if n == 0 || prevLevel == n {
                newLines.append(stripped)
            } else {
                newLines.append(String(repeating: "#", count: n) + " " + stripped)
            }
        }
        let replacement = newLines.joined(separator: "\n")
        tv.replaceCharacters(in: combinedRange, with: replacement)
        let newLen = (replacement as NSString).length
        let rel = sel.location - combinedRange.location
        let newLoc = combinedRange.location + min(max(rel, 0), newLen)
        tv.setSelectedRange(NSRange(location: newLoc, length: 0))
        commit(tv)
    }

    private static func togglePrefix(in tv: NSTextView, pattern: String, prefix: String) {
        let ns = tv.string as NSString
        let sel = tv.selectedRange()
        let lrs = lineRanges(in: tv, for: sel)
        guard let first = lrs.first, let last = lrs.last else { return }
        let combinedRange = NSRange(location: first.location, length: NSMaxRange(last) - first.location)
        let combined = ns.substring(with: combinedRange)
        let lines = combined.components(separatedBy: "\n")
        let regex = (try? NSRegularExpression(pattern: pattern)) ?? NSRegularExpression()
        let allHave = lines.allSatisfy {
            regex.firstMatch(in: $0, range: NSRange(location: 0, length: ($0 as NSString).length)) != nil
        }
        var newLines: [String] = []
        for line in lines {
            let nsLine = line as NSString
            let m = regex.firstMatch(in: line, range: NSRange(location: 0, length: nsLine.length))
            if allHave {
                if let m = m {
                    newLines.append(String(line.dropFirst(m.range.length)))
                } else {
                    newLines.append(line)
                }
            } else if m != nil {
                newLines.append(line)
            } else {
                newLines.append(prefix + line)
            }
        }
        let replacement = newLines.joined(separator: "\n")
        tv.replaceCharacters(in: combinedRange, with: replacement)
        let newLen = (replacement as NSString).length
        let rel = sel.location - combinedRange.location
        let newLoc = combinedRange.location + min(max(rel, 0), newLen)
        tv.setSelectedRange(NSRange(location: newLoc, length: 0))
        commit(tv)
    }

    private static func toggleNumbered(in tv: NSTextView) {
        let ns = tv.string as NSString
        let sel = tv.selectedRange()
        let lrs = lineRanges(in: tv, for: sel)
        guard let first = lrs.first, let last = lrs.last else { return }
        let combinedRange = NSRange(location: first.location, length: NSMaxRange(last) - first.location)
        let combined = ns.substring(with: combinedRange)
        let lines = combined.components(separatedBy: "\n")
        let regex = (try? NSRegularExpression(pattern: "^\\d+\\.\\s")) ?? NSRegularExpression()
        let allHave = lines.allSatisfy {
            regex.firstMatch(in: $0, range: NSRange(location: 0, length: ($0 as NSString).length)) != nil
        }
        var newLines: [String] = []
        var idx = 1
        for line in lines {
            let nsLine = line as NSString
            let m = regex.firstMatch(in: line, range: NSRange(location: 0, length: nsLine.length))
            if allHave {
                if let m = m {
                    newLines.append(String(line.dropFirst(m.range.length)))
                } else {
                    newLines.append(line)
                }
            } else if m != nil {
                newLines.append(line)
            } else {
                newLines.append("\(idx). \(line)")
                idx += 1
            }
        }
        let replacement = newLines.joined(separator: "\n")
        tv.replaceCharacters(in: combinedRange, with: replacement)
        let newLen = (replacement as NSString).length
        let rel = sel.location - combinedRange.location
        let newLoc = combinedRange.location + min(max(rel, 0), newLen)
        tv.setSelectedRange(NSRange(location: newLoc, length: 0))
        commit(tv)
    }

    private static func wrapSelection(in tv: NSTextView, marker: String, disambiguate: Bool = false) {
        let ns = tv.string as NSString
        let sel = tv.selectedRange()
        let mLen = (marker as NSString).length
        // Toggle off if already wrapped
        if sel.length > 0 && sel.location >= mLen && NSMaxRange(sel) + mLen <= ns.length {
            let beforeRange = NSRange(location: sel.location - mLen, length: mLen)
            let afterRange = NSRange(location: NSMaxRange(sel), length: mLen)
            if ns.substring(with: beforeRange) == marker && ns.substring(with: afterRange) == marker {
                var ok = true
                if disambiguate {
                    if beforeRange.location > 0,
                       ns.substring(with: NSRange(location: beforeRange.location - 1, length: 1)) == marker { ok = false }
                    if NSMaxRange(afterRange) < ns.length,
                       ns.substring(with: NSRange(location: NSMaxRange(afterRange), length: 1)) == marker { ok = false }
                }
                if ok {
                    let inner = ns.substring(with: sel)
                    tv.replaceCharacters(in: NSRange(location: beforeRange.location, length: sel.length + 2 * mLen), with: inner)
                    tv.setSelectedRange(NSRange(location: beforeRange.location, length: (inner as NSString).length))
                    commit(tv)
                    return
                }
            }
        }
        if sel.length == 0 {
            tv.replaceCharacters(in: sel, with: marker + marker)
            tv.setSelectedRange(NSRange(location: sel.location + mLen, length: 0))
        } else {
            let selected = ns.substring(with: sel)
            tv.replaceCharacters(in: sel, with: marker + selected + marker)
            tv.setSelectedRange(NSRange(location: sel.location + mLen, length: (selected as NSString).length))
        }
        commit(tv)
    }

    private static func insertTable(in tv: NSTextView) {
        let ns = tv.string as NSString
        let sel = tv.selectedRange()
        let atLineStart = sel.location == 0
            || (sel.location > 0 && ns.substring(with: NSRange(location: sel.location - 1, length: 1)) == "\n")
        let leading = atLineStart ? "" : "\n"
        let header = "| 列1 | 列2 | 列3 | 列4 |"
        let sep = "| --- | --- | --- | --- |"
        let row = "|  |  |  |  |"
        let template = leading + header + "\n" + sep + "\n" + row + "\n" + row + "\n" + row + "\n"
        tv.replaceCharacters(in: sel, with: template)
        let prefixForCaret = leading + header + "\n" + sep + "\n| "
        let caret = sel.location + (prefixForCaret as NSString).length
        tv.setSelectedRange(NSRange(location: caret, length: 0))
        commit(tv)
    }

    private static func insertImage(in tv: NSTextView, path: String) {
        let sel = tv.selectedRange()
        let md = "![image](\(path))"
        tv.replaceCharacters(in: sel, with: md)
        tv.setSelectedRange(NSRange(location: sel.location + (md as NSString).length, length: 0))
        commit(tv)
    }

    private static func insertLink(in tv: NSTextView, text: String, url: String) {
        let ns = tv.string as NSString
        let sel = tv.selectedRange()
        let linkText = sel.length > 0 ? ns.substring(with: sel) : text
        let md = "[\(linkText)](\(url))"
        tv.replaceCharacters(in: sel, with: md)
        let textStart = sel.location + 1
        tv.setSelectedRange(NSRange(location: textStart, length: (linkText as NSString).length))
        commit(tv)
    }
}

/// NSTextView subclass that intercepts Notes-style keyboard shortcuts and
/// routes them to `EditorCommand` (text commands run inline; UI requests
/// bubble up via `onShortcut`).
final class MarkdownTextView: NSTextView {
    var onShortcut: ((EditorCommand) -> Void)?

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard mods.contains(.command), let chars = event.charactersIgnoringModifiers else {
            return super.performKeyEquivalent(with: event)
        }
        let key = chars.lowercased()
        let shift = mods.contains(.shift)
        let opt = mods.contains(.option)

        func txt(_ c: EditorCommand) -> Bool {
            MarkdownLiveEditor.perform(c, in: self)
            return true
        }
        func ui(_ c: EditorCommand) -> Bool {
            onShortcut?(c)
            return true
        }

        switch (key, shift, opt) {
        case ("b", false, false): return txt(.bold)
        case ("i", false, false): return txt(.italic)
        case ("k", false, false): return ui(.requestLinkDialog)
        case ("t", true, false): return txt(.heading(1))
        case ("h", true, false): return txt(.heading(2))
        case ("j", true, false): return txt(.heading(3))
        case ("b", true, false): return txt(.heading(0))
        case ("m", true, false): return txt(.inlineCode)
        case ("'", false, false): return txt(.quote)
        case ("7", true, false): return txt(.bulletList)
        case ("8", true, false): return txt(.bulletList)
        case ("9", true, false): return txt(.numberedList)
        case ("l", true, false): return txt(.checklist)
        case ("t", false, true): return txt(.insertTable)
        case ("a", true, false): return ui(.requestImagePicker)
        default: break
        }
        return super.performKeyEquivalent(with: event)
    }
}

private extension NSRange {
    var valid: NSRange? { location != NSNotFound ? self : nil }
}

#endif
