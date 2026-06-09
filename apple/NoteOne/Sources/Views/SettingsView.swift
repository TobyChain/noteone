import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authService: AuthService
    @State private var serverURL = "http://localhost:3000"
    @State private var stats: StatsResponse?

    var body: some View {
        Form {
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
