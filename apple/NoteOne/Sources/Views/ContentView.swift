import SwiftUI

struct ContentView: View {
    var body: some View {
        #if os(macOS)
        NavigationSplitView {
            NoteListView()
        } detail: {
            Text("选择一条笔记")
                .foregroundStyle(.secondary)
        }
        #else
        TabView {
            NavigationStack {
                NoteListView()
            }
            .tabItem {
                Label("笔记", systemImage: "note.text")
            }

            NavigationStack {
                CaptureView()
            }
            .tabItem {
                Label("记一条", systemImage: "plus.circle.fill")
            }

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("设置", systemImage: "gear")
            }
        }
        #endif
    }
}
