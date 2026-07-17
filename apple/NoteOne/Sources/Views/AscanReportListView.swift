import SwiftUI
#if os(macOS)
import AppKit
#endif

struct AscanReportListView: View {
    @State private var reports: [AscanReportMeta] = []
    @State private var selectedReportDate: String?
    @State private var reportHTML: String?
    @State private var isLoading = false
    @State private var isLoadingDetail = false
    @State private var errorMessage: String?
    @State private var readDates: Set<String> = UserDefaults.standard.readReportDates

    var body: some View {
        Group {
            if let html = reportHTML, let date = selectedReportDate {
                AscanReportDetailView(htmlContent: html, date: date) {
                    reportHTML = nil
                    selectedReportDate = nil
                }
            } else {
                reportListView
            }
        }
        .task { await loadReports() }
    }

    private var todayString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd"
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        return formatter.string(from: Date())
    }

    private var todayReports: [AscanReportMeta] {
        reports.filter { $0.date == todayString }
    }

    private var pastReports: [AscanReportMeta] {
        reports.filter { $0.date != todayString }
    }

    private var reportListView: some View {
        List {
            // 今日新知
            if !todayReports.isEmpty {
                Section {
                    ForEach(todayReports) { report in
                        reportRow(report)
                    }
                } header: {
                    Text("今日新知").font(.subheadline.bold()).foregroundStyle(Color.ink)
                }
            }

            // 往期新知
            Section {
                ForEach(pastReports) { report in
                    reportRow(report)
                }
            } header: {
                HStack {
                    Text("往期新知").font(.subheadline.bold()).foregroundStyle(Color.ink)
                    Spacer()
                    Text("\(pastReports.count)")
                        .font(.caption2)
                        .foregroundStyle(Color.inkTertiary)
                }
            }
        }
        .listStyle(.inset)
        .safeAreaInset(edge: .top) {
            HStack(spacing: DG.sp8) {
                Image(systemName: "sparkles")
                    .foregroundStyle(Color.accent)
                Text("跟闹闹说\"帮我补充今日新知\"即可运行")
                    .font(.caption)
                    .foregroundStyle(Color.inkSecondary)
                Spacer()
            }
            .padding(.horizontal, DG.sp16)
            .padding(.vertical, DG.sp8)
            .background(Color.canvasSecondary)
        }
        .overlay {
            if isLoading && reports.isEmpty {
                ProgressView("加载中…")
            } else if let err = errorMessage, reports.isEmpty {
                EmptyStateView(
                    icon: "exclamationmark.triangle",
                    title: "加载失败",
                    subtitle: err,
                    actionTitle: "重试",
                    action: { errorMessage = nil; Task { await loadReports() } }
                )
                .foregroundStyle(Color.danger)
            } else if reports.isEmpty {
                EmptyStateView(
                    icon: "globe",
                    title: "还没有新知",
                    subtitle: "跟闹闹说\"帮我补充今日新知\"\n即可生成今天的科技前沿日报"
                )
            }
        }
    }

    private func reportRow(_ report: AscanReportMeta) -> some View {
        let isRead = readDates.contains(report.date)
        return Button {
            Task { await loadReport(date: report.date) }
        } label: {
            HStack(spacing: DG.sp12) {
                // Unread indicator
                Circle()
                    .fill(isRead ? Color.clear : Color.accent)
                    .frame(width: 8, height: 8)

                VStack(alignment: .leading, spacing: DG.sp4) {
                    Text(report.formattedDate)
                        .font(.headline)
                        .foregroundStyle(Color.ink)
                    if !report.summary.isEmpty {
                        Text(report.summary)
                            .font(.caption)
                            .foregroundStyle(Color.inkTertiary)
                            .lineLimit(2)
                    }
                }

                Spacer()

                if isLoadingDetail && selectedReportDate == report.date {
                    ProgressView().scaleEffect(0.7)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            #if os(macOS)
            Button {
                Task { await revealInFinder(date: report.date) }
            } label: {
                Label("在访达中显示", systemImage: "folder")
            }
            #endif
        }
    }

    // MARK: - Actions

    private func loadReports() async {
        isLoading = true
        defer { isLoading = false }
        do {
            reports = try await APIClient.shared.listAscanReports()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadReport(date: String) async {
        isLoadingDetail = true
        defer { isLoadingDetail = false }
        do {
            let response = try await APIClient.shared.getAscanReport(date: date)
            selectedReportDate = date
            reportHTML = response.html
            errorMessage = nil
            // Mark as read
            readDates.insert(date)
            UserDefaults.standard.readReportDates = readDates
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func revealInFinder(date: String) async {
        do {
            let path = try await APIClient.shared.getAscanReportPath(date: date)
            #if os(macOS)
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            #endif
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Read/Unread Persistence

extension UserDefaults {
    private var readReportDatesKey: String { "ascanReadReportDates" }

    var readReportDates: Set<String> {
        get {
            Set(array(forKey: readReportDatesKey) as? [String] ?? [])
        }
        set {
            set(Array(newValue), forKey: readReportDatesKey)
        }
    }
}
