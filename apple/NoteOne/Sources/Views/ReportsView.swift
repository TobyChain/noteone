import SwiftUI
import WebKit

struct ReportsView: View {
    @State private var reports: [DailyReport] = []
    @State private var selectedReport: DailyReport?
    @State private var isLoading = false
    @State private var isGenerating = false
    @State private var errorMessage: String?
    @State private var selectedStyle = UserDefaults.standard.reportStyle
    @State private var selectedDepth = UserDefaults.standard.reportDepth

    var body: some View {
        Group {
            if let report = selectedReport {
                ReportDetailView(report: report) {
                    selectedReport = nil
                }
            } else {
                reportListView
            }
        }
        .navigationTitle(L("每日报告", "Daily Report"))
        .task {
            await loadReports()
        }
    }

    private var reportListView: some View {
        VStack(spacing: 0) {
            // Generate today's report card
            generateCard

            // Report list
            if isLoading && reports.isEmpty {
                Spacer()
                ProgressView(L("加载中…", "Loading…"))
                Spacer()
            } else if reports.isEmpty {
                Spacer()
                VStack(spacing: 12) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary)
                    Text(L("还没有报告", "No reports yet"))
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text(L("点击上方按钮生成今天的灵感报告", "Tap the button above to generate today's inspiration report"))
                        .font(.subheadline)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
            } else {
                List {
                    Section(L("历史报告", "History")) {
                        ForEach(reports) { report in
                            Button {
                                selectedReport = report
                            } label: {
                                reportRow(report)
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    Task { await deleteReport(report) }
                                } label: {
                                    Label(L("删除", "Delete"), systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private var generateCard: some View {
        VStack(spacing: 16) {
            // Style picker
            HStack {
                Text(L("风格", "Style"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Picker(L("风格", "Style"), selection: $selectedStyle) {
                    ForEach(ReportStyle.allCases, id: \.self) { style in
                        Label(style.displayName, systemImage: style.icon).tag(style)
                    }
                }
                .pickerStyle(.menu)
            }

            // Depth picker
            HStack {
                Text(L("深度", "Depth"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Picker(L("深度", "Depth"), selection: $selectedDepth) {
                    ForEach(ReportDepth.allCases, id: \.self) { depth in
                        Text("\(depth.displayName) · \(depth.description)").tag(depth)
                    }
                }
                .pickerStyle(.menu)
            }

            // Generate button
            Button {
                Task { await generateTodayReport() }
            } label: {
                HStack {
                    if isGenerating {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: "sparkles")
                    }
                    Text(isGenerating ? L("闹闹正在生成…", "Notty is generating…") : L("生成今日报告", "Generate Today's Report"))
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isGenerating)
        }
        .padding()
        #if os(iOS)
        .background(Color(.systemGroupedBackground))
        #else
        .background(Color(nsColor: .windowBackgroundColor))
        #endif
        .onChange(of: selectedStyle) { _, new in UserDefaults.standard.reportStyle = new }
        .onChange(of: selectedDepth) { _, new in UserDefaults.standard.reportDepth = new }
    }

    private func reportRow(_ report: DailyReport) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(report.date)
                    .font(.headline)
                HStack(spacing: 8) {
                    Label(report.style.displayName, systemImage: report.style.icon)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Label(report.depth.displayName, systemImage: "text.magnifyingglass")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if report.status == .failed {
                    Text(L("生成失败", "Generation Failed"))
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .foregroundStyle(.tertiary)
        }
    }

    // MARK: - Actions

    private func loadReports() async {
        isLoading = true
        defer { isLoading = false }
        do {
            reports = try await APIClient.shared.listReports()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func generateTodayReport() async {
        isGenerating = true
        defer { isGenerating = false }
        do {
            let today = todayString()
            let report = try await APIClient.shared.generateDailyReport(
                date: today,
                style: selectedStyle,
                depth: selectedDepth
            )
            if report.status == .completed {
                selectedReport = report
            }
            await loadReports()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteReport(_ report: DailyReport) async {
        do {
            try await APIClient.shared.deleteReport(id: report.id)
            reports.removeAll { $0.id == report.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func todayString() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        return formatter.string(from: Date())
    }
}

// MARK: - Report Detail View (WKWebView)

struct ReportDetailView: View {
    let report: DailyReport
    let onBack: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Top bar
            HStack {
                Button {
                    onBack()
                } label: {
                    Image(systemName: "chevron.left")
                }
                Spacer()
                Text(report.date)
                    .font(.headline)
                Spacer()
                // Share button placeholder
                Button {
                    // TODO: share HTML
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .disabled(true)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            #if os(iOS)
            .background(Color(.systemBackground))
            #else
            .background(Color(nsColor: .textBackgroundColor))
            #endif

            if let html = report.htmlContent {
                #if os(iOS)
                WebView(htmlContent: html)
                #elseif os(macOS)
                WebViewMac(htmlContent: html)
                #endif
            } else {
                Spacer()
                VStack(spacing: 12) {
                    if report.status == .generating {
                        ProgressView()
                        Text(L("闹闹正在生成报告…", "Notty is generating report…"))
                            .foregroundStyle(.secondary)
                    } else if report.status == .failed {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundStyle(.red)
                        Text(L("生成失败", "Generation Failed"))
                            .font(.headline)
                        if let err = report.errorMessage {
                            Text(err)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer()
            }
        }
        .navigationBarBackButtonHidden(true)
    }
}

// MARK: - WKWebView Wrapper
#if os(iOS)
struct WebView: UIViewRepresentable {
    let htmlContent: String

    func makeCoordinator() -> ExternalLinkCoordinator { ExternalLinkCoordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        webView.navigationDelegate = context.coordinator
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        webView.loadHTMLString(htmlContent, baseURL: nil)
    }
}
#endif

// MARK: - macOS WebView variant
#if os(macOS)
struct WebViewMac: NSViewRepresentable {
    let htmlContent: String

    func makeCoordinator() -> ExternalLinkCoordinator { ExternalLinkCoordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        webView.loadHTMLString(htmlContent, baseURL: nil)
    }
}
#endif

class ExternalLinkCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url,
           url.scheme == "http" || url.scheme == "https" {
            #if os(macOS)
            NSWorkspace.shared.open(url)
            #else
            UIApplication.shared.open(url)
            #endif
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "http" || url.scheme == "https" {
            #if os(macOS)
            NSWorkspace.shared.open(url)
            #else
            UIApplication.shared.open(url)
            #endif
        }
        return nil
    }
}
