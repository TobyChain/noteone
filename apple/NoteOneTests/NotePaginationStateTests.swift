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

    /// Completing permission onboarding must suppress it on later launches for the same defaults suite.
    @MainActor
    func testPermissionOnboardingIsShownOnlyUntilCompleted() {
        let suiteName = "PermissionCoordinatorTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let coordinator = PermissionCoordinator(defaults: defaults)
        XCTAssertTrue(coordinator.shouldPresentOnboarding)

        coordinator.completeOnboarding()

        XCTAssertFalse(coordinator.shouldPresentOnboarding)
    }

    /// Shortcut-driven permission requests must not recur after the first system prompt.
    @MainActor
    func testSelectionCapturePromptsAtMostOnceAutomatically() {
        let suiteName = "PermissionCoordinatorTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        var requestCount = 0
        let coordinator = PermissionCoordinator(
            defaults: defaults,
            accessibilityStatus: { false },
            accessibilityRequest: {
                requestCount += 1
                return false
            },
            appFingerprint: "build-a"
        )

        XCTAssertFalse(coordinator.prepareForSelectionCapture())
        XCTAssertFalse(coordinator.prepareForSelectionCapture())
        XCTAssertEqual(requestCount, 1)
    }

    /// A replaced ad-hoc binary may request a new TCC entry once without prompting every launch.
    @MainActor
    func testSelectionCaptureCanPromptOnceForANewBuild() {
        let suiteName = "PermissionCoordinatorTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set("build-a", forKey: PermissionCoordinator.accessibilityPromptedBuildKey)
        var requestCount = 0
        let coordinator = PermissionCoordinator(
            defaults: defaults,
            accessibilityStatus: { false },
            accessibilityRequest: {
                requestCount += 1
                return false
            },
            appFingerprint: "build-b"
        )

        XCTAssertFalse(coordinator.prepareForSelectionCapture())
        XCTAssertFalse(coordinator.prepareForSelectionCapture())
        XCTAssertEqual(requestCount, 1)
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
