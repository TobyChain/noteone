#if os(macOS)
import SwiftUI
import AppKit

/// Records a global hotkey combo. Click "修改", press the desired ⌘/⌥/⌃/⇧ + key,
/// and the new binding is persisted and re-armed immediately. Esc cancels recording.
struct HotkeyRecorderField: View {
    @AppStorage(HotkeyConfig.keyCodeKey) private var keyCode: Int = HotkeyConfig.defaultKeyCode
    @AppStorage(HotkeyConfig.modifiersKey) private var modifiers: Int = HotkeyConfig.defaultModifiers
    @AppStorage(HotkeyConfig.keyLabelKey) private var keyLabel: String = HotkeyConfig.defaultKeyLabel

    @State private var recording = false
    @State private var monitor: Any?

    var body: some View {
        HStack(spacing: 12) {
            Text("快捷键")
            Spacer()
            Text(displayString)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(recording ? Color.accent : Color.ink)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.canvasSecondary)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            Button(recording ? "按下组合键…(Esc 取消)" : "修改") {
                recording ? stopRecording() : startRecording()
            }
        }
        .onDisappear { stopRecording() }
    }

    private var displayString: String {
        let m = NSEvent.ModifierFlags(rawValue: UInt(modifiers))
        var s = ""
        if m.contains(.control) { s += "⌃" }
        if m.contains(.option) { s += "⌥" }
        if m.contains(.shift) { s += "⇧" }
        if m.contains(.command) { s += "⌘" }
        return s + keyLabel
    }

    private func startRecording() {
        recording = true
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            // Esc cancels without changing the binding.
            if event.keyCode == 53 {
                stopRecording()
                return nil
            }
            let mods = event.modifierFlags.intersection(HotkeyConfig.relevantMask)
            // Require at least one modifier so the global hotkey can't be a bare key.
            guard !mods.isEmpty else { return nil }

            keyCode = Int(event.keyCode)
            modifiers = Int(mods.rawValue)
            keyLabel = (event.charactersIgnoringModifiers ?? "").uppercased()
            stopRecording()
            HotkeyManager.shared.reload()
            return nil // swallow the event
        }
    }

    private func stopRecording() {
        recording = false
        if let monitor = monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }
}
#endif
