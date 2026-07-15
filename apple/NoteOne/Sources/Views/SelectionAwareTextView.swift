import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// A platform-native text editor that exposes both the text binding *and* the current
/// selection (start/end UTF-16 offsets). SwiftUI's `TextEditor` doesn't surface
/// selection at all, which prevents Notty from doing precise insert / replace operations,
/// so we reach for `NSTextView` (macOS) and `UITextView` (iOS) directly.
struct SelectionAwareTextView: View {
    @Binding var text: String
    @Binding var selection: NSRange
    var font: PlatformFont = .monospacedSystemFont(ofSize: 14, weight: .regular)

    var body: some View {
        SelectionAwareTextViewImpl(text: $text, selection: $selection, font: font)
    }
}

#if os(macOS)
typealias PlatformFont = NSFont

private struct SelectionAwareTextViewImpl: NSViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRange
    let font: NSFont

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        let tv = scroll.documentView as! NSTextView
        tv.delegate = context.coordinator
        tv.allowsUndo = true
        tv.isRichText = false
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticSpellingCorrectionEnabled = false
        tv.font = font
        tv.textContainerInset = NSSize(width: 8, height: 8)
        context.coordinator.isApplyingProgrammaticChange = true
        tv.string = text
        context.coordinator.isApplyingProgrammaticChange = false
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let tv = scroll.documentView as? NSTextView else { return }
        // During IME composition, the text view manages its own marked-text
        // range internally. Any external string/selection mutation would destroy
        // the composition state and break Chinese/Japanese/Korean input.
        guard !tv.hasMarkedText() else { return }

        if tv.string != text {
            let oldSel = tv.selectedRange()
            context.coordinator.isApplyingProgrammaticChange = true
            tv.string = text
            let newLen = (text as NSString).length
            let clampedLoc = min(oldSel.location, newLen)
            tv.setSelectedRange(NSRange(location: clampedLoc, length: 0))
            context.coordinator.isApplyingProgrammaticChange = false
            DispatchQueue.main.async {
                if selection.location != clampedLoc || selection.length != 0 {
                    selection = NSRange(location: clampedLoc, length: 0)
                }
            }
        } else if tv.selectedRange() != selection {
            let len = (text as NSString).length
            let safe = NSRange(
                location: min(selection.location, len),
                length: min(selection.length, max(0, len - selection.location))
            )
            context.coordinator.isApplyingProgrammaticChange = true
            tv.setSelectedRange(safe)
            context.coordinator.isApplyingProgrammaticChange = false
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: SelectionAwareTextViewImpl
        var isApplyingProgrammaticChange = false
        init(_ parent: SelectionAwareTextViewImpl) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard !isApplyingProgrammaticChange,
                  let tv = notification.object as? NSTextView else { return }
            parent.text = tv.string
            parent.selection = tv.selectedRange()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard !isApplyingProgrammaticChange,
                  let tv = notification.object as? NSTextView else { return }
            let r = tv.selectedRange()
            if parent.selection != r {
                parent.selection = r
            }
        }
    }
}

#else
typealias PlatformFont = UIFont

private struct SelectionAwareTextViewImpl: UIViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRange
    let font: UIFont

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.delegate = context.coordinator
        tv.font = font
        tv.autocapitalizationType = .none
        tv.autocorrectionType = .no
        tv.spellCheckingType = .no
        tv.smartQuotesType = .no
        tv.smartDashesType = .no
        context.coordinator.isApplyingProgrammaticChange = true
        tv.text = text
        context.coordinator.isApplyingProgrammaticChange = false
        tv.textContainerInset = UIEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        // During IME composition the text view owns its marked-text range;
        // any external mutation would break Chinese/Japanese/Korean input.
        guard tv.markedTextRange == nil else { return }

        if tv.text != text {
            let oldSel = tv.selectedRange
            context.coordinator.isApplyingProgrammaticChange = true
            tv.text = text
            let newLen = (text as NSString).length
            let clampedLoc = min(oldSel.location, newLen)
            tv.selectedRange = NSRange(location: clampedLoc, length: 0)
            context.coordinator.isApplyingProgrammaticChange = false
            DispatchQueue.main.async {
                if selection.location != clampedLoc || selection.length != 0 {
                    selection = NSRange(location: clampedLoc, length: 0)
                }
            }
        } else if tv.selectedRange != selection {
            let len = (text as NSString).length
            let safe = NSRange(
                location: min(selection.location, len),
                length: min(selection.length, max(0, len - selection.location))
            )
            context.coordinator.isApplyingProgrammaticChange = true
            tv.selectedRange = safe
            context.coordinator.isApplyingProgrammaticChange = false
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: SelectionAwareTextViewImpl
        var isApplyingProgrammaticChange = false
        init(_ parent: SelectionAwareTextViewImpl) { self.parent = parent }

        func textViewDidChange(_ tv: UITextView) {
            guard !isApplyingProgrammaticChange else { return }
            parent.text = tv.text
            parent.selection = tv.selectedRange
        }

        func textViewDidChangeSelection(_ tv: UITextView) {
            guard !isApplyingProgrammaticChange else { return }
            if parent.selection != tv.selectedRange {
                parent.selection = tv.selectedRange
            }
        }
    }
}
#endif
