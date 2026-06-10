import SwiftUI

struct ContentView: View {
    #if os(macOS)
    @State private var showNotty = false
    #endif

    var body: some View {
        #if os(macOS)
        NavigationSplitView {
            NoteListView()
        } detail: {
            Text("选择一条笔记")
                .foregroundStyle(.secondary)
        }
        .overlay(alignment: .bottomTrailing) {
            Button { showNotty = true } label: {
                Image(systemName: "sparkle")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.blue)
                    .clipShape(Circle())
                    .shadow(radius: 4)
            }
            .buttonStyle(.plain)
            .padding(20)
        }
        .sheet(isPresented: $showNotty) {
            NottyView()
                .frame(width: 420, height: 560)
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
                NottyView()
            }
            .tabItem {
                Label("Notty", systemImage: "sparkle")
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
