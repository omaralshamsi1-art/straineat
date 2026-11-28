import Charts
import SwiftUI

// MARK: WHOOP-style overview: three rings, two monitor cards, detail pages

enum OverviewDetail: String, Identifiable { case eaten, left, burn; var id: String { rawValue } }

private let eatColor = Color(red: 0.48, green: 0.65, blue: 0.79)
private let leftColor = Color(red: 0.18, green: 0.75, blue: 0.33)
private let burnColor = Color(red: 0.12, green: 0.56, blue: 0.91)

struct NutrientCheck: Identifiable {
    enum State { case ok, high, low }
    let id: String; let label: String; let have: Double; let want: Double; let unit: String; let state: State; let chip: String
}

func nutrientChecks(_ b: Balance, isToday: Bool) -> [NutrientCheck] {
    let late = !isToday || Calendar.current.component(.hour, from: Date()) >= 19
    let mt = b.macroTargets
    func row(_ id: String, _ label: String, _ have: Double, _ want: Double, _ unit: String, max: Bool) -> NutrientCheck {
        if max {
            let hi = want > 0 && have > want * 1.05
            return .init(id: id, label: label, have: have, want: want, unit: unit, state: hi ? .high : .ok,
                         chip: hi ? t("↑ above \(fmt(want))", "↑ أعلى من \(fmt(want))") : t("✓ within ≤ \(fmt(want))", "✓ ضمن ≤ \(fmt(want))"))
        }
        let lo = late && want > 0 && have < want * 0.8
        return .init(id: id, label: label, have: have, want: want, unit: unit, state: lo ? .low : .ok,
                     chip: lo ? t("↓ below \(fmt(want))", "↓ أقل من \(fmt(want))") : have >= want ? t("✓ reached \(fmt(want))", "✓ وصلت \(fmt(want))") : t("✓ target \(fmt(want))", "✓ الهدف \(fmt(want))"))
    }
    var out = [
        row("kcal", t("Calories", "السعرات"), b.intake.calories, b.targetIntakeKcal ?? 0, t("kcal", "سعرة"), max: b.goal != "gain"),
        row("protein", t("Protein", "البروتين"), b.intake.proteinG, mt?.proteinG ?? 0, t("g", "غ"), max: false),
        row("carbs", t("Carbs", "الكربوهيدرات"), b.intake.carbsG, mt?.carbsG ?? 0, t("g", "غ"), max: true),
        row("fat", t("Fat", "الدهون"), b.intake.fatG, mt?.fatG ?? 0, t("g", "غ"), max: true),
        row("fiber", t("Fibre", "الألياف"), b.intake.fiberG, mt?.fiberG ?? 0, t("g", "غ"), max: false),
    ]
    if b.intake.sodiumMg > 0 { out.append(row("sodium", t("Sodium", "الصوديوم"), b.intake.sodiumMg, 2300, t("mg", "ملغ"), max: true)) }
    return out
}

private func chipColors(_ s: NutrientCheck.State) -> (Color, Color) {
    switch s {
    case .ok: (Theme.good, Theme.goodSoft)
    case .high: (Theme.warn, Theme.accentSoft)
    case .low: (Color(red: 0.12, green: 0.37, blue: 0.66), Color(red: 0.89, green: 0.94, blue: 0.98))
    }
}

struct MiniRing: View {
    let fraction: Double
    let color: Color
    let value: String
    let label: String
    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle().stroke(Theme.ringTrack, lineWidth: 9)
                Circle().trim(from: 0, to: max(0, min(1, fraction)))
                    .stroke(color, style: StrokeStyle(lineWidth: 9, lineCap: .round)).rotationEffect(.degrees(-90))
                Text(value).font(.system(size: 27, weight: .heavy)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1).padding(10)
            }
            .frame(width: 98, height: 98)
            HStack(spacing: 2) { Text(label); Image(systemName: "chevron.forward").font(.caption2.weight(.bold)) }
                .font(.subheadline.weight(.heavy)).tracking(0.8).foregroundStyle(Theme.ink)
        }
        .frame(maxWidth: .infinity)
    }
}

struct OverviewSection: View {
    let balance: Balance
    let isToday: Bool
    @State private var detail: OverviewDetail?

    var body: some View {
        let b = balance
        let eaten = b.intake.calories, target = max(b.targetIntakeKcal ?? 1, 1), left = b.remainingKcal ?? 0
        let burn = b.burn?.totalKcal
        let eatPct = Int((eaten / target * 100).rounded())
        let expBurn = b.expectedBurnKcal
        let burnFrac: Double = (burn != nil && (expBurn ?? 0) > 0) ? burn! / expBurn! : 0
        let checks = nutrientChecks(b, isToday: isToday)
        let okN = checks.filter { $0.state == .ok }.count
        VStack(spacing: 12) {
            HStack(spacing: 4) {
                Button { detail = .eaten } label: { MiniRing(fraction: eaten / target, color: eatPct > 105 && b.goal != "gain" ? Theme.bad : eatColor, value: "\(eatPct)%", label: t("EATEN", "الأكل")) }
                Button { detail = .left } label: { MiniRing(fraction: max(0, left) / target, color: left < 0 ? Theme.bad : leftColor, value: "\(left < 0 ? "−" : "")\(fmt(abs(left)))", label: left < 0 ? t("OVER", "فوق الهدف") : t("LEFT", "المتبقي")) }
                Button { detail = .burn } label: { MiniRing(fraction: burnFrac, color: burnColor, value: burn.map { fmt($0) } ?? "—", label: t("BURN", "الحرق")) }
            }
            .buttonStyle(.plain)
            HStack(spacing: 10) {
                monitor(title: t("NUTRITION", "مراقبة التغذية"), badge: okN == checks.count ? "✓" : "\(checks.count - okN)",
                        state: okN == checks.count ? .ok : (checks.contains { $0.state == .high } ? .high : .low),
                        headline: okN == checks.count ? t("WITHIN RANGE", "ضمن النطاق") : t("NEEDS ATTENTION", "يحتاج انتباه"),
                        sub: t("\(okN)/\(checks.count) metrics", "\(okN)/\(checks.count) عناصر")) { detail = .eaten }
                if let burn {
                    let net = burn - eaten
                    monitor(title: t("ENERGY", "الطاقة"), badge: "\(net >= 0 ? "+" : "−")\(fmt(abs(net)))", state: net >= 0 ? .ok : .high,
                            headline: net >= 0 ? t("DEFICIT", "عجز") : t("SURPLUS", "فائض"),
                            sub: t("Burned \(fmt(burn)) · Ate \(fmt(eaten))", "حرقت \(fmt(burn)) · أكلت \(fmt(eaten))")) { detail = .burn }
                } else {
                    monitor(title: t("ENERGY", "الطاقة"), badge: "—", state: .low, headline: t("NO BURN DATA", "لا توجد بيانات حرق"),
                            sub: t("Connect WHOOP or Apple Health", "اربط WHOOP أو Apple Health")) { detail = .burn }
                }
            }
        }
        .sheet(item: $detail) { d in OverviewDetailView(kind: d, balance: b, isToday: isToday) }
    }

    private func monitor(title: String, badge: String, state: NutrientCheck.State, headline: String, sub: String, action: @escaping () -> Void) -> some View {
        let (fg, bg) = chipColors(state)
        return Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack { Text(title).font(.subheadline.weight(.heavy)).tracking(0.8).lineLimit(1).minimumScaleFactor(0.8); Spacer(); Image(systemName: "chevron.forward").font(.caption.weight(.bold)).foregroundStyle(Theme.muted) }
                HStack(spacing: 10) {
                    Text(badge).font(.system(size: badge.count > 3 ? 12 : 15, weight: .heavy)).foregroundStyle(fg)
                        .frame(minWidth: 38, minHeight: 38).padding(.horizontal, 2).background(bg, in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(headline).font(.subheadline.weight(.heavy)).foregroundStyle(fg).lineLimit(1).minimumScaleFactor(0.7)
                        Text(sub).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                    }
                }
            }
            .foregroundStyle(Theme.ink)
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct OverviewDetailView: View {
    let kind: OverviewDetail
    let balance: Balance
    let isToday: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var history: History?
    @State private var selected: Date?

    /// The tapped day in the chart (nil = today).
    private var picked: HistoryDay? {
        guard let selected, let days = history?.days else { return nil }
        let d = days.first { Calendar.current.isDate($0.day, inSameDayAs: selected) }
        return d?.id == days.last?.id ? nil : d
    }
    private var pickedLabel: String {
        guard let p = picked else { return t("Today", "اليوم") }
        return p.day.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: appLang == .ar ? "ar" : "en")))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    header
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) { tiles }
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button { dismiss() } label: { Image(systemName: "chevron.backward") } } }
            .task { if kind != .left { history = try? await APIClient.shared.history(days: 7) } }
        }
    }

    private var title: String {
        switch kind { case .eaten: t("Nutrition monitor", "مراقبة التغذية"); case .left: t("Left today", "المتبقي اليوم"); case .burn: t("Energy", "الطاقة") }
    }

    @ViewBuilder private var header: some View {
        let b = balance
        VStack(alignment: .leading, spacing: 6) {
            switch kind {
            case .eaten:
                Text(t("CALORIES · LAST 7 DAYS", "سعرات آخر 7 أيام")).font(.caption.weight(.heavy)).tracking(0.8)
                Text(pickedLabel).font(.caption).foregroundStyle(Theme.muted)
                Text("\(fmt(picked?.intakeKcal ?? b.intake.calories)) / \(fmt(picked?.targetKcal ?? b.targetIntakeKcal ?? 0))").heroFont(34, weight: .heavy).monospacedDigit()
                    .contentTransition(.numericText())
                chart(\.intakeKcal, color: eatColor, line: b.targetIntakeKcal)
            case .left:
                Text(t("LEFT TODAY", "متبقي لك اليوم")).font(.caption.weight(.heavy)).tracking(0.8)
                Text("\(fmt(b.remainingKcal ?? 0)) \(t("kcal", "سعرة"))").heroFont(34, weight: .heavy).monospacedDigit()
                if let bonus = b.burnBonusKcal, bonus > 0, let base = b.baseTargetKcal {
                    Text(t("Your budget is \(fmt(base)) + \(fmt(bonus)) because you burned more than expected today (we add back only half — watch calorie estimates are rough).",
                           "ميزانيتك \(fmt(base)) + \(fmt(bonus)) لأن حرقك اليوم أكثر من المتوقع (نضيف نصف الزيادة فقط لأن تقدير الساعة تقريبي)."))
                        .font(.caption).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
                }
            case .burn:
                Text(t("BURN · LAST 7 DAYS", "الحرق آخر 7 أيام")).font(.caption.weight(.heavy)).tracking(0.8)
                Text(pickedLabel).font(.caption).foregroundStyle(Theme.muted)
                let burnV: Double? = picked != nil ? picked!.burnKcal : b.burn?.totalKcal
                Text(burnV.map { "\(fmt($0)) \(t("kcal", "سعرة"))" } ?? "—").heroFont(34, weight: .heavy).monospacedDigit()
                    .contentTransition(.numericText())
                Text(t("Ate \(fmt(picked?.intakeKcal ?? b.intake.calories))", "أكلت \(fmt(picked?.intakeKcal ?? b.intake.calories))")).font(.caption).foregroundStyle(Theme.muted)
                chart(\.burnKcalOrZero, color: burnColor, line: b.intake.calories)
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    @ViewBuilder private func chart(_ key: KeyPath<HistoryDay, Double>, color: Color, line: Double?) -> some View {
        if let days = history?.days {
            Chart {
                ForEach(days) { d in
                    let on = selected.map { Calendar.current.isDate(d.day, inSameDayAs: $0) } ?? (d.id == days.last?.id)
                    BarMark(x: .value("day", d.day, unit: .day), y: .value("kcal", d[keyPath: key])).foregroundStyle(color.opacity(on ? 1 : 0.45)).cornerRadius(5)
                }
                if let line { RuleMark(y: .value("ref", line)).lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4])).foregroundStyle(Theme.ink.opacity(0.45)) }
            }
            .chartXAxis { AxisMarks(values: .stride(by: .day)) { _ in AxisValueLabel(format: .dateTime.weekday(.narrow)) } }
            .chartYAxis(.hidden)
            .chartXSelection(value: $selected)
            .frame(height: 120)
        } else if kind != .left {
            ProgressView().frame(maxWidth: .infinity, minHeight: 120)
        }
    }

    @ViewBuilder private var tiles: some View {
        let b = balance
        switch kind {
        case .eaten:
            ForEach(nutrientChecks(b, isToday: isToday)) { c in tile(c.label, fmt(c.have), c.unit, chip: c.chip, state: c.state) }
        case .left:
            let mt = b.macroTargets
            let lft = { (want: Double?, have: Double) in max(0, (want ?? 0) - have) }
            tile(t("Protein", "البروتين"), fmt(lft(mt?.proteinG, b.intake.proteinG)), t("g", "غ"), chip: t("of \(fmt(mt?.proteinG ?? 0))", "من \(fmt(mt?.proteinG ?? 0))"), state: .low)
            tile(t("Carbs", "الكربوهيدرات"), fmt(lft(mt?.carbsG, b.intake.carbsG)), t("g", "غ"), chip: t("of \(fmt(mt?.carbsG ?? 0))", "من \(fmt(mt?.carbsG ?? 0))"), state: .low)
            tile(t("Fat", "الدهون"), fmt(lft(mt?.fatG, b.intake.fatG)), t("g", "غ"), chip: t("of \(fmt(mt?.fatG ?? 0))", "من \(fmt(mt?.fatG ?? 0))"), state: .low)
            tile(t("Fibre", "الألياف"), fmt(lft(mt?.fiberG, b.intake.fiberG)), t("g", "غ"), chip: t("of \(fmt(mt?.fiberG ?? 0))", "من \(fmt(mt?.fiberG ?? 0))"), state: .low)
        case .burn:
            let eaten = b.intake.calories
            let burn = b.burn?.totalKcal
            let exp = b.expectedBurnKcal
            let pct: Int? = (burn != nil && (exp ?? 0) > 0) ? Int((burn! / exp! * 100).rounded()) : nil
            let net = burn.map { $0 - eaten }
            tile(t("OF EXPECTED DAILY BURN", "من حرق اليوم المتوقع"), pct.map { "\($0)%" } ?? "—", "", chip: exp.map { t("expected \(fmt($0))", "المتوقع \(fmt($0))") }, state: .low)
            tile(t("DIFFERENCE", "الفرق"), net.map { "\($0 >= 0 ? "+" : "−")\(fmt(abs($0)))" } ?? "—", t("kcal", "سعرة"), chip: net.map { $0 >= 0 ? t("✓ deficit", "✓ عجز") : t("↑ surplus", "↑ فائض") }, state: (net ?? 0) >= 0 ? .ok : .high)
            tile(t("ACTIVE BURN", "الحرق النشط"), b.burn?.activeKcal.map { fmt($0) } ?? "—", t("kcal", "سعرة"), chip: nil, state: .ok)
            tile(t("BASAL BURN", "الحرق الأساسي"), b.burn?.basalKcal.map { fmt($0) } ?? "—", t("kcal", "سعرة"), chip: nil, state: .ok)
            tile(t("WORKOUTS", "التمارين"), (b.activity?.totalKcal ?? 0) > 0 ? fmt(b.activity!.totalKcal) : "—", t("kcal", "سعرة"),
                 chip: (b.activity?.totalMin ?? 0) > 0 ? t("\(fmt(b.activity!.totalMin)) min", "\(fmt(b.activity!.totalMin)) دقيقة") : nil, state: .low)
            tile(t("EATEN", "أكلت"), fmt(eaten), t("kcal", "سعرة"), chip: t("target \(fmt(b.targetIntakeKcal ?? 0))", "الهدف \(fmt(b.targetIntakeKcal ?? 0))"), state: .low)
        }
    }

    private func tile(_ label: String, _ value: String, _ unit: String, chip: String?, state: NutrientCheck.State) -> some View {
        let (fg, bg) = chipColors(state)
        return VStack(alignment: .leading, spacing: 8) {
            Text(label.uppercased()).font(.caption2.weight(.heavy)).tracking(0.6).foregroundStyle(Theme.muted).lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).heroFont(30, weight: .heavy).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                Text(unit).font(.subheadline.weight(.semibold))
            }
            Spacer(minLength: 0)
            if let chip { Text(chip).font(.caption.weight(.bold)).foregroundStyle(fg).padding(.horizontal, 8).padding(.vertical, 4).background(bg, in: RoundedRectangle(cornerRadius: 8)) }
        }
        .padding(14).frame(maxWidth: .infinity, minHeight: 124, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

extension HistoryDay { var burnKcalOrZero: Double { burnKcal ?? 0 } }
