import SwiftUI

// MARK: - Palette

/// One built-in theme: the 12 semantic tokens shared by native views and the
/// web reader. Decoded from `server/public/reader/themes.json`, the single
/// source of truth for both sides.
struct Palette: Identifiable {
    let id: String
    /// Proper name from the table (kept identical across locales); falls back to the id.
    let name: String

    var displayName: String { name.isEmpty ? id : name }
    let scheme: ColorScheme
    let canvas: Color
    let surface: Color
    let ink: Color
    let inkSecondary: Color
    let inkTertiary: Color
    let hairline: Color
    let accent: Color
    let series: [Color]
    /// Relative luminance of the accent fill (0-1); decides which text reads on it.
    let accentLuminance: Double

    /// Text color that stays legible on accent fills. The luminance cutoff is
    /// where white text stops clearing 4.5:1 (lum 0.18): every shipped accent
    /// sits above it, so they all take deep ink (~7:1); only very dark accents
    /// (lum <= 0.18, e.g. navy) flip to white.
    var onAccent: Color { accentLuminance > 0.18 ? Color(hex: "#1D1D1F") : .white }

    /// WCAG relative luminance of a #RRGGBB string.
    static func luminance(_ hex: String) -> Double {
        var value: UInt64 = 0
        Scanner(string: hex.hasPrefix("#") ? String(hex.dropFirst()) : hex).scanHexInt64(&value)
        func channel(_ raw: UInt64) -> Double {
            let c = Double(raw & 0xFF) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(value >> 16) + 0.7152 * channel(value >> 8) + 0.0722 * channel(value)
    }

    /// Offline fallback mirroring the defaultLight/defaultDark entries of
    /// server/public/reader/themes.json (keep the two in sync). With these
    /// bundled, a missing /reader route degrades to the default pair instead
    /// of locking a saved dark theme to light or losing brand accent.
    static let builtinDefaults: [Palette] = [
        Palette(
            id: "defaultLight", name: "Default Light", scheme: .light,
            canvas: Color(hex: "#FBFAF6"), surface: Color(hex: "#F3EFE5"),
            ink: Color(hex: "#1A1C2C"), inkSecondary: Color(hex: "#3B3F5C"),
            inkTertiary: Color(hex: "#6C7395"), hairline: Color(hex: "#E6DFCD"),
            accent: Color(hex: "#D96F3A"),
            series: ["#D26C38", "#472DCF", "#0088FF", "#00A03C", "#CB30E0"].map(Color.init(hex:)),
            accentLuminance: Palette.luminance("#D96F3A")
        ),
        Palette(
            id: "defaultDark", name: "Default Dark", scheme: .dark,
            canvas: Color(hex: "#1C1C1E"), surface: Color(hex: "#28282A"),
            ink: Color(hex: "#F5F5F7"), inkSecondary: Color(hex: "#9E9EA3"),
            inkTertiary: Color(hex: "#707075"), hairline: Color(hex: "#38383A"),
            accent: Color(hex: "#588EFF"),
            series: ["#0091FF", "#FF4245", "#C401DB", "#009E38", "#007E9C"].map(Color.init(hex:)),
            accentLuminance: Palette.luminance("#588EFF")
        ),
    ]
}

extension Palette: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, name, scheme, canvas, surface, ink, inkSecondary, inkTertiary, hairline, accent, series
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let accentHex = try c.decode(String.self, forKey: .accent)
        let series = try c.decode([String].self, forKey: .series)
        // Tag dimensions pin series slots 0...3; a shorter table would crash
        // those views, so reject it at the boundary instead of indexing guardedly.
        guard series.count >= 4 else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: c.codingPath,
                debugDescription: "palette \(try c.decode(String.self, forKey: .id)) needs >= 4 series colors"
            ))
        }
        self.init(
            id: try c.decode(String.self, forKey: .id),
            name: (try? c.decode(String.self, forKey: .name)) ?? "",
            scheme: try c.decode(String.self, forKey: .scheme) == "dark" ? .dark : .light,
            canvas: Color(hex: try c.decode(String.self, forKey: .canvas)),
            surface: Color(hex: try c.decode(String.self, forKey: .surface)),
            ink: Color(hex: try c.decode(String.self, forKey: .ink)),
            inkSecondary: Color(hex: try c.decode(String.self, forKey: .inkSecondary)),
            inkTertiary: Color(hex: try c.decode(String.self, forKey: .inkTertiary)),
            hairline: Color(hex: try c.decode(String.self, forKey: .hairline)),
            accent: Color(hex: accentHex),
            series: series.map(Color.init(hex:)),
            accentLuminance: Palette.luminance(accentHex)
        )
    }
}

// MARK: - Text Size

/// Text size preference covering both native text and web reading content.
/// "standard" leaves Dynamic Type to the system setting; the other steps pin
/// an absolute size so the choice is predictable.
enum TextSize: String, CaseIterable, Identifiable {
    case small, standard, large

    var id: String { rawValue }

    /// nil = follow the system Dynamic Type setting (no override applied).
    var dynamicTypeSize: DynamicTypeSize? {
        switch self {
        case .small: .medium
        case .standard: nil
        case .large: .xxLarge
        }
    }

    /// Whole-page zoom for web content, where per-element scaling is not reachable.
    var pageZoom: CGFloat {
        switch self {
        case .small: 0.9
        case .standard: 1
        case .large: 1.2
        }
    }

    var label: String {
        switch self {
        case .small: L("小", "Small")
        case .standard: L("标准", "Standard")
        case .large: L("大", "Large")
        }
    }
}

// MARK: - Theme Store

/// App-wide theme state.
///
/// The store starts from the bundled default pair and adopts the server table
/// once it arrives. If the fetch fails, the app keeps rendering with the
/// defaults, so presentation assets never block or break startup.
@MainActor
@Observable
final class ThemeStore {
    static let shared = ThemeStore()

    enum Selection: Hashable {
        case system
        case fixed(String)
    }

    /// Starts from the bundled default pair so the picker, saved selections and
    /// brand accent survive even when the server table cannot be fetched.
    private(set) var palettes: [Palette] = Palette.builtinDefaults
    /// The window's effective light/dark trait; kept in sync by NoteOneApp so
    /// "follow system" can pick defaultLight vs defaultDark.
    var systemScheme: ColorScheme = .light
    var selection: Selection {
        didSet { persistSelection() }
    }
    var textSize: TextSize {
        didSet { UserDefaults.standard.set(textSize.rawValue, forKey: Self.textSizeKey) }
    }

    private static let storageKey = "appTheme"
    private static let textSizeKey = "textSize"

    private init() {
        selection = Self.loadSelection()
        textSize = TextSize(rawValue: UserDefaults.standard.string(forKey: Self.textSizeKey) ?? "") ?? .standard
    }

    /// The palette views should render with right now.
    var palette: Palette {
        switch selection {
        case .system:
            let id = systemScheme == .dark ? "defaultDark" : "defaultLight"
            return palettes.first { $0.id == id } ?? palettes.first!
        case .fixed(let id):
            return palettes.first { $0.id == id } ?? palettes.first!
        }
    }

    /// Decode and adopt a freshly fetched table; malformed data keeps the
    /// previous state (startup must not fail over presentation assets).
    func adoptTable(_ data: Data) {
        struct Table: Decodable { let themes: [Palette] }
        guard let table = try? JSONDecoder().decode(Table.self, from: data), !table.themes.isEmpty else { return }
        palettes = table.themes
    }

    /// Legacy values ("system"/"light"/"dark") map onto the new selection so
    /// existing installs keep their chosen appearance after the upgrade.
    private static func loadSelection() -> Selection {
        switch UserDefaults.standard.string(forKey: storageKey) ?? "system" {
        case "system": return .system
        case "light": return .fixed("defaultLight")
        case "dark": return .fixed("defaultDark")
        case let raw: return .fixed(raw)
        }
    }

    private func persistSelection() {
        switch selection {
        case .system: UserDefaults.standard.set("system", forKey: Self.storageKey)
        case .fixed(let id): UserDefaults.standard.set(id, forKey: Self.storageKey)
        }
    }
}

// MARK: - Color Tokens

extension Color {
    init(hex: String) {
        var value: UInt64 = 0
        Scanner(string: hex.hasPrefix("#") ? String(hex.dropFirst()) : hex).scanHexInt64(&value)
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    /// Semantic theme tokens — resolved live from ThemeStore. Reads happen
    /// inside view bodies (MainActor), so SwiftUI's observation tracking
    /// refreshes every view that touches a token when the selection changes.
    @MainActor static var canvas: Color { ThemeStore.shared.palette.canvas }
    @MainActor static var canvasSecondary: Color { ThemeStore.shared.palette.surface }
    @MainActor static var ink: Color { ThemeStore.shared.palette.ink }
    @MainActor static var inkSecondary: Color { ThemeStore.shared.palette.inkSecondary }
    @MainActor static var inkTertiary: Color { ThemeStore.shared.palette.inkTertiary }
    @MainActor static var hairline: Color { ThemeStore.shared.palette.hairline }
    @MainActor static var accent: Color { ThemeStore.shared.palette.accent }
    @MainActor static var onAccent: Color { ThemeStore.shared.palette.onAccent }

    // Semantic colors — platform-adaptive, unchanged by themes.
    static let success = Color.green
    static let danger = Color.red
    static let warning = Color.orange
    @MainActor static var info: Color { .accent }

    // Tag dimension colors: fixed series slots, so a dimension keeps its
    // identity slot in every theme instead of chasing a hue.
    @MainActor static var tagFormat: Color { ThemeStore.shared.palette.series[0] }
    @MainActor static var tagTopic: Color { ThemeStore.shared.palette.series[1] }
    @MainActor static var tagDomain: Color { ThemeStore.shared.palette.series[2] }
    @MainActor static var tagModule: Color { ThemeStore.shared.palette.series[3] }
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
    /// Apply appearance preferences: tint follows the palette accent
    /// everywhere; the window's color scheme locks to the palette only when a
    /// concrete theme is chosen ("follow system" hands control back to the
    /// OS); the text size override applies unless set to standard.
    @ViewBuilder func applyTheme() -> some View {
        let store = ThemeStore.shared
        let scheme: ColorScheme? = store.selection == .system ? nil : store.palette.scheme
        let themed = self
            .tint(store.palette.accent)
            .preferredColorScheme(scheme)
        if let size = store.textSize.dynamicTypeSize {
            themed.dynamicTypeSize(size)
        } else {
            themed
        }
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

struct InlineErrorBanner: View {
    let message: String
    let retryTitle: String?
    let retry: (() -> Void)?

    var body: some View {
        HStack(spacing: DG.sp8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.danger)
            Text(message)
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
                .lineLimit(2)
            Spacer()
            if let retryTitle, let retry {
                Button(retryTitle, action: retry)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, DG.sp12)
        .padding(.vertical, DG.sp8)
        .background(Color.danger.opacity(0.08))
    }
}

/// Inline failure state shared by data-driven screens. Every recoverable
/// request failure should be visible and offer a retry path.
struct ErrorStateView: View {
    let message: String
    let retryTitle: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: DG.sp8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.title2)
                .foregroundStyle(Color.danger)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
                .multilineTextAlignment(.center)
                .lineLimit(4)
            Button(retryTitle, action: retry)
                .buttonStyle(.bordered)
        }
        .padding(DG.sp16)
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
