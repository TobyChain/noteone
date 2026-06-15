import SwiftUI

@main
struct NoteOneApp: App {
    @StateObject private var authService = AuthService()
    @AppStorage("appTheme") private var selectedTheme: String = AppTheme.system.rawValue
    @Environment(\.scenePhase) private var scenePhase
    #if os(macOS)
    @StateObject private var hotkeyManager = HotkeyManager.shared
    @State private var showCaptureWindow = false
    #endif

    private var theme: AppTheme {
        AppTheme(rawValue: selectedTheme) ?? .system
    }

    private func syncPending() async {
        guard authService.isAuthenticated else { return }
        let synced = await SyncQueue.shared.flush()
        if synced > 0 {
            await MainActor.run {
                NotificationCenter.default.post(name: .noteCreated, object: nil)
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if authService.isAuthenticated {
                    ContentView()
                        .environmentObject(authService)
                } else {
                    LoginView()
                        .environmentObject(authService)
                }
            }
            .applyTheme(theme)
            .task {
                await SyncQueue.shared.warmUp()
                await syncPending()
                #if os(macOS)
                hotkeyManager.register()
                #endif
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await syncPending() }
                }
            }
        }
        #if os(macOS)
        .defaultSize(width: 900, height: 600)
        .commands {
            CommandGroup(replacing: .textFormatting) {}
            CommandGroup(after: .newItem) {
                Button("顺手记一条") {
                    hotkeyManager.togglePanel()
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            }
        }
        #endif

        #if os(macOS)
        Settings {
            SettingsView()
                .environmentObject(authService)
        }
        #endif
    }
}
