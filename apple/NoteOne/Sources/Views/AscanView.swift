import SwiftUI

struct AscanView: View {
    @State private var subView: AscanSubView = .reports

    enum AscanSubView: String, CaseIterable, Identifiable {
        case reports = "日报浏览"
        case config = "配置管理"
        var id: String { rawValue }
    }

    var body: some View {
        Group {
            switch subView {
            case .reports:
                AscanReportListView()
            case .config:
                AscanConfigView()
            }
        }
        .navigationTitle("Ascan")
        #if os(iOS)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Picker("", selection: $subView) {
                    ForEach(AscanSubView.allCases) { sub in
                        Text(sub.rawValue).tag(sub)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 200)
            }
        }
        #endif
    }
}
