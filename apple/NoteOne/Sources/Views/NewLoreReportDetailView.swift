import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

private enum NewLoreHighlightOperation {
    case load
    case save(NewLoreHighlightRequest)
    case capture(NewLoreHighlightRequest)
    case quick(String)
    case remove([String])
}

struct NewLoreReportDetailView: View {
    /// Report body fragment from the server; the reader wraps it in the app shell.
    let htmlContent: String
    let date: String
    let onBack: () -> Void

    private var reportTitle: String { L("新知", "NewLore") + "-\(date)" }

    @State private var webView: WKWebView?
    @State private var highlights: [NewLoreHighlight] = []
    @State private var selection: NewLoreHighlightSelection?
    @State private var loading = true
    @State private var busy = false
    @State private var message: String?
    @State private var failedOperation: NewLoreHighlightOperation?
    @State private var generation = UUID()
    @State private var unresolvedCount = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left").foregroundStyle(Color.inkTertiary)
                }
                Spacer()
                Text(reportTitle)
                    .font(.headline).foregroundStyle(Color.ink)
                Spacer()
                Button(action: captureSelection) {
                    Image(systemName: "square.and.arrow.down.on.rectangle").foregroundStyle(Color.inkTertiary)
                }
                .disabled(loading || busy)
                .help(L("快记选中片段", "Quick note selected excerpt"))
                Button {
                    let page = ReaderShell.page(title: reportTitle, body: htmlContent)
                    #if os(macOS)
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(page, forType: .html)
                    #elseif os(iOS)
                    UIPasteboard.general.string = page
                    #endif
                } label: {
                    Image(systemName: "doc.on.doc").foregroundStyle(Color.inkTertiary)
                }
                .help(L("复制 HTML", "Copy HTML"))
            }
            .padding(.horizontal, DG.sp16)
            .padding(.vertical, DG.sp8)
            .background(Color.canvas)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.hairline).frame(height: 0.5)
            }

            if ReaderAssets.shared.isReady {
                ReaderWebView(content: .fragment(title: reportTitle, body: htmlContent), highlights: highlights,
                              highlightingEnabled: true, highlightBusy: loading || busy,
                              onHighlightEvent: handleEvent) { webView = $0 }
                    .safeAreaInset(edge: .bottom, spacing: 0) { highlightControls }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .task { await ReaderAssets.shared.load() }
            }
        }
        .navigationBarBackButtonHidden(true)
        .task(id: date) {
            generation = UUID()
            highlights = []
            selection = nil
            unresolvedCount = 0
            message = nil
            failedOperation = nil
            loading = true
            busy = false
            await perform(.load, for: generation)
        }
        .onDisappear { generation = UUID() }
    }

    @ViewBuilder
    private var highlightControls: some View {
        if loading || busy || selection != nil || message != nil || unresolvedCount > 0 {
            VStack(alignment: .leading, spacing: DG.sp8) {
                if let selected = selection {
                    HStack(spacing: DG.sp16) {
                        ForEach(NewLoreHighlightStyle.allCases, id: \.self) { style in
                            Button(style.label) { start(.save(.init(selection: selected, style: style))) }
                        }
                        Spacer(minLength: 0)
                        Button(L("快记", "Quick note")) { start(.capture(.init(selection: selected, style: .highlight))) }
                    }
                    .font(.callout)
                    .disabled(loading || busy)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(L("选中文字格式", "Selected text formatting"))
                }
                if loading || busy {
                    HStack(spacing: DG.sp8) {
                        ProgressView().controlSize(.small)
                        Text(loading ? L("正在恢复标注…", "Restoring marks…") : L("正在保存…", "Saving…"))
                            .font(.caption).foregroundStyle(Color.inkSecondary)
                    }
                } else if let message {
                    HStack(spacing: DG.sp8) {
                        Text(message).font(.caption).foregroundStyle(failedOperation == nil ? Color.inkSecondary : Color.danger)
                        Spacer(minLength: 0)
                        if let failedOperation {
                            Button(L("重试", "Retry")) { start(failedOperation) }.font(.caption)
                        }
                        Button {
                            self.message = nil
                            failedOperation = nil
                        } label: { Image(systemName: "xmark") }
                        .help(L("关闭提示", "Dismiss message"))
                    }
                }
                if unresolvedCount > 0 {
                    Text(L("原文已变更，\(unresolvedCount) 个片段待定位", "The source changed; \(unresolvedCount) excerpts need a matching location"))
                        .font(.caption).foregroundStyle(Color.warning)
                }
            }
            .padding(.horizontal, DG.sp16)
            .padding(.vertical, DG.sp8)
            .background(Color.canvasSecondary)
        }
    }

    /// Preserve the selected locations before native toolbar focus changes the selection.
    private func captureSelection() {
        if let selection { start(.capture(.init(selection: selection, style: .highlight))); return }
        let current = generation
        webView?.evaluateJavaScript("window.newLoreMarks?.readSelection()") { result, error in
            guard current == generation else { return }
            if let error { message = error.localizedDescription; return }
            guard let result, JSONSerialization.isValidJSONObject(result),
                  let data = try? JSONSerialization.data(withJSONObject: result),
                  let selected = try? JSONDecoder().decode(NewLoreHighlightSelection.self, from: data) else {
                message = L("请先在日报中选中文字", "Select text in the report first")
                return
            }
            start(.capture(.init(selection: selected, style: .highlight)))
        }
    }

    /// Receive actions only from this report's installed formatting bridge.
    private func handleEvent(_ event: NewLoreHighlightEvent) {
        switch event.action {
        case "selection": selection = event.selection
        case "restored": unresolvedCount = event.unresolved ?? 0
        case "save":
            if let selected = event.selection, let style = event.style {
                selection = selected
                start(.save(.init(selection: selected, style: style)))
            }
        case "copy":
            guard let id = event.ids?.first, let highlight = highlights.first(where: { $0.id == id }) else { return }
            #if os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(highlight.text, forType: .string)
            #elseif os(iOS)
            UIPasteboard.general.string = highlight.text
            #endif
            message = L("片段已复制", "Excerpt copied")
        case "quick":
            if let id = event.ids?.first { start(.quick(id)) }
        case "remove":
            if let ids = event.ids, !ids.isEmpty { start(.remove(ids)) }
        default: break
        }
    }

    /// Serialize mutations and retain the exact operation when a network request fails.
    private func start(_ operation: NewLoreHighlightOperation) {
        guard !busy else { return }
        let current = generation
        busy = true
        Task { await perform(operation, for: current) }
    }

    /// Apply successful server state without reloading HTML or changing the scroll position.
    private func perform(_ operation: NewLoreHighlightOperation, for current: UUID) async {
        guard current == generation else { return }
        let reportDate = date
        busy = true
        failedOperation = nil
        message = nil
        do {
            let response: NewLoreHighlightsResponse
            let success: String?
            switch operation {
            case .load:
                response = try await APIClient.shared.getNewLoreHighlights(date: reportDate)
                success = nil
            case .save(let request):
                response = try await APIClient.shared.saveNewLoreHighlight(date: reportDate, request: request)
                success = request.style.label + L("已保存", " saved")
            case .capture(let request):
                let saved = try await APIClient.shared.saveNewLoreHighlight(date: reportDate, request: request)
                guard current == generation else { return }
                highlights = saved.highlights
                guard let id = saved.highlight?.id else { throw APIError.decodingError(CocoaError(.coderReadCorrupt)) }
                response = try await APIClient.shared.quickNoteNewLoreHighlight(date: reportDate, id: id)
                success = L("已保存到往事", "Saved to OldEcho")
            case .quick(let id):
                response = try await APIClient.shared.quickNoteNewLoreHighlight(date: reportDate, id: id)
                success = L("已保存到往事", "Saved to OldEcho")
            case .remove(let ids):
                var last: NewLoreHighlightsResponse?
                for id in ids {
                    last = try await APIClient.shared.cancelNewLoreHighlight(date: reportDate, id: id)
                    guard current == generation else { return }
                    highlights = last!.highlights
                }
                guard let last else { return }
                response = last
                success = L("格式已取消", "Formatting removed")
            }
            guard current == generation else { return }
            highlights = response.highlights
            loading = false
            message = success
            if case .load = operation {} else {
                selection = nil
                webView?.evaluateJavaScript("window.newLoreMarks?.clearSelection()", completionHandler: nil)
            }
            switch operation {
            case .capture, .quick:
                NotificationCenter.default.post(name: .noteCreated, object: nil)
            default: break
            }
        } catch {
            guard current == generation else { return }
            loading = false
            failedOperation = operation
            message = L("保存失败：", "Save failed: ") + error.localizedDescription
            if case .load = operation { message = L("标注读取失败：", "Could not load marks: ") + error.localizedDescription }
        }
        guard current == generation else { return }
        busy = false
    }
}
