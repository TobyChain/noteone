import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

/// What the reader shows. Fragments get the app shell (reader.css plus the
/// theme block); pages load as-is for documents that ship their own
/// stylesheet (learn-art notes, legacy daily reports).
enum ReaderContent: Equatable {
    case fragment(title: String, body: String)
    case page(String)
}

/// The reader's two stylesheets, fetched once from the local server and kept
/// in memory: `themes.css` (all six theme blocks, generated from
/// themes.json on the server) and `reader.css` (layout rules that only
/// reference theme tokens).
@MainActor
@Observable
final class ReaderAssets {
    static let shared = ReaderAssets()

    private(set) var themesCSS: String?
    private(set) var readerCSS: String?
    private var inFlight: Task<Void, Never>?

    var isReady: Bool { themesCSS != nil && readerCSS != nil }

    /// Idempotent: concurrent callers share one fetch. A failed fetch leaves
    /// isReady false so the next reader open retries.
    func load() async {
        if isReady { return }
        if let inFlight { await inFlight.value; return }
        let task = Task {
            if let data = try? await APIClient.shared.getReaderAsset("themes.css") { themesCSS = String(decoding: data, as: UTF8.self) }
            if let data = try? await APIClient.shared.getReaderAsset("reader.css") { readerCSS = String(decoding: data, as: UTF8.self) }
        }
        inFlight = task
        await task.value
        inFlight = nil
    }
}

enum ReaderShell {
    /// Full page for a content fragment: theme block first so reader.css can
    /// resolve its tokens, then layout. Mirrors the server's `renderPage`,
    /// which uses the same two stylesheets for exported files; here
    /// data-theme pins the user's current palette.
    /// Before the assets arrive the stylesheets are empty, which only yields
    /// an unstyled page (readers gate on isReady; Copy HTML does not).
    @MainActor static func page(title: String, body: String) -> String {
        let themes = ReaderAssets.shared.themesCSS ?? ""
        let layout = ReaderAssets.shared.readerCSS ?? ""
        return """
        <!doctype html><html lang="zh-CN" data-theme="\(ThemeStore.shared.palette.id)"><head>\
        <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\
        <title>\(escapeHTML(title))</title><style>\(themes)</style><style>\(layout)</style></head>\
        <body>\(body)</body></html>
        """
    }

    private static func escapeHTML(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}

/// Owns one reader web view: content lifecycle, the highlight bridge for
/// daily reports, and external-link handling.
@MainActor
final class ReaderCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var currentContent: ReaderContent?
    private var currentThemeId: String?
    var onHighlightEvent: ((NewLoreHighlightEvent) -> Void)?
    var highlights: [NewLoreHighlight] = []
    var highlightBusy = false
    var highlightingEnabled = false
    private var documentReady = false
    private var renderedHighlights: [NewLoreHighlight]?

    /// Install the highlight bridge only for callers that enable it.
    func configuration(javaScriptEnabled: Bool, highlighting: Bool) -> WKWebViewConfiguration {
        highlightingEnabled = highlighting
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = javaScriptEnabled
        if highlighting {
            config.userContentController.add(self, name: "newLoreHighlight")
            config.userContentController.addUserScript(WKUserScript(source: NewLoreHighlightScript.source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        return config
    }

    /// Load new content, or refresh marks in place when it is unchanged.
    func update(_ webView: WKWebView, content: ReaderContent, highlights: [NewLoreHighlight], busy: Bool, event: ((NewLoreHighlightEvent) -> Void)?) {
        onHighlightEvent = event
        self.highlights = highlights
        highlightBusy = busy
        webView.pageZoom = ThemeStore.shared.textSize.pageZoom
        if currentContent != content {
            currentContent = content
            documentReady = false
            renderedHighlights = nil
            switch content {
            case .fragment(let title, let body):
                currentThemeId = ThemeStore.shared.palette.id
                webView.loadHTMLString(ReaderShell.page(title: title, body: body), baseURL: nil)
            case .page(let html):
                webView.loadHTMLString(html, baseURL: nil)
            }
        } else {
            syncTheme(webView)
            applyMarks(to: webView)
        }
    }

    /// Swap the theme without reloading: the shell carries all six theme
    /// blocks, so flipping the root attribute re-resolves every CSS variable
    /// in place and keeps the scroll position and marks.
    private func syncTheme(_ webView: WKWebView) {
        guard case .fragment = currentContent else { return }
        let id = ThemeStore.shared.palette.id
        guard id != currentThemeId else { return }
        currentThemeId = id
        webView.evaluateJavaScript("document.documentElement.dataset.theme = \(jsString(id))", completionHandler: nil)
    }

    /// Restore persisted ranges after the original report scripts finish loading.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        documentReady = true
        applyMarks(to: webView)
    }

    /// Keep the content DOM intact while replacing only formatting spans.
    private func applyMarks(to webView: WKWebView) {
        guard highlightingEnabled, documentReady else { return }
        webView.evaluateJavaScript("window.newLoreMarks?.setBusy(\(highlightBusy ? "true" : "false"))", completionHandler: nil)
        guard renderedHighlights != highlights else { return }
        do {
            let data = try JSONEncoder().encode(highlights)
            let json = String(decoding: data, as: UTF8.self)
            renderedHighlights = highlights
            webView.evaluateJavaScript("window.newLoreMarks?.render(\(json))") { [weak self] result, error in
                if error != nil { self?.renderedHighlights = nil; return }
                self?.onHighlightEvent?(.init(action: "restored", selection: nil, style: nil, ids: nil, unresolved: result as? Int))
            }
        } catch { renderedHighlights = nil }
    }

    /// Decode bridge payloads as typed selections and fragment actions.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, JSONSerialization.isValidJSONObject(message.body),
              let data = try? JSONSerialization.data(withJSONObject: message.body),
              let event = try? JSONDecoder().decode(NewLoreHighlightEvent.self, from: data) else { return }
        onHighlightEvent?(event)
    }

    /// Open HTTP links through the platform while keeping outline links inside the document.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
           url.scheme == "http" || url.scheme == "https" {
            openExternal(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    /// Send links opening a new browser window to the platform browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "http" || url.scheme == "https" { openExternal(url) }
        return nil
    }

    /// Use the existing system browser behavior for document sources.
    private func openExternal(_ url: URL) {
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #elseif os(iOS)
        UIApplication.shared.open(url)
        #endif
    }

    /// JSON-encode a string for safe interpolation into a script literal.
    private func jsString(_ text: String) -> String {
        let data = (try? JSONEncoder().encode(text)) ?? Data("\"\"".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    /// Release bridge callbacks when SwiftUI removes the reading view.
    func dismantle(_ webView: WKWebView) {
        onHighlightEvent = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "newLoreHighlight")
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }
}

#if os(iOS)
struct ReaderWebView: UIViewRepresentable {
    let content: ReaderContent
    var javaScriptEnabled = true
    var highlights: [NewLoreHighlight] = []
    var highlightingEnabled = false
    var highlightBusy = false
    var onHighlightEvent: ((NewLoreHighlightEvent) -> Void)? = nil
    var onWebViewReady: ((WKWebView) -> Void)? = nil

    func makeCoordinator() -> ReaderCoordinator { ReaderCoordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: context.coordinator.configuration(javaScriptEnabled: javaScriptEnabled, highlighting: highlightingEnabled))
        webView.isOpaque = false
        webView.backgroundColor = UIColor(ThemeStore.shared.palette.canvas)
        webView.scrollView.backgroundColor = UIColor(ThemeStore.shared.palette.canvas)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        onWebViewReady?(webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        webView.backgroundColor = UIColor(ThemeStore.shared.palette.canvas)
        webView.scrollView.backgroundColor = UIColor(ThemeStore.shared.palette.canvas)
        context.coordinator.update(webView, content: content, highlights: highlights, busy: highlightBusy, event: onHighlightEvent)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: ReaderCoordinator) { coordinator.dismantle(webView) }
}
#elseif os(macOS)
struct ReaderWebView: NSViewRepresentable {
    let content: ReaderContent
    var javaScriptEnabled = true
    var highlights: [NewLoreHighlight] = []
    var highlightingEnabled = false
    var highlightBusy = false
    var onHighlightEvent: ((NewLoreHighlightEvent) -> Void)? = nil
    var onWebViewReady: ((WKWebView) -> Void)? = nil

    func makeCoordinator() -> ReaderCoordinator { ReaderCoordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: context.coordinator.configuration(javaScriptEnabled: javaScriptEnabled, highlighting: highlightingEnabled))
        // Transparent so the theme canvas underneath shows through.
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        onWebViewReady?(webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.update(webView, content: content, highlights: highlights, busy: highlightBusy, event: onHighlightEvent)
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: ReaderCoordinator) { coordinator.dismantle(webView) }
}
#endif
