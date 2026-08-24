import SwiftUI

@main
struct NoteOneApp: App {
    @StateObject private var authService = AuthService()
    @AppStorage("appTheme") private var selectedTheme: String = AppTheme.system.rawValue
    @Environment(\.scenePhase) private var scenePhase
    #if os(macOS)
    @StateObject private var hotkeyManager = HotkeyManager.shared
    @State private var updateInfo: UpdateInfo?
    @State private var showUpdateAlert = false
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

    #if os(macOS)
    /// Check GitHub Releases once at launch; only surface the alert when a newer build exists.
    private func checkForAppUpdate() async {
        // Delay so it doesn't race with server startup.
        try? await Task.sleep(for: .seconds(10))
        if let info = try? await UpdateChecker.shared.checkForUpdate() {
            await MainActor.run {
                updateInfo = info
                showUpdateAlert = true
            }
        }
    }
    #endif

    var body: some Scene {
        WindowGroup {
            Group {
                if authService.isAuthenticated {
                    ContentView()
                        .environmentObject(authService)
                } else {
                    // Auto-login is in flight (first launch or 401 refresh) —
                    // there is no login screen anymore, just a brief spinner.
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .applyTheme(theme)
            .environment(\.openURL, OpenURLAction { url in
                #if os(macOS)
                NSWorkspace.shared.open(url)
                return .handled
                #else
                return .systemAction
                #endif
            })
            .task {
                #if os(macOS)
                await ServerLauncher.shared.ensureRunning()
                #endif
                await SyncQueue.shared.warmUp()
                await syncPending()
                #if os(macOS)
                hotkeyManager.register()
                Task { await checkForAppUpdate() }
                #endif
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await syncPending() }
                }
            }
            #if os(macOS)
            .alert("发现新版本", isPresented: $showUpdateAlert, presenting: updateInfo) { info in
                Button("下载安装包") {
                    if let url = URL(string: info.downloadURL) { NSWorkspace.shared.open(url) }
                }
                Button("查看发布页") {
                    if let url = URL(string: info.releasePage) { NSWorkspace.shared.open(url) }
                }
                Button("稍后提醒", role: .cancel) {}
            } message: { info in
                Text("已发布 v\(info.version)。下载后拖入 Applications 覆盖即可，你的笔记和数据不受影响。\n\n\(info.releaseNotes.prefix(300))")
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
                ServerLauncher.shared.terminate()
            }
            #endif
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
            UnifiedSettingsView()
                .environmentObject(authService)
        }
        #endif
    }
}
