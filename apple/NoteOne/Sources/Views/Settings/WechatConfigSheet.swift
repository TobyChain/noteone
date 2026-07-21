import SwiftUI
import WebKit

/// 微信公众号配置页 — 内嵌 server 提供的 /wechat/ 网页（扫码登录 + 公众号订阅管理）。
struct WechatConfigSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var pageURL: URL?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("微信公众号")
                    .font(.headline)
                Spacer()
                Button("完成") { dismiss() }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.hairline).frame(height: 0.5)
            }

            if let url = pageURL {
                WechatWebView(url: url)
            } else {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("正在打开配置页…").font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 680)
        #endif
        .task {
            pageURL = await APIClient.shared.wechatConfigURL()
        }
    }
}

private struct WechatWebView {
    let url: URL

    func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.load(URLRequest(url: url))
        return webView
    }
}

#if os(macOS)
extension WechatWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView() }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#else
extension WechatWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView() }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#endif
