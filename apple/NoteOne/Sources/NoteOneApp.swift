import SwiftUI

@main
struct NoteOneApp: App {
    @StateObject private var authService = AuthService()
    #if os(macOS)
    @StateObject private var hotkeyManager = HotkeyManager.shared
    #endif

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
            .task {
                await SyncQueue.shared.warmUp()
                #if os(macOS)
                hotkeyManager.register()
                #endif
            }
        }
        #if os(macOS)
        .defaultSize(width: 900, height: 600)
        #endif

        #if os(macOS)
        Settings {
            SettingsView()
                .environmentObject(authService)
        }
        #endif
    }
}
