import SwiftUI

struct ContentView: View {
    #if os(macOS)
    @EnvironmentObject var authService: AuthService
    @State private var showNotty = false
    @State private var showMCPInstall = false
    @State private var showTrash = false
    @State private var selectedNoteId: String?
    @State private var notes: [Note] = []
    #endif

    var body: some View {
        #if os(macOS)
        NavigationSplitView {
            NoteListView(selectedNoteId: $selectedNoteId, notes: $notes)
        } detail: {
            if showTrash {
                TrashView()
            } else if let noteId = selectedNoteId {
                NoteDetailView(noteId: noteId, initialNote: notes.first { $0.id == noteId })
            } else {
                Text("选择一条笔记")
                    .foregroundStyle(.secondary)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            Button { showNotty = true } label: {
                Image("NottyAvatar")
                    .resizable()
                    .frame(width: 44, height: 44)
                    .clipShape(Circle())
                    .shadow(color: Color.accent.opacity(0.3), radius: 4, y: 2)
            }
            .buttonStyle(.plain)
            .padding(20)
        }
        .sheet(isPresented: $showNotty) {
            NottyView()
                .frame(width: 420, height: 560)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showMCPInstall = true } label: {
                    Image(systemName: "puzzlepiece.extension")
                }
                .help("MCP 一键安装")
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showTrash.toggle()
                    if showTrash { selectedNoteId = nil }
                } label: {
                    Image(systemName: showTrash ? "trash.fill" : "trash")
                }
                .help("垃圾箱")
            }
        }
        .sheet(isPresented: $showMCPInstall) {
            MCPInstallView()
                .environmentObject(authService)
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
                Label("Notty", systemImage: "bubble.left.fill")
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
