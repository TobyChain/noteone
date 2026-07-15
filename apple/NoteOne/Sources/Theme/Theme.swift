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

// MARK: - Color Tokens

extension Color {
    static let canvas = Color("Canvas")
    static let canvasSecondary = Color("CanvasSecondary")
    static let ink = Color("Ink")
    static let inkSecondary = Color("InkSecondary")
    static let inkTertiary = Color("InkTertiary")
    static let accent = Color("Accent")
    static let hairline = Color("Hairline")
    static let tagBackground = Color("TagBackground")

    // Semantic colors
    static let success = Color.green
    static let danger = Color.red
    static let warning = Color.orange
    static let info = Color.accent

    // Tag dimension colors
    static let tagFormat = Color.blue
    static let tagTopic = Color.green
    static let tagDomain = Color.orange
    static let tagModule = Color.purple
}

// MARK: - Design Tokens

enum DG {
    // Spacing
    static let sp4: CGFloat = 4
    static let sp8: CGFloat = 8
    static let sp12: CGFloat = 12
    static let sp16: CGFloat = 16
    static let sp20: CGFloat = 20
    static let sp24: CGFloat = 24
    static let sp32: CGFloat = 32

    // Corner radii
    static let r6: CGFloat = 6
    static let r8: CGFloat = 8
    static let r12: CGFloat = 12
    static let r16: CGFloat = 16

    // Icon sizes
    static let iconSM: CGFloat = 14
    static let iconMD: CGFloat = 16
    static let iconLG: CGFloat = 20
    static let iconXL: CGFloat = 28
    static let iconEmpty: CGFloat = 48
}

// MARK: - Shared View Modifiers

extension View {
    func applyTheme(_ theme: AppTheme) -> some View {
        self.preferredColorScheme(theme.colorScheme)
    }

    /// Standard card background: canvas surface with hairline border and 8pt corners.
    func cardStyle(padding: CGFloat = DG.sp16) -> some View {
        self
            .padding(padding)
            .background(Color.canvasSecondary)
            .clipShape(RoundedRectangle(cornerRadius: DG.r8))
            .overlay(
                RoundedRectangle(cornerRadius: DG.r8)
                    .stroke(Color.hairline, lineWidth: 0.5)
            )
    }

    /// Tinted info banner background.
    func bannerStyle(tint: Color) -> some View {
        self
            .padding(DG.sp12)
            .background(tint.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: DG.r8))
    }

    /// Section header label with icon.
    func sectionHeaderStyle() -> some View {
        self
            .font(.caption.bold())
            .foregroundStyle(Color.inkSecondary)
            .textCase(nil)
    }
}

// MARK: - Reusable Empty State

struct EmptyStateView: View {
    let icon: String
    let title: String
    let subtitle: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: DG.sp12) {
            Image(systemName: icon)
                .font(.system(size: DG.iconEmpty))
                .foregroundStyle(Color.inkTertiary)
            Text(title)
                .font(.headline)
                .foregroundStyle(Color.inkSecondary)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(Color.inkTertiary)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.bordered)
                    .controlSize(.regular)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Reusable Tag Pill

struct TagPill: View {
    let text: String
    var color: Color = .accent

    var body: some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(color)
            .padding(.horizontal, DG.sp8)
            .padding(.vertical, DG.sp4)
            .background(color.opacity(0.1))
            .clipShape(Capsule())
    }
}
