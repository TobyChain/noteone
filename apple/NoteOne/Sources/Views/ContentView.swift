import SwiftUI

struct ContentView: View {
    #if os(macOS)
    @State private var showNotty = false
    @State private var selectedNoteId: String?
    #endif

    var body: some View {
        #if os(macOS)
        NavigationSplitView {
            NoteListView(selectedNoteId: $selectedNoteId)
        } detail: {
            if let noteId = selectedNoteId {
                NoteDetailView(noteId: noteId)
            } else {
                Text("选择一条笔记")
                    .foregroundStyle(.secondary)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            Button { showNotty = true } label: {
                Image(systemName: "sparkle")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.accent)
                    .clipShape(Circle())
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
