import XCTest
@testable import NoteOne
#if os(macOS)
import AppKit
import Carbon.HIToolbox
#endif

final class NotePaginationStateTests: XCTestCase {
    func testAppendingDeduplicatesNotesAndPreservesOrder() {
        let merged = NotePagination.appending([note("b"), note("c")], to: [note("a"), note("b")])
        XCTAssertEqual(merged.map(\.id), ["a", "b", "c"])
    }

    func testFarViewOverviewDecodesSevenDayRanking() throws {
        let json = """
        {
          "state": "ready",
          "snapshot": {
            "periodDays": 7,
            "periodStart": "2026-08-29",
            "periodEnd": "2026-09-04",
            "sourceThrough": "2026-09-04",
            "totalItems": 3,
            "sourceCounts": { "paper": 2, "github": 1 },
            "topics": [{
              "id": "topic-1", "name": "agent harness", "currentCount": 3,
              "sourceDiversity": 2, "normalizedHeat": 1.0, "score": 2.0,
              "sourceCounts": { "paper": 2, "github": 1 },
              "representatives": [{
                "sourceType": "paper", "sourceId": "1", "title": "Agent Harness",
                "url": "https://example.com", "observedDate": "2026-09-04"
              }]
            }]
          }
        }
        """
        let response = try JSONDecoder().decode(FarViewOverviewResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.snapshot?.periodDays, 7)
        XCTAssertEqual(response.snapshot?.periodStart, "2026-08-29")
        XCTAssertEqual(response.snapshot?.topics.first?.currentCount, 3)
    }

    func testPrimaryTabsStartWithFarViewNewLoreOldEcho() {
        XCTAssertEqual(Array(AppTab.allCases.prefix(3)), [.farView, .newLore, .oldEcho])
    }

    #if os(macOS)
    /// The Carbon registration must preserve every supported AppKit modifier.
    func testHotkeyCarbonModifierMapping() {
        let rawValue = Int(NSEvent.ModifierFlags([.command, .option, .control, .shift]).rawValue)
        let expected = UInt32(cmdKey | optionKey | controlKey | shiftKey)
        XCTAssertEqual(HotkeyConfig.carbonModifiers(from: rawValue), expected)
    }

    /// Shortcut-driven selection capture must never open a system prompt implicitly.
    @MainActor
    func testSelectionCaptureNeverPromptsImplicitly() {
        var requestCount = 0
        let coordinator = PermissionCoordinator(
            accessibilityStatus: { false },
            accessibilityRequest: {
                requestCount += 1
                return false
            }
        )

        XCTAssertFalse(coordinator.canCaptureSelectionWithoutPrompt())
        XCTAssertFalse(coordinator.canCaptureSelectionWithoutPrompt())
        XCTAssertEqual(requestCount, 0)
    }

    /// The system prompt remains available after an explicit Settings action.
    @MainActor
    func testSelectionCapturePromptsAfterExplicitAction() {
        var requestCount = 0
        let coordinator = PermissionCoordinator(
            accessibilityStatus: { false },
            accessibilityRequest: {
                requestCount += 1
                return false
            }
        )

        XCTAssertFalse(coordinator.requestAccessibility())
        XCTAssertEqual(requestCount, 1)
    }

    func testBrowserMetadataCaptureIsOffByDefault() {
        let suiteName = "HotkeyConfigTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertFalse(HotkeyConfig.browserMetadataEnabled(in: defaults))
        defaults.set(true, forKey: HotkeyConfig.browserMetadataEnabledKey)
        XCTAssertTrue(HotkeyConfig.browserMetadataEnabled(in: defaults))
    }

    @MainActor
    func testNottyHistoryKeepsDuplicateToolNamesPairedByCallID() {
        let now = Date()
        let calls = [
            StoredToolCall(id: "call-a", function: .init(name: "search_web", arguments: #"{"query":"A"}"#)),
            StoredToolCall(id: "call-b", function: .init(name: "search_web", arguments: #"{"query":"B"}"#)),
        ]
        let history = [
            ServerChatMessage(id: "1", sessionId: "s", role: "assistant", content: "", isSummary: false, toolCalls: calls, toolCallId: nil, createdAt: now),
            ServerChatMessage(id: "2", sessionId: "s", role: "tool", content: "result B", isSummary: false, toolCalls: nil, toolCallId: "call-b", createdAt: now),
            ServerChatMessage(id: "3", sessionId: "s", role: "tool", content: "result A", isSummary: false, toolCalls: nil, toolCallId: "call-a", createdAt: now),
            ServerChatMessage(id: "4", sessionId: "s", role: "assistant", content: "done", isSummary: false, toolCalls: nil, toolCallId: nil, createdAt: now),
        ]

        let mapped = NottyView.mapHistory(history)

        XCTAssertEqual(mapped.last?.toolActivities.map(\.id), ["call-a", "call-b"])
        XCTAssertEqual(mapped.last?.toolActivities.map(\.resultPreview), ["result A", "result B"])
    }

    func testNottyFormatsWideMarkdownTablesForTheSidebar() {
        let markdown = "| 状态 | 任务 |\n|---|---|\n| 启用 | 每日新知 |"
        XCTAssertEqual(NottySidebarText.format(markdown), "• 状态：启用 · 任务：每日新知")
    }

    func testMacSyncQueueDoesNotResolveTheShareExtensionContainer() {
        let support = URL(fileURLWithPath: "/tmp/noteone-support", isDirectory: true)
        var appGroupLookupCount = 0

        let result = SyncQueue.storageDirectory(
            applicationSupportDirectory: support,
            appGroupContainer: {
                appGroupLookupCount += 1
                return URL(fileURLWithPath: "/tmp/noteone-group", isDirectory: true)
            }
        )

        XCTAssertEqual(result, support.appendingPathComponent("NoteOne", isDirectory: true))
        XCTAssertEqual(appGroupLookupCount, 0)
    }

    /// The standard titlebar close button must dismiss the floating capture panel.
    @MainActor
    func testFloatingPanelTitlebarCloseButtonClosesWindow() {
        let panel = FloatingCaptureWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 320))
        XCTAssertFalse(panel.hidesOnDeactivate)
        XCTAssertTrue(panel.standardWindowButton(.closeButton)?.isEnabled == true)
        XCTAssertTrue(panel.standardWindowButton(.miniaturizeButton)?.isEnabled == true)
        XCTAssertTrue(panel.standardWindowButton(.zoomButton)?.isEnabled == true)
        panel.orderFront(nil)
        XCTAssertTrue(panel.isVisible)

        panel.standardWindowButton(.closeButton)?.performClick(nil)

        XCTAssertFalse(panel.isVisible)
    }
    #endif

    private func note(_ id: String) -> Note {
        Note(id: id, contentType: .text, title: id, content: id, sourceUrl: nil,
             sourceApp: nil, author: nil, authorOrg: nil, aiSummary: nil, status: .active,
             deletedAt: nil, tags: nil, createdAt: Date(), updatedAt: Date())
    }
}
