import SwiftUI

struct AscanReportListView: View {
    @State private var reports: [AscanReportMeta] = []
    @State private var selectedReportDate: String?
    @State private var reportHTML: String?
    @State private var isLoading = false
    @State private var isLoadingDetail = false
    @State private var isTriggering = false
    @State private var errorMessage: String?
    @State private var triggerMessage: String?

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

    private var reportListView: some View {
        VStack(spacing: 0) {
            triggerCard

            if isLoading && reports.isEmpty {
                Spacer()
                ProgressView("加载中…")
                Spacer()
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
                    title: "还没有日报",
                    subtitle: "点击上方按钮运行 Ascan pipeline\n生成今天的科技前沿日报"
                )
            } else {
                List {
                    Section {
                        ForEach(reports) { report in
                            Button {
                                Task { await loadReport(date: report.date) }
                            } label: {
                                reportRow(report)
                            }
                            .listRowInsets(EdgeInsets(top: DG.sp8, leading: DG.sp16, bottom: DG.sp8, trailing: DG.sp16))
                        }
                    } header: {
                        HStack {
                            Text("历史日报")
                            Spacer()
                            Text("\(reports.count) 篇")
                                .font(.caption2)
                                .foregroundStyle(Color.inkTertiary)
                        }
                        .sectionHeaderStyle()
                    }
                }
                .listStyle(.inset)
            }
        }
    }

    private var triggerCard: some View {
        VStack(spacing: DG.sp12) {
            HStack(spacing: DG.sp12) {
                Image(systemName: "globe")
                    .font(.system(size: DG.iconXL))
                    .foregroundStyle(Color.accent)
                    .frame(width: 44, height: 44)
                    .background(Color.accent.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: DG.r12))

                VStack(alignment: .leading, spacing: DG.sp4) {
                    Text("Ascan 科技日报")
                        .font(.headline)
                        .foregroundStyle(Color.ink)
                    Text("arXiv · GitHub · 官方动态 · 博客 · 会议论文 · 微信")
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                        .lineLimit(1)
                }

                Spacer()

                Button {
                    Task { await triggerRun() }
                } label: {
                    HStack(spacing: DG.sp4) {
                        if isTriggering {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "play.fill")
                        }
                        Text(isTriggering ? "运行中" : "运行")
                            .fontWeight(.medium)
                    }
                    .padding(.horizontal, DG.sp16)
                    .padding(.vertical, DG.sp8)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isTriggering)
            }

            if let msg = triggerMessage {
                HStack(spacing: DG.sp4) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.success)
                    Text(msg)
                }
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let err = errorMessage {
                HStack(spacing: DG.sp4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.danger)
                    Text(err)
                }
                .font(.caption)
                .foregroundStyle(Color.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(DG.sp16)
        .background(Color.canvasSecondary)
    }

    private func reportRow(_ report: AscanReportMeta) -> some View {
        HStack(spacing: DG.sp12) {
            // Date block
            VStack(spacing: 0) {
                Text(String(report.date.prefix(4)))
                    .font(.caption2)
                    .foregroundStyle(Color.inkTertiary)
                Text(String(report.date.suffix(4).prefix(2)))
                    .font(.title3.bold())
                    .foregroundStyle(Color.accent)
                Text(String(report.date.suffix(2)))
                    .font(.caption2)
                    .foregroundStyle(Color.inkTertiary)
            }
            .frame(width: 44)
            .padding(.vertical, DG.sp4)

            Divider()
                .frame(height: 36)

            // Info
            VStack(alignment: .leading, spacing: DG.sp4) {
                Text("Ascan 日报")
                    .font(.subheadline)
                    .foregroundStyle(Color.ink)
                HStack(spacing: DG.sp8) {
                    Label(report.formattedSize, systemImage: "doc.text")
                        .font(.caption)
                        .foregroundStyle(Color.inkTertiary)
                    if report.hasMarkdown {
                        TagPill(text: "MD", color: Color.tagModule)
                    }
                }
            }

            Spacer()

            if isLoadingDetail && selectedReportDate == report.date {
                ProgressView()
                    .scaleEffect(0.7)
            } else {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(Color.inkTertiary)
            }
        }
        .contentShape(Rectangle())
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
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func triggerRun() async {
        isTriggering = true
        triggerMessage = nil
        errorMessage = nil
        defer { isTriggering = false }
        do {
            let result = try await APIClient.shared.triggerAscan(date: nil)
            triggerMessage = result.message
            try? await Task.sleep(for: .seconds(3))
            await loadReports()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
