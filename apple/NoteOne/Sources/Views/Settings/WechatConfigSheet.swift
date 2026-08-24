import SwiftUI
import WebKit

/// 微信公众号配置页 — 内嵌 server 提供的 /wechat/ 网页（扫码登录 + 公众号订阅管理）。
struct WechatConfigSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var pageURL: URL?
    @State private var health: WechatHealthResponse?
    @State private var reloadTrigger = 0
    @State private var loadError: String?

    /// Parses the `expiresAt` string from the health response into a Date.
    private var expiryDate: Date? {
        guard let raw = health?.expiresAt, !raw.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return withFraction.date(from: raw) ?? plain.date(from: raw)
    }

    /// True when the session has already expired.
    private var sessionExpired: Bool {
        guard let expiry = expiryDate else { return health?.status == "auth_expired" }
        return expiry <= Date()
    }

    /// True when the session will expire within 24 hours.
    private var sessionExpiringSoon: Bool {
        guard let expiry = expiryDate else { return false }
        let interval = expiry.timeIntervalSinceNow
        return interval > 0 && interval < 24 * 3600
    }

    private var showWarning: Bool {
        sessionExpired || sessionExpiringSoon
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(L("微信公众号", "WeChat Official Account"))
                    .font(.headline)
                Spacer()
                Button(L("完成", "Done")) { dismiss() }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.hairline).frame(height: 0.5)
            }

            if showWarning {
                expiryWarningBanner
            }

            if let url = pageURL {
                WechatWebView(url: url)
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
                        Task { await loadConfigURL() }
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
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 680)
        #endif
        .task {
            await loadConfigURL()
            await refreshHealth()
        }
    }

    // MARK: - Config URL

    private func loadConfigURL() async {
        let url = await APIClient.shared.wechatConfigURL()
        await MainActor.run {
            if let url {
                pageURL = url
                loadError = nil
            } else {
                loadError = L("无法获取配置页地址，请检查网络或重新登录", "Unable to get config page URL, please check network or re-login")
            }
        }
    }

    // MARK: - Expiry warning banner

    @ViewBuilder
    private var expiryWarningBanner: some View {
        HStack(spacing: DG.sp8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.warning)
            Text(sessionExpired
                 ? L("微信公众号会话已过期，请重新扫码登录",
                     "WeChat session expired, please re-scan QR code to login")
                 : L("微信公众号会话即将过期，请尽快重新扫码登录",
                     "WeChat session expiring soon, please re-scan QR code to login"))
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
            Spacer()
            Button(L("重新登录", "Re-login")) {
                reloadTrigger += 1
                pageURL = nil
                loadError = nil
                Task {
                    await loadConfigURL()
                    try? await Task.sleep(for: .seconds(3))
                    await refreshHealth()
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color.warning.opacity(0.1))
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.warning.opacity(0.2)).frame(height: 0.5)
        }
    }

    // MARK: - Health

    private func refreshHealth() async {
        do {
            health = try await APIClient.shared.getWechatHealth()
        } catch {
            health = nil
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
