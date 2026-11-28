import SwiftUI
import UIKit
import UserNotifications

/// Server alerts (activity, calories, protein, weekly summary, goal milestones) arrive through APNs.
/// Meal, water and medicine reminders stay local (the server never repeats them to this device).
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await PushRegistration.upload(hex) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {}

    /// Show banners while the app is open too.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }
}

enum PushRegistration {
    private struct Reply: Decodable { let subscribed: Bool? }

    /// Registers with APNs when notifications are allowed (no prompt here).
    @MainActor static func registerIfAllowed() async {
        let s = await UNUserNotificationCenter.current().notificationSettings()
        guard s.authorizationStatus == .authorized || s.authorizationStatus == .provisional else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Asks for permission (from a settings toggle), then registers.
    @MainActor static func requestAndRegister() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await registerIfAllowed()
    }

    /// On sign-out: detach this device from the account (best effort, at most ~5 s).
    static func unregister() async {
        guard let token = UserDefaults.standard.string(forKey: "apnsToken"), !token.isEmpty else { return }
        await withTaskGroup(of: Void.self) { g in
            g.addTask { let _: Reply? = try? await APIClient.shared.post("push/unsubscribe", ["endpoint": "apns:\(token)"]) }
            g.addTask { try? await Task.sleep(for: .seconds(5)) }
            await g.next(); g.cancelAll()
        }
    }

    static func upload(_ token: String) async {
        // one small request per launch: keeps the token tied to whoever is signed in now
        UserDefaults.standard.set(token, forKey: "apnsToken")
        let _: Reply? = try? await APIClient.shared.post("push/apns", ["token": token])
    }
}

/// Settings → Notifications: the "your day" alerts sent by the server.
struct DayAlertsCard: View {
    let profile: Profile
    @State private var v: [String: Bool] = [:]
    @State private var loaded = false
    private let items: [(String, String, String)] = [
        ("activity", "After each activity (10+ min), with calories left", "بعد كل نشاط (10 دقائق أو أكثر) مع السعرات الباقية"),
        ("calories", "Calories: at 90% and 100% of your target", "السعرات: عند 90% و100% من هدفك"),
        ("protein", "Protein in the evening if you're short", "البروتين مساءً إذا كان ناقصاً"),
        ("weekly", "Weekly summary (Sunday evening)", "ملخص الأسبوع (الأحد مساءً)"),
        ("milestones", "Milestones on your goal-weight journey", "محطات رحلتك للوزن المستهدف"),
    ]
    var body: some View {
        Card(title: t("Your day alerts", "تنبيهات يومك"), icon: "bell.badge.fill") {
            ForEach(items, id: \.0) { k, en, ar in
                Toggle(t(en, ar), isOn: Binding(get: { v[k] ?? true }, set: { nv in
                    v[k] = nv
                    Task {
                        if nv { await PushRegistration.requestAndRegister() }
                        _ = try? await APIClient.shared.updateProfile(["reminders": [
                            "meals": profile.reminders?.meals ?? true, "weight": profile.reminders?.weight ?? true, "water": profile.reminders?.water ?? true, k: nv,
                        ]])
                    }
                })).tint(Theme.brand2)
            }
            Text(t("Nothing between 11 pm and 7 am, no food alerts while you fast, and at most 6 a day (medicine reminders don't count).",
                   "لا نرسل شيئاً بين 11 مساءً و7 صباحاً، ولا تنبيهات أكل وأنت صائم، وبحد أقصى 6 تنبيهات في اليوم (تذكير الأدوية لا يُحسب)."))
                .font(.caption).foregroundStyle(Theme.muted)
        }
        .onAppear {
            guard !loaded else { return }; loaded = true
            let r = profile.reminders
            v = ["activity": r?.activity ?? true, "calories": r?.calories ?? true, "protein": r?.protein ?? true, "weekly": r?.weekly ?? true, "milestones": r?.milestones ?? true]
        }
    }
}
