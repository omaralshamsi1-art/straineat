import SwiftUI
import Charts

// Customisable Today: big ring (or the three rings) + tiles the user picks. Same ids as the web.
let focusHeroes = ["rings", "left", "protein", "water", "steps", "week_budget", "week_protein"]
let focusTiles = ["steps", "water", "sleep", "recovery", "strain", "burn", "protein", "carbs", "fat", "fiber", "week_budget", "week_protein", "week_water", "week_steps"]
let defaultLayout = Profile.TodayLayout(hero: "rings", tiles: ["steps", "water", "sleep", "burn"])

func focusName(_ id: String) -> String {
    switch id {
    case "rings": return t("The three rings", "الحلقات الثلاث")
    case "left": return t("Calories left", "السعرات المتبقية")
    case "protein": return t("Protein", "البروتين")
    case "water": return t("Water", "الماء")
    case "steps": return t("Steps", "الخطوات")
    case "sleep": return t("Sleep", "النوم")
    case "recovery": return t("Recovery", "الاستشفاء")
    case "strain": return t("Strain", "الجهد")
    case "burn": return t("Burn", "الحرق")
    case "carbs": return t("Carbs", "الكربوهيدرات")
    case "fat": return t("Fat", "الدهون")
    case "fiber": return t("Fiber", "الألياف")
    case "week_budget": return t("Weekly budget", "ميزانية الأسبوع")
    case "week_protein": return t("Protein days", "أيام البروتين")
    case "week_water": return t("Water days", "أيام الماء")
    case "week_steps": return t("Steps days", "أيام الخطوات")
    default: return id
    }
}

struct FocusDatum {
    let icon: String; let color: Color; let label: String; let value: String; let sub: String; let frac: Double
    var heroLabel: String? = nil; var heroSub: String? = nil
    enum Action { case detail(OverviewDetail), wellness, week, water, steps }
    let action: Action
}

private func hex(_ v: UInt32) -> Color { Color(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255) }

struct FocusSection: View {
    @Environment(AppStore.self) private var store
    let balance: Balance
    let isToday: Bool
    @AppStorage("todayLayout") private var layoutJSON = ""
    @State private var steps: StepsDay?
    @State private var water: WaterDay?
    @State private var well: Wellness?
    @State private var week: WeekSummary?
    @State private var editing = false
    @State private var detail: OverviewDetail?
    @State private var showWeek = false
    @State private var showWell = false
    @State private var showWater = false
    @State private var showSteps = false

    private var layout: Profile.TodayLayout {
        (try? JSONDecoder().decode(Profile.TodayLayout.self, from: Data(layoutJSON.utf8))) ?? defaultLayout
    }

    var body: some View {
        let lay = layout
        let hero = lay.hero == "rings" ? nil : datum(lay.hero)
        let ready = lay.tiles.filter { lay.hero == "rings" || $0 != lay.hero }.compactMap { id in datum(id).map { (id, $0) } }
        let side = hero == nil ? [] : Array(ready.prefix(3))
        let rest = hero == nil ? ready : Array(ready.dropFirst(3))
        VStack(spacing: 8) {
            HStack { Spacer(); Button { editing = true } label: { Image(systemName: "pencil").font(.subheadline.weight(.bold)).frame(width: 34, height: 34).background(Theme.card, in: Circle()) }.buttonStyle(.plain).accessibilityLabel(t("Customize Today", "تخصيص اليوم")) }
            if let h = hero {
                HStack(alignment: .center, spacing: 10) {
                    Button { act(h.action) } label: { BigRing(d: h) }.buttonStyle(.plain).frame(maxWidth: .infinity)
                    VStack(spacing: 8) { ForEach(side, id: \.0) { item in tile(item.1) } }.frame(maxWidth: .infinity)
                }
            } else {
                TodayRings(balance: balance, isToday: isToday)
            }
            if !rest.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(rest, id: \.0) { item in tile(item.1) }
                }
            }
        }
        .task(id: "\(store.refreshTick)-\(store.selectedDateKey)") { await load() }
        .sheet(isPresented: $editing) { FocusEditor(initial: lay) { new in
            if let d = try? JSONEncoder().encode(new), let s = String(data: d, encoding: .utf8) { layoutJSON = s }
            Task { _ = try? await APIClient.shared.updateProfile(["todayLayout": ["hero": new.hero, "tiles": new.tiles]]) }
        } }
        .sheet(item: $detail) { d in OverviewDetailView(kind: d, balance: balance, isToday: isToday) }
        .sheet(isPresented: $showWeek) { if let w = week { WeekDetailView(week: w) } }
        .sheet(isPresented: $showWell) { if let w = well { WellnessDetailView(data: w) } }
        .sheet(isPresented: $showWater) { if let w = water { WaterDetailView(day: w) { water = $0 } } }
        .sheet(isPresented: $showSteps) { if let s = steps { StepsDetailView(day: s) } }
    }

    private func tile(_ d: FocusDatum) -> some View {
        Button { act(d.action) } label: {
            HStack(spacing: 12) {
                Image(systemName: d.icon).font(.system(size: 19, weight: .semibold)).foregroundStyle(d.color)
                    .frame(width: 44, height: 44)
                    .background(d.color.opacity(0.22), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(d.color.opacity(0.35), lineWidth: 1))
                VStack(alignment: .leading, spacing: 1) {
                    Text(d.label).font(.subheadline.weight(.bold)).foregroundStyle(d.color).lineLimit(1)
                    Text(d.value).font(.system(size: 25, weight: .heavy)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                    if !d.sub.isEmpty { Text(d.sub).font(.footnote).foregroundStyle(Theme.muted).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 78, alignment: .leading)
            .background(d.color.opacity(0.18), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(alignment: .bottomLeading) {
                GeometryReader { g in Capsule().fill(d.color).frame(width: g.size.width * d.frac, height: 3).frame(maxHeight: .infinity, alignment: .bottom) }
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
        }
        .buttonStyle(.plain)
    }

    private func act(_ a: FocusDatum.Action) {
        switch a {
        case .detail(let k): detail = k
        case .wellness: showWell = well != nil
        case .week: showWeek = week != nil
        case .water: showWater = water != nil
        case .steps: showSteps = steps != nil
        }
    }

    private func load() async {
        let key = store.selectedDateKey
        async let s = try? APIClient.shared.steps(date: key)
        async let w = try? APIClient.shared.water(date: key)
        async let wl: Wellness? = try? APIClient.shared.wellness(date: key) // any day, not just today
        async let wk: WeekSummary? = try? APIClient.shared.week()
        (steps, water, well, week) = await (s, w, wl, wk)
        if layoutJSON.isEmpty, let p = try? await APIClient.shared.profile(), let l = p.todayLayout,
           let d = try? JSONEncoder().encode(l), let str = String(data: d, encoding: .utf8) { layoutJSON = str }
    }

    private func datum(_ id: String) -> FocusDatum? {
        let b = balance, mt = b.macroTargets, it = b.intake
        let today = well.flatMap { $0.connected && !$0.needsReconnect ? $0.today : nil }
        func f(_ a: Double, _ c: Double?) -> Double { guard let c, c > 0 else { return 0 }; return max(0, min(1, a / c)) }
        switch id {
        case "left":
            let tg = b.targetIntakeKcal ?? 1, l = b.remainingKcal ?? (tg - it.calories)
            return FocusDatum(icon: "flame.fill", color: l < 0 && b.goal != "gain" ? Theme.bad : hex(0x2BA84A), label: l < 0 ? t("Over target", "فوق الهدف") : t("Left", "متبقي"),
                              value: fmt(abs(l)), sub: t("of \(fmt(tg)) kcal", "من \(fmt(tg)) سعرة"), frac: l < 0 ? 1 : f(it.calories, tg), action: .detail(.left))
        case "protein":
            guard let p = mt?.proteinG, p > 0 else { return nil }
            return FocusDatum(icon: "fork.knife", color: hex(0x8A7DF0), label: t("Protein", "البروتين"), value: fmt(it.proteinG), sub: t("of \(fmt(p)) g", "من \(fmt(p)) غ"), frac: f(it.proteinG, p), action: .detail(.eaten))
        case "carbs":
            guard let c = mt?.carbsG, c > 0 else { return nil }
            return FocusDatum(icon: "basket.fill", color: hex(0xE0A43B), label: t("Carbs", "الكربوهيدرات"), value: fmt(it.carbsG), sub: t("of \(fmt(c)) g", "من \(fmt(c)) غ"), frac: f(it.carbsG, c), action: .detail(.eaten))
        case "fat":
            guard let c = mt?.fatG, c > 0 else { return nil }
            return FocusDatum(icon: "drop.halffull", color: hex(0xD9B44A), label: t("Fat", "الدهون"), value: fmt(it.fatG), sub: t("of \(fmt(c)) g", "من \(fmt(c)) غ"), frac: f(it.fatG, c), action: .detail(.eaten))
        case "fiber":
            guard let c = mt?.fiberG, c > 0 else { return nil }
            return FocusDatum(icon: "leaf.fill", color: hex(0x3FB27F), label: t("Fiber", "الألياف"), value: fmt(it.fiberG), sub: t("of \(fmt(c)) g", "من \(fmt(c)) غ"), frac: f(it.fiberG, c), action: .detail(.eaten))
        case "burn":
            guard let bn = b.burn?.totalKcal else { return nil }
            return FocusDatum(icon: "bolt.fill", color: hex(0x1E90E8), label: t("Burn", "الحرق"), value: fmt(bn), sub: b.expectedBurnKcal.map { t("of ~\(fmt($0))", "من ~\(fmt($0))") } ?? t("kcal", "سعرة"), frac: f(bn, b.expectedBurnKcal), action: .detail(.burn))
        case "water":
            guard let w = water else { return nil }
            return FocusDatum(icon: "drop.fill", color: hex(0x4AA8FF), label: t("Water", "الماء"), value: fmt1(w.intakeMl / 1000), sub: w.targetMl.map { t("of \(fmt1($0 / 1000)) L", "من \(fmt1($0 / 1000)) لتر") } ?? t("L", "لتر"), frac: f(w.intakeMl, w.targetMl), action: .water)
        case "steps":
            guard let s = steps, let n = s.steps else { return nil }
            return FocusDatum(icon: "figure.walk", color: hex(0xFF9E4D), label: t("Steps", "الخطوات"), value: fmt(n), sub: t("Goal \(fmt(s.goal))", "الهدف \(fmt(s.goal))"), frac: f(n, s.goal), action: .steps)
        case "sleep":
            guard let m = today?.sleepMin else { return nil }
            return FocusDatum(icon: "moon.zzz.fill", color: hex(0x8B6CF6), label: t("Sleep", "النوم"), value: hmText(m), sub: today?.sleepPerformance.map { t("\(Int($0))% performance", "أداء \(Int($0))%") } ?? t("Last night", "الليلة الماضية"), frac: (today?.sleepPerformance ?? 0) / 100, action: .wellness)
        case "recovery":
            guard let r = today?.recovery else { return nil }
            return FocusDatum(icon: "heart.fill", color: recoveryColor(r), label: t("Recovery", "الاستشفاء"), value: "\(Int(r))%", sub: today?.hrv.map { "HRV \(Int($0))" } ?? "", frac: r / 100, action: .wellness)
        case "strain":
            guard let s = today?.strain else { return nil }
            return FocusDatum(icon: "waveform.path.ecg", color: hex(0x1E90E8), label: t("Strain", "الجهد"), value: String(format: "%.1f", s), sub: t("of 21", "من 21"), frac: s / 21, action: .wellness)
        case "week_budget":
            guard let w = week else { return nil }
            let r = w.budget.remainingKcal
            return FocusDatum(icon: "calendar", color: r < 0 ? Theme.bad : hex(0xF2B94B), label: t("Weekly budget", "ميزانية الأسبوع"), value: fmt(abs(r)),
                              sub: r < 0 ? t("over the week (\(fmt(w.budget.weekTargetKcal)))", "فوق الأسبوع (\(fmt(w.budget.weekTargetKcal)))") : t("left of \(fmt(w.budget.weekTargetKcal)) kcal", "باقي من \(fmt(w.budget.weekTargetKcal)) سعرة"),
                              frac: f(w.budget.eatenKcal, w.budget.weekTargetKcal), heroLabel: r < 0 ? t("Over for the week", "فوق الأسبوع") : t("Week left", "باقي الأسبوع"),
                              heroSub: t("of \(fmt(w.budget.weekTargetKcal))", "من \(fmt(w.budget.weekTargetKcal))"), action: .week)
        case "week_protein":
            guard let w = week, let tg = w.proteinDays.targetG else { return nil }
            return FocusDatum(icon: "rosette", color: hex(0x8A7DF0), label: t("Protein days", "أيام البروتين"), value: t("\(w.proteinDays.hit) of 7", "\(w.proteinDays.hit) من 7"), sub: t("reached \(fmt(tg * 0.9))+ g", "وصلت \(fmt(tg * 0.9))+ غ"), frac: Double(w.proteinDays.hit) / 7, action: .week)
        case "week_water":
            guard let w = week else { return nil }
            return FocusDatum(icon: "drop.fill", color: hex(0x4AA8FF), label: t("Water days", "أيام الماء"), value: t("\(w.waterDays.hit) of 7", "\(w.waterDays.hit) من 7"), sub: t("This week", "هذا الأسبوع"), frac: Double(w.waterDays.hit) / 7, action: .week)
        case "week_steps":
            guard let w = week else { return nil }
            return FocusDatum(icon: "shoeprints.fill", color: hex(0xFF9E4D), label: t("Steps days", "أيام الخطوات"), value: t("\(w.stepsDays.hit) of 7", "\(w.stepsDays.hit) من 7"), sub: t("This week", "هذا الأسبوع"), frac: Double(w.stepsDays.hit) / 7, action: .week)
        default: return nil
        }
    }
}

struct BigRing: View {
    let d: FocusDatum
    var body: some View {
        ZStack {
            Circle().stroke(Theme.card2, lineWidth: 14)
            Circle().trim(from: 0, to: d.frac).stroke(d.color, style: StrokeStyle(lineWidth: 14, lineCap: .round)).rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.8), value: d.frac)
            VStack(spacing: 2) {
                Text(d.heroLabel ?? d.label).font(.footnote.weight(.heavy)).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.7)
                Text(d.value).font(.system(size: 40, weight: .heavy)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                Text(d.heroSub ?? d.sub).font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 24)
        }
        .aspectRatio(1, contentMode: .fit)
        .padding(7)
    }
}

struct FocusEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State var draft: Profile.TodayLayout
    var onSave: (Profile.TodayLayout) -> Void
    init(initial: Profile.TodayLayout, onSave: @escaping (Profile.TodayLayout) -> Void) { _draft = State(initialValue: initial); self.onSave = onSave }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(t("Pick the big ring and the tiles you want to see. A tile with no data today hides itself.", "اختر الحلقة الكبيرة والبطاقات اللي تبي تشوفها. البطاقة اللي ما فيها بيانات اليوم تختفي تلقائياً."))
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                Section(t("Big ring", "الحلقة الكبيرة")) {
                    Picker(t("Big ring", "الحلقة الكبيرة"), selection: $draft.hero) { ForEach(focusHeroes, id: \.self) { Text(focusName($0)).tag($0) } }
                        .pickerStyle(.inline).labelsHidden()
                }
                Section(t("Your tiles", "بطاقاتك")) {
                    ForEach(draft.tiles, id: \.self) { id in
                        HStack { Text(focusName(id)); Spacer()
                            Button { draft.tiles.removeAll { $0 == id } } label: { Image(systemName: "minus.circle.fill").foregroundStyle(Theme.bad) }.buttonStyle(.plain) }
                    }
                    .onMove { draft.tiles.move(fromOffsets: $0, toOffset: $1) }
                }
                Section(t("Add", "أضف")) {
                    ForEach(focusTiles.filter { !draft.tiles.contains($0) }, id: \.self) { id in
                        HStack { Text(focusName(id)); Spacer()
                            Button { if draft.tiles.count < 12 { draft.tiles.append(id) } } label: { Image(systemName: "plus.circle.fill").foregroundStyle(Theme.brand2) }.buttonStyle(.plain) }
                    }
                }
                Section { Button(t("Default", "الافتراضي")) { draft = defaultLayout } }
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle(t("Customize Today", "تخصيص اليوم")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("Cancel", "إلغاء")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(t("Save", "حفظ")) { onSave(draft); dismiss() }.bold() }
            }
        }
    }
}

struct WeekDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let week: WeekSummary
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    let r = week.budget.remainingKcal
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t("Weekly budget", "ميزانية الأسبوع")).font(.caption.weight(.heavy)).foregroundStyle(Theme.muted)
                        Text("\(fmt(week.budget.eatenKcal)) / \(fmt(week.budget.weekTargetKcal)) " + t("kcal", "سعرة")).font(.title.weight(.heavy)).monospacedDigit()
                            .environment(\.layoutDirection, .leftToRight)
                        Text(r >= 0 ? t("\(fmt(r)) left · ~\(fmt(r / Double(max(week.budget.daysLeft, 1)))) per remaining day", "باقي \(fmt(r)) · ~\(fmt(r / Double(max(week.budget.daysLeft, 1)))) لكل يوم باقي")
                                    : t("\(fmt(-r)) over the week", "فوق الأسبوع بـ \(fmt(-r))"))
                            .font(.subheadline).foregroundStyle(r >= 0 ? Theme.good : Theme.bad)
                    }
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
                    HStack(spacing: 8) {
                        stat(t("Protein days", "أيام البروتين"), week.proteinDays.hit)
                        stat(t("Water days", "أيام الماء"), week.waterDays.hit)
                        stat(t("Steps days", "أيام الخطوات"), week.stepsDays.hit)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        Text(t("kcal · ✓ protein ✓ water ✓ steps", "السعرات · ✓ بروتين ✓ ماء ✓ خطوات")).font(.caption).foregroundStyle(Theme.muted).padding(.bottom, 6)
                        ForEach(week.days) { d in
                            HStack {
                                Text((DateFormatter.isoDay.date(from: d.date) ?? Date()).formatted(.dateTime.weekday(.wide).locale(appLocale)))
                                Spacer()
                                Text("\(fmt(d.intakeKcal)) / \(fmt(d.targetKcal))").monospacedDigit().environment(\.layoutDirection, .leftToRight)
                                Text("\(d.proteinHit ? "✓" : "·") \(d.waterHit ? "✓" : "·") \(d.stepsHit ? "✓" : "·")").frame(width: 52)
                            }
                            .font(.subheadline).padding(.vertical, 8)
                            Divider()
                        }
                    }
                    .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
                    Text(t("The week runs Monday to Sunday. The budget is the sum of your daily targets (including extra burn), so a bigger day is balanced over the rest of the week instead of feeling like a failure. Don't go under your daily minimum to make up for it.",
                           "الأسبوع من الاثنين إلى الأحد. الميزانية = مجموع أهدافك اليومية (مع إضافة الحرق الزايد)، فيوم أكلت فيه أكثر يتعوّض بباقي الأسبوع بدل ما تحس إنك فشلت. لا تنزل تحت حدّك الأدنى اليومي للتعويض."))
                        .font(.caption).foregroundStyle(Theme.muted)
                }
                .padding()
            }
            .background(Theme.bg)
            .navigationTitle(t("This week", "هذا الأسبوع")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("Done", "تم")) { dismiss() } } }
        }
    }
    private func stat(_ l: String, _ n: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(l).font(.caption).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.7)
            Text("\(n)/7").font(.title2.weight(.heavy)).monospacedDigit()
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct StepsDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let day: StepsDay
    @State private var hist: [StepsHistory.Day] = []
    private let orange = Color(red: 1.0, green: 0.62, blue: 0.30)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(t("Steps, last 7 days", "الخطوات آخر 7 أيام")).font(.caption.weight(.heavy)).foregroundStyle(Theme.muted)
                        Text("\(day.steps.map { fmt($0) } ?? "—") / \(fmt(day.goal))").font(.largeTitle.weight(.heavy)).monospacedDigit()
                            .environment(\.layoutDirection, .leftToRight)
                        if !hist.isEmpty {
                            Chart(hist) { d in
                                BarMark(x: .value("day", String(d.date.suffix(2))), y: .value("steps", d.steps ?? 0))
                                    .foregroundStyle(orange.opacity(d.id == hist.last?.id ? 1 : 0.45)).cornerRadius(5)
                                RuleMark(y: .value("goal", day.goal)).foregroundStyle(Theme.ink.opacity(0.4)).lineStyle(StrokeStyle(dash: [4, 4]))
                            }
                            .frame(height: 140)
                        }
                    }
                    .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        tile(t("Today", "اليوم"), day.steps.map { fmt($0) } ?? "—")
                        tile(t("Today's goal", "هدف اليوم"), fmt(day.goal))
                        tile(t("7-day average", "متوسط 7 أيام"), day.avg7.map { fmt($0) } ?? "—")
                        tile(t("Full goal", "الهدف الكامل"), fmt(day.fullGoal))
                    }
                    if let src = day.sources, !src.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(t("Sources", "المصادر")).font(.headline)
                            Text(t("Each source is kept separately; we show the highest.", "كل مصدر ينحفظ لحاله، ونعرض الأعلى.")).font(.caption).foregroundStyle(Theme.muted).padding(.bottom, 6)
                            ForEach(src, id: \.self) { x in
                                HStack {
                                    Text(appLang == .ar ? x.nameAr : x.name)
                                    if x.source == day.source { Text(t("used", "المعتمد")).font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2).background(Theme.good.opacity(0.2), in: Capsule()) }
                                    Spacer()
                                    Text(fmt(x.steps)).monospacedDigit().bold()
                                    Text(x.at.formatted(.dateTime.hour().minute().locale(appLocale))).font(.caption).foregroundStyle(Theme.muted)
                                }
                                .padding(.vertical, 8)
                                Divider()
                            }
                        }
                        .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
                    }
                    Text(t("Goal: 9,000 steps under 60 and 7,000 at 60+ (the health benefit levels off around 8–10k under 60 and 6–8k at 60+ — Paluch 2022). It starts at your average + 1,000 and rises gradually.",
                           "الهدف 9,000 خطوة تحت 60 سنة و7,000 فوقها (الفائدة الصحية تستقر عند 8–10 آلاف تحت 60 و6–8 آلاف فوقها — Paluch 2022). يبدأ من متوسطك + 1,000 ويرتفع تدريجياً."))
                        .font(.caption).foregroundStyle(Theme.muted)
                }
                .padding()
            }
            .background(Theme.bg)
            .navigationTitle(t("Steps", "الخطوات")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("Done", "تم")) { dismiss() } } }
            .task { hist = (try? await APIClient.shared.stepsHistory())?.days ?? [] }
        }
    }
    private func tile(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption).foregroundStyle(Theme.muted)
            Text(value).font(.title3.weight(.heavy)).monospacedDigit()
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
    }
}
