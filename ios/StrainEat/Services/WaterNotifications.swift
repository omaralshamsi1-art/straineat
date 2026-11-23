import Foundation
import UserNotifications

/// Local water nudges for today at 11:00 / 14:00 / 17:00 / 20:00 (ids "water-<hour>").
/// Re-planned after every refresh or tap: a nudge stays only if, without drinking more,
/// you'd be ≥500 ml behind the expected pace at that time. Off on fasting days.
enum WaterNotifications {
    static let enabledKey = "waterReminders"
    private static let checks = [11, 14, 17, 20]

    static func sync(_ w: WaterDay, fastingDay: Bool) async {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: checks.map { "water-\($0)" })
        guard UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true, !fastingDay, let target = w.targetMl,
              w.date == DateFormatter.isoDay.string(from: Date()) else { return }
        guard await center.notificationSettings().authorizationStatus == .authorized else { return }
        let cal = Calendar.current
        for h in checks {
            guard let at = cal.date(bySettingHour: h, minute: 0, second: 0, of: Date()), at > Date() else { continue }
            let share = max(0, min(1, Double(h * 60 - 8 * 60) / Double(14 * 60)))
            let behind = target * share - w.intakeMl
            guard behind >= 500 else { continue }
            let c = UNMutableNotificationContent()
            c.title = t("Drink some water 💧", "اشرب ماء 💧")
            c.body = t("You're behind on water for this time of day — a glass now helps.", "أنت متأخر عن هدف الماء لهالوقت — كوب الحين يقربك.")
            c.sound = .default
            let dc = cal.dateComponents([.year, .month, .day, .hour, .minute], from: at)
            try? await center.add(UNNotificationRequest(identifier: "water-\(h)", content: c, trigger: UNCalendarNotificationTrigger(dateMatching: dc, repeats: false)))
        }
    }
}
