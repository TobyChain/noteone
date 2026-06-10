import SwiftUI

enum AppTheme: String, CaseIterable {
    case system, light, dark

    var label: String {
        switch self {
        case .system: "跟随系统"
        case .light: "浅色"
        case .dark: "深色"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

extension Color {
    static let canvas = Color("Canvas")
    static let canvasSecondary = Color("CanvasSecondary")
    static let ink = Color("Ink")
    static let inkSecondary = Color("InkSecondary")
    static let inkTertiary = Color("InkTertiary")
    static let accent = Color("Accent")
    static let hairline = Color("Hairline")
    static let tagBackground = Color("TagBackground")
}

extension View {
    func applyTheme(_ theme: AppTheme) -> some View {
        self.preferredColorScheme(theme.colorScheme)
    }
}
