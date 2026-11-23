import Foundation

/// Today's numbers shared from the app to the home-screen widget through the App Group.
struct WidgetSnapshot: Codable, Equatable {
    var date: String            // local YYYY-MM-DD the numbers belong to
    var updatedAt: Date
    var lang: String            // "ar" | "en"
    var leftKcal: Double?
    var targetKcal: Double?
    var eatenKcal: Double
    var burnKcal: Double?
    var expectedBurnKcal: Double?
    var proteinG: Double
    var proteinTargetG: Double?
    var waterMl: Double?
    var waterTargetMl: Double?
    var steps: Double?
    var stepsGoal: Double?

    static let appGroup = "group.ae.sheen.straineat"
    private static let key = "widgetSnapshot"

    static func load() -> WidgetSnapshot? {
        guard let d = UserDefaults(suiteName: appGroup)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: d)
    }
    func save() {
        guard let d = try? JSONEncoder().encode(self) else { return }
        UserDefaults(suiteName: Self.appGroup)?.set(d, forKey: Self.key)
    }

    static var todayKey: String {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
    var isToday: Bool { date == Self.todayKey }

    static let placeholder = WidgetSnapshot(date: todayKey, updatedAt: Date(), lang: "en", leftKcal: 820, targetKcal: 1900, eatenKcal: 1080, burnKcal: 1650,
                                            expectedBurnKcal: 2300, proteinG: 72, proteinTargetG: 120, waterMl: 1400, waterTargetMl: 2200, steps: 6240, stepsGoal: 8000)
}
