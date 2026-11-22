import SwiftUI
import UIKit

/// Same palette as the web app (light + dark).
enum Theme {
    static let bg = dyn(0xFFFFFF, 0x0B0B0C)
    static let card = dyn(0xF1F1F2, 0x1C1C1E)
    static let card2 = dyn(0xFFFFFF, 0x2A2A2D)
    static let ink = dyn(0x111113, 0xF5F5F7)
    static let muted = dyn(0x6E6E73, 0xA1A1A6)
    static let line = dyn(0xE3E3E6, 0x2F2F33)
    static let brand = dyn(0x111113, 0xF3EF9E)
    static let brand2 = dyn(0x3B2A78, 0xC9BDE8)
    static let brandSoft = dyn(0xECE8F8, 0x2B2540)
    static let accent = dyn(0xF3EF9E, 0xE9E48A)
    static let accentSoft = dyn(0xFAF7CF, 0x3A3820)
    // pastel tiles (light text never sits on these: always dark ink)
    static let yellow = dyn(0xF3EF9E, 0xE9E48A)
    static let lavender = dyn(0xC9BDE8, 0xB8A9E0)
    static let sky = dyn(0xBDE4F6, 0xA6D6EC)
    static let pink = dyn(0xF4CCC3, 0xE8B8AD)
    static let mint = dyn(0xB2E2B2, 0x9FD59F)
    static let mintSoft = dyn(0xE7F5E7, 0x1D2D1D)
    static let plum = dyn(0x3B2A78, 0x2B2540)
    static let onPastel = Color(UIColor(hex: 0x111113))
    static let protein = dyn(0x3B6FD8, 0x7AA2F5)
    static let carbs = dyn(0xE09A2C, 0xF0B04F)
    static let fat = dyn(0xD0567A, 0xEC7FA0)
    static let fiber = dyn(0x2F8F5B, 0x6CC995)
    static let good = dyn(0x1D7A3E, 0x7FD69A)
    static let goodSoft = dyn(0xDFF2DF, 0x1A2E1F)
    static let bad = dyn(0xD23B2A, 0xFF7B6B)
    static let badSoft = dyn(0xFDE4E0, 0x3D1B16)
    static let warn = dyn(0x8A6D00, 0xF0D36A)
    static let ringTrack = dyn(0xE6E6E9, 0x2C2C30)

    /// Green when within / on the good side of the target, red when over / negative.
    static func status(_ ok: Bool) -> Color { ok ? good : bad }
    static func statusSoft(_ ok: Bool) -> Color { ok ? goodSoft : badSoft }

    private static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

// MARK: Building blocks

struct Card<Content: View>: View {
    var title: String? = nil
    var icon: String? = nil
    var trailing: AnyView? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if title != nil || trailing != nil {
                HStack(spacing: 6) {
                    if let icon { Image(systemName: icon).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted) }
                    if let title { Text(title).font(.title3.weight(.heavy)).tracking(-0.3).foregroundStyle(Theme.ink) }
                    Spacer()
                    if let trailing { trailing }
                }
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

struct Chip: View {
    let text: String
    var icon: String? = nil
    var fg: Color = Theme.brand2
    var bg: Color = Theme.brandSoft
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon) }
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 10).padding(.vertical, 5)
        .foregroundStyle(fg)
        .background(bg, in: Capsule())
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var color: Color = Theme.brand
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(Theme.bg)
            .background(color.opacity(configuration.isPressed ? 0.8 : 1), in: Capsule())
    }
}

struct SoftButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .foregroundStyle(Theme.ink)
            .background(Theme.card2.opacity(configuration.isPressed ? 0.7 : 1), in: Capsule())
            .overlay(Capsule().stroke(Theme.line))
    }
}

struct Notice: View {
    let text: String
    var level: String = "info"
    var body: some View {
        let warn = level == "warn" || level == "warning"
        let danger = level == "danger" || level == "error"
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: danger ? "exclamationmark.octagon.fill" : warn ? "exclamationmark.triangle.fill" : "info.circle.fill")
            Text(text).font(.footnote).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .foregroundStyle(danger ? Theme.bad : warn ? Theme.warn : Theme.brand2)
        .background(danger ? Theme.badSoft : warn ? Theme.accentSoft : Theme.brandSoft, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// Progress bar for one nutrient against its target.
struct MacroProgress: View {
    let title: String
    let value: Double
    let target: Double?
    let color: Color
    var unit = t("g", "غ")
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title).font(.caption).foregroundStyle(Theme.muted)
                Spacer()
                Text(target.map { "\(fmt(value)) / \(fmt($0)) \(unit)" } ?? "\(fmt(value)) \(unit)")
                    .font(.caption.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.ringTrack)
                    Capsule().fill(color)
                        .frame(width: g.size.width * min(1, (target ?? 0) > 0 ? value / target! : 0))
                }
            }
            .frame(height: 7)
        }
    }
}

// MARK: Formatting

func fmt(_ v: Double) -> String { guard v.isFinite else { return "—" }; return Int(v.rounded()).formatted(.number.locale(Locale(identifier: "en_US"))) }
func fmt1(_ v: Double) -> String { v.formatted(.number.precision(.fractionLength(0...1)).locale(Locale(identifier: "en_US"))) }
/// "+1,130" / "−450" — always shown left-to-right so the sign stays in front of the number.
func signed(_ v: Double) -> String {
    guard v.isFinite else { return "—" }
    let n = Int(v.rounded())
    return ltr((n > 0 ? "+" : n < 0 ? "−" : "") + abs(n).formatted(.number.locale(Locale(identifier: "en_US"))))
}
/// Signed kg value ("+0.4 كغ" / "−1.2 كغ"), sign kept in front in Arabic text.
func signedKg(_ v: Double) -> String { ltr((v > 0 ? "+" : v < 0 ? "−" : "") + fmt1(abs(v))) + t(" kg", " كغ") }
/// Left-to-right isolate so signs and ranges are not reordered inside Arabic text.
func ltr(_ s: String) -> String { "\u{202A}" + s + "\u{202C}" }

extension Date {
    var arDayMonth: String { formatted(.dateTime.day().month(.wide).locale(appLocale)) }
    var arWeekday: String { formatted(.dateTime.weekday(.wide).locale(appLocale)) }
    var arMonthYear: String { formatted(.dateTime.month(.wide).year().locale(appLocale)) }
    var arTime: String { formatted(.dateTime.hour().minute().locale(appLocale)) }
}

func sourceName(_ s: String) -> String {
    ["apple_health": "Apple Health", "whoop": "WHOOP", "health_connect": "Health Connect",
     "garmin": "Garmin", "fitbit": "Fitbit", "manual": t("Manual", "يدوي"), "estimate": t("Estimate", "تقدير"), "formula": t("Formula", "معادلة"),
     "device": t("Your device", "جهازك"), "adaptive": t("From your data", "من بياناتك")][s] ?? s
}

func sportIcon(_ kind: String?) -> String {
    switch kind {
    case "run": return "figure.run"
    case "walk": return "figure.walk"
    case "bike": return "figure.outdoor.cycle"
    case "strength": return "dumbbell.fill"
    case "swim": return "figure.pool.swim"
    case "hiit": return "figure.highintensity.intervaltraining"
    case "mind": return "figure.mind.and.body"
    case "racket": return "figure.tennis"
    case "team": return "figure.soccer"
    case "combat": return "figure.boxing"
    default: return "figure.mixed.cardio"
    }
}

extension View {
    func screenBackground() -> some View { background(Theme.bg.ignoresSafeArea()) }
}

// MARK: Quick links (pastel tiles, like the web app)

struct QuickTile: View {
    let title: String
    let icon: String
    let color: Color
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 0) {
                Image(systemName: icon).font(.title3.weight(.semibold)).foregroundStyle(Theme.onPastel)
                    .frame(maxWidth: .infinity).frame(height: 58).background(color)
                Text(title).font(.caption.weight(.bold)).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.8)
                    .padding(.vertical, 9).padding(.horizontal, 2)
            }
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// Dark floating-style tab bar with a yellow selected item.
@MainActor func styleTabBar() {
    let a = UITabBarAppearance()
    a.configureWithOpaqueBackground()
    a.backgroundColor = UIColor(hex: 0x3A3A3C)
    a.shadowColor = .clear
    for layout in [a.stackedLayoutAppearance, a.inlineLayoutAppearance, a.compactInlineLayoutAppearance] {
        layout.normal.iconColor = UIColor.white.withAlphaComponent(0.55)
        layout.normal.titleTextAttributes = [.foregroundColor: UIColor.white.withAlphaComponent(0.55)]
        layout.selected.iconColor = UIColor(hex: 0xF3EF9E)
        layout.selected.titleTextAttributes = [.foregroundColor: UIColor(hex: 0xF3EF9E)]
    }
    UITabBar.appearance().standardAppearance = a
    UITabBar.appearance().scrollEdgeAppearance = a
}

extension Notification.Name {
    static let openAssistant = Notification.Name("openAssistant")
    static let openProgress = Notification.Name("openProgress")
    static let openPlan = Notification.Name("openPlan")
}
