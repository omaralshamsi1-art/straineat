import SwiftUI

// Progress header: journey to the goal weight, BMI capsule, this week's habits, nutrition monitor.

struct ProgressSummary: Decodable {
    struct Journey: Decodable {
        let status: String
        let currentKg: Double?
        let startKg: Double?
        let targetKg: Double?
        let frac: Double?
        let planFrac: Double?
        let milestones: [Double]?
        let eta: String?
        let aheadDays: Int?
        let tooFast: Bool?
        let daysOfData: Int?
        let needDays: Int?
    }
    struct BMI: Decodable { let value: Double; let zone: String; let target: Double?; let deltaMonth: Double?; let toNormal: Double }
    struct Week: Decodable {
        struct Row: Decodable { let habit: String; let days: [Bool?]; let hit: Int }
        struct Weak: Decodable { let habit: String; let hit: Int; let of: Int }
        let score: Int?
        let delta: Int?
        let daysSoFar: Int
        let grid: [Row]
        let weakest: Weak?
    }
    struct Gauge: Decodable { let level: String; let fill: Double; let g: Double?; let mg: Double?; let ml: Double? }
    struct Monitor: Decodable { let sugar: Gauge?; let sodium: Gauge?; let fiber: Gauge?; let water: Gauge? }
    let journey: Journey
    let bmi: BMI?
    let week: Week
    let monitor: Monitor
}

extension APIClient {
    func progressSummary() async throws -> ProgressSummary { try await get("progress/summary") }
}

private let lime = Color(red: 0.72, green: 0.95, blue: 0.35)
private let leafGreen = Color(red: 0.18, green: 0.62, blue: 0.37)

/// The S-shaped road (same curve as the web).
private struct RoadShape: Shape {
    func path(in r: CGRect) -> Path {
        let sx = r.width / 378, sy = r.height / 300
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: r.minX + x * sx, y: r.minY + y * sy) }
        var path = Path()
        path.move(to: p(40, 280))
        path.addCurve(to: p(330, 165), control1: p(40, 205), control2: p(330, 230))
        path.addCurve(to: p(55, 72), control1: p(330, 105), control2: p(50, 130))
        path.addCurve(to: p(330, 28), control1: p(58, 30), control2: p(250, 28))
        return path
    }
}

/// Point at a fraction of the road (sampled, good enough for markers).
private func roadPoint(_ f: Double, in size: CGSize) -> CGPoint {
    let path = RoadShape().path(in: CGRect(origin: .zero, size: size))
    let t = max(0.0001, min(1, f))
    return path.trimmedPath(from: 0, to: t).currentPoint ?? .zero
}

struct JourneyCard: View {
    let j: ProgressSummary.Journey
    @State private var progress: Double = 0
    @State private var shownAhead = 0

    var body: some View {
        VStack(spacing: 6) {
            header
            if j.status != "no_target" {
                GeometryReader { geo in
                    let size = geo.size
                    let me = j.status == "reached" ? 1 : (j.frac ?? 0)
                    ZStack {
                        RoadShape().stroke(Theme.line, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                        RoadShape().stroke(Theme.muted.opacity(0.5), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [2, 9]))
                        RoadShape().trim(from: 0, to: me * progress)
                            .stroke(LinearGradient(colors: [leafGreen, lime], startPoint: .bottomLeading, endPoint: .topTrailing), style: StrokeStyle(lineWidth: 14, lineCap: .round))
                            .shadow(color: lime.opacity(0.6), radius: 8)
                        ForEach(Array(milestones.enumerated()), id: \.offset) { _, m in
                            let pt = roadPoint(m.0, in: size)
                            Circle().fill(Theme.bg).overlay(Circle().stroke(Theme.muted, lineWidth: 2)).frame(width: 9, height: 9).position(pt)
                            Text(fmt1(m.1)).font(.caption2.weight(.heavy)).foregroundStyle(Theme.muted)
                                .position(x: pt.x + (pt.x > size.width / 2 ? -22 : 22), y: pt.y)
                        }
                        if let pf = j.planFrac {
                            Circle().stroke(Theme.muted, style: StrokeStyle(lineWidth: 2.5, dash: [3, 3])).frame(width: 18, height: 18)
                                .position(roadPoint(pf * progress, in: size))
                        }
                        TimelineView(.animation) { tl in
                            let t = tl.date.timeIntervalSinceReferenceDate
                            let pt = roadPoint(me * progress, in: size)
                            ZStack {
                                Circle().fill(lime.opacity(0.25)).frame(width: 40 * (1 + 0.25 * sin(t * 2.8)), height: 40 * (1 + 0.25 * sin(t * 2.8)))
                                Circle().fill(.white).overlay(Circle().stroke(lime, lineWidth: 4)).frame(width: 20, height: 20)
                            }
                            .position(pt)
                            let g = roadPoint(1, in: size)
                            ZStack {
                                Circle().fill(Color(red: 0.11, green: 0.23, blue: 0.16)).overlay(Circle().stroke(lime, lineWidth: 2))
                                Text("🌿").font(.system(size: 15))
                            }
                            .frame(width: 32, height: 32).scaleEffect(1 + 0.06 * sin(t * 2)).position(g)
                        }
                    }
                }
                .frame(height: 280)
                legend
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 2.4).delay(0.25)) { progress = 1 }
            if let a = j.aheadDays {
                let target = abs(a)
                Task { for i in 0...max(1, target) { try? await Task.sleep(for: .milliseconds(1800 / max(1, target))); shownAhead = min(i, target) } }
            }
        }
    }

    private var milestones: [(Double, Double)] {
        guard let s = j.startKg else { return [] }
        let m = j.milestones ?? []
        return [(0.0, s)] + zip([0.25, 0.5, 0.75], m).map { ($0, $1) }
    }

    @ViewBuilder private var header: some View {
        VStack(spacing: 6) {
            switch j.status {
            case "no_target":
                Text(t("Your journey", "رحلتك")).font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                Text(t("Set your goal weight", "حدّد وزنك المستهدف")).font(.title2.weight(.heavy))
            case "reached":
                Text(t("Your journey", "رحلتك")).font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                Text(t("You reached your goal 🎉", "وصلت لهدفك 🎉")).font(.title.weight(.heavy))
            case "on_way":
                Text(t("You'll reach your goal", "تصل لهدفك")).font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                Text(dateText(j.eta)).font(.system(size: 40, weight: .heavy))
                if let a = j.aheadDays {
                    chip(a >= 1 ? t("↑ \(shownAhead) days ahead of plan", "↑ أبكر من خطتك بـ\(shownAhead) يوم") : a <= -1 ? t("\(shownAhead) days behind plan", "متأخر عن خطتك \(shownAhead) يوم") : t("✓ Right on plan", "✓ على الخطة بالضبط"), late: a <= -1)
                }
                if j.tooFast == true { Text(t("You're losing faster than is healthy — eat a little more", "تنزل أسرع من المعدل الصحي — زد أكلك شوي")).font(.caption).foregroundStyle(Theme.warn) }
            case "stalled":
                Text(t("Your journey", "رحلتك")).font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                Text(t("Your weight is steady lately", "وزنك ثابت هالفترة")).font(.title2.weight(.heavy))
            default:
                let left = max(0, (j.needDays ?? 14) - (j.daysOfData ?? 0))
                Text(t("Your arrival date", "تاريخ وصولك")).font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                Text(t("in \(left) days", "بعد \(left) يوم")).font(.title2.weight(.heavy))
                chip(t("Needs \(j.needDays ?? 14) days of weigh-ins · you have \(j.daysOfData ?? 0)", "نحتاج \(j.needDays ?? 14) يوم من الوزن · عندك \(j.daysOfData ?? 0)"), muted: true)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func chip(_ s: String, late: Bool = false, muted: Bool = false) -> some View {
        Text(s).font(.subheadline.weight(.heavy))
            .foregroundStyle(muted ? Theme.muted : late ? Color(red: 0.96, green: 0.76, blue: 0.42) : lime)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(muted ? Theme.card2 : late ? Color(red: 0.23, green: 0.18, blue: 0.11) : Color(red: 0.11, green: 0.23, blue: 0.16), in: Capsule())
    }

    private var legend: some View {
        HStack(spacing: 14) {
            if let c = j.currentKg { Label(t("You · \(fmt1(c)) kg", "أنت · \(fmt1(c)) كغ"), systemImage: "circle.fill") }
            if j.planFrac != nil { Label(t("Plan", "الخطة"), systemImage: "circle.dashed") }
            if let g = j.targetKg { Text("🌿 " + t("Goal · \(fmt1(g)) kg", "الهدف · \(fmt1(g)) كغ")) }
        }
        .font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
    }

    private func dateText(_ iso: String?) -> String {
        guard let iso, let d = ISO8601DateFormatter.dayOnly.date(from: iso) else { return "—" }
        let f = DateFormatter(); f.locale = Locale(identifier: appLang == .ar ? "ar" : "en"); f.setLocalizedDateFormatFromTemplate("dMMMM")
        return f.string(from: d)
    }
}

extension ISO8601DateFormatter {
    static let dayOnly: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]; return f }()
}

private func sectionHeader(_ title: String, _ chip: String?) -> some View {
    HStack {
        Text(title).font(.subheadline.weight(.heavy))
        Spacer()
        if let chip { Text(chip).font(.caption.weight(.bold)).padding(.horizontal, 10).padding(.vertical, 5).background(Theme.card2, in: RoundedRectangle(cornerRadius: 10)) }
    }
    .padding(.horizontal, 4).padding(.top, 8)
}

struct BMICard: View {
    let b: ProgressSummary.BMI
    @State private var go = false
    private let zones: [(Double, Double, Color)] = [(16, 18.5, Color(red: 0.29, green: 0.66, blue: 1)), (18.5, 25, Color(red: 0.27, green: 0.83, blue: 0.51)), (25, 30, Color(red: 0.96, green: 0.76, blue: 0.42)), (30, 35, Color(red: 0.94, green: 0.54, blue: 0.36))]
    private func w(_ v: Double) -> Double { (min(35, max(16, v)) - 16) / 19 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader(t("Body mass index", "مؤشر كتلة الجسم"), b.deltaMonth.map { (($0 > 0 ? "+" : $0 < 0 ? "−" : "") + fmt1(abs($0))) + t(" vs last month", " عن الشهر الماضي") })
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(fmt1(b.value)).font(.system(size: 36, weight: .heavy)).monospacedDigit()
                    Text("BMI").font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                    Spacer()
                    Text(b.toNormal > 0 ? t("\(fmt1(b.toNormal)) to the healthy range", "باقي \(fmt1(b.toNormal)) للمنطقة الطبيعية") : t("In the healthy range ✓", "ضمن المنطقة الطبيعية ✓"))
                        .font(.caption).foregroundStyle(Theme.muted)
                }
                GeometryReader { geo in
                    let W = geo.size.width
                    ZStack(alignment: .leading) {
                        HStack(spacing: 4) {
                            ForEach(Array(zones.enumerated()), id: \.offset) { _, z in
                                let frac = b.value >= z.1 ? 1 : b.value <= z.0 ? 0 : (b.value - z.0) / (z.1 - z.0)
                                RoundedRectangle(cornerRadius: 10).fill(Theme.card2)
                                    .overlay(alignment: .leading) { GeometryReader { g in RoundedRectangle(cornerRadius: 10).fill(z.2).frame(width: g.size.width * (go ? frac : 0)) } }
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                    .frame(width: (W - 12) * (z.1 - z.0) / 19)
                            }
                        }
                        .frame(height: 28)
                        if let tg = b.target {
                            Capsule().fill(lime).frame(width: 3, height: 36).shadow(color: lime, radius: 5).offset(x: W * w(tg) - 1)
                        }
                        VStack(spacing: 0) {
                            Text(t("You", "أنت")).font(.caption2.weight(.heavy)).foregroundStyle(Theme.bg).padding(.horizontal, 6).padding(.vertical, 2).background(Theme.ink, in: RoundedRectangle(cornerRadius: 8))
                            Rectangle().fill(Theme.ink).frame(width: 2, height: 8)
                        }
                        .offset(x: (go ? W * w(b.value) : 0) - 16, y: -32)
                    }
                    .environment(\.layoutDirection, .leftToRight)
                }
                .frame(height: 30).padding(.top, 26)
                HStack(spacing: 4) {
                    ForEach(Array(zones.enumerated()), id: \.offset) { _, z in
                        Text("\(fmt1(z.0))–\(fmt1(z.1))").font(.caption2.weight(.bold)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity)
                    }
                }
                .environment(\.layoutDirection, .leftToRight)
                Text(b.zone == "normal" ? t("Your weight is in the healthy range for your height.", "وزنك ضمن المنطقة الطبيعية لطولك.") : b.zone == "under" ? t("Below the healthy range for your height — your plan helps you raise it safely.", "أقل من الطبيعي لطولك — خطتك تساعدك ترفعه بشكل صحي.") : t("BMI is a rough guide — it can't tell muscle from fat.", "المؤشر تقريبي ولا يفرّق بين العضل والدهون."))
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
            .padding(16).background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .onAppear { withAnimation(.easeOut(duration: 2.2).delay(0.15)) { go = true } }
    }
}

struct WeekHabitsCard: View {
    let w: ProgressSummary.Week
    @State private var shown = false
    private func meta(_ h: String) -> (String, Color) {
        switch h {
        case "calories": return (t("Calories", "السعرات"), Color(red: 0.27, green: 0.83, blue: 0.51))
        case "protein": return (t("Protein", "البروتين"), Color(red: 0.96, green: 0.76, blue: 0.42))
        case "logged": return (t("Meal", "وجبات"), Color(red: 0.27, green: 0.83, blue: 0.51))
        case "water": return (t("Water", "الماء"), Color(red: 0.29, green: 0.66, blue: 1))
        default: return (t("Steps", "الخطوات"), Color(red: 1, green: 0.62, blue: 0.3))
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader(t("This week's habits", "التزام الأسبوع"), w.delta.map { ($0 > 0 ? "+" : $0 < 0 ? "−" : "") + "\(abs($0))" + t(" vs last week", " عن الأسبوع الماضي") })
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(w.score ?? 0)").font(.system(size: 40, weight: .heavy)).monospacedDigit().contentTransition(.numericText())
                    Text(t("of 100", "من 100")).font(.subheadline.weight(.bold)).foregroundStyle(Theme.muted)
                }
                Grid(horizontalSpacing: 6, verticalSpacing: 6) {
                    GridRow {
                        Text("")
                        ForEach(0..<7, id: \.self) { i in Text((appLang == .ar ? ["ن", "ث", "ر", "خ", "ج", "س", "ح"] : ["M", "T", "W", "T", "F", "S", "S"])[i]).font(.caption2.weight(.bold)).foregroundStyle(Theme.muted) }
                    }
                    ForEach(Array(w.grid.enumerated()), id: \.offset) { ri, row in
                        let m = meta(row.habit)
                        GridRow {
                            Text(m.0).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted).gridColumnAlignment(.leading)
                            ForEach(0..<7, id: \.self) { i in
                                RoundedRectangle(cornerRadius: 7)
                                    .fill(row.days[safe: i].flatMap { $0 } == true ? m.1 : Theme.card2)
                                    .opacity(i >= w.daysSoFar ? 0.35 : 1)
                                    .aspectRatio(1, contentMode: .fit)
                                    .scaleEffect(shown ? 1 : 0.4).opacity(shown ? 1 : 0)
                                    .animation(.spring(response: 0.45, dampingFraction: 0.55).delay(0.2 + Double(i) * 0.11 + Double(ri) * 0.04), value: shown)
                            }
                        }
                    }
                }
                if let wk = w.weakest, wk.hit < wk.of {
                    Text(t("💡 \(meta(wk.habit).0) is your weakest habit — \(wk.hit) of \(wk.of) days this week.", "💡 \(meta(wk.habit).0) أضعف نقطة — \(wk.hit) من \(wk.of) أيام هالأسبوع.")).font(.footnote).foregroundStyle(Theme.muted)
                }
            }
            .padding(16).background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .onAppear { shown = true }
    }
}

extension Array { subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil } }

struct NutritionJars: View {
    let m: ProgressSummary.Monitor
    @State private var fill = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader(t("Nutrition monitor", "مراقب التغذية"), t("7-day average", "متوسط 7 أيام"))
            HStack(spacing: 8) {
                jar(t("Sugar", "السكر"), m.sugar.map { t("\(Int($0.g ?? 0)) g", "\(Int($0.g ?? 0))غ") }, m.sugar)
                jar(t("Sodium", "الصوديوم"), m.sodium.map { t("\(fmt1(($0.mg ?? 0) / 1000)) g", "\(fmt1(($0.mg ?? 0) / 1000))غ") }, m.sodium)
                jar(t("Fibre", "الألياف"), m.fiber.map { t("\(Int($0.g ?? 0)) g", "\(Int($0.g ?? 0))غ") }, m.fiber)
                jar(t("Water", "الماء"), m.water.map { t("\(fmt1(($0.ml ?? 0) / 1000)) L", "\(fmt1(($0.ml ?? 0) / 1000))ل") }, m.water, water: true)
            }
        }
        .onAppear { withAnimation(.easeOut(duration: 2).delay(0.2)) { fill = true } }
    }
    private func jar(_ name: String, _ value: String?, _ g: ProgressSummary.Gauge?, water: Bool = false) -> some View {
        let level = g?.level ?? ""
        let col: Color = level == "high" ? Color(red: 0.73, green: 0.52, blue: 0.18) : level == "low" ? Color(red: 0.36, green: 0.4, blue: 0.44) : water ? Color(red: 0.18, green: 0.44, blue: 0.68) : leafGreen
        let label = [ "ok": t("Normal", "طبيعي"), "good": t("Good", "جيد"), "high": t("High", "مرتفع"), "low": t("Low", "قليل") ][level] ?? t("No data", "لا بيانات")
        return ZStack(alignment: .bottom) {
            RoundedRectangle(cornerRadius: 16).fill(Theme.card2)
            GeometryReader { geo in
                VStack { Spacer(); col.frame(height: geo.size.height * (fill ? (g?.fill ?? 0) : 0)) }
            }
            VStack(spacing: 2) {
                Text(name).font(.caption2.weight(.heavy)).foregroundStyle(.white.opacity(0.85))
                Text(value ?? "—").font(.headline.weight(.heavy)).foregroundStyle(.white).monospacedDigit()
                Text(label).font(.caption2.weight(.heavy)).foregroundStyle(.white.opacity(0.85))
                Spacer()
            }
            .padding(.top, 10)
        }
        .frame(height: 96).clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

/// All four, loaded together.
struct ProgressHeader: View {
    @State private var s: ProgressSummary?
    var refresh: Int = 0
    var body: some View {
        VStack(spacing: 6) {
            if let s {
                JourneyCard(j: s.journey)
                if let b = s.bmi { BMICard(b: b) }
                if s.week.score != nil { WeekHabitsCard(w: s.week) }
                if s.monitor.sugar != nil || s.monitor.water != nil || s.monitor.fiber != nil { NutritionJars(m: s.monitor) }
            }
        }
        .task(id: refresh) { s = try? await APIClient.shared.progressSummary() }
    }
}
