import SwiftUI
#if os(macOS)
import AppKit
#endif

enum SidebarSelection: Hashable {
    case note(String)
    case trash
    case newloreReports
    case newloreReport(String)
    case newloreConfig
    case farView
    case empty
}

struct MainSidebar: View {
    @Binding var selection: SidebarSelection
    @Binding var notes: [Note]
    @Binding var newloreReports: [NewLoreReportMeta]

    var onCreateNote: () -> Void
    var onRefresh: () async -> Void
    var onDeleteNote: (Note) -> Void
    var onSearch: (String) async -> Void
    var onLoadMore: () async -> Void
    var hasMoreNotes: Bool
    var isLoadingMore: Bool
    var onShowTrash: () -> Void
    var onShowConfig: () -> Void
    var onDeleteNewLoreReport: (String) -> Void

    @State private var searchText = ""
    @State private var filterType: ContentType?
    @State private var isNotesExpanded = true
    @State private var isNewLoreExpanded = true
    @State private var collapsedDateGroups: Set<String> = ["本月", "更早"]
    @State private var collapsedNewLoreGroups: Set<String> = ["更早"]
    @State private var isNewLoreRunning = false
    @State private var newloreRunningStatus: String?
    @State private var newloreTimer: Timer?

    private var filteredNotes: [Note] {
        guard let filter = filterType else { return notes }
        return notes.filter { $0.contentType == filter }
    }

    private var todayString: String {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd"
        f.timeZone = .current
        return f.string(from: Date())
    }

    private var groupedNewLoreReports: [(String, [NewLoreReportMeta])] {
        let cal = Calendar.current
        let now = Date()
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd"
        f.timeZone = .current
        var groups: [String: [NewLoreReportMeta]] = [:]
        let order = ["今日", "昨日", "本月", "更早"]

        for r in newloreReports {
            guard let d = f.date(from: r.date) else { continue }
            let key: String
            if cal.isDateInToday(d) { key = "今日" }
            else if cal.isDateInYesterday(d) { key = "昨日" }
            else if let monthAgo = cal.date(byAdding: .month, value: -1, to: now), d >= monthAgo { key = "本月" }
            else { key = "更早" }
            groups[key, default: []].append(r)
        }
        return order.compactMap { key in
            guard let rs = groups[key], !rs.isEmpty else { return nil }
            return (key, rs)
        }
    }

    private var groupedNotes: [(String, [Note])] {
        let calendar = Calendar.current
        let now = Date()
        var groups: [String: [Note]] = [:]
        let order = ["今日", "昨日", "本周", "本月", "更早"]

        for note in filteredNotes {
            let key: String
            if calendar.isDateInToday(note.createdAt) {
                key = "今日"
            } else if calendar.isDateInYesterday(note.createdAt) {
                key = "昨日"
            } else if let weekAgo = calendar.date(byAdding: .day, value: -7, to: now),
                      note.createdAt >= weekAgo {
                key = "本周"
            } else if let monthAgo = calendar.date(byAdding: .month, value: -1, to: now),
                      note.createdAt >= monthAgo {
                key = "本月"
            } else {
                key = "更早"
            }
            groups[key, default: []].append(note)
        }
        return order.compactMap { key in
            guard let notes = groups[key], !notes.isEmpty else { return nil }
            return (key, notes)
        }
    }

    @ViewBuilder
    private var oldEchoSection: some View {
        moduleHeader(
            title: L("往事", "OldEcho"),
            icon: "note.text",
            isExpanded: $isNotesExpanded,
            action: { selection = groupedNotes.first?.1.first.map { .note($0.id) } ?? .empty }
        ) {
            Button(action: onCreateNote) { Image(systemName: "plus.circle") }
                .buttonStyle(.plain)
                .help(L("新建笔记", "New Note"))
            Menu {
                Button { filterType = nil } label: {
                    if filterType == nil { Label(L("全部类型", "All Types"), systemImage: "checkmark") }
                    else { Text(L("全部类型", "All Types")) }
                }
                Divider()
                ForEach(ContentType.allCases, id: \.rawValue) { type in
                    Button { filterType = type } label: {
                        if filterType == type { Label(type.displayName, systemImage: "checkmark") }
                        else { Text(type.displayName) }
                    }
                }
            } label: {
                Image(systemName: filterType == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .help(L("按类型筛选", "Filter by Type"))
            Button(action: { Task { await onRefresh() } }) { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.plain)
                .help(L("刷新笔记列表", "Refresh Notes"))
        }

        if isNotesExpanded && !groupedNotes.isEmpty {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(groupedNotes, id: \.0) { title, sectionNotes in
                        dateGroupHeader(title, count: sectionNotes.count)
                        if !collapsedDateGroups.contains(title) {
                            ForEach(sectionNotes) { note in
                                NoteRowView(note: note)
                                    .padding(.horizontal, DG.sp8)
                                    .padding(.vertical, 2)
                                    .background(selection == .note(note.id) ? Color.accent.opacity(0.1) : Color.clear)
                                    .cornerRadius(DG.r6)
                                    .contentShape(Rectangle())
                                    .onTapGesture { selection = .note(note.id) }
                                    .contextMenu {
                                        Button(role: .destructive) { onDeleteNote(note) } label: {
                                            Label(L("移到垃圾箱", "Move to Trash"), systemImage: "trash")
                                        }
                                    }
                            }
                        }
                    }
                    if hasMoreNotes && searchText.isEmpty {
                        HStack {
                            Spacer()
                            if isLoadingMore { ProgressView().controlSize(.small) }
                            else { Text(L("加载更多", "Load More")).font(.caption2).foregroundStyle(.secondary) }
                            Spacer()
                        }
                        .padding(.vertical, DG.sp8)
                        .onAppear { Task { await onLoadMore() } }
                    }
                }
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Button { selection = .farView } label: {
                Label(L("高见", "FarView"), systemImage: "chart.line.uptrend.xyaxis")
                    .font(.subheadline.bold())
                    .foregroundStyle(Color.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, DG.sp12)
                    .padding(.vertical, DG.sp8)
                    .background(selection == .farView ? Color.accent.opacity(0.1) : Color.canvasSecondary.opacity(0.5))
            }
            .buttonStyle(.plain)

            Divider()

            // 新知
            HStack(spacing: 0) {
                Button { withAnimation { isNewLoreExpanded.toggle() } } label: {
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .rotationEffect(.degrees(isNewLoreExpanded ? 90 : 0))
                        .foregroundStyle(Color.inkTertiary)
                        .padding(.trailing, DG.sp4)
                }
                .buttonStyle(.plain)
                Button { selection = .newloreReports } label: {
                    HStack {
                    Label(L("新知", "NewLore"), systemImage: "globe")
                        .font(.subheadline.bold())
                        .foregroundStyle(Color.ink)
                    Spacer()
                    if isNewLoreRunning {
                        ProgressView()
                            .controlSize(.small)
                    }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, DG.sp12)
            .padding(.vertical, DG.sp8)
            .background(selection == .newloreReports ? Color.accent.opacity(0.1) : Color.canvasSecondary.opacity(0.5))

            if isNewLoreRunning, let status = newloreRunningStatus {
                Text(status)
                    .font(.system(size: 10))
                    .foregroundStyle(Color.inkTertiary)
                    .lineLimit(2)
                    .padding(.horizontal, DG.sp16)
                    .padding(.bottom, DG.sp4)
            }

            if isNewLoreExpanded && !groupedNewLoreReports.isEmpty {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(groupedNewLoreReports, id: \.0) { (title, reports) in
                            let isCollapsed = collapsedNewLoreGroups.contains(title)
                            Button {
                                withAnimation {
                                    if isCollapsed {
                                        collapsedNewLoreGroups.remove(title)
                                    } else {
                                        collapsedNewLoreGroups.insert(title)
                                    }
                                }
                            } label: {
                                HStack(spacing: DG.sp4) {
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 8))
                                        .rotationEffect(.degrees(isCollapsed ? 0 : 90))
                                    Text(LDateGroup(title))
                                        .font(.caption2)
                                    if isCollapsed {
                                        Text("\(reports.count)")
                                            .font(.system(size: 9))
                                            .foregroundStyle(Color.inkTertiary)
                                    }
                                    Spacer()
                                }
                                .padding(.horizontal, DG.sp12)
                                .padding(.top, DG.sp4)
                                .padding(.bottom, 2)
                            }
                            .buttonStyle(.plain)

                            if !isCollapsed {
                                ForEach(reports) { report in
                                    NewLoreReportRow(
                                        report: report,
                                        isSelected: {
                                            if case .newloreReport(let d) = selection { return d == report.date }
                                            return false
                                        }(),
                                        onTap: { selection = .newloreReport(report.date) },
                                        onDelete: { onDeleteNewLoreReport(report.date) }
                                    )
                                }
                            }
                        }
                    }
                }
            }

            Divider()

            oldEchoSection
        }
        .background(Color.canvas)
        .onAppear { startNewLorePolling() }
        .modifier(OldEchoSearchModifier(
            isEnabled: isOldEchoSelection,
            searchText: $searchText,
            onSearch: onSearch
        ))
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 0) {
                Button(action: onShowTrash) {
                    Label(L("垃圾箱", "Trash"), systemImage: "trash")
                        .font(.subheadline)
                        .foregroundStyle(Color.inkSecondary)
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Divider().frame(height: 20)

                Button(action: onShowConfig) {
                    Label(L("设置", "Settings"), systemImage: "gearshape")
                        .font(.subheadline)
                        .foregroundStyle(Color.inkSecondary)
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color.canvasSecondary)
        }
    }

    private var isOldEchoSelection: Bool {
        if case .note = selection { return true }
        return selection == .empty
    }

    // MARK: - Module Header

    @ViewBuilder
    private func moduleHeader(title: String, icon: String, isExpanded: Binding<Bool>, action: @escaping () -> Void, @ViewBuilder trailing: () -> some View) -> some View {
        HStack(spacing: 0) {
            Button { withAnimation { isExpanded.wrappedValue.toggle() } } label: {
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .rotationEffect(.degrees(isExpanded.wrappedValue ? 90 : 0))
                    .foregroundStyle(Color.inkTertiary)
                    .padding(.trailing, DG.sp4)
            }
            .buttonStyle(.plain)
            Button(action: action) {
                HStack {
                    Label(title, systemImage: icon)
                        .font(.subheadline.bold())
                        .foregroundStyle(Color.ink)
                    Spacer(minLength: DG.sp8)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            trailing()
        }
        .padding(.horizontal, DG.sp12)
        .padding(.vertical, DG.sp8)
        .background(Color.canvasSecondary.opacity(0.5))
    }

    // MARK: - Date Group Header

    @ViewBuilder
    private func dateGroupHeader(_ title: String, count: Int) -> some View {
        let isCollapsed = collapsedDateGroups.contains(title)
        Button {
            withAnimation {
                if isCollapsed {
                    collapsedDateGroups.remove(title)
                } else {
                    collapsedDateGroups.insert(title)
                }
            }
        } label: {
            HStack(spacing: DG.sp4) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 8))
                    .rotationEffect(.degrees(isCollapsed ? 0 : 90))
                Text(LDateGroup(title))
                    .font(.caption2)
                if isCollapsed {
                    Text("\(count)")
                        .font(.system(size: 9))
                        .foregroundStyle(Color.inkTertiary)
                }
                Spacer()
            }
            .padding(.horizontal, DG.sp12)
            .padding(.top, DG.sp4)
            .padding(.bottom, 2)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    private func startNewLorePolling() {
        stopNewLorePolling()
        newloreTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task { @MainActor in
                do {
                    let status = try await APIClient.shared.getNewLoreStatus()
                    isNewLoreRunning = status.isRunning
                    newloreRunningStatus = status.recentLog ?? (status.isRunning ? L("运行中…", "Running…") : nil)
                    if !status.isRunning {
                        newloreRunningStatus = nil
                        await onRefresh()
                    }
                } catch {}
            }
        }
    }

    private func stopNewLorePolling() {
        newloreTimer?.invalidate()
        newloreTimer = nil
    }
}

private struct OldEchoSearchModifier: ViewModifier {
    let isEnabled: Bool
    @Binding var searchText: String
    let onSearch: (String) async -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if isEnabled {
            content
                .searchable(text: $searchText, prompt: L("搜索往事...", "Search OldEcho..."))
                .onSubmit(of: .search) { Task { await onSearch(searchText) } }
                .onChange(of: searchText) { _, value in
                    if value.isEmpty { Task { await onSearch("") } }
                }
        } else {
            content
        }
    }
}

private struct NewLoreReportRow: View {
    let report: NewLoreReportMeta
    let isSelected: Bool
    let onTap: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(report.formattedDate)
                .font(.subheadline)
                .foregroundStyle(Color.ink)
            if !report.summary.isEmpty {
                Text(report.summary)
                    .font(.system(size: 10))
                    .foregroundStyle(Color.inkTertiary)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, DG.sp8)
        .padding(.vertical, 3)
        .background(isSelected ? Color.accent.opacity(0.1) : Color.clear)
        .cornerRadius(DG.r6)
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
        .padding(.horizontal, DG.sp4)
        .contextMenu {
            #if os(macOS)
            Button {
                Task {
                    do {
                        let path = try await APIClient.shared.getNewLoreReportPath(date: report.date)
                        let url = URL(fileURLWithPath: path)
                        NSWorkspace.shared.activateFileViewerSelecting([url])
                    } catch {}
                }
            } label: {
                Label(L("在 Finder 中显示", "Show in Finder"), systemImage: "folder")
            }
            #endif
            Button(role: .destructive) {
                onDelete()
            } label: {
                Label(L("删除", "Delete"), systemImage: "trash")
            }
        }
    }
}
