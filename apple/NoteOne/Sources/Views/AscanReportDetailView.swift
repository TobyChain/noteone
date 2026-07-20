import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#endif
#if os(iOS)
import UIKit
#endif

struct AscanReportDetailView: View {
    let htmlContent: String
    let date: String
    let onBack: () -> Void

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
                Text("新知-\(date)")
                    .font(.headline)
                    .foregroundStyle(Color.ink)
                Spacer()
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

            AscanWebView(htmlContent: htmlContent)
        }
        .navigationBarBackButtonHidden(true)
    }
}

// MARK: - WKWebView with JavaScript enabled (for TOC scroll-spy)

#if os(iOS)
struct AscanWebView: UIViewRepresentable {
    let htmlContent: String

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
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.currentHTML != htmlContent else { return }
        context.coordinator.currentHTML = htmlContent
        webView.loadHTMLString(htmlContent, baseURL: nil)
    }

    class Coordinator: NSObject, WKNavigationDelegate {
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
    }
}
#elseif os(macOS)
struct AscanWebView: NSViewRepresentable {
    let htmlContent: String

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.currentHTML != htmlContent else { return }
        context.coordinator.currentHTML = htmlContent
        webView.loadHTMLString(htmlContent, baseURL: nil)
    }

    class Coordinator: NSObject, WKNavigationDelegate {
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
    }
}
#endif
