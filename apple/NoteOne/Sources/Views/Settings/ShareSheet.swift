#if !os(macOS)
import SwiftUI
import UIKit

/// SwiftUI wrapper around UIActivityViewController so the user can save / share the
/// exported zip file.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#endif
