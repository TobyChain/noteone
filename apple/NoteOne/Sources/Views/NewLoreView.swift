import SwiftUI

struct NewLoreView: View {
    @State private var subView: NewLoreSubView = .reports

    enum NewLoreSubView: String, CaseIterable, Identifiable {
        case reports = "日报浏览"
        case config = "配置管理"
        var id: String { rawValue }
        var localizedName: String {
            switch self {
            case .reports: return L("日报浏览", "Reports")
            case .config: return L("配置管理", "Config")
            }
        }
    }

    var body: some View {
        Group {
            switch subView {
            case .reports:
                NewLoreReportListView()
            case .config:
                NewLoreConfigWebContent()
            }
        }
        .navigationTitle(L("新知", "NewLore"))
        #if os(iOS)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Picker("", selection: $subView) {
                    ForEach(NewLoreSubView.allCases) { sub in
                        Text(sub.localizedName).tag(sub)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 200)
            }
        }
        #endif
    }
}
