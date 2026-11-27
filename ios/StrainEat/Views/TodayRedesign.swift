import SwiftUI

// MARK: Today (redesign): hero card, goal/motivation chips, time-ordered meals, body card

private let ringGreen = Color(red: 0.17, green: 0.66, blue: 0.29)
private let burnBlue = Color(red: 0.09, green: 0.40, blue: 0.71)

private func hhmm(_ s: String) -> Int {
    let p = s.split(separator: ":").compactMap { Int($0) }
    return (p.first ?? 0) * 60 + (p.count > 1 ? p[1] : 0)
}
private func minutesOf(_ d: Date) -> Int {
    let c = Calendar.current.dateComponents([.hour, .minute], from: d)
    return (c.hour ?? 0) * 60 + (c.minute ?? 0)
}

/// Goal chip + one merged motivation chip (streak and weekly challenge).
struct TodayChips: View {
    let balance: Balance?
    let motivation: Motivation?
    var body: some View {
        let goalName: String = switch balance?.goal {
        case "lose": t("Lose weight", "إنقاص الوزن")
        case "gain": t("Gain weight", "زيادة الوزن")
        case "maintain": t("Maintain", "المحافظة")
        default: ""
        }
        let gd = balance?.goalDeltaKcal ?? 0
        let delta = gd < 0 ? t("\(fmt(-gd)) kcal/day deficit", "عجز \(fmt(-gd))/يوم") : gd > 0 ? t("\(fmt(gd)) kcal/day surplus", "فائض \(fmt(gd))/يوم") : ""
        var parts: [String] = []
        if let s = motivation?.streak, s.current > 0 { parts.append(t("\(s.current) \(s.current == 1 ? "day" : "days")", "\(s.current) \(s.current == 1 ? "يوم" : "أيام")")) }
        if let c = motivation?.challenge { parts.append(c.done ? t("Weekly challenge ✓", "تحدي الأسبوع ✓") : t("\(fmt(c.progress))/\(fmt(c.target)) this week", "\(fmt(c.progress))/\(fmt(c.target)) هذا الأسبوع")) }
        let goalChip = [goalName, delta].filter { !$0.isEmpty }.joined(separator: " · ")
        let motChip = parts.joined(separator: " · ")
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { chips(goalChip, motChip); Spacer(minLength: 0) }
            VStack(alignment: .leading, spacing: 6) { chips(goalChip, motChip) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func chips(_ goal: String, _ mot: String) -> some View {
            if !goal.isEmpty {
                Label(goal, systemImage: "scope")
                    .font(.caption.weight(.medium)).lineLimit(1).fixedSize()
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Theme.card, in: Capsule())
            }
            if !mot.isEmpty {
                Label(mot, systemImage: "flame.fill")
                    .font(.caption.weight(.semibold)).lineLimit(1).fixedSize()
                    .foregroundStyle(Theme.onPastel)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Theme.yellow, in: Capsule())
            }
    }
}

/// One card: kcal-left ring, budget / eaten / burned, net balance, protein bar, status line.
struct TodayHero: View {
    let balance: Balance
    let isToday: Bool
    @State private var detail: OverviewDetail?

    var body: some View {
        let b = balance
        let target = max(b.targetIntakeKcal ?? 1, 1), eaten = b.intake.calories, left = b.remainingKcal ?? (target - eaten)
        let burn = b.burn?.totalKcal
        let frac = left < 0 ? 1 : max(0, min(1, left / target))
        let pw = b.macroTargets?.proteinG ?? 0, ph = b.intake.proteinG
        let checks = nutrientChecks(b, isToday: isToday)
        let over = left < 0 && b.goal != "gain"
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 18) {
                Button { detail = .left } label: {
                    ZStack {
                        Circle().stroke(Theme.ringTrack, lineWidth: 14)
                        Circle().trim(from: 0, to: frac)
                            .stroke(over ? Theme.bad : ringGreen, style: StrokeStyle(lineWidth: 14, lineCap: .round)).rotationEffect(.degrees(-90))
                            .animation(.easeOut(duration: 0.6), value: frac)
                        VStack(spacing: 2) {
                            Text("\(left < 0 ? "+" : "")\(fmt(abs(left)))").font(.system(size: 30, weight: .heavy)).monospacedDigit()
                                .contentTransition(.numericText()).minimumScaleFactor(0.6).lineLimit(1)
                            Text(left < 0 ? t("over target", "فوق الهدف") : t("kcal left", "سعرة متبقية")).font(.caption).foregroundStyle(Theme.muted)
                        }
                        .padding(18)
                    }
                    .frame(width: 128, height: 128)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t("\(fmt(left)) kcal left of \(fmt(target)). Open details", "متبقي \(fmt(left)) من \(fmt(target)) سعرة. افتح التفاصيل"))
                VStack(alignment: .leading, spacing: 10) {
                    stat(t("Daily budget", "ميزانية اليوم"), fmt(target), t("kcal", "سعرة"), Theme.ink) { detail = .left }
                    stat(t("Eaten", "أكلت"), fmt(eaten), "· \(Int((eaten / target * 100).rounded()))%", Theme.ink) { detail = .eaten }
                    let expB = b.burnIsPartialDay ? (b.expectedBurnKcal ?? 0) : 0
                    stat(b.burn.map { t("Burned · \(sourceName($0.source))", "حرقت · \(sourceName($0.source))") } ?? t("Burned", "حرقت"),
                         burn.map { fmt($0) } ?? "—", expB > 0 ? t("of ~\(fmt(expB))", "من ~\(fmt(expB))") : t("kcal", "سعرة"), burnBlue,
                         bar: expB > 0 && burn != nil ? min(1, burn! / expB) : nil) { detail = .burn }
                }
            }
            if let burn, !(b.burnIsPartialDay && (b.expectedBurnKcal ?? 0) > 0) {
                let net = eaten - burn
                Button { detail = .burn } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(t("Net for the day", "صافي اليوم")).font(.subheadline.weight(.bold))
                            Spacer()
                            Text("\u{2066}\(net > 0 ? "+" : net < 0 ? "−" : "")\(fmt(abs(net)))\u{2069}").font(.headline.weight(.heavy)).monospacedDigit()
                            Text(t("kcal", "سعرة")).font(.subheadline)
                        }
                    }
                    .foregroundStyle(Color(red: 0.07, green: 0.25, blue: 0.44))
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.sky, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(t("Protein", "البروتين")).font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(pw > 0 ? t("\(fmt(ph)) of \(fmt(pw)) g", "\(fmt(ph)) من \(fmt(pw)) غ") : "\(fmt(ph)) \(t("g", "غ"))")
                        .font(.subheadline).monospacedDigit().foregroundStyle(Theme.muted)
                }
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.ringTrack)
                        Capsule().fill(Theme.protein).frame(width: g.size.width * (pw > 0 ? min(1, ph / pw) : 0))
                    }
                }
                .frame(height: 10)
            }
            statusLine(b, checks: checks)
        }
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .sheet(item: $detail) { d in OverviewDetailView(kind: d, balance: b, isToday: isToday) }
    }

    private func stat(_ label: String, _ value: String, _ unit: String, _ color: Color, bar: Double? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.8)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(value).font(.title2.weight(.heavy)).monospacedDigit().foregroundStyle(color)
                    Text(unit).font(.footnote).foregroundStyle(Theme.muted)
                }
                if let bar {
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.ringTrack)
                            Capsule().fill(Color(red: 0.12, green: 0.56, blue: 0.91)).frame(width: g.size.width * bar)
                        }
                    }
                    .frame(width: 130, height: 4).padding(.top, 4)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func statusLine(_ b: Balance, checks: [NutrientCheck]) -> some View {
        let target = b.targetIntakeKcal ?? 0, eaten = b.intake.calories
        let over = eaten - target
        let okN = checks.filter { $0.state == .ok }.count
        let good: Bool
        let text: String
        if b.goal == "gain" {
            good = eaten >= target * 0.95
            text = good ? t("You reached today's target", "وصلت هدف اليوم") : t("On the way to your gain target", "في الطريق لهدف الزيادة")
        } else if over > 0 {
            good = false
            text = t("\(fmt(over)) kcal over today's target", "تجاوزت هدف اليوم بـ \(fmt(over)) سعرة")
        } else {
            good = true
            text = okN == checks.count ? t("Within target", "ضمن الهدف")
                : t("Within target · \(checks.count - okN) to watch", "ضمن الهدف · \(checks.count - okN) تحتاج انتباه")
        }
        return HStack(spacing: 10) {
            Image(systemName: good ? "checkmark.circle" : "exclamationmark.circle").font(.headline)
            Text(text).font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(good ? Color(red: 0.07, green: 0.21, blue: 0.11) : Color(red: 0.35, green: 0.10, blue: 0.06))
        .padding(12)
        .background(good ? Theme.mint : Theme.pink, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// "Next up": the next planned slot, with the meal-ideas button under it.
struct NextUpHeader: View {
    let slot: DaySchedule.Slot?
    var body: some View {
        if let s = slot {
            let mins = max(0, hhmm(s.time) - minutesOf(Date()))
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(s.label) · \(s.time)").font(.headline)
                    Text(t("Aim for about \(fmt(s.targetKcal)) kcal", "هدفك حوالي \(fmt(s.targetKcal)) سعرة")).font(.subheadline).foregroundStyle(Theme.muted)
                }
                Spacer()
                Text(s.status == "now" ? t("Now", "الآن") : mins >= 60 ? t("In \(Int((Double(mins) / 60).rounded())) h", "بعد \(Int((Double(mins) / 60).rounded())) س") : t("In \(mins) min", "بعد \(mins) د"))
                    .font(.caption.weight(.semibold)).padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Theme.card2, in: Capsule())
            }
        } else {
            Text(t("Today's planned meals are done. If you get hungry, pick something light that fits what's left.", "انتهت وجبات اليوم المخططة. إذا جعت، اختر شيئاً خفيفاً يناسب ما تبقى."))
                .font(.subheadline).foregroundStyle(Theme.muted)
        }
    }
}

/// Plan slots and logged meals in one list, in time order. Missed slots can be logged or marked skipped.
struct TimelineCard: View {
    let meals: [Balance.MealRow]
    let schedule: DaySchedule?
    var onLog: () -> Void
    var onSchedule: (DaySchedule) -> Void
    var onEditTimes: () -> Void
    @State private var busy: String?
    @State private var showAll = false

    private enum Row: Identifiable {
        case meal(Balance.MealRow), slot(DaySchedule.Slot)
        var id: String { switch self { case .meal(let m): "m-\(m.id)"; case .slot(let s): "s-\(s.id)" } }
        var at: Int { switch self { case .meal(let m): minutesOf(m.eatenAt); case .slot(let s): hhmm(s.time) } }
    }

    var body: some View {
        let drafts = meals.filter { $0.status != "confirmed" }.map { minutesOf($0.eatenAt) }
        var rows: [Row] = meals.map { .meal($0) }
        for s in schedule?.slots ?? [] where s.items.isEmpty && !drafts.contains(where: { abs($0 - hhmm(s.time)) <= 180 }) { rows.append(.slot(s)) }
        rows.sort { $0.at < $1.at }
        // Default: the last three meals added; "View all meals" shows the full day with planned slots.
        let recent = Array(meals.sorted { minutesOf($0.eatenAt) > minutesOf($1.eatenAt) }.prefix(3).reversed())
        let compact = !showAll && !meals.isEmpty && rows.count > recent.count
        let shown: [Row] = compact ? recent.map { .meal($0) } : rows
        let canToggle = !meals.isEmpty && rows.count > recent.count
        return Card {
            HStack(spacing: 6) {
                if !meals.isEmpty { Text(t("\(meals.count) meals ·", "\(meals.count) وجبات ·")) }
                if schedule != nil { Button(t("Edit times", "تعديل الأوقات"), action: onEditTimes).fontWeight(.semibold).foregroundStyle(Theme.brand2) }
                Spacer()
                Text(t("kcal", "سعرة"))
            }
            .font(.caption).foregroundStyle(Theme.muted)
            if rows.isEmpty {
                Text(t("No meals yet.", "لا وجبات بعد.")).font(.footnote).foregroundStyle(Theme.muted)
                Button(action: onLog) { Label(t("Log your meal", "سجّل وجبتك"), systemImage: "camera.fill") }.buttonStyle(SoftButtonStyle())
            }
            ForEach(Array(shown.enumerated()), id: \.element.id) { i, r in
                if i > 0 { Divider() }
                switch r {
                case .meal(let m): mealRow(m)
                case .slot(let s): slotRow(s)
                }
            }
            if canToggle {
                Divider()
                Button { withAnimation(.snappy) { showAll.toggle() } } label: {
                    Label(compact ? t("View all meals", "عرض كل الوجبات") : t("Show less", "عرض أقل"), systemImage: compact ? "arrow.forward" : "chevron.up")
                        .labelStyle(TrailingIconLabel())
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func icon(_ name: String, bg: Color = Theme.card2, fg: Color = Theme.muted, dashed: Bool = false) -> some View {
        Image(systemName: name).font(.subheadline.weight(.semibold)).foregroundStyle(fg)
            .frame(width: 34, height: 34)
            .background(dashed ? Color.clear : bg, in: RoundedRectangle(cornerRadius: 10))
            .overlay { if dashed { RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.muted.opacity(0.4), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])) } }
    }

    /// Name the meal by the plan slot it counted toward; eaten far from any slot = snack.
    private func label(_ m: Balance.MealRow) -> (String, String) {
        if m.kind == "drink" { return (t("Drink", "مشروب"), "cup.and.saucer") }
        if let d = schedule, m.status == "confirmed" {
            if let s = d.slots.first(where: { $0.items.contains { $0.id == m.id } }) {
                return (s.label, s.kind == "snack" ? "carrot" : ["breakfast", "suhoor"].contains(s.id) ? "sun.max" : ["dinner", "iftar", "evening"].contains(s.id) ? "moon" : "fork.knife")
            }
            return (t("Snack", "سناك"), "carrot")
        }
        if m.kind == "snack" { return (t("Snack", "سناك"), "carrot") }
        return (kindLabel(m.kind) ?? t("Meal", "وجبة"), "fork.knife")
    }

    private func mealRow(_ m: Balance.MealRow) -> some View {
        let (lbl, sym) = label(m)
        return NavigationLink(value: m.id) {
            HStack(spacing: 12) {
                icon(sym)
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.displayName).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2)
                    Text(([lbl, m.eatenAt.arTime, m.restaurant].compactMap { $0 } + (m.status == "confirmed" ? [] : [t("Draft", "مسودة")])).joined(separator: " · "))
                        .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(fmt(m.calories)).font(.headline).monospacedDigit().foregroundStyle(Theme.ink)
                    if let p = m.proteinG { Text(t("\(fmt(p)) g protein", "\(fmt(p))غ بروتين")).font(.caption2).foregroundStyle(Theme.muted) }
                }
            }
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func slotRow(_ s: DaySchedule.Slot) -> some View {
        let plan = t("~\(fmt(s.targetKcal)) kcal planned", "المخطط ~\(fmt(s.targetKcal)) سعرة")
        let sym = s.kind == "snack" ? "carrot" : ["breakfast", "suhoor"].contains(s.id) ? "sun.max" : ["dinner", "iftar", "evening"].contains(s.id) ? "moon" : "fork.knife"
        let head = { (sub: String, dashed: Bool) in
            HStack(spacing: 12) {
                icon(sym, bg: Theme.card2, fg: Theme.muted, dashed: dashed)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(s.label) · \(s.time)").font(.subheadline.weight(.semibold))
                    Text(sub).font(.caption).foregroundStyle(Theme.muted)
                }
                Spacer()
            }
        }
        switch s.status {
        case "upcoming":
            head("\(t("Upcoming", "قادم")) · \(plan)", true)
        case "skipped":
            HStack {
                Text("\(s.label) · \(s.time) · \(t("skipped", "تخطيته"))").font(.caption).foregroundStyle(Theme.muted)
                Spacer()
                Button(t("Undo", "تراجع")) { Task { await skip(s.id, undo: true) } }.font(.caption.weight(.semibold)).disabled(busy != nil)
            }
        default:
            VStack(alignment: .leading, spacing: 10) {
                head("\(s.status == "now" ? t("Now", "الآن") : t("Not logged", "لم تُسجّل")) · \(plan)", false)
                HStack(spacing: 8) {
                    Button(t("Log it", "سجّلها"), action: onLog)
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Color(red: 0.07, green: 0.21, blue: 0.11))
                        .padding(.horizontal, 18).frame(minHeight: 44).background(Theme.mint, in: Capsule())
                    Button(t("I skipped it", "تخطيتها")) { Task { await skip(s.id, undo: false) } }
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        .padding(.horizontal, 18).frame(minHeight: 44)
                        .background(Theme.card2, in: Capsule())
                        .disabled(busy != nil)
                }
                .buttonStyle(.plain)
                .padding(.leading, 56)
            }
        }
    }

    private func skip(_ slot: String, undo: Bool) async {
        busy = slot
        defer { busy = nil }
        if let d: DaySchedule = try? await APIClient.shared.post("schedule/skip", ["slot": slot, "undo": undo]) { onSchedule(d) }
    }
}

/// WHOOP tiles (each opens recovery & sleep details) with the day's workouts folded in.
struct BodyTodayCard: View {
    @Environment(AppStore.self) private var store
    let activity: DayActivity?
    let isToday: Bool
    var showWellness = true
    @State private var data: Wellness?
    @State private var open = false
    @State private var steps: StepsDay?

    var body: some View {
        let workouts = activity?.workouts ?? []
        Card(title: showWellness ? t("Your body today", "جسمك اليوم") : t("Activity", "النشاط"),
             trailing: workouts.isEmpty ? nil : AnyView(Text(t("\(fmt(activity?.totalMin ?? 0)) min · \(fmt(activity?.totalKcal ?? 0)) kcal", "\(fmt(activity?.totalMin ?? 0)) د · \(fmt(activity?.totalKcal ?? 0)) سعرة")).font(.caption).foregroundStyle(Theme.muted))) {
            if let st = steps, let n = st.steps {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Label(t("\(fmt(n)) steps", "\(fmt(n)) خطوة"), systemImage: "shoeprints.fill").font(.headline.weight(.heavy)).lineLimit(1)
                        Spacer()
                        Text(t("Goal \(fmt(st.goal))", "الهدف \(fmt(st.goal))") + (st.goal < st.fullGoal ? t(" · rising to \(fmt(st.fullGoal))", " · نرفعه لـ \(fmt(st.fullGoal))") : ""))
                            .font(.caption).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.card2)
                            Capsule().fill(n >= st.goal ? Theme.good : Theme.brand2).frame(width: g.size.width * min(1, n / max(st.goal, 1)))
                        }
                    }
                    .frame(height: 6)
                }
                .padding(.bottom, 4)
            }
            if showWellness, isToday, let d = data, d.connected {
                if d.needsReconnect {
                    Button { Task { _ = try? await WhoopConnector.shared.connect(); await load() } } label: {
                        Text(t("Reconnect WHOOP once to show recovery and sleep. Tap here.", "أعد ربط WHOOP مرة واحدة لإظهار الاستشفاء والنوم. اضغط هنا."))
                            .font(.subheadline).foregroundStyle(Theme.brand2).frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else if let td = d.today, td.recovery != nil || td.sleepMin != nil || td.strain != nil {
                    HStack(spacing: 8) {
                        let rec = td.recovery
                        tile(t("Recovery", "الاستشفاء"), rec.map { "\(Int($0))%" } ?? "—",
                             rec.map { $0 >= 67 ? t("Good", "جيد") : $0 >= 34 ? t("Fair", "متوسط") : t("Low", "منخفض") } ?? "", recoveryColor(rec))
                        tile(t("Sleep", "النوم"), hmText(td.sleepMin), t("Last night", "الليلة الماضية"), Theme.ink)
                        tile(t("Strain", "الجهد"), td.strain.map { String(format: "%.1f", $0) } ?? "—",
                             td.strain.map { $0 >= 14 ? t("High", "عالية") : $0 >= 10 ? t("Moderate", "متوسطة") : t("Light day", "يوم خفيف") } ?? "", burnBlue)
                    }
                    .sheet(isPresented: $open) { WellnessDetailView(data: d) }
                } else {
                    Text(t("No WHOOP data for today yet — pull down to refresh.", "لا توجد بيانات WHOOP اليوم بعد — اسحب الشاشة للتحديث.")).font(.footnote).foregroundStyle(Theme.muted)
                }
                Divider()
            }
            if workouts.isEmpty {
                Label(t("No workout yet · syncs from WHOOP and Apple Health", "لا يوجد تمرين بعد · يُسحب من WHOOP و Apple Health"), systemImage: "waveform.path.ecg")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
            ForEach(workouts) { w in
                HStack(spacing: 12) {
                    Image(systemName: sportIcon(w.kind)).font(.body.weight(.semibold)).foregroundStyle(Theme.brand2)
                        .frame(width: 40, height: 40).background(Theme.brandSoft, in: RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(w.displayName).font(.subheadline.weight(.semibold))
                        Text([t("\(fmt(w.durationMin)) min", "\(fmt(w.durationMin)) د"), w.start.arTime, w.strain.map { t("Strain \(fmt1($0))", "إجهاد \(fmt1($0))") }].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Text(t("\(fmt(w.kcal ?? 0)) kcal", "\(fmt(w.kcal ?? 0)) سعرة")).font(.subheadline.weight(.semibold)).monospacedDigit()
                }
            }
        }
        .task(id: store.refreshTick) { if isToday && showWellness { await load() } }
        .task(id: "\(store.refreshTick)-\(store.selectedDateKey)") { steps = try? await APIClient.shared.steps(date: store.selectedDateKey) }
    }

    private func tile(_ label: String, _ value: String, _ sub: String, _ color: Color) -> some View {
        Button { open = true } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 2) { Text(label); Image(systemName: "chevron.forward").font(.caption2.weight(.bold)) }
                    .font(.caption).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.8)
                Text(value).font(.title3.weight(.heavy)).monospacedDigit().foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
                Text(sub).font(.caption2).foregroundStyle(Theme.muted).lineLimit(1)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card2, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func load() async { data = try? await APIClient.shared.wellness() }
}

/// A tip shown as one short line; tap to read the rest.
struct TipRow: View {
    let text: String
    @State private var open = false
    var body: some View {
        let head = text.components(separatedBy: " — ").first?.components(separatedBy: ": ").first?.components(separatedBy: ". ").first ?? text
        Button { withAnimation(.easeOut(duration: 0.2)) { open.toggle() } } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "lightbulb").foregroundStyle(Theme.warn)
                Text(open || head == text ? text : head).font(.subheadline).foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                if !open && head != text { Image(systemName: "chevron.forward").font(.caption.weight(.bold)).foregroundStyle(Theme.muted).padding(.top, 3) }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: Today v4 — WHOOP-style rings, swipeable insight cards, monitors

/// Three rings: kcal left, protein, burn. Each opens its detail.
struct TodayRings: View {
    let balance: Balance
    let isToday: Bool
    @State private var detail: OverviewDetail?

    var body: some View {
        let b = balance
        let target = max(b.targetIntakeKcal ?? 1, 1), left = b.remainingKcal ?? (target - b.intake.calories)
        let pw = b.macroTargets?.proteinG ?? 0, ph = b.intake.proteinG
        let burn = b.burn?.totalKcal, expB = b.expectedBurnKcal ?? 0
        HStack(spacing: 8) {
            ring(left < 0 ? 1 : left / target, left < 0 && b.goal != "gain" ? Theme.bad : ringGreen,
                 "\(left < 0 ? "+" : "")\(fmt(abs(left)))", left < 0 ? t("OVER", "فوق الهدف") : t("LEFT", "متبقي"),
                 (b.burnBonusKcal ?? 0) > 0 ? t("+\(fmt(b.burnBonusKcal!)) from burn", "+\(fmt(b.burnBonusKcal!)) من الحرق") : t("kcal", "سعرة")) { detail = .left }
            ring(pw > 0 ? ph / pw : 0, Color(red: 0.54, green: 0.49, blue: 0.94), fmt(ph), t("PROTEIN", "بروتين"), pw > 0 ? t("of \(fmt(pw)) g", "من \(fmt(pw)) غ") : t("g", "غ")) { detail = .eaten }
            ring(burn != nil && expB > 0 ? burn! / expB : 0, Color(red: 0.12, green: 0.56, blue: 0.91), burn.map { fmt($0) } ?? "—",
                 t("BURN", "حرق"), burn != nil && b.burnIsPartialDay && expB > 0 ? t("of ~\(fmt(expB))", "من ~\(fmt(expB))") : t("kcal", "سعرة")) { detail = .burn }
        }
        .sheet(item: $detail) { d in OverviewDetailView(kind: d, balance: b, isToday: isToday) }
    }

    private func ring(_ frac: Double, _ color: Color, _ value: String, _ label: String, _ unit: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                ZStack {
                    // same look as the tiles below: tinted disc, tinted track
                    Circle().fill(color.opacity(0.16)).overlay(Circle().stroke(color.opacity(0.28), lineWidth: 1)).padding(11)
                    Circle().stroke(color.opacity(0.22), lineWidth: 7)
                    Circle().trim(from: 0, to: max(0, min(1, frac)))
                        .stroke(color, style: StrokeStyle(lineWidth: 7, lineCap: .round)).rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 0.7), value: frac)
                    Text(value).font(.system(size: 21, weight: .heavy)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1).padding(12)
                }
                .frame(maxWidth: 104).aspectRatio(1, contentMode: .fit)
                Text(label).font(.caption.weight(.heavy)).tracking(appLang == .ar ? 0 : 1.4).padding(.top, 5).foregroundStyle(color)
                Text(unit).font(.caption2).foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }
}

/// One insight at a time; swipe it away (dismissed for the rest of the day).
struct InsightStack: View {
    let balance: Balance
    let schedule: DaySchedule?
    let motivation: Motivation?
    let isToday: Bool
    var onLog: () -> Void
    var onSuggest: () -> Void
    var onSchedule: (DaySchedule) -> Void
    @State private var gone: [String] = []
    @State private var drag: CGFloat = 0
    @State private var pos = 0

    struct Item: Identifiable { let id: String; let icon: String; let title: String; let sub: String; var acts: [(String, Bool, () -> Void)] = []; var tone = "mid" }

    private var key: String { "dis-" + (isToday ? Date() : Date.distantPast).formatted(.iso8601.year().month().day()) }

    private var items: [Item] {
        var out: [Item] = []
        let b = balance
        for c in b.cards ?? [] {
            out.append(Item(id: c.id, icon: c.kind == "morning" ? "sun.max" : "bolt.heart", title: c.title, sub: c.lines.joined(separator: "\n"),
                            acts: c.kind == "workout" ? [(t("Suggest a post-workout meal", "اقترح وجبة بعد التمرين"), true, onSuggest)] : [], tone: c.tone))
        }
        if isToday, let d = schedule {
            if let nx = d.slots.first(where: { $0.status == "now" || $0.status == "upcoming" }) {
                let mins = max(0, hhmm(nx.time) - minutesOf(Date()))
                let when = nx.status == "now" ? t("Now", "الآن") : mins >= 60 ? t("In \(Int((Double(mins) / 60).rounded())) h", "بعد \(Int((Double(mins) / 60).rounded())) س") : t("In \(mins) min", "بعد \(mins) د")
                out.append(Item(id: "next:\(nx.id)", icon: "clock", title: "\(nx.label) · \(nx.time)",
                                sub: t("Aim for about \(fmt(nx.targetKcal)) kcal", "هدفك حوالي \(fmt(nx.targetKcal)) سعرة") + " · " + when,
                                acts: [(t("Suggest a meal", "اقترح وجبة"), true, onSuggest)]))
            } else if (b.remainingKcal ?? 0) > 150 {
                out.append(Item(id: "next:done", icon: "clock", title: t("Today's planned meals are done", "انتهت وجبات اليوم المخططة"),
                                sub: t("\(fmt(b.remainingKcal ?? 0)) kcal left", "متبقي \(fmt(b.remainingKcal ?? 0)) سعرة"),
                                acts: [(t("Suggest something light", "اقترح شيئاً خفيفاً"), true, onSuggest)]))
            }
            for s in d.slots where s.status == "missed" && s.items.isEmpty {
                out.append(Item(id: "miss:\(s.id)", icon: "exclamationmark.circle", title: t("\(s.label) not logged", "\(s.label) لم تُسجّل"),
                                sub: t("~\(fmt(s.targetKcal)) kcal planned", "المخطط ~\(fmt(s.targetKcal)) سعرة"),
                                acts: [(t("Log it", "سجّلها"), true, onLog), (t("I skipped it", "تخطيتها"), false, { Task { await skip(s.id) } })]))
            }
        }
        if b.goal != "gain", let target = b.targetIntakeKcal, b.intake.calories > target {
            out.append(Item(id: "over", icon: "exclamationmark.circle", title: t("\(fmt(b.intake.calories - target)) kcal over today's target", "تجاوزت هدف اليوم بـ \(fmt(b.intake.calories - target)) سعرة"), sub: ""))
        }
        if b.pendingDrafts.calories > 0 {
            out.append(Item(id: "drafts", icon: "hourglass", title: t("Drafts not counted: \(fmt(b.pendingDrafts.calories)) kcal", "مسودات لم تُحسب: \(fmt(b.pendingDrafts.calories)) سعرة"),
                            sub: t("Open and confirm them so they count", "افتحها وأكّدها لتدخل في حسابك")))
        }
        if isToday, let c = motivation?.challenge, !c.done {
            out.append(Item(id: "chal", icon: "flame", title: t("Weekly challenge: \(fmt(c.progress))/\(fmt(c.target))", "تحدي الأسبوع: \(fmt(c.progress))/\(fmt(c.target))"), sub: c.title))
        }
        for tip in b.tips ?? [] {
            let head = tip.text.components(separatedBy: " — ").first?.components(separatedBy: ": ").first?.components(separatedBy: ". ").first ?? tip.text
            let rest = head.count < tip.text.count ? String(tip.text.dropFirst(head.count)).trimmingCharacters(in: CharacterSet(charactersIn: " —:.")) : ""
            out.append(Item(id: "tip:\(tip.text.hashValue)", icon: "lightbulb", title: head, sub: rest))
        }
        return out.filter { !gone.contains($0.id) }
    }

    var body: some View {
        let all = items
        let n = all.count, i0 = n > 0 ? ((pos % n) + n) % n : 0
        let list = n > 0 ? Array(all[i0...] + all[..<i0]) : []
        VStack(spacing: 10) {
        ZStack {
            if list.count > 1 {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.card).opacity(0.55)
                    .padding(.horizontal, 12).offset(y: 9)
            }
            if let c = list.first {
                card(c, index: i0 + 1, count: n)
                    .offset(x: drag).rotationEffect(.degrees(Double(drag / 25)))
                    .gesture(DragGesture(minimumDistance: 12)
                        .onChanged { drag = $0.translation.width }
                        .onEnded { v in
                            if abs(v.translation.width) > 80 && n > 1 { fly(c.id, dir: v.translation.width > 0 ? 1 : -1, hide: false) }
                            else { withAnimation(.spring(duration: 0.25)) { drag = 0 } }
                        })
                    .id(c.id)
                    .transition(.opacity)
            }
        }
        }
        .onAppear { gone = UserDefaults.standard.stringArray(forKey: key) ?? [] }
    }

    private func card(_ c: Item, index: Int, count: Int) -> some View {
        let tint: (Color, Color, Color) = c.tone == "low" || c.tone == "bad"
            ? (Color(red: 0.18, green: 0.12, blue: 0.11), Color(red: 0.16, green: 0.13, blue: 0.12), Color(red: 0.29, green: 0.18, blue: 0.17))
            : c.tone == "info" ? (Color(red: 0.11, green: 0.15, blue: 0.2), Color(red: 0.1, green: 0.15, blue: 0.19), Color(red: 0.17, green: 0.24, blue: 0.32))
            : (Color(red: 0.11, green: 0.16, blue: 0.12), Color(red: 0.1, green: 0.16, blue: 0.15), Color(red: 0.17, green: 0.29, blue: 0.21))
        return HStack(alignment: .center, spacing: 12) {
            Image(systemName: "lightbulb").font(.title3.weight(.semibold)).foregroundStyle(Color(red: 0.95, green: 0.82, blue: 0.35))
                .frame(width: 46, height: 46).background(Color(red: 0.95, green: 0.82, blue: 0.35).opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(c.title).font(.headline.weight(.heavy)).foregroundStyle(.white).lineLimit(2)
                if !c.sub.isEmpty { Text(c.sub).font(.subheadline).foregroundStyle(.white.opacity(0.8)) }
                if c.acts.count > 1 {
                    HStack(spacing: 8) {
                        ForEach(Array(c.acts.enumerated()), id: \.offset) { _, a in
                            Button(a.0, action: a.2).font(.subheadline.weight(.bold))
                                .foregroundStyle(a.1 ? Color(red: 0.09, green: 0.07, blue: 0.12) : .white)
                                .padding(.horizontal, 14).frame(minHeight: 34)
                                .background(a.1 ? Theme.brand2 : Color.white.opacity(0.08), in: Capsule())
                        }
                    }
                    .buttonStyle(.plain).padding(.top, 4)
                }
                if count > 1 {
                    HStack(spacing: 5) {
                        ForEach(0..<count, id: \.self) { k in Circle().fill(k == index - 1 ? Theme.good : Color.white.opacity(0.35)).frame(width: 6, height: 6) }
                        Text(t("Swipe for next", "اسحب للتالي")).font(.caption2).foregroundStyle(.white.opacity(0.6)).padding(.leading, 4)
                    }
                    .padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
            if let first = c.acts.first {
                Button(action: first.2) {
                    Image(systemName: "chevron.forward").font(.subheadline.weight(.bold)).foregroundStyle(.white)
                        .frame(width: 34, height: 34).background(Color.white.opacity(0.08), in: Circle())
                }
                .buttonStyle(.plain).accessibilityLabel(first.0)
            }
        }
        .padding(14)
        .background(LinearGradient(colors: [tint.0, tint.1], startPoint: .leading, endPoint: .trailing), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(tint.2))
        .overlay(alignment: .topTrailing) {
            Button { fly(c.id, dir: appLang == .ar ? -1 : 1, hide: true) } label: { Image(systemName: "xmark").font(.caption2.weight(.bold)).foregroundStyle(.white.opacity(0.6)).padding(8) }
                .accessibilityLabel(t("Hide", "إخفاء"))
        }
    }

    /// Swipe = next card (they cycle); × = hide for today (restorable).
    private func fly(_ id: String, dir: CGFloat, hide: Bool) {
        withAnimation(.easeIn(duration: 0.22)) { drag = dir * 420 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
            if hide { gone.append(id); UserDefaults.standard.set(gone, forKey: key) } else { pos += 1 }
            drag = 0
        }
    }

    private func skip(_ slot: String) async {
        if let d: DaySchedule = try? await APIClient.shared.post("schedule/skip", ["slot": slot, "undo": false]) { onSchedule(d) }
    }
}

/// Two small monitors under the cards (like WHOOP's Health / Stress monitors).
struct TodayMonitors: View {
    @Environment(AppStore.self) private var store
    let balance: Balance
    let isToday: Bool
    @State private var well: Wellness?
    @State private var detail: OverviewDetail?
    @State private var openWell = false

    var body: some View {
        let b = balance, target = b.targetIntakeKcal ?? 0, eaten = b.intake.calories
        let over = b.goal != "gain" && eaten > target
        let rec = isToday && well?.connected == true && well?.needsReconnect != true ? well?.today?.recovery : nil
        HStack(spacing: 10) {
            tile(t("NUTRITION", "التغذية"), over ? t("Over target", "تجاوزت الهدف") : t("✓ Within target", "✓ ضمن الهدف"), over ? Theme.bad : Theme.good,
                 t("Ate \(fmt(eaten)) of \(fmt(target))", "أكلت \(fmt(eaten)) من \(fmt(target))")) { detail = .eaten }
            if let rec {
                tile(t("BODY", "الجسم"), "\(Int(rec))%", recoveryColor(rec),
                     t("Recovery", "الاستشفاء") + (well?.today?.sleepMin.map { " · " + t("sleep", "نوم") + " " + hmText($0) } ?? "")) { openWell = true }
            } else {
                let n = b.activity?.workouts.count ?? 0
                tile(t("BODY", "الجسم"), n > 0 ? t("\(n) workout(s)", "\(n) تمرين") : t("No workout yet", "لا تمرين بعد"), Theme.ink,
                     b.burn.map { t("Burned \(fmt($0.totalKcal)) kcal", "حرق \(fmt($0.totalKcal)) سعرة") } ?? t("Connect WHOOP or Apple Health", "اربط WHOOP أو Apple Health")) { detail = .burn }
            }
        }
        .sheet(item: $detail) { d in OverviewDetailView(kind: d, balance: b, isToday: isToday) }
        .sheet(isPresented: $openWell) { if let well { WellnessDetailView(data: well) } }
        .task(id: store.refreshTick) { if isToday { well = try? await APIClient.shared.wellness() } }
    }

    private func tile(_ title: String, _ value: String, _ color: Color, _ sub: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                HStack { Text(title).font(.caption.weight(.heavy)).tracking(appLang == .ar ? 0 : 1.2); Spacer(); Image(systemName: "chevron.forward").font(.caption2.weight(.bold)).foregroundStyle(Theme.muted) }
                Text(value).font(.headline.weight(.heavy)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.8)
                Text(sub).font(.caption2).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.8)
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// Text first, icon after (e.g. "View all meals →").
struct TrailingIconLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View { HStack(spacing: 6) { configuration.title; configuration.icon } }
}
