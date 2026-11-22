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
                Text(label).font(.caption).foregroundStyle(Theme.muted).lineLimit(1).minimumScaleFactor(0.8)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(value).font(.title3.weight(.bold)).monospacedDigit().foregroundStyle(color)
                    Text(unit).font(.caption).foregroundStyle(Theme.muted)
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
        return Card(title: t("Today's meals", "وجبات اليوم"),
                    trailing: schedule == nil ? nil : AnyView(Button(t("Edit times", "تعديل الأوقات"), action: onEditTimes).font(.subheadline.weight(.semibold)))) {
            if rows.isEmpty {
                Text(t("No meals yet.", "لا وجبات بعد.")).font(.footnote).foregroundStyle(Theme.muted)
                Button(action: onLog) { Label(t("Log your meal", "سجّل وجبتك"), systemImage: "camera.fill") }.buttonStyle(SoftButtonStyle())
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                if i > 0 { Divider() }
                switch r {
                case .meal(let m): mealRow(m)
                case .slot(let s): slotRow(s)
                }
            }
        }
    }

    private func icon(_ name: String, bg: Color, fg: Color, dashed: Bool = false) -> some View {
        Image(systemName: name).font(.body.weight(.semibold)).foregroundStyle(fg)
            .frame(width: 44, height: 44)
            .background(dashed ? Color.clear : bg, in: RoundedRectangle(cornerRadius: 12))
            .overlay { if dashed { RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.muted.opacity(0.4), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])) } }
    }

    private func mealRow(_ m: Balance.MealRow) -> some View {
        NavigationLink(value: m.id) {
            HStack(spacing: 12) {
                let (sym, bg, fg): (String, Color, Color) = m.kind == "drink" ? ("cup.and.saucer.fill", Theme.sky, Theme.onPastel)
                    : m.status == "confirmed" ? ("checkmark", Theme.mintSoft, Theme.good) : ("hourglass", Theme.accentSoft, Theme.warn)
                icon(sym, bg: bg, fg: fg)
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.displayName).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text([kindLabel(m.kind), m.eatenAt.arTime, m.restaurant].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(fmt(m.calories)).font(.subheadline.weight(.bold)).monospacedDigit().foregroundStyle(Theme.ink)
                    if let p = m.proteinG { Text(t("\(fmt(p)) g protein", "\(fmt(p)) غ بروتين")).font(.caption2).foregroundStyle(Theme.muted) }
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
                head(t("Skipped", "تم التخطي"), false)
                Button(t("Undo", "تراجع")) { Task { await skip(s.id, undo: true) } }.font(.subheadline.weight(.semibold)).disabled(busy != nil)
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
    @State private var data: Wellness?
    @State private var open = false

    var body: some View {
        let workouts = activity?.workouts ?? []
        Card(title: t("Your body today", "جسمك اليوم"),
             trailing: workouts.isEmpty ? nil : AnyView(Text(t("\(fmt(activity?.totalMin ?? 0)) min · \(fmt(activity?.totalKcal ?? 0)) kcal", "\(fmt(activity?.totalMin ?? 0)) د · \(fmt(activity?.totalKcal ?? 0)) سعرة")).font(.caption).foregroundStyle(Theme.muted))) {
            if isToday, let d = data, d.connected {
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
        .task(id: store.refreshTick) { if isToday { await load() } }
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
