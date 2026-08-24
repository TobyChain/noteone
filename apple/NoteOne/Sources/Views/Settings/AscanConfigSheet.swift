import SwiftUI
import WebKit

/// 新知配置 Web 内容 — 内嵌 server 提供的 /ascan/ 网页（模块开关、信息源、各模块参数）。
/// 设置页弹窗（AscanConfigSheet）与新知标签页（AscanView）共用。
struct AscanConfigWebContent: View {
    @State private var pageURL: URL?
    @State private var loadError: String?
    @State private var reloadTrigger = 0

    var body: some View {
        Group {
            if let url = pageURL {
                AscanConfigWebView(url: url)
                    .id(reloadTrigger)
            } else if let loadError = loadError {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.title)
                        .foregroundStyle(Color.danger)
                    Text(L("配置页加载失败", "Failed to load config page"))
                        .font(.subheadline)
                        .foregroundStyle(Color.inkSecondary)
                    Text(loadError)
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                    Button(L("重试", "Retry")) {
                        self.loadError = nil
                        loadURL()
                    }
                    .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 8) {
                    ProgressView()
                    Text(L("正在打开配置页…", "Opening config page…"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { loadURL() }
    }

    private func loadURL() {
        if let url = APIClient.shared.ascanConfigURL() {
            pageURL = url
            loadError = nil
        } else {
            loadError = L("无法获取配置页地址，请检查网络或重新登录", "Unable to get config page URL, please check network or re-login")
        }
    }
}

/// 新知配置弹窗 — 头部 + AscanConfigWebContent。
struct AscanConfigSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(L("新知配置", "NewSee Config"))
                    .font(.headline)
                Spacer()
                Button(L("完成", "Done")) { dismiss() }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.hairline).frame(height: 0.5)
            }

            AscanConfigWebContent()
        }
        #if os(macOS)
        .frame(minWidth: 600, minHeight: 720)
        #endif
    }
}

private struct AscanConfigWebView {
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
extension AscanConfigWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView() }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#else
extension AscanConfigWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView() }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#endif
