import SwiftUI

struct TodayView: View {
    @Environment(AppStore.self) private var store
    var onLog: () -> Void = {}
    var onFavourites: () -> Void = {}

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    header
                    if let b = store.balance {
                        TodayRings(balance: b, isToday: store.isToday)
                        InsightStack(balance: b, schedule: store.isToday ? schedule : nil, motivation: store.motivation, isToday: store.isToday,
                                     onLog: onLog, onSuggest: { showIdeas = true }, onSchedule: { schedule = $0 })
                        if let r = b.ramadan, r.active || r.needsChoice { RamadanCard(view: r) }
                        TodayMonitors(balance: b, isToday: store.isToday)
                        WaterCard(isToday: store.isToday, fastingDay: b.ramadan?.active == true)
                        HStack {
                            Text(t("My day", "يومي")).font(.title3.weight(.heavy))
                            Spacer()
                            Button { showIdeas = true } label: {
                                Label(t("Meal ideas", "اقتراح وجبة"), systemImage: "lightbulb").font(.subheadline.weight(.semibold))
                                    .padding(.horizontal, 12).frame(minHeight: 34).background(Theme.card, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            Button(action: onLog) { Image(systemName: "plus").font(.headline.weight(.bold)).foregroundStyle(Theme.bg).frame(width: 34, height: 34).background(Theme.ink, in: RoundedRectangle(cornerRadius: 11)).contentShape(Rectangle().inset(by: -5)) }
                                .accessibilityLabel(t("Log a meal", "سجّل وجبة"))
                        }
                        .padding(.top, 8)
                        TimelineCard(meals: b.meals, schedule: store.isToday ? schedule : nil, onLog: onLog,
                                     onSchedule: { schedule = $0 },
                                     onEditTimes: { NotificationCenter.default.post(name: .openPlan, object: nil) })
                        BodyTodayCard(activity: b.activity, isToday: store.isToday, showWellness: false)
                    } else if let e = store.error {
                        Card { VStack(spacing: 10) {
                            Image(systemName: "wifi.exclamationmark").font(.largeTitle).foregroundStyle(Theme.muted)
                            Text(t("Couldn't connect", "تعذّر الاتصال")).font(.headline)
                            Text(e).font(.footnote).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                            Button(t("Try again", "إعادة المحاولة")) { Task { await store.refresh() } }.buttonStyle(SoftButtonStyle())
                        }.frame(maxWidth: .infinity) }
                    } else {
                        ProgressView().padding(60)
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .refreshable { await store.refresh(force: true) }
            .navigationDestination(for: String.self) { MealLoaderView(mealId: $0) }
            .toolbar(.hidden, for: .navigationBar)
            .task(id: store.refreshTick) { await loadSchedule() }
            .sheet(isPresented: $showIdeas) { NavigationStack { ScrollView { SuggestCard().padding(16) }.screenBackground().navigationTitle(t("Meal ideas", "اقتراحات وجبات")).navigationBarTitleDisplayMode(.inline) } }
        }
    }

    @State private var showIdeas = false

    @State private var schedule: DaySchedule?
    private func loadSchedule() async {
        guard let d = try? await APIClient.shared.schedule() else { return }
        schedule = d
        await MealNotifications.sync(d)
    }

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(store.isToday ? t("Today", "اليوم") : store.day.arWeekday)
                    .font(.title2.weight(.heavy)).foregroundStyle(Theme.ink)
                Text(store.day.arDayMonth)
                    .font(.caption).foregroundStyle(Theme.muted)
            }
            if let st = store.motivation?.streak, st.current > 0 {
                Label(t("\(st.current) \(st.current == 1 ? "day" : "days")", "\(st.current) \(st.current == 1 ? "يوم" : "أيام")"), systemImage: "flame.fill").font(.footnote.weight(.bold)).monospacedDigit()
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Theme.card, in: Capsule())
                    .foregroundStyle(Theme.ink)
                    .accessibilityLabel(t("\(st.current)-day streak", "\(st.current) أيام متتالية"))
            }
            Spacer()
            HStack(spacing: 0) {
                Button { store.shiftDay(-1) } label: { Image(systemName: "chevron.backward").frame(width: 36, height: 36) }
                Button { store.shiftDay(1) } label: { Image(systemName: "chevron.forward").frame(width: 36, height: 36) }
                    .disabled(store.isToday)
            }
            .font(.headline)
            .background(Theme.card, in: Capsule())
        }
    }
}

// MARK: Energy ring

struct EnergyCard: View {
    let balance: Balance

    var body: some View {
        let target = balance.targetIntakeKcal ?? 0
        let eaten = balance.intake.calories
        let remaining = balance.remainingKcal ?? (target - eaten)
        let within = remaining >= 0
        let progress = target > 0 ? eaten / target : 0

        Card {
            VStack(spacing: 16) {
                HStack {
                    Chip(text: within ? t("On target", "ضمن الهدف") : t("Over target", "فوق الهدف"),
                         icon: within ? "checkmark.circle.fill" : "exclamationmark.circle.fill",
                         fg: Theme.status(within), bg: Theme.statusSoft(within))
                    Spacer()
                    Text(goalName(balance.goal)).font(.caption).foregroundStyle(Theme.muted)
                }
                ZStack {
                    Circle().stroke(Theme.ringTrack, lineWidth: 16)
                    Circle().trim(from: 0, to: min(progress, 1))
                        .stroke(Theme.status(within), style: StrokeStyle(lineWidth: 16, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 0.6), value: progress)
                        .environment(\.layoutDirection, .leftToRight)
                    VStack(spacing: 2) {
                        Text(fmt(abs(remaining)))
                            .font(.system(size: 44, weight: .bold, design: .rounded)).monospacedDigit()
                            .foregroundStyle(Theme.status(within))
                        Text(within ? t("kcal left", "سعرة متبقية") : t("kcal over target", "سعرة فوق الهدف")).font(.subheadline).foregroundStyle(Theme.muted)
                    }
                }
                .frame(width: 190, height: 190)

                HStack(spacing: 0) {
                    stat(t("Eaten", "أكلت"), eaten, "fork.knife", Theme.ink)
                    Divider().frame(height: 34)
                    stat(balance.burnIsPartialDay ? t("Burned so far", "حرقت حتى الآن") : t("Burned", "حرقت"), balance.burn?.totalKcal ?? balance.estimatedTdee, "flame.fill", Theme.accent)
                    Divider().frame(height: 34)
                    stat(t("Target", "هدفك"), target, "target", Theme.brand2)
                }
                if let burn = balance.burn {
                    let net = burn.totalKcal - eaten
                    HStack(spacing: 6) {
                        Text(t("Difference (burn − food):", "الفرق (الحرق − الأكل):")).foregroundStyle(Theme.muted)
                        Text(signed(net)).bold().foregroundStyle(Theme.status(net >= 0))
                            .environment(\.layoutDirection, .leftToRight)
                        Text("• \(sourceName(burn.source))").foregroundStyle(Theme.muted)
                    }
                    .font(.footnote)
                } else {
                    Text(t("Burn is estimated — connect Apple Health or WHOOP from the Plan tab", "الحرق تقديري — اربط Apple Health أو WHOOP من صفحة الخطة")).font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func stat(_ title: String, _ v: Double?, _ icon: String, _ color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).foregroundStyle(color).font(.footnote)
            Text(v.map(fmt) ?? "—").font(.headline).monospacedDigit().foregroundStyle(Theme.ink)
            Text(title).font(.caption2).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

func goalName(_ g: String) -> String { ["lose": t("Lose weight", "إنقاص الوزن"), "maintain": t("Maintain weight", "المحافظة على الوزن"), "gain": t("Gain weight", "زيادة الوزن")][g] ?? g }

struct MacrosCard: View {
    let balance: Balance
    var body: some View {
        let n = balance.intake, mt = balance.macroTargets
        Card(title: t("Nutrients", "العناصر الغذائية"), icon: "chart.bar.fill") {
            VStack(spacing: 12) {
                MacroProgress(title: t("Protein", "بروتين"), value: n.proteinG, target: mt?.proteinG, color: Theme.protein)
                MacroProgress(title: t("Carbs", "كربوهيدرات"), value: n.carbsG, target: mt?.carbsG, color: Theme.carbs)
                MacroProgress(title: t("Fat", "دهون"), value: n.fatG, target: mt?.fatG, color: Theme.fat)
                MacroProgress(title: t("Fibre", "ألياف"), value: n.fiberG, target: mt?.fiberG, color: Theme.fiber)
            }
        }
    }
}

// MARK: Ramadan

struct RamadanCard: View {
    @Environment(AppStore.self) private var store
    let view: RamadanView
    var body: some View {
        Card(title: view.kind == nil || view.kind == "ramadan" ? t("Ramadan mode", "وضع رمضان") : view.kind == "white" ? t("White Days fast", "صيام الأيام البيض") : t("Fasting day", "يوم صيام"), icon: "moon.stars.fill") {
            if view.needsChoice && !view.active {
                Text(t("Ramadan Mubarak! Turn on Ramadan mode? We'll split your calories between suhoor and iftar.", "رمضان مبارك! هل تريد تفعيل وضع رمضان؟ نقسّم سعراتك بين السحور والإفطار.")).font(.subheadline)
                HStack {
                    Button(t("Turn on", "تفعيل")) { Task { await set(true) } }.buttonStyle(PrimaryButtonStyle())
                    Button(t("Not now", "ليس الآن")) { Task { await set(false) } }.buttonStyle(SoftButtonStyle())
                }
            } else {
                if view.fasting, let m = view.minutesToIftar {
                    Chip(text: t("\(m / 60) h \(m % 60) min to iftar", "باقي على الإفطار \(m / 60) س \(m % 60) د"), icon: "clock", fg: Theme.warn, bg: Theme.accentSoft)
                }
                if let s = view.split {
                    HStack {
                        part(t("Suhoor", "السحور"), s.suhoor, view.suhoorTime)
                        part(t("Iftar", "الإفطار"), s.iftar, view.iftarTime)
                        part(t("Evening", "المساء"), s.evening, nil)
                    }
                }
            }
        }
    }
    private func part(_ label: String, _ kcal: Double, _ time: String?) -> some View {
        VStack(spacing: 3) {
            Text(label).font(.caption).foregroundStyle(Theme.muted)
            Text(fmt(kcal)).font(.headline).monospacedDigit()
            if let time { Text(time).font(.caption2).foregroundStyle(Theme.muted).environment(\.layoutDirection, .leftToRight) }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 8)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }
    private func set(_ on: Bool) async {
        if let prof = try? await APIClient.shared.profile() {
            let r = prof.ramadan
            let patch: [String: Any] = ["enabled": on, "suhoorTime": r?.suhoorTime ?? "04:45", "iftarTime": r?.iftarTime ?? "18:00"]
            _ = try? await APIClient.shared.updateProfile(["ramadan": patch])
        }
        await store.refresh()
    }
}

// MARK: Challenge

struct ChallengeCard: View {
    let challenge: Motivation.Challenge
    var body: some View {
        Card(title: t("Weekly challenge", "تحدي الأسبوع"), icon: "trophy.fill",
             trailing: AnyView(Text(challenge.done ? t("Done ✓", "أُنجز ✓") : t("\(challenge.daysLeft) \(challenge.daysLeft == 1 ? t("day", "يوم") : t("days", "أيام")) left", "باقي \(challenge.daysLeft) \(challenge.daysLeft == 1 ? t("day", "يوم") : t("days", "أيام"))"))
                .font(.caption).foregroundStyle(challenge.done ? Theme.good : Theme.muted))) {
            Text(challenge.title).font(.subheadline.weight(.semibold))
            ProgressView(value: min(challenge.progress, challenge.target), total: max(challenge.target, 1))
                .tint(challenge.done ? Theme.good : Theme.accent)
            Text(t("\(fmt(challenge.progress)) of \(fmt(challenge.target)) \(challenge.unitText)", "\(fmt(challenge.progress)) من \(fmt(challenge.target)) \(challenge.unitText)")).font(.caption).foregroundStyle(Theme.muted)
        }
    }
}

// MARK: Eating schedule

struct ScheduleCard: View {
    @Environment(AppStore.self) private var store
    @State private var day: DaySchedule?
    @State private var error: String?

    var body: some View {
        Card(title: t("Today's eating schedule", "جدول وجباتك اليوم"), icon: "clock") {
            if let day {
                if day.ramadan { Text(t("🌙 Ramadan schedule: iftar and suhoor", "🌙 جدول رمضان: الإفطار والسحور")).font(.caption).foregroundStyle(Theme.muted) }
                ForEach(day.slots) { s in
                    HStack(alignment: .top, spacing: 10) {
                        Text(s.time).font(.subheadline.weight(.bold)).monospacedDigit().frame(width: 50, alignment: .leading)
                            .environment(\.layoutDirection, .leftToRight)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                Text("\(s.kind == "snack" ? "🍎" : "🍽️") \(s.label)").font(.subheadline.weight(.semibold))
                                Text("~\(fmt(s.targetKcal)) \(t("kcal", "سعرة"))").font(.caption).foregroundStyle(Theme.muted)
                            }
                            if !s.items.isEmpty {
                                Text(s.items.map(\.displayName).joined(separator: appLang == .ar ? "، " : ", ") + " · \(fmt(s.eatenKcal))")
                                    .font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                            }
                        }
                        Spacer()
                        statusChip(s.status)
                    }
                    .padding(.vertical, 4)
                }
                if !day.drinks.isEmpty {
                    Text(t("☕ Drinks today: \(day.drinks.count) · \(fmt(day.drinksKcal)) kcal (counted in calories, not as a meal)",
                           "☕ المشروبات اليوم: \(day.drinks.count) · \(fmt(day.drinksKcal)) سعرة (تُحسب في السعرات، لا كوجبة)"))
                        .font(.caption).foregroundStyle(Theme.muted)
                }
            } else if let error {
                Text(error).font(.caption).foregroundStyle(Theme.bad)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task(id: store.refreshTick) { await load() }
    }

    private func statusChip(_ st: String) -> some View {
        let (text, fg, bg): (String, Color, Color) = switch st {
        case "done": (t("✓ Done", "✓ تم"), Theme.good, Theme.goodSoft)
        case "now": (t("Now", "الآن"), Theme.warn, Theme.accentSoft)
        case "missed": (t("Not logged", "لم تُسجّل"), Theme.bad, Theme.badSoft)
        default: (t("Upcoming", "قادم"), Theme.muted, Theme.card2)
        }
        return Text(text).font(.caption2.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 4).foregroundStyle(fg).background(bg, in: Capsule())
    }

    private func load() async {
        do {
            let d = try await APIClient.shared.schedule()
            day = d; error = nil
            await MealNotifications.sync(d)
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: Coach suggestions

struct SuggestCard: View {
    @Environment(AppStore.self) private var store
    @State private var data: Suggestions?
    @State private var busy = false
    @State private var error: String?
    @State private var logged: Set<String> = []
    @State private var openRecipe: String?
    var showNext = false
    var next: DaySchedule.Slot? = nil

    var body: some View {
        Card(title: showNext ? t("Next up", "التالي") : t("What should I eat now?", "ماذا آكل الآن؟"), icon: showNext ? nil : "sparkles",
             trailing: data == nil ? nil : AnyView(Button { Task { await load(force: true) } } label: { Image(systemName: "arrow.clockwise") })) {
            if showNext { NextUpHeader(slot: next) }
            if busy && data != nil { ProgressView().frame(maxWidth: .infinity) }
            if let data, !busy {
                if !data.introAr.isEmpty { Text(data.introAr).font(.subheadline).foregroundStyle(Theme.muted) }
                if let home = data.home {
                    if !home.isEmpty { header(t("🏠 Cook at home", "🏠 من البيت")) }
                    ForEach(home, id: \.self) { homeCard($0) }
                    if let h = data.healthy, !h.isEmpty { header(t("🥗 Healthy restaurant", "🥗 من مطعم صحي")); ForEach(h, id: \.self) { outCard($0, icon: "🥗") } }
                    if let f = data.fast, !f.isEmpty { header(t("🍔 Fast food, smart pick", "🍔 وجبات سريعة بخيار مناسب")); ForEach(f, id: \.self) { outCard($0, icon: "🍔") } }
                    Button { Task { await load(force: true) } } label: {
                        Label(t("More options (different restaurants & recipes)", "خيارات أخرى (مطاعم ووصفات مختلفة)"), systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(SoftButtonStyle())
                } else {
                    ForEach(data.options, id: \.self) { o in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(o.titleAr).font(.subheadline.weight(.semibold))
                            Text(t("\(o.whereAr) • \(fmt(o.kcal)) kcal", "\(o.whereAr) • \(fmt(o.kcal)) سعرة")).font(.caption).foregroundStyle(Theme.muted)
                        }
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 14))
                    }
                }
            } else if data == nil {
                if !showNext { Text(t("Suggestions that fit the calories and protein you have left today.", "اقتراحات تناسب ما تبقى من سعراتك وبروتينك اليوم.")).font(.footnote).foregroundStyle(Theme.muted) }
                Button { Task { await load() } } label: {
                    if busy { ProgressView() } else { Label(showNext ? t("Suggest a meal that fits", "اقترح وجبة تناسب الباقي") : t("Suggest something", "اقترح عليّ"), systemImage: "wand.and.stars") }
                }
                .buttonStyle(SoftButtonStyle()).disabled(busy)
            }
            if let error { Text(error).font(.caption).foregroundStyle(Theme.bad) }
        }
    }

    private func header(_ s: String) -> some View { Text(s).font(.subheadline.weight(.bold)).padding(.top, 6) }

    private func macros(_ kcal: Double, _ p: Double) -> some View {
        Text(t("\(fmt(kcal)) kcal · \(fmt(p)) g protein", "\(fmt(kcal)) سعرة · \(fmt(p)) غ بروتين")).font(.caption.weight(.bold)).monospacedDigit()
    }

    private func homeCard(_ o: Suggestions.Home) -> some View {
        let open = openRecipe == o.title
        return VStack(alignment: .leading, spacing: 6) {
            Button { withAnimation { openRecipe = open ? nil : o.title } } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) { Text(o.title).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading); Spacer(); macros(o.kcal, o.proteinG) }
                    HStack(spacing: 4) {
                        Text(t("🏠 Home · \(fmt(o.prepMin)) min", "🏠 البيت · \(fmt(o.prepMin)) دقيقة"))
                        Text("·")
                        Text(t("Ingredients & method", "المقادير وطريقة التحضير")).underline()
                        Image(systemName: open ? "chevron.up" : "chevron.down")
                    }
                    .font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .buttonStyle(.plain)
            if open {
                Text(t("Ingredients", "المقادير")).font(.caption.weight(.bold))
                ForEach(o.ingredients, id: \.self) { x in Text("• \(x.item) — \(x.amount)").font(.caption) }
                Text(t("Method", "طريقة التحضير")).font(.caption.weight(.bold)).padding(.top, 4)
                ForEach(Array(o.steps.enumerated()), id: \.offset) { i, step in Text("\(i + 1). \(step)").font(.caption) }
                Text(t("Carbs \(fmt(o.carbsG)) g · Fat \(fmt(o.fatG)) g", "كربوهيدرات \(fmt(o.carbsG)) غ · دهون \(fmt(o.fatG)) غ")).font(.caption).foregroundStyle(Theme.muted)
                if !o.why.isEmpty { Text(o.why).font(.caption).foregroundStyle(Theme.muted) }
            }
            logButton(id: "home|\(o.title)") {
                try await APIClient.shared.logSuggestion(title: o.title, restaurant: nil, kcal: o.kcal, protein: o.proteinG, carbs: o.carbsG, fat: o.fatG)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 14))
    }

    private func outCard(_ o: Suggestions.Out, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) { Text(o.title).font(.subheadline.weight(.semibold)); Spacer(); macros(o.kcal, o.proteinG) }
            if let url = mapsURL(o.restaurant) {
                Link(destination: url) {
                    HStack(spacing: 4) {
                        Text("\(icon) \(o.restaurant)").underline()
                        Image(systemName: "mappin.and.ellipse")
                        Text(t("Map", "الموقع على الخريطة"))
                    }
                    .font(.caption).foregroundStyle(Theme.brand2)
                }
            }
            if !o.orderTip.isEmpty { Text("💡 \(o.orderTip)").font(.caption) }
            if !o.why.isEmpty { Text(o.why).font(.caption).foregroundStyle(Theme.muted) }
            logButton(id: "\(o.restaurant)|\(o.title)") {
                try await APIClient.shared.logSuggestion(title: o.title, restaurant: o.restaurant, kcal: o.kcal, protein: o.proteinG, carbs: o.carbsG, fat: o.fatG)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 14))
    }

    /// Google Maps search for the chain near the user's saved area (opens the Maps app if installed).
    private func mapsURL(_ name: String) -> URL? {
        var c = URLComponents(string: "https://www.google.com/maps/search/")
        c?.queryItems = [URLQueryItem(name: "api", value: "1"), URLQueryItem(name: "query", value: "\(name) \(data?.mapsArea ?? "UAE")")]
        return c?.url
    }

    private func logButton(id: String, action: @escaping () async throws -> Void) -> some View {
        Button {
            Task {
                do { try await action(); logged.insert(id); await store.refresh() } catch { self.error = error.localizedDescription }
            }
        } label: {
            Text(logged.contains(id) ? t("✓ Added", "✓ تمت الإضافة") : t("Log it", "سجّلها")).font(.caption.weight(.semibold))
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Theme.card, in: Capsule()).overlay(Capsule().stroke(Theme.line))
        }
        .buttonStyle(.plain).disabled(logged.contains(id)).padding(.top, 4)
    }

    private func load(force: Bool = false) async {
        busy = true; error = nil
        defer { busy = false }
        do { data = try await APIClient.shared.suggest(force: force); openRecipe = nil } catch { self.error = error.localizedDescription }
    }
}

// MARK: Activity

struct ActivityCard: View {
    let activity: DayActivity
    var body: some View {
        Card(title: t("Activity", "النشاط"), icon: "figure.run",
             trailing: activity.workouts.isEmpty ? nil : AnyView(Text(t("\(fmt(activity.totalMin)) min • \(fmt(activity.totalKcal)) kcal", "\(fmt(activity.totalMin)) د • \(fmt(activity.totalKcal)) سعرة")).font(.caption).foregroundStyle(Theme.muted))) {
            if activity.workouts.isEmpty {
                Text(t("No workouts recorded for this day.", "لا تمارين مسجلة لهذا اليوم.")).font(.footnote).foregroundStyle(Theme.muted)
            }
            ForEach(activity.workouts) { w in
                HStack(spacing: 12) {
                    Image(systemName: sportIcon(w.kind))
                        .font(.title3).foregroundStyle(Theme.brand2)
                        .frame(width: 42, height: 42)
                        .background(Theme.brandSoft, in: RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(w.displayName).font(.subheadline.weight(.semibold))
                        Text(details(w)).font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(t("\(fmt(w.kcal ?? 0)) kcal", "\(fmt(w.kcal ?? 0)) سعرة")).font(.subheadline.weight(.semibold)).monospacedDigit()
                        Text(sourceName(w.source)).font(.caption2).foregroundStyle(Theme.muted)
                    }
                }
            }
        }
    }
    private func details(_ w: Workout) -> String {
        var parts = [t("\(fmt(w.durationMin)) min", "\(fmt(w.durationMin)) د"), w.start.arTime]
        if let s = w.strain { parts.append(t("Strain \(fmt1(s))", "إجهاد \(fmt1(s))")) }
        if let hr = w.avgHr { parts.append(t("HR \(fmt(hr))", "نبض \(fmt(hr))")) }
        if let d = w.distanceM, d > 0 { parts.append(t("\(fmt1(d / 1000)) km", "\(fmt1(d / 1000)) كم")) }
        return parts.joined(separator: " • ")
    }
}

// MARK: Meals

struct MealsCard: View {
    let meals: [Balance.MealRow]
    var onLog: () -> Void
    var body: some View {
        Card(title: t("Today's meals", "وجبات اليوم"), icon: "fork.knife") {
            if meals.isEmpty {
                Text(t("No meals yet.", "لا وجبات بعد.")).font(.footnote).foregroundStyle(Theme.muted)
                Button(action: onLog) { Label(t("Log your meal", "سجّل وجبتك"), systemImage: "camera.fill") }.buttonStyle(SoftButtonStyle())
            }
            ForEach(meals) { m in
                NavigationLink(value: m.id) {
                    HStack(spacing: 12) {
                        Image(systemName: m.status == "confirmed" ? "checkmark.seal.fill" : "hourglass")
                            .foregroundStyle(m.status == "confirmed" ? Theme.good : Theme.warn)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.displayName).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                .lineLimit(1)
                            Text([kindLabel(m.kind), m.restaurant, m.eatenAt.arTime].compactMap { $0 }.joined(separator: " • "))
                                .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(fmt(m.calories)).font(.subheadline.weight(.bold)).monospacedDigit().foregroundStyle(Theme.ink)
                            if let p = m.proteinG { Text(t("\(fmt(p)) g protein", "\(fmt(p)) غ بروتين")).font(.caption2).foregroundStyle(Theme.protein) }
                        }
                        Image(systemName: "chevron.forward").font(.caption).foregroundStyle(Theme.muted)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
                if m.id != meals.last?.id { Divider() }
            }
        }
    }
}

struct MealLoaderView: View {
    let mealId: String
    @State private var meal: Meal?
    @State private var error: String?
    var body: some View {
        Group {
            if let meal { MealReviewView(meal: meal) }
            else if let error { Text(error).padding() }
            else { ProgressView() }
        }
        .task {
            do { meal = try await APIClient.shared.meal(id: mealId) } catch { self.error = error.localizedDescription }
        }
    }
}

/// Short label for a logged item's kind (meals show nothing extra).
func kindLabel(_ kind: String?) -> String? {
    switch kind {
    case "drink": return t("☕ Drink", "☕ مشروب")
    case "snack": return t("🍎 Snack", "🍎 سناك")
    default: return nil
    }
}
