import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authService: AuthService
    @AppStorage("appTheme") private var selectedTheme: String = AppTheme.system.rawValue
    @State private var serverURL = "http://localhost:3000"
    @State private var stats: StatsResponse?

    private var theme: AppTheme {
        AppTheme(rawValue: selectedTheme) ?? .system
    }

    var body: some View {
        Form {
            Section("外观") {
                Picker("主题", selection: $selectedTheme) {
                    ForEach(AppTheme.allCases, id: \.rawValue) { t in
                        Text(t.label).tag(t.rawValue)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section("账户") {
                if let name = authService.userName {
                    Text("已登录: \(name)")
                }
                Button("退出登录", role: .destructive) {
                    authService.signOut()
                }
            }

            Section("服务器") {
                TextField("API 地址", text: $serverURL)
            }

            if let stats = stats {
                Section("统计") {
                    LabeledContent("总笔记数", value: "\(stats.totalNotes)")
                    ForEach(stats.byContentType, id: \.contentType) { item in
                        LabeledContent(item.contentType, value: "\(item.count)")
                    }
                }

                Section("热门标签") {
                    ForEach(stats.topTags.prefix(10), id: \.name) { tag in
                        LabeledContent(tag.name, value: "\(tag.count)")
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("设置")
        .task {
            do { stats = try await APIClient.shared.getStats() } catch {}
        }
    }
}
