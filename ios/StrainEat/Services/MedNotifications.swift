import Foundation
import UserNotifications

/// Daily local notifications for the user's medicine / vitamin reminders (ids "med-<id>-<HH:MM>").
enum MedNotifications {
    static func sync(_ meds: [MedReminder]) async {
        let center = UNUserNotificationCenter.current()
        let old = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix("med-") }
        center.removePendingNotificationRequests(withIdentifiers: old)
        guard meds.contains(where: \.enabled) else { return }
        guard (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) == true else { return }
        for m in meds where m.enabled {
            for tm in m.times {
                let p = tm.split(separator: ":").compactMap { Int($0) }
                guard p.count == 2 else { continue }
                var dc = DateComponents(); dc.hour = p[0]; dc.minute = p[1]
                let c = UNMutableNotificationContent()
                let icon = m.kind == "vitamin" || m.kind == "supplement" ? "🌿" : "💊"
                c.title = t("\(icon) Time for \(m.name)", "\(icon) وقت \(m.name)")
                c.body = (m.dose.isEmpty ? "" : "\(m.dose) · ") + t("Scheduled for \(tm).", "موعدك الساعة \(tm).")
                c.sound = .default
                try? await center.add(UNNotificationRequest(identifier: "med-\(m.id)-\(tm)", content: c,
                                                            trigger: UNCalendarNotificationTrigger(dateMatching: dc, repeats: true)))
            }
        }
    }
}
