import Foundation

/// Returns the localized string based on the user's language preference.
/// - Parameters:
///   - zh: Chinese text (default)
///   - en: English text
/// - Returns: The appropriate string based on `appLanguage` in UserDefaults.
func L(_ zh: String, _ en: String) -> String {
    let lang = UserDefaults.standard.string(forKey: "appLanguage") ?? "zh"
    return lang == "en" ? en : zh
}

/// Localizes date group labels used in note/ascan list grouping.
/// The internal grouping keys remain Chinese; this function only translates
/// the display text shown to the user.
func LDateGroup(_ zh: String) -> String {
    let lang = UserDefaults.standard.string(forKey: "appLanguage") ?? "zh"
    guard lang == "en" else { return zh }
    switch zh {
    case "今日", "今天": return "Today"
    case "昨日", "昨天": return "Yesterday"
    case "本周": return "This Week"
    case "本月": return "This Month"
    case "更早": return "Earlier"
    default: return zh
    }
}
