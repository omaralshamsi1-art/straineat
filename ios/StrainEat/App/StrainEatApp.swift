import SwiftUI

@main
struct StrainEatApp: App {
    @State private var store = AppStore()
    @Environment(\.scenePhase) private var phase
    @AppStorage(appLanguageKey) private var lang = "en"
    @AppStorage(appThemeKey) private var theme = "dark"

    init() { styleTabBar() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(\.layoutDirection, lang == "ar" ? .rightToLeft : .leftToRight)
                .environment(\.locale, appLocale)
                .id(lang) // rebuild every screen when the language changes
                .tint(Theme.brand2)
                .onAppear { applyAppTheme(theme) }
                .onChange(of: phase) { _, p in
                    if p == .active, store.signedIn { Task { await store.refresh() } }
                }
                .onReceive(NotificationCenter.default.publisher(for: .strainEatUnauthorized)) { _ in
                    store.handleUnauthorized()
                }
        }
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store
    @State private var tab = UserDefaults.standard.integer(forKey: "initialTab")
    @State private var tabBeforeSnap = 0
    @State private var showAssistant = UserDefaults.standard.bool(forKey: "openAssistant")
    @State private var aiConsentModel = AIConsent.shared
    private var screenName: String { ["today", "progress", "snap", "plan"][min(max(tab, 0), 3)] }

    var body: some View {
        @Bindable var store = store
        @Bindable var aiConsent = aiConsentModel
        Group {
            if !store.signedIn {
                AuthView()
            } else {
                TabView(selection: $tab) {
                    TodayView(onLog: { tab = 2 }, onFavourites: { UserDefaults.standard.set("favorites", forKey: "logMode"); tab = 2 })
                        .tag(0).tabItem { Label(t("Today", "اليوم"), systemImage: "sun.max.fill") }
                    ProgressTab()
                        .tag(1).tabItem { Label(t("Progress", "التقدم"), systemImage: "chart.line.uptrend.xyaxis") }
                    LogView(active: tab == 2, onLogged: { tab = 0 }, onClose: { tab = tabBeforeSnap })
                        .tag(2).tabItem { Label(t("Log meal", "سجّل وجبة"), systemImage: "plus.circle.fill") }
                    PlanTab()
                        .tag(3).tabItem { Label(t("Plan", "الخطة"), systemImage: "target") }
                }
                .task {
                    if !UserDefaults.standard.bool(forKey: "screenshotMode") {
                        try? await HealthKitManager.shared.requestAuthorization()
                        HealthKitManager.shared.enableBackgroundSync()
                    }
                    await store.refresh()
                }
                .overlay(alignment: .bottomTrailing) {
                    AskFab { showAssistant = true }
                        .padding(.trailing, 16)
                        .padding(.bottom, 64)
                }
                .onReceive(NotificationCenter.default.publisher(for: .openAssistant)) { _ in showAssistant = true }
                .onChange(of: tab) { old, _ in if old != 2 { tabBeforeSnap = old } }
                .onReceive(NotificationCenter.default.publisher(for: .openProgress)) { _ in tab = 1 }
                .onReceive(NotificationCenter.default.publisher(for: .openPlan)) { _ in tab = 3 }
                .onOpenURL { url in if url.host == "today" { tab = 0 } } // from the home-screen widget
                .sheet(isPresented: $aiConsent.asking) { AIConsentSheet() }
                .sheet(isPresented: $showAssistant) {
                    AssistantView(screen: screenName, onChanged: { Task { await store.refresh() } })
                        .environment(\.layoutDirection, appLayoutDirection)
                }
                .fullScreenCover(isPresented: $store.needsOnboarding) {
                    OnboardingView().environment(store).environment(\.layoutDirection, appLayoutDirection)
                }
            }
        }
    }
}

/// App-wide state: who is signed in and today's numbers.
@MainActor @Observable
final class AppStore {
    var balance: Balance?
    var motivation: Motivation?
    var me: AuthUser?
    var error: String?
    var isLoading = false
    var needsOnboarding = false
    var day = Date()
    var whoopConnected = UserDefaults.standard.bool(forKey: "whoopConnected")
    var signedIn: Bool = AppStore.hasCredentials()
    private var languageSynced = false

    var isOwner: Bool { me?.role == "owner" }
    var isToday: Bool { Calendar.current.isDateInToday(day) }
    var selectedDateKey: String { DateFormatter.isoDay.string(from: day) }

    static func hasCredentials() -> Bool {
        let d = UserDefaults.standard
        return !(d.string(forKey: "apiKey") ?? "").isEmpty || !(d.string(forKey: "accessToken") ?? "").isEmpty
    }

    /// Bumped on every refresh so cards that load their own data (schedule…) reload too.
    var refreshTick = 0

    /// `force` = pull-to-refresh: sync WHOOP now instead of waiting for the 15-minute throttle.
    func refresh(force: Bool = false) async {
        isLoading = true
        defer { isLoading = false; refreshTick += 1 }
        await HealthKitManager.shared.syncBurnToServer()
        await HealthKitManager.shared.syncWorkoutsToServer()
        await HealthKitManager.shared.syncWaterToServer()
        await HealthKitManager.shared.syncStepsToServer()
        if whoopConnected {
            let lastSync = UserDefaults.standard.double(forKey: "whoopLastSync")
            if force || Date().timeIntervalSince1970 - lastSync > 15 * 60 { // at most every 15 min unless pulled
                let from = Calendar.current.date(byAdding: .day, value: -2, to: Date())!
                if (try? await APIClient.shared.whoopSync(from: from, to: Date())) != nil {
                    UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "whoopLastSync")
                }
            }
        }
        do {
            let b = try await APIClient.shared.balance(date: day)
            balance = b
            error = nil
            if b.onboarded == false && isToday { needsOnboarding = true }
        } catch {
            self.error = error.localizedDescription
        }
        if !languageSynced { // AI texts and notifications follow the app language
            languageSynced = true
            _ = try? await APIClient.shared.updateProfile(["language": appLang.rawValue])
        }
        if me == nil { me = try? await APIClient.shared.me() }
        if isToday { motivation = try? await APIClient.shared.motivation() }
        if isToday, balance != nil { // home-screen widget
            async let w = try? APIClient.shared.water()
            async let st = try? APIClient.shared.steps()
            WidgetBridge.update(balance: balance, water: await w, steps: await st)
        }
    }

    func shiftDay(_ d: Int) {
        guard let next = Calendar.current.date(byAdding: .day, value: d, to: day), next <= Date() else { return }
        day = next
        Task { await refresh() }
    }

    func setWhoop(_ on: Bool) {
        whoopConnected = on
        UserDefaults.standard.set(on, forKey: "whoopConnected")
    }

    func signIn(token: String, user: AuthUser) {
        let d = UserDefaults.standard
        d.set(token, forKey: "accessToken")
        d.set("", forKey: "apiKey")
        me = user
        signedIn = true
    }

    func signInOwner(apiKey: String, userId: String) {
        let d = UserDefaults.standard
        d.set(apiKey, forKey: "apiKey")
        d.set(userId, forKey: "devUserId")
        signedIn = true
    }

    func signOut() {
        let d = UserDefaults.standard
        d.set("", forKey: "accessToken")
        d.set("", forKey: "apiKey")
        balance = nil; motivation = nil; me = nil
        signedIn = false
    }

    func handleUnauthorized() {
        // Only an expired account token signs the user out; a wrong owner key is fixed in settings.
        if !(UserDefaults.standard.string(forKey: "accessToken") ?? "").isEmpty,
           (UserDefaults.standard.string(forKey: "apiKey") ?? "").isEmpty {
            signOut()
            error = t("Session expired — please sign in again", "انتهت الجلسة — سجّل الدخول مرة أخرى")
        }
    }
}
