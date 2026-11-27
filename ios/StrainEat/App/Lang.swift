import SwiftUI

/// UI language. English is the default; Arabic switches the layout to right-to-left.
enum AppLang: String, CaseIterable, Identifiable {
    case en, ar
    var id: String { rawValue }
    var title: String { self == .en ? "English" : "العربية" }
}

let appLanguageKey = "appLanguage"

var appLang: AppLang { AppLang(rawValue: UserDefaults.standard.string(forKey: appLanguageKey) ?? "en") ?? .en }
var appLocale: Locale { Locale(identifier: appLang == .ar ? "ar" : "en_GB") }
var appLayoutDirection: LayoutDirection { appLang == .ar ? .rightToLeft : .leftToRight }

/// Pick the string for the current UI language.
func t(_ en: String, _ ar: String) -> String { appLang == .ar ? ar : en }

/// Pick a server-provided text: English variant when available, Arabic otherwise.
func pick(_ en: String?, _ ar: String?) -> String {
    appLang == .ar ? (ar ?? en ?? "") : ((en?.isEmpty == false ? en : nil) ?? ar ?? "")
}

/// English / العربية switch used on the sign-in screen and in Plan settings.
struct LanguagePicker: View {
    @AppStorage(appLanguageKey) private var lang = "en"
    var body: some View {
        Picker("Language", selection: Binding(get: { lang }, set: { v in
            lang = v
            Task { _ = try? await APIClient.shared.updateProfile(["language": v]) }
        })) {
            ForEach(AppLang.allCases) { Text($0.title).tag($0.rawValue) }
        }
        .pickerStyle(.segmented)
    }
}

// MARK: Appearance (in-app setting, independent of the iPhone's own setting)

let appThemeKey = "appTheme"

/// Applies light / dark / system to every window (also covers sheets and UIKit views).
@MainActor func applyAppTheme(_ value: String) {
    let style: UIUserInterfaceStyle = value == "light" ? .light : value == "dark" ? .dark : .unspecified
    for scene in UIApplication.shared.connectedScenes {
        (scene as? UIWindowScene)?.windows.forEach { $0.overrideUserInterfaceStyle = style }
    }
}

struct ThemePicker: View {
    @AppStorage(appThemeKey) private var theme = "dark"
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker(t("Appearance", "المظهر"), selection: $theme) {
                Text(t("Auto", "تلقائي")).tag("system")
                Text(t("Light", "فاتح")).tag("light")
                Text(t("Dark", "داكن")).tag("dark")
            }
            .pickerStyle(.segmented)
            Text(t("Auto follows your iPhone setting.", "تلقائي = يتبع إعداد الآيفون.")).font(.caption).foregroundStyle(Theme.muted)
        }
        .onChange(of: theme) { _, v in applyAppTheme(v) }
    }
}

/// Small / normal / large text across the app (replaces the iPhone text size inside StrainEat).
func displaySizeType(_ v: String) -> DynamicTypeSize {
    switch v { case "sm": return .medium; case "lg": return .xLarge; default: return .large }
}

struct DisplaySizePicker: View {
    @AppStorage("displaySize") private var size = "md"
    var body: some View {
        Picker(t("Display size", "حجم العرض"), selection: $size) {
            Text(t("Small", "صغير")).tag("sm")
            Text(t("Normal", "عادي")).tag("md")
            Text(t("Large", "كبير")).tag("lg")
        }
        .pickerStyle(.segmented)
    }
}
