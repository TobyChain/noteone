#if os(macOS)
import AppKit
import SwiftUI

/// A floating standard window that remains visible while users drag content from another app.
final class FloatingCaptureWindow: NSWindow {
    init(contentRect: NSRect) {
        super.init(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        level = .floating
        title = L("顺手记", "Quick Capture")
        titleVisibility = .visible
        titlebarAppearsTransparent = false
        isMovableByWindowBackground = false
        isOpaque = true
        hasShadow = true
        isReleasedWhenClosed = false
        hidesOnDeactivate = false
        minSize = NSSize(width: 480, height: 320)
        // Follow the user across Spaces and stay visible over full-screen apps.
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        // SwiftUI's preferredColorScheme inside the hosted view does not restyle
        // NSWindow chrome; set the window appearance so the titlebar matches.
        appearance = NSAppearance(named: ThemeStore.shared.palette.scheme == .dark ? .darkAqua : .aqua)
        center()
    }
}
#endif
