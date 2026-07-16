import SwiftUI

struct UnifiedSettingsView: View {
    enum SettingsTab: String, CaseIterable, Identifiable {
        case noteone = "壹识"
        case ascan = "新知"
        var id: String { rawValue }
    }

    @State private var selectedTab: SettingsTab = .noteone

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $selectedTab) {
                ForEach(SettingsTab.allCases) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, DG.sp16)
            .padding(.top, DG.sp12)
            .padding(.bottom, DG.sp8)

            Group {
                switch selectedTab {
                case .noteone:
                    SettingsView()
                case .ascan:
                    AscanConfigView()
                }
            }
        }
        .navigationTitle("设置")
    }
}
