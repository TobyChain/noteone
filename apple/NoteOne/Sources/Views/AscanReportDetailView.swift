import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#endif
#if os(iOS)
import UIKit
#endif

private enum AddToNotesState: Equatable {
    case idle
    case saving
    case success
    case failed(String)
    case noSelection
}

struct AscanReportDetailView: View {
    let htmlContent: String
    let date: String
    let onBack: () -> Void

    @State private var webView: WKWebView?
    @State private var addToNotesState: AddToNotesState = .idle

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    onBack()
                } label: {
                    Image(systemName: "chevron.left")
                        .foregroundStyle(Color.inkTertiary)
                }
                Spacer()
                Text(L("新知", "NewSee") + "-\(date)")
                    .font(.headline)
                    .foregroundStyle(Color.ink)
                Spacer()
                Button {
                    addToNotes()
                } label: {
                    Image(systemName: "square.and.arrow.down.on.rectangle")
                        .foregroundStyle(Color.inkTertiary)
                }
                .help(L("添加到往事", "Add to OldScene"))
                Button {
                    #if os(macOS)
                    let pasteboard = NSPasteboard.general
                    pasteboard.clearContents()
                    pasteboard.setString(htmlContent, forType: .html)
                    #elseif os(iOS)
                    UIPasteboard.general.string = htmlContent
                    #endif
                } label: {
                    Image(systemName: "doc.on.doc")
                        .foregroundStyle(Color.inkTertiary)
                }
                .help(L("复制 HTML", "Copy HTML"))
            }
            .padding(.horizontal, DG.sp16)
            .padding(.vertical, DG.sp8)
            #if os(iOS)
            .background(Color(.systemBackground))
            #else
            .background(Color(nsColor: .textBackgroundColor))
            #endif
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(Color.hairline)
                    .frame(height: 0.5)
            }

            AscanWebView(htmlContent: htmlContent) { wv in
                webView = wv
            }
            .overlay(alignment: .bottom) {
                if addToNotesState != .idle {
                    addToNotesBanner
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .navigationBarBackButtonHidden(true)
    }

    @ViewBuilder
    private var addToNotesBanner: some View {
        let (icon, text, color): (String, String, Color) = {
            switch addToNotesState {
            case .saving: return ("arrow.2.circle", L("正在保存到往事…", "Saving to OldScene…"), Color.accent)
            case .success: return ("checkmark.circle.fill", L("已添加到往事", "Added to OldScene"), Color.success)
            case .noSelection: return ("exclamationmark.triangle", L("请先在日报中选中文本", "Please select text in the report first"), Color.warning)
            case .failed(let msg): return ("xmark.circle.fill", L("保存失败: ", "Save failed: ") + msg, Color.danger)
            default: return ("", "", .clear)
            }
        }()
        HStack(spacing: DG.sp8) {
            if addToNotesState == .saving {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: icon).foregroundStyle(color)
            }
            Text(text).font(.caption).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, DG.sp16)
        .padding(.vertical, DG.sp8)
        .background(.ultraThinMaterial)
    }

    private func addToNotes() {
        guard let wv = webView else { return }
        addToNotesState = .saving
        wv.evaluateJavaScript("window.getSelection().toString()") { result, _ in
            let selectedText = (result as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            DispatchQueue.main.async {
                if selectedText.isEmpty {
                    addToNotesState = .noSelection
                    scheduleReset()
                    return
                }
                Task {
                    do {
                        let request = CreateNoteRequest(
                            content: selectedText,
                            sourceApp: "新知"
                        )
                        _ = try await APIClient.shared.createNote(request)
                        await MainActor.run {
                            addToNotesState = .success
                            NotificationCenter.default.post(name: .noteCreated, object: nil)
                            scheduleReset()
                        }
                    } catch {
                        await MainActor.run {
                            addToNotesState = .failed(error.localizedDescription)
                            scheduleReset()
                        }
                    }
                }
            }
        }
    }

    private func scheduleReset() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            withAnimation { addToNotesState = .idle }
        }
    }
}

// MARK: - WKWebView with JavaScript enabled (for TOC scroll-spy + text selection)

#if os(iOS)
struct AscanWebView: UIViewRepresentable {
    let htmlContent: String
    var onWebViewReady: ((WKWebView) -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        onWebViewReady?(webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.currentHTML != htmlContent else { return }
        context.coordinator.currentHTML = htmlContent
        webView.loadHTMLString(htmlContent, baseURL: nil)
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var currentHTML: String?

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
               url.scheme == "http" || url.scheme == "https" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url, url.scheme == "http" || url.scheme == "https" {
                UIApplication.shared.open(url)
            }
            return nil
        }
    }
}
#elseif os(macOS)
struct AscanWebView: NSViewRepresentable {
    let htmlContent: String
    var onWebViewReady: ((WKWebView) -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        onWebViewReady?(webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.currentHTML != htmlContent else { return }
        context.coordinator.currentHTML = htmlContent
        webView.loadHTMLString(htmlContent, baseURL: nil)
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var currentHTML: String?

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
               url.scheme == "http" || url.scheme == "https" {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url, url.scheme == "http" || url.scheme == "https" {
                NSWorkspace.shared.open(url)
            }
            return nil
        }
    }
}
#endif
