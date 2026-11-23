import SwiftUI
import WidgetKit

// MARK: Timeline

struct Entry: TimelineEntry {
    let date: Date
    let snap: WidgetSnapshot?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date(), snap: .placeholder) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date(), snap: context.isPreview ? (WidgetSnapshot.load() ?? .placeholder) : WidgetSnapshot.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // The app pushes fresh numbers (and reloads us) whenever it refreshes; re-read every 30 min and right after midnight.
        let now = Date()
        let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86400))
        let next = min(now.addingTimeInterval(30 * 60), midnight.addingTimeInterval(60))
        completion(Timeline(entries: [Entry(date: now, snap: WidgetSnapshot.load())], policy: .after(next)))
    }
}

// MARK: Helpers

private let lime = Color(red: 0.80, green: 0.95, blue: 0.40)
private let protein = Color(red: 0.62, green: 0.55, blue: 1.0)
private let water = Color(red: 0.29, green: 0.66, blue: 1.0)
private let steps = Color(red: 1.0, green: 0.62, blue: 0.30)

private func L(_ s: WidgetSnapshot?, _ en: String, _ ar: String) -> String { s?.lang == "ar" ? ar : en }
private func n0(_ v: Double?) -> String {
    guard let v else { return "—" }
    let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0; f.locale = Locale(identifier: "en_US")
    return f.string(from: NSNumber(value: v.rounded())) ?? "\(Int(v))"
}
private func liters(_ ml: Double?) -> String { ml.map { String(format: "%.1f", $0 / 1000) } ?? "—" }
private func frac(_ a: Double?, _ b: Double?) -> Double { guard let a, let b, b > 0 else { return 0 }; return max(0, min(1, a / b)) }

struct Ring: View {
    let value: Double; let color: Color; var width: CGFloat = 9
    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.18), lineWidth: width)
            Circle().trim(from: 0, to: value).stroke(color, style: StrokeStyle(lineWidth: width, lineCap: .round)).rotationEffect(.degrees(-90))
        }
    }
}

struct Bar: View {
    let label: String; let value: String; let f: Double; let color: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(label).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Text(value).font(.caption.weight(.bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7).environment(\.layoutDirection, .leftToRight)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(color.opacity(0.18))
                    Capsule().fill(color).frame(width: g.size.width * f)
                }
            }
            .frame(height: 5)
        }
    }
}

// MARK: Views

struct LeftRing: View {
    let s: WidgetSnapshot
    var big = true
    var body: some View {
        let over = (s.leftKcal ?? 0) < 0
        ZStack {
            Ring(value: frac(s.eatenKcal, s.targetKcal), color: over ? .red : lime, width: big ? 10 : 8)
            VStack(spacing: 0) {
                Text(n0(s.leftKcal.map { abs($0) })).font(.system(size: big ? 24 : 18, weight: .heavy)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
                Text(over ? L(s, "OVER", "زيادة") : L(s, "LEFT", "متبقي")).font(.system(size: 9, weight: .bold)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 6)
        }
    }
}

struct StaleView: View {
    let s: WidgetSnapshot?
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "fork.knife.circle.fill").font(.title).foregroundStyle(lime)
            Text(L(s, "Open StrainEat to update today", "افتح StrainEat لتحديث اليوم")).font(.caption.weight(.semibold)).multilineTextAlignment(.center)
        }
    }
}

struct WidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View {
        let s = entry.snap
        Group {
            if let s, s.isToday {
                switch family {
                case .systemSmall: small(s)
                case .systemMedium: medium(s)
                case .accessoryCircular: circular(s)
                case .accessoryRectangular: rectangular(s)
                case .accessoryInline: Text("\(n0(s.leftKcal)) " + L(s, "kcal left", "سعرة متبقية"))
                default: medium(s)
                }
            } else if family == .accessoryInline {
                Text("StrainEat")
            } else {
                StaleView(s: s)
            }
        }
        .environment(\.layoutDirection, s?.lang == "ar" ? .rightToLeft : .leftToRight)
        .widgetURL(URL(string: "straineat://today"))
        .containerBackground(for: .widget) { Color(red: 0.07, green: 0.08, blue: 0.09) }
    }

    private func small(_ s: WidgetSnapshot) -> some View {
        VStack(spacing: 8) {
            LeftRing(s: s).frame(width: 88, height: 88)
            HStack(spacing: 10) {
                Label(liters(s.waterMl), systemImage: "drop.fill").foregroundStyle(water)
                Label(n0(s.steps.map { $0 / 1000 }) + "k", systemImage: "figure.walk").foregroundStyle(steps)
            }
            .font(.caption2.weight(.bold)).labelStyle(.titleAndIcon).environment(\.layoutDirection, .leftToRight)
        }
    }

    private func medium(_ s: WidgetSnapshot) -> some View {
        HStack(spacing: 14) {
            VStack(spacing: 6) {
                LeftRing(s: s).frame(width: 96, height: 96)
                Text(L(s, "of \(n0(s.targetKcal)) kcal", "من \(n0(s.targetKcal)) سعرة")).font(.caption2).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7)
            }
            VStack(spacing: 9) {
                Bar(label: L(s, "Protein", "البروتين"), value: "\(n0(s.proteinG))/\(n0(s.proteinTargetG)) g", f: frac(s.proteinG, s.proteinTargetG), color: protein)
                Bar(label: L(s, "Water", "الماء"), value: "\(liters(s.waterMl))/\(liters(s.waterTargetMl)) L", f: frac(s.waterMl, s.waterTargetMl), color: water)
                Bar(label: L(s, "Steps", "الخطوات"), value: "\(n0(s.steps))/\(n0(s.stepsGoal))", f: frac(s.steps, s.stepsGoal), color: steps)
                Bar(label: L(s, "Burn", "الحرق"), value: "\(n0(s.burnKcal))/\(n0(s.expectedBurnKcal))", f: frac(s.burnKcal, s.expectedBurnKcal), color: .orange)
            }
        }
    }

    private func circular(_ s: WidgetSnapshot) -> some View {
        Gauge(value: frac(s.eatenKcal, s.targetKcal)) {
            Image(systemName: "fork.knife")
        } currentValueLabel: {
            Text(n0(s.leftKcal)).monospacedDigit().minimumScaleFactor(0.5)
        }
        .gaugeStyle(.accessoryCircular)
    }

    private func rectangular(_ s: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(n0(s.leftKcal)) " + L(s, "kcal left", "سعرة متبقية")).font(.headline).monospacedDigit()
            Text(L(s, "Protein \(n0(s.proteinG))/\(n0(s.proteinTargetG)) g", "بروتين \(n0(s.proteinG))/\(n0(s.proteinTargetG)) غ")).font(.caption)
            Text("💧 \(liters(s.waterMl))/\(liters(s.waterTargetMl)) L · 👣 \(n0(s.steps))").font(.caption).monospacedDigit()
        }
    }
}

// MARK: Widget

@main
struct StrainEatWidgetBundle: WidgetBundle {
    var body: some Widget { TodayWidget() }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StrainEatToday", provider: Provider()) { WidgetView(entry: $0) }
            .configurationDisplayName("StrainEat")
            .description("Calories left, protein, water and steps for today. · السعرات المتبقية والبروتين والماء والخطوات لليوم.")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
