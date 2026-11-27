import SwiftUI
import UserNotifications

struct PlanTab: View {
    @Environment(AppStore.self) private var store
    @State private var plan: Plan?
    @State private var profile: Profile?
    @State private var editing = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let plan { PlanSummaryCard(plan: plan, onEdit: { editing = true }) }
                    AccountCard()
                    ExtraAnalysesRow()
                    PrivacyCard(aiConsentAt: profile?.aiConsentAt)
                    DevicesCard(profile: profile, onChange: { Task { await load() } })
                    if let profile { RamadanSettingsCard(profile: profile, onSaved: { Task { await load() } }) }
                    MealRemindersCard()
                    if let profile { WaterSettingsCard(profile: profile) }
                    if let profile { MedRemindersCard(profile: profile) }
                    if let profile { ScheduleSettingsCard(profile: profile) }
                    if let profile { LocationCard(profile: profile) }
                    Card(title: t("Appearance", "المظهر"), icon: "circle.lefthalf.filled") { ThemePicker() }
                    Card(title: "Language · اللغة", icon: "globe") { LanguagePicker() }
                    if let message { Text(message).font(.footnote).foregroundStyle(Theme.muted) }
                    Text("StrainEat \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                        .font(.caption2).foregroundStyle(Theme.muted)
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle(t("Plan", "الخطة"))
            .refreshable { await store.refresh(force: true); await load() }
            .task { await load() }
            .sheet(isPresented: $editing, onDismiss: { Task { await load(); await store.refresh() } }) {
                OnboardingView(existing: profile).environment(store).environment(\.layoutDirection, appLayoutDirection)
            }
        }
    }

    private func load() async {
        async let p = APIClient.shared.plan()
        async let pr = APIClient.shared.profile()
        plan = try? await p
        profile = try? await pr
    }
}

// MARK: Plan summary

struct PlanSummaryCard: View {
    let plan: Plan
    var onEdit: () -> Void
    var body: some View {
        Card(title: t("Your daily plan", "خطتك اليومية"), icon: "target",
             trailing: AnyView(Button(t("Edit", "تعديل"), action: onEdit).font(.subheadline.weight(.semibold)))) {
            HStack(alignment: .firstTextBaseline) {
                Text(fmt(plan.targetKcal)).font(.system(size: 40, weight: .bold, design: .rounded)).monospacedDigit()
                Text(t("kcal/day", "سعرة/يوم")).foregroundStyle(Theme.muted)
                Spacer()
                Chip(text: goalName(plan.effectiveGoal))
            }
            HStack(spacing: 8) {
                macro(t("Protein", "بروتين"), plan.proteinG, Theme.protein)
                macro(t("Carbs", "كربوهيدرات"), plan.carbsG, Theme.carbs)
                macro(t("Fat", "دهون"), plan.fatG, Theme.fat)
                macro(t("Fibre", "ألياف"), plan.fiberG, Theme.fiber)
            }
            VStack(alignment: .leading, spacing: 6) {
                row(t("Daily burn (maintenance)", "حرقك اليومي (الصيانة)"), "\(fmt(plan.maintenanceKcal)) • \(sourceName(plan.maintenanceSource))")
                row(t("Daily deficit/surplus", "العجز/الفائض اليومي"), signed(plan.dailyDeltaKcal))
                if let w = plan.weeklyChangeKg, w != 0 { row(t("Expected weekly change", "التغيّر المتوقع أسبوعياً"), signedKg(w)) }
                if let bmi = plan.bmi { row(t("BMI", "مؤشر كتلة الجسم"), fmt1(bmi)) }
                if let bd = plan.burnData, plan.maintenanceSource != "device" {
                    row(t("Burn data from your watch", "قياسات الحرق من الساعة"), t("\(bd.days) of \(bd.needed) days", "\(bd.days) من \(bd.needed) أيام"))
                }
            }
            ForEach(plan.notices, id: \.self) { Notice(text: $0.text, level: $0.level) }
            IntenseAdvice(plan: plan)
            if let dc = plan.deviceCalibration {
                let how = dc.factor < 1 ? t("reads \(Int(((1 / dc.factor - 1) * 100).rounded()))% high", "تبالغ \(Int(((1 / dc.factor - 1) * 100).rounded()))%")
                    : dc.factor > 1 ? t("reads \(Int(((1 - 1 / dc.factor) * 100).rounded()))% low", "تقلّل \(Int(((1 - 1 / dc.factor) * 100).rounded()))%") : t("spot on", "مطابقة")
                Notice(text: t("Your watch's accuracy for you: \(dc.accuracyPct)% (\(how)). We correct its reading and give back 75% of extra burn instead of 50%.",
                               "دقة ساعتك عندك: \(dc.accuracyPct)% (\(how)). نصحّح قراءتها ونرجّع لك 75% من الحرق الزايد بدل 50%."), level: "info")
            }
        }
    }
    private func macro(_ label: String, _ g: Double, _ c: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(fmt(g))").font(.headline).foregroundStyle(c).monospacedDigit()
            Text(t("\(label) g", "\(label) غ")).font(.caption2).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 8)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }
    private func row(_ k: String, _ v: String, ltr: Bool = false) -> some View {
        HStack {
            Text(k).foregroundStyle(Theme.muted)
            Spacer()
            Text(v).fontWeight(.semibold).monospacedDigit()
                .environment(\.layoutDirection, ltr ? .leftToRight : appLayoutDirection)
        }
        .font(.footnote)
    }
}

// MARK: Account & invites

struct AccountCard: View {
    @Environment(AppStore.self) private var store
    @State private var invites: [Invite]?
    @State private var linkEmail = ""
    @State private var linkPass = ""
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        Card(title: t("My account", "حسابي"), icon: "person.crop.circle") {
            if let me = store.me {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(me.name ?? me.id).font(.headline)
                        Text(me.email ?? (me.role == "owner" ? t("Signed in with the owner key", "دخول بمفتاح المالك") : "")).font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    if me.role == "owner" { Chip(text: t("Owner", "المالك"), icon: "crown.fill", fg: Theme.warn, bg: Theme.accentSoft) }
                }
                if me.role == "owner" && me.account == false {
                    Divider()
                    Text(t("Link your email to sign in with a password instead of the key — your data stays as it is.", "اربط بريدك لتدخل بكلمة مرور بدل المفتاح — بياناتك الحالية تبقى كما هي.")).font(.caption).foregroundStyle(Theme.muted)
                    InputField(title: t("Email", "البريد الإلكتروني"), text: $linkEmail)
                        .textInputAutocapitalization(.never).keyboardType(.emailAddress)
                    SecureField(t("Password (at least 8 characters)", "كلمة المرور (8 أحرف على الأقل)"), text: $linkPass)
                        .padding(11).background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
                    Button(t("Link email", "ربط البريد")) { Task { await link() } }.buttonStyle(SoftButtonStyle()).disabled(busy)
                }
                if me.role == "owner" {
                    Divider()
                    HStack {
                        Text(t("Invite users", "دعوة مستخدمين")).font(.subheadline.weight(.semibold))
                        Spacer()
                        Button { Task { await createInvite() } } label: { Label(t("New code", "رمز جديد"), systemImage: "plus") }
                            .font(.subheadline).disabled(busy)
                    }
                    Text(t("Each code is for one person and valid for 14 days. User limits: 20 analyses and 12 coach requests per day.", "كل رمز لشخص واحد وصالح 14 يوماً. حدود المستخدم: 20 تحليل و12 طلب مدرب يومياً."))
                        .font(.caption).foregroundStyle(Theme.muted)
                    ForEach(invites ?? []) { inv in
                        HStack {
                            Text(inv.code).font(.system(.body, design: .monospaced).weight(.bold))
                                .environment(\.layoutDirection, .leftToRight)
                            Spacer()
                            if let used = inv.usedByName ?? inv.usedBy {
                                Text(t("Used: \(used)", "استُخدم: \(used)")).font(.caption).foregroundStyle(Theme.muted)
                            } else if inv.expiresAt < Date() {
                                Text(t("Expired", "منتهي")).font(.caption).foregroundStyle(Theme.bad)
                            } else {
                                ShareLink(item: t("Invite to StrainEat 🍽️\nLink: \(APIClient.shared.baseURL.absoluteString)/app/\nInvite code: \(inv.code)", "دعوة لتطبيق StrainEat 🍽️\nالرابط: \(APIClient.shared.baseURL.absoluteString)/app/\nرمز الدعوة: \(inv.code)")) {
                                    Image(systemName: "square.and.arrow.up")
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            } else {
                ProgressView()
            }
            if let message { Text(message).font(.caption).foregroundStyle(Theme.muted) }
            Button(role: .destructive) { store.signOut() } label: { Text(t("Sign out", "تسجيل الخروج")).frame(maxWidth: .infinity) }
                .padding(.top, 4)
        }
        .task {
            if store.me == nil { store.me = try? await APIClient.shared.me() }
            if store.isOwner { invites = try? await APIClient.shared.invites() }
        }
    }

    private func link() async {
        busy = true; defer { busy = false }
        do {
            _ = try await APIClient.shared.register(inviteCode: nil, name: store.me?.name ?? t("Owner", "المالك"),
                                                    email: linkEmail.trimmingCharacters(in: .whitespaces), password: linkPass,
                                                    claimUserId: store.me?.id)
            message = t("Linked ✓ — you can now sign in with your email on any device", "تم الربط ✓ — يمكنك الآن الدخول بالبريد من أي جهاز")
            store.me = try? await APIClient.shared.me()
            linkPass = ""
        } catch { message = error.localizedDescription }
    }

    private func createInvite() async {
        busy = true; defer { busy = false }
        do {
            _ = try await APIClient.shared.createInvite()
            invites = try await APIClient.shared.invites()
        } catch { message = error.localizedDescription }
    }
}

// MARK: Devices

struct DevicesCard: View {
    @Environment(AppStore.self) private var store
    let profile: Profile?
    var onChange: () -> Void
    @State private var message: String?
    @State private var busy = false
    @State private var source = ""
    @State private var loaded = false
    @State private var active = ""
    @State private var basal = ""
    @State private var whoop: WhoopInfo?
    private let sources = [("", t("Automatic", "تلقائي")), ("whoop", "WHOOP"), ("apple_health", "Apple Health"), ("manual", t("Manual", "يدوي"))]

    private var showWhoop: Bool { source.isEmpty || source == "whoop" }
    private var showApple: Bool { source.isEmpty || source == "apple_health" }

    var body: some View {
        Card(title: t("Burn source", "مصدر الحرق"), icon: "applewatch") {
            Picker(t("Preferred source", "المصدر المفضل"), selection: $source) {
                ForEach(sources, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.segmented)
            .onChange(of: source) { _, v in
                guard loaded else { return }
                Task {
                    _ = try? await APIClient.shared.updateProfile(["preferredEnergySource": v.isEmpty ? NSNull() as Any : v as Any])
                    onChange(); await store.refresh(force: true)
                    message = t("Saved ✓", "تم الحفظ ✓")
                }
            }

            if showApple {
                Button {
                    Task {
                        busy = true; defer { busy = false }
                        guard HealthKitManager.shared.isAvailable else { message = t("Apple Health isn't available on this device.", "Apple Health غير متاح على هذا الجهاز."); return }
                        try? await HealthKitManager.shared.requestAuthorization()
                        let kcal = await HealthKitManager.shared.syncBurnToServer()
                        await HealthKitManager.shared.syncWorkoutsToServer()
                        await store.refresh(force: true)
                        message = kcal.map { t("Apple Health synced ✓ — today's burn \(fmt($0)) kcal", "تمت مزامنة Apple Health ✓ — حرق اليوم \(fmt($0)) سعرة") }
                            ?? t("No burn data was read. Check iPhone Settings → Health → Data Access & Devices → StrainEat and allow Active & Resting Energy.",
                                 "لم تُقرأ بيانات حرق. افتح إعدادات الآيفون ← الصحة ← الوصول إلى البيانات والأجهزة ← StrainEat واسمح بالطاقة النشطة وطاقة الراحة.")
                    }
                } label: { Label(t("Sync Apple Health now", "مزامنة Apple Health الآن"), systemImage: "heart.fill") }
                    .buttonStyle(SoftButtonStyle()).disabled(busy)
                DisclosureGroup(t("Have a Fitbit (like Fitbit Air)?", "عندك Fitbit (مثل Fitbit Air)؟")) {
                    Text(t("It reaches StrainEat through Apple Health. In the Google Health app open Connections → Apps and services → Apple Health → Get started, and turn on active calories, exercise, sleep and weight. Fitbit doesn't send resting energy, so StrainEat adds it from your weight, height and age.",
                           "بياناته توصل عن طريق Apple Health: في تطبيق Google Health افتح Connections ← Apps and services ← Apple Health ← Get started، وفعّل السعرات النشطة والتمارين والنوم والوزن. طاقة الراحة نحسبها من وزنك وطولك وعمرك لأن Fitbit ما يرسلها."))
                        .font(.caption).foregroundStyle(Theme.muted).padding(.top, 4)
                }
                .font(.caption.weight(.semibold)).tint(Theme.muted)
            }

            if showWhoop {
                if store.whoopConnected {
                    if let a = whoop?.account, let name = a.name {
                        // isolate the Latin name so its period doesn't jump sides in Arabic
                        Text(t("Linked WHOOP account: ", "حساب WHOOP المربوط: ") + "\u{2068}\(name)\u{2069}" + (a.email.map { " · \u{2068}\($0)\u{2069}" } ?? ""))
                            .font(.caption).foregroundStyle(Theme.muted)
                    }
                    if let s = whoop?.lastSync {
                        if s.cycles == 0 {
                            Text(t("WHOOP sent no data for this account. Make sure you signed in with the same WHOOP account as your band (same email as in the WHOOP app). If not, tap Disconnect and connect again.",
                                   "WHOOP ما أرسل أي بيانات لهذا الحساب. تأكد إنك دخلت بنفس حساب WHOOP اللي على السوار (نفس الإيميل في تطبيق WHOOP)، وإذا مو هو اضغط «فصل» واربط من جديد."))
                                .font(.caption.weight(.semibold)).foregroundStyle(Theme.dangerText)
                        } else {
                            Text(lastSyncLine(s)).font(.caption).foregroundStyle(Theme.muted)
                        }
                    }
                    HStack(spacing: 8) {
                        Button {
                            Task {
                                busy = true; defer { busy = false }
                                let from = Calendar.current.date(byAdding: .day, value: -3, to: Date())!
                                do {
                                    let cycles = try await APIClient.shared.whoopSync(from: from, to: Date())
                                    message = cycles > 0 ? t("WHOOP synced ✓", "تمت مزامنة WHOOP ✓")
                                        : t("WHOOP sent no data for this account — check the linked WHOOP account", "WHOOP ما أرسل أي بيانات لهذا الحساب — تأكد من حساب WHOOP المربوط")
                                } catch { message = error.localizedDescription }
                                whoop = try? await APIClient.shared.whoopInfo()
                                await store.refresh()
                            }
                        } label: { Label(t("Sync WHOOP now", "مزامنة WHOOP الآن"), systemImage: "arrow.triangle.2.circlepath") }
                            .buttonStyle(SoftButtonStyle()).disabled(busy)
                        Button(role: .destructive) {
                            Task { try? await APIClient.shared.whoopDisconnect(); store.setWhoop(false); whoop = nil }
                        } label: { Text(t("Disconnect", "فصل")) }
                            .frame(width: 60)
                    }
                } else {
                    Button { Task { await connectWhoop() } } label: { Label(t("Connect WHOOP", "ربط WHOOP"), systemImage: "link") }
                        .buttonStyle(SoftButtonStyle())
                }
            }

            if source == "manual" {
                Text(t("Today's burn (from the Health app or your watch)", "حرق اليوم (من تطبيق الصحة أو ساعتك)")).font(.subheadline.weight(.semibold))
                HStack(spacing: 8) {
                    TextField(t("Active kcal", "النشط (سعرة)"), text: $active).keyboardType(.numberPad)
                        .padding(10).background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
                    TextField(t("Basal kcal", "الأساسي (سعرة)"), text: $basal).keyboardType(.numberPad)
                        .padding(10).background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
                }
                Button {
                    let a = Double(active), b = Double(basal)
                    guard a != nil || b != nil else { message = t("Enter at least one number", "أدخل رقماً واحداً على الأقل"); return }
                    Task {
                        do {
                            try await APIClient.shared.pushEnergy([EnergySample(date: DateFormatter.isoDay.string(from: Date()), source: "manual", activeKcal: a, basalKcal: b)])
                            message = t("Burn saved ✓", "تم حفظ الحرق ✓"); await store.refresh()
                        } catch { message = error.localizedDescription }
                    }
                } label: { Text(t("Save burn", "حفظ الحرق")) }
                    .buttonStyle(SoftButtonStyle())
            }
            Text(t("When several sources cover the same day, only one is used so your burn isn't counted twice.", "عند توفر أكثر من مصدر لنفس اليوم يُستخدم مصدر واحد فقط لتجنب احتساب الحرق مرتين."))
                .font(.caption).foregroundStyle(Theme.muted)
            if let message { Text(message).font(.caption).foregroundStyle(Theme.brand2) }
        }
        .onAppear { if !loaded { source = profile?.preferredEnergySource ?? ""; DispatchQueue.main.async { loaded = true } } }
        .task { if let w = try? await APIClient.shared.whoopInfo() { whoop = w; store.setWhoop(w.connected) } }
    }

    private func lastSyncLine(_ s: WhoopInfo.LastSync) -> String {
        var parts = [t("Last sync: ", "آخر مزامنة: ") + s.at.formatted(.dateTime.weekday(.abbreviated).hour().minute().locale(appLocale))]
        parts.append(s.days == 1 ? t("1 day", "يوم واحد") : t("\(s.days) days", "\(s.days) أيام"))
        parts.append(s.workouts == 1 ? t("1 workout", "تمرين واحد") : t("\(s.workouts) workouts", "\(s.workouts) تمارين"))
        if s.wellness > 0 { parts.append(t("sleep & recovery ✓", "نوم واستشفاء ✓")) }
        return parts.joined(separator: " · ")
    }

    private func connectWhoop() async {
        do {
            let ok = try await WhoopConnector.shared.connect()
            store.setWhoop(ok)
            message = ok ? t("WHOOP connected ✓", "تم ربط WHOOP ✓") : t("Connection didn't finish", "لم يكتمل الربط")
            if ok {
                whoop = try? await APIClient.shared.whoopInfo()
                if let s = whoop?.lastSync, s.cycles == 0 {
                    message = t("Connected, but WHOOP sent no data for this account — check the linked account below", "تم الربط، لكن WHOOP ما أرسل أي بيانات لهذا الحساب — شوف الحساب المربوط تحت")
                }
                await store.refresh()
            }
        } catch { message = error.localizedDescription }
    }
}

// MARK: Ramadan settings

struct RamadanSettingsCard: View {
    let profile: Profile
    var onSaved: () -> Void
    @State private var mode = "auto" // auto | on | off
    @State private var days: Set<Int> = []
    @State private var white = false
    @State private var suhoor = Date()
    @State private var iftar = Date()
    @State private var loaded = false
    @State private var saved = false

    var body: some View {
        Card(title: t("Ramadan & fasting", "رمضان والصيام"), icon: "moon.stars") {
            Picker(t("Ramadan", "رمضان"), selection: $mode) {
                Text(t("Automatic in Ramadan", "تلقائي في رمضان")).tag("auto")
                Text(t("Fasting every day (always on)", "صائم كل يوم (مفعّل دائماً)")).tag("on")
                Text(t("Off", "متوقف")).tag("off")
            }
            Text(t("Voluntary fasting outside Ramadan", "صيام تطوع في غير رمضان")).font(.subheadline.weight(.semibold)).padding(.top, 4)
            FlowDays(selected: $days)
            Toggle(t("The White Days (13th, 14th and 15th of each Hijri month)", "الأيام البيض (13 و14 و15 من كل شهر هجري)"), isOn: $white).tint(Theme.brand2)
            DatePicker(t("Suhoor", "السحور"), selection: $suhoor, displayedComponents: .hourAndMinute)
            DatePicker(t("Iftar", "الإفطار"), selection: $iftar, displayedComponents: .hourAndMinute)
            Text(t("On these days the app switches to fasting mode: suhoor/iftar split, and no food or water reminders while you fast. Never applied on Eid or the Tashreeq days.",
                   "في هالأيام يتحول اليوم تلقائياً لوضع الصيام: تقسيم السحور والإفطار، وما نذكّرك بالأكل والماء وأنت صائم. لا يُطبّق في أيام العيد والتشريق."))
                .font(.caption).foregroundStyle(Theme.muted)
            Button(saved ? t("Saved ✓", "تم الحفظ ✓") : t("Save", "حفظ")) { Task { await save() } }.buttonStyle(SoftButtonStyle())
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            let r = profile.ramadan
            mode = r?.enabled == nil ? "auto" : (r?.enabled == true ? "on" : "off")
            days = Set(r?.fastDays ?? [])
            white = r?.whiteDays ?? false
            suhoor = time(r?.suhoorTime ?? "04:45")
            iftar = time(r?.iftarTime ?? "18:00")
        }
    }

    private func time(_ hhmm: String) -> Date {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: p.first ?? 0, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
    }
    private func hhmm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
    private func save() async {
        let flag: Any = mode == "auto" ? NSNull() as Any : (mode == "on") as Any
        let r: [String: Any] = ["enabled": flag, "suhoorTime": hhmm(suhoor), "iftarTime": hhmm(iftar), "fastDays": days.sorted(), "whiteDays": white]
        if (try? await APIClient.shared.updateProfile(["ramadan": r])) != nil { saved = true }
        onSaved()
    }
}

/// Weekday chips (0 = Sunday … 6 = Saturday), Monday and Thursday first.
private struct FlowDays: View {
    @Binding var selected: Set<Int>
    private let order = [1, 4, 0, 2, 3, 5, 6]
    private func name(_ d: Int) -> String {
        [t("Sun", "الأحد"), t("Mon", "الاثنين"), t("Tue", "الثلاثاء"), t("Wed", "الأربعاء"), t("Thu", "الخميس"), t("Fri", "الجمعة"), t("Sat", "السبت")][d]
    }
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 78), spacing: 6)], spacing: 6) {
            ForEach(order, id: \.self) { d in
                let on = selected.contains(d)
                Button { if on { selected.remove(d) } else { selected.insert(d) } } label: {
                    Text(name(d)).font(.subheadline.weight(on ? .bold : .regular)).frame(maxWidth: .infinity, minHeight: 36)
                        .foregroundStyle(on ? Color.black : Theme.ink)
                        .background(on ? Theme.brand2 : Theme.card2, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: Water settings

struct WaterSettingsCard: View {
    let profile: Profile
    @AppStorage(WaterNotifications.enabledKey) private var remind = true
    @State private var hot = false
    @State private var loaded = false
    var body: some View {
        Card(title: t("Water", "الماء"), icon: "drop.fill") {
            Toggle(t("Water reminders (when you fall behind)", "تذكير شرب الماء (إذا تأخرت عن هدفك)"), isOn: Binding(get: { remind }, set: { v in
                remind = v
                Task {
                    if v { _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) }
                    else { UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["water-11", "water-14", "water-17", "water-20"]) }
                    _ = try? await APIClient.shared.updateProfile(["reminders": ["meals": profile.reminders?.meals ?? true, "weight": profile.reminders?.weight ?? true, "water": v]])
                }
            })).tint(Theme.brand2)
            Toggle(t("I work or train in the heat most days (+750 ml water goal)", "أشتغل أو أتمرن في الحر أغلب الأيام (+750 مل لهدف الماء)"), isOn: Binding(get: { hot }, set: { v in
                hot = v
                Task { _ = try? await APIClient.shared.updateProfile(["hotEnvironment": v]) }
            })).tint(Theme.brand2)
            Text(t("Goal from drinks: 2.2 L women / 3.0 L men, more with training and heat. Kidney or heart conditions: tracking only.",
                   "الهدف من المشروبات: 2.2 لتر للنساء و3.0 للرجال، ويزيد مع التمرين والحر. مع أمراض الكلى أو القلب: متابعة فقط."))
                .font(.caption).foregroundStyle(Theme.muted)
        }
        .onAppear { guard !loaded else { return }; loaded = true; hot = profile.hotEnvironment ?? false }
    }
}

// MARK: Location for meal suggestions

struct LocationCard: View {
    let profile: Profile
    @State private var city = ""
    @State private var area = ""
    @State private var saved = false
    @State private var error: String?
    private let emirates = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah", "Al Ain"]

    var body: some View {
        Card(title: t("Your location for suggestions", "موقعك للاقتراحات"), icon: "mappin.and.ellipse") {
            Text(t("We suggest restaurants in your emirate and area.", "نقترح مطاعم موجودة في إمارتك ومنطقتك.")).font(.footnote).foregroundStyle(Theme.muted)
            Picker(t("Emirate", "الإمارة"), selection: $city) {
                Text("—").tag("")
                ForEach(emirates, id: \.self) { Text($0).tag($0) }
            }
            TextField(t("Area, e.g. Al Nakheel", "المنطقة، مثال: النخيل"), text: $area)
                .padding(10).background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
            Button {
                Task {
                    do {
                        _ = try await APIClient.shared.updateProfile(["city": city.isEmpty ? NSNull() as Any : city as Any, "area": area.trimmingCharacters(in: .whitespaces).isEmpty ? NSNull() as Any : area as Any])
                        saved = true; error = nil
                    } catch { self.error = error.localizedDescription }
                }
            } label: { Text(saved ? t("Saved ✓", "تم الحفظ ✓") : t("Save location", "حفظ الموقع")) }
            .buttonStyle(SoftButtonStyle())
            if let error { Text(error).font(.caption).foregroundStyle(Theme.bad) }
        }
        .onAppear { city = profile.city ?? ""; area = profile.area ?? "" }
        .onChange(of: city) { saved = false }
        .onChange(of: area) { saved = false }
    }
}

// MARK: Meal reminders + schedule

struct MealRemindersCard: View {
    @AppStorage(MealNotifications.enabledKey) private var on = false
    @State private var denied = false
    var body: some View {
        Card(title: t("Meal reminders", "تنبيهات الوجبات"), icon: "bell.badge") {
            Toggle(isOn: Binding(get: { on }, set: { v in
                Task {
                    if v {
                        let ok = await MealNotifications.requestPermission()
                        on = ok; denied = !ok
                        if ok, let d = try? await APIClient.shared.schedule() { await MealNotifications.sync(d) }
                    } else { on = false; await MealNotifications.clear() }
                }
            })) {
                Text(t("10 min before each meal, and if a meal isn't logged an hour later", "قبل كل وجبة بـ10 دقائق، وإذا لم تسجّل الوجبة بعد ساعة")).font(.subheadline)
            }
            .tint(Theme.brand2)
            if denied { Text(t("Allow notifications for StrainEat in iPhone Settings.", "اسمح بالتنبيهات لـStrainEat من إعدادات الآيفون.")).font(.caption).foregroundStyle(Theme.bad) }
        }
    }
}

struct ScheduleSettingsCard: View {
    let profile: Profile
    @State private var custom = false
    @State private var on: [String: Bool] = [:]
    @State private var times: [String: Date] = [:]
    @State private var saved = false
    @State private var error: String?
    private let ids = ["breakfast", "snack1", "lunch", "snack2", "dinner", "snack3"]
    private let defaults = ["breakfast": "08:00", "snack1": "10:30", "lunch": "13:30", "snack2": "16:30", "dinner": "19:30", "snack3": "21:30"]
    private func name(_ id: String) -> String {
        switch id {
        case "breakfast": return t("🍽️ Breakfast", "🍽️ الفطور")
        case "lunch": return t("🍽️ Lunch", "🍽️ الغداء")
        case "dinner": return t("🍽️ Dinner", "🍽️ العشاء")
        case "snack1": return t("🍎 Morning snack", "🍎 سناك الصباح")
        case "snack2": return t("🍎 Afternoon snack", "🍎 سناك العصر")
        default: return t("🍎 Evening snack", "🍎 سناك المساء")
        }
    }
    private static func date(_ hm: String) -> Date {
        let p = hm.split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: p.first ?? 8, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
    }
    private static func hm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    var body: some View {
        Card(title: t("Meal schedule", "جدول الوجبات"), icon: "clock") {
            Text(t("Coffee and other drinks don't count as a meal.", "القهوة والمشروبات لا تُحسب كوجبة.")).font(.caption).foregroundStyle(Theme.muted)
            Picker("", selection: $custom) {
                Text(t("Automatic", "تلقائي")).tag(false)
                Text(t("My times", "أوقاتي")).tag(true)
            }
            .pickerStyle(.segmented)
            if custom {
                ForEach(ids, id: \.self) { id in
                    HStack {
                        Toggle(isOn: Binding(get: { on[id] ?? false }, set: { on[id] = $0; saved = false })) { Text(name(id)).font(.subheadline) }
                            .toggleStyle(.switch).tint(Theme.brand2)
                        DatePicker("", selection: Binding(get: { times[id] ?? Self.date(defaults[id]!) }, set: { times[id] = $0; saved = false }), displayedComponents: .hourAndMinute)
                            .labelsHidden().disabled(!(on[id] ?? false))
                    }
                }
            } else {
                Text(t("Automatic = from your meals per day and usual eating times.", "تلقائي = من عدد وجباتك وأوقات أكلك المعتادة.")).font(.caption).foregroundStyle(Theme.muted)
            }
            Button {
                Task { await save() }
            } label: { Text(saved ? t("Saved ✓", "تم الحفظ ✓") : t("Save schedule", "حفظ الجدول")) }
            .buttonStyle(SoftButtonStyle())
            if let error { Text(error).font(.caption).foregroundStyle(Theme.bad) }
        }
        .onAppear {
            let cur = profile.mealSchedule?.slots ?? []
            custom = !cur.isEmpty
            for id in ids {
                let s = cur.first { $0.id == id }
                on[id] = s != nil || (cur.isEmpty && ["breakfast", "lunch", "dinner"].contains(id))
                times[id] = Self.date(s?.time ?? defaults[id]!)
            }
        }
        .onChange(of: custom) { saved = false }
    }

    private func save() async {
        var value: Any = NSNull()
        if custom {
            let slots = ids.filter { on[$0] ?? false }.map { ["id": $0, "time": Self.hm(times[$0] ?? Self.date(defaults[$0]!))] }
            guard !slots.isEmpty else { error = t("Pick at least one meal", "اختر وجبة واحدة على الأقل"); return }
            value = ["slots": slots]
        }
        do {
            _ = try await APIClient.shared.updateProfile(["mealSchedule": value])
            saved = true; error = nil
            if let d = try? await APIClient.shared.schedule() { await MealNotifications.sync(d) }
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: Medicine & vitamin reminders

struct MedRemindersCard: View {
    let profile: Profile
    @State private var meds: [MedReminder] = []
    @State private var adding = false
    @State private var name = ""
    @State private var dose = ""
    @State private var kind = "medicine"
    @State private var times: [Date] = [Calendar.current.date(bySettingHour: 8, minute: 0, second: 0, of: Date()) ?? Date()]
    @State private var error: String?

    private func kindName(_ k: String) -> String {
        switch k {
        case "vitamin": t("Vitamin", "فيتامين")
        case "supplement": t("Supplement", "مكمل غذائي")
        case "other": t("Other", "أخرى")
        default: t("Medicine", "دواء")
        }
    }
    private static let hm: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "HH:mm"; return f }()

    var body: some View {
        Card(title: t("Medicines & vitamins", "الأدوية والفيتامينات"), icon: "pills") {
            Text(t("We'll notify you at each time you set. These are reminders only — follow the dose from your doctor or pharmacist.",
                   "نرسل لك تنبيهاً في كل وقت تحدده. هذه تذكيرات فقط — اتبع جرعات طبيبك أو الصيدلي."))
                .font(.caption).foregroundStyle(Theme.muted)
            if meds.isEmpty { Text(t("No reminders yet.", "لا توجد تذكيرات بعد.")).font(.footnote).foregroundStyle(Theme.muted) }
            ForEach(meds) { m in
                HStack(spacing: 10) {
                    Image(systemName: m.kind == "vitamin" || m.kind == "supplement" ? "leaf" : "pills")
                        .foregroundStyle(Theme.brand2).frame(width: 36, height: 36).background(Theme.card2, in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.dose.isEmpty ? m.name : "\(m.name) · \(m.dose)").font(.subheadline.weight(.semibold)).lineLimit(1)
                        Text("\(kindName(m.kind)) · \(m.times.joined(separator: " · "))").font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Toggle("", isOn: Binding(get: { m.enabled }, set: { v in if let j = meds.firstIndex(where: { $0.id == m.id }) { meds[j].enabled = v; Task { await save() } } })).labelsHidden().tint(Theme.brand2)
                    Button(role: .destructive) { meds.removeAll { $0.id == m.id }; Task { await save() } } label: { Image(systemName: "trash") }
                        .foregroundStyle(Theme.dangerText)
                }
            }
            if adding {
                TextField(t("Name (e.g. Vitamin D)", "الاسم (مثال: فيتامين د)"), text: $name).textFieldStyle(.roundedBorder)
                TextField(t("Dose (optional)", "الجرعة (اختياري)"), text: $dose).textFieldStyle(.roundedBorder)
                Picker(t("Type", "النوع"), selection: $kind) {
                    ForEach(["medicine", "vitamin", "supplement", "other"], id: \.self) { Text(kindName($0)).tag($0) }
                }
                .pickerStyle(.segmented)
                ForEach(times.indices, id: \.self) { i in
                    HStack {
                        DatePicker(t("Time \(i + 1)", "الوقت \(i + 1)"), selection: $times[i], displayedComponents: .hourAndMinute)
                        if times.count > 1 { Button { times.remove(at: i) } label: { Image(systemName: "minus.circle") } }
                    }
                }
                if times.count < 6 { Button(t("+ Another time", "+ وقت آخر")) { times.append(times.last ?? Date()) }.font(.subheadline) }
                HStack {
                    Button(t("Cancel", "إلغاء")) { adding = false }.buttonStyle(SoftButtonStyle())
                    Button(t("Save reminder", "حفظ التذكير")) { Task { await add() } }.buttonStyle(SoftButtonStyle())
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else {
                Button { adding = true } label: { Label(t("Add reminder", "إضافة تذكير"), systemImage: "plus") }.buttonStyle(SoftButtonStyle())
            }
            if let error { Text(error).font(.caption).foregroundStyle(Theme.bad) }
        }
        .task { meds = profile.medReminders ?? []; await MedNotifications.sync(meds) }
    }

    private func add() async {
        let ts = Array(Set(times.map { Self.hm.string(from: $0) })).sorted()
        meds.append(MedReminder(id: "", name: name.trimmingCharacters(in: .whitespaces), dose: dose.trimmingCharacters(in: .whitespaces), kind: kind, times: ts, enabled: true))
        if await save() { adding = false; name = ""; dose = ""; kind = "medicine" } else { meds.removeLast() }
    }

    @discardableResult private func save() async -> Bool {
        do {
            let p = try await APIClient.shared.updateProfile(["medReminders": meds.map(\.dict)])
            meds = p.medReminders ?? meds
            error = nil
            await MedNotifications.sync(meds)
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
}

/// Advice list shown with an intense plan (collapsed after onboarding).
struct IntenseAdvice: View {
    let plan: Plan
    @State private var open = false
    var body: some View {
        if plan.intense == true, let adv = plan.advice, !adv.isEmpty {
            DisclosureGroup(isExpanded: $open) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(adv, id: \.self) { a in
                        HStack(alignment: .top, spacing: 6) { Text("•"); Text(a.text).fixedSize(horizontal: false, vertical: true) }.font(.subheadline)
                    }
                }.padding(.top, 6)
            } label: { Text(t("Intense loss advice", "نصائح النزول المكثّف")).font(.subheadline.weight(.bold)) }
            .tint(Theme.ink)
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.warn.opacity(0.18), in: RoundedRectangle(cornerRadius: 18))
        }
    }
}
