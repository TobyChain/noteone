import SwiftUI

@main
struct NoteOneApp: App {
    @StateObject private var localSession = LocalSessionService()
    @State private var didStartBootstrap = false
    @State private var syncStatus: SyncStatus?
    @AppStorage("appTheme") private var selectedTheme: String = AppTheme.system.rawValue
    @Environment(\.scenePhase) private var scenePhase
    #if os(macOS)
    @StateObject private var hotkeyManager = HotkeyManager.shared
    @StateObject private var permissionCoordinator = PermissionCoordinator.shared
    @State private var updateInfo: UpdateInfo?
    @State private var showUpdateAlert = false
    @State private var showPermissionOnboarding = false
    #endif

    private var theme: AppTheme {
        AppTheme(rawValue: selectedTheme) ?? .system
    }

    private func syncPending() async {
        guard localSession.state == .ready else { return }
        let synced = await SyncQueue.shared.flush()
        syncStatus = await SyncQueue.shared.status()
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
                switch localSession.state {
                case .ready:
                    ContentView()
                        .environmentObject(localSession)
                case .starting:
                    VStack(spacing: 12) {
                        ProgressView()
                        Text(L("正在打开本地数据…", "Opening local data…"))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .failed(let message):
                    ContentUnavailableView {
                        Label(L("无法启动壹识", "NoteOne Could Not Start"), systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(message)
                    } actions: {
                        Button(L("重试", "Retry")) {
                            Task { await bootstrap() }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
                if let syncStatus, syncStatus.pendingCount > 0 {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .foregroundStyle(Color.accent)
                    Text(L("待同步 \(syncStatus.pendingCount) 条", "\(syncStatus.pendingCount) pending sync"))
                        .font(.caption)
                    Spacer()
                    Button(L("立即同步", "Sync Now")) {
                        Task { await syncPending() }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.accent.opacity(0.08))
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
                guard !didStartBootstrap else { return }
                didStartBootstrap = true
                #if os(macOS)
                hotkeyManager.register()
                permissionCoordinator.refresh()
                showPermissionOnboarding = permissionCoordinator.shouldPresentOnboarding
                #endif
                await bootstrap()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    #if os(macOS)
                    permissionCoordinator.refresh()
                    #endif
                    Task { await syncPending() }
                }
            }
            #if os(macOS)
            .sheet(isPresented: $showPermissionOnboarding) {
                PermissionOnboardingView(coordinator: permissionCoordinator) {
                    showPermissionOnboarding = false
                }
            }
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
                hotkeyManager.unregister()
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
                .environmentObject(localSession)
        }
        #endif
    }

    @MainActor
    private func bootstrap() async {
        #if os(macOS)
        do {
            try await ServerLauncher.shared.ensureRunning()
        } catch {
            localSession.reportStartupFailure(error.localizedDescription)
            return
        }
        #endif

        await localSession.prepareLocalSession()
        guard localSession.state == .ready else { return }
        await SyncQueue.shared.warmUp()
        await syncPending()
        #if os(macOS)
        Task { await checkForAppUpdate() }
        #endif
    }
}
