import SwiftUI
import UniformTypeIdentifiers

extension Notification.Name {
    /// Posted when a payload was deposited into DropPayloadStore and the capture view
    /// should pick it up (also drives the iOS tab switch to “记一条”).
    static let droppedPayloadReady = Notification.Name("droppedPayloadReady")
}

struct ContentView: View {
    #if os(macOS)
    @EnvironmentObject var authService: AuthService
    @State private var showNotty = false
    @State private var showMCPInstall = false
    @State private var showTrash = false
    @State private var selectedNoteId: String?
    @State private var notes: [Note] = []
    #else
    @State private var selectedTab = 0
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
        TabView(selection: $selectedTab) {
            NavigationStack {
                NoteListView()
            }
            .tabItem {
                Label("笔记", systemImage: "note.text")
            }
            .tag(0)

            NavigationStack {
                CaptureView()
            }
            .tabItem {
                Label("记一条", systemImage: "plus.circle.fill")
            }
            .tag(1)

            NavigationStack {
                NottyView()
            }
            .tabItem {
                Label("Notty", systemImage: "bubble.left.fill")
            }
            .tag(2)

            NavigationStack {
                ReportsView()
            }
            .tabItem {
                Label("报告", systemImage: "chart.bar.doc.horizontal")
            }
            .tag(3)

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("设置", systemImage: "gear")
            }
            .tag(4)
        }
        // Top-level drop target: when iOS routes a drag-from-another-app onto NoteOne,
        // stash the payload and jump to the capture tab so the user can confirm-and-save.
        .onDrop(of: [.image, .url, .plainText], isTargeted: nil) { providers in
            handleTopLevelDrop(providers)
        }
        .onReceive(NotificationCenter.default.publisher(for: .droppedPayloadReady)) { _ in
            selectedTab = 1
        }
        #endif
    }

    #if !os(macOS)
    /// Read items off the providers, store them in DropPayloadStore, and signal the capture tab.
    private func handleTopLevelDrop(_ providers: [NSItemProvider]) -> Bool {
        // Image takes priority — it carries the most information.
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                guard let data else { return }
                Task {
                    await DropPayloadStore.shared.set(DroppedPayload(imageData: data))
                    await MainActor.run {
                        NotificationCenter.default.post(name: .droppedPayloadReady, object: nil)
                    }
                }
            }
            return true
        }
        for provider in providers where provider.canLoadObject(ofClass: URL.self) {
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                guard let url else { return }
                Task {
                    await DropPayloadStore.shared.set(DroppedPayload(
                        text: url.absoluteString,
                        sourceUrl: url.absoluteString
                    ))
                    await MainActor.run {
                        NotificationCenter.default.post(name: .droppedPayloadReady, object: nil)
                    }
                }
            }
            return true
        }
        for provider in providers where provider.canLoadObject(ofClass: String.self) {
            _ = provider.loadObject(ofClass: String.self) { text, _ in
                guard let text else { return }
                Task {
                    await DropPayloadStore.shared.set(DroppedPayload(text: text))
                    await MainActor.run {
                        NotificationCenter.default.post(name: .droppedPayloadReady, object: nil)
                    }
                }
            }
            return true
        }
        return false
    }
    #endif
}
