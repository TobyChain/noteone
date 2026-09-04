import SwiftUI
import UniformTypeIdentifiers

extension Notification.Name {
    /// Posted when a payload was deposited into DropPayloadStore and the capture view
    /// should pick it up (also drives the iOS tab switch to "记一条").
    static let droppedPayloadReady = Notification.Name("droppedPayloadReady")
}

enum AppTab: Int, CaseIterable {
    case farView, newLore, oldEcho, capture, notty, reports, settings
}

struct ContentView: View {
    #if os(macOS)
    @EnvironmentObject var localSession: LocalSessionService
    #else
    @State private var selectedTab: AppTab = .farView
    #endif

    var body: some View {
        #if os(macOS)
        MainSplitView()
            .environmentObject(localSession)
        #else
        TabView(selection: $selectedTab) {
            NavigationStack {
                FarViewView()
            }
            .tabItem {
                Label(L("高见", "FarView"), systemImage: "chart.line.uptrend.xyaxis")
            }
            .tag(AppTab.farView)

            NavigationStack {
                NewLoreReportListView()
            }
            .tabItem {
                Label(L("新知", "NewLore"), systemImage: "globe")
            }
            .tag(AppTab.newLore)

            NavigationStack {
                NoteListView()
            }
            .tabItem {
                Label(L("往事", "OldEcho"), systemImage: "note.text")
            }
            .tag(AppTab.oldEcho)

            NavigationStack {
                CaptureView()
            }
            .tabItem {
                Label(L("记一条", "Capture"), systemImage: "plus.circle.fill")
            }
            .tag(AppTab.capture)

            NavigationStack {
                NottyView()
            }
            .tabItem {
                Label(L("闹闹", "Notty"), systemImage: "bubble.left.fill")
            }
            .tag(AppTab.notty)

            NavigationStack {
                ReportsView()
            }
            .tabItem {
                Label(L("报告", "Reports"), systemImage: "chart.bar.doc.horizontal")
            }
            .tag(AppTab.reports)

            NavigationStack {
                UnifiedSettingsView()
            }
            .tabItem {
                Label(L("设置", "Settings"), systemImage: "gear")
            }
            .tag(AppTab.settings)
        }
        // Top-level drop target: when iOS routes a drag-from-another-app onto NoteOne,
        // stash the payload and jump to the capture tab so the user can confirm-and-save.
        .onDrop(of: [.image, .url, .plainText], isTargeted: nil) { providers in
            handleTopLevelDrop(providers)
        }
        .onReceive(NotificationCenter.default.publisher(for: .droppedPayloadReady)) { _ in
            selectedTab = .capture
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
