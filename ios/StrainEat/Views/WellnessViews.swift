import Charts
import SwiftUI

// MARK: WHOOP recovery & sleep

struct WellnessDay: Codable, Hashable, Identifiable {
    let date: String
    var recovery: Double?; var hrv: Double?; var restingHr: Double?; var spo2: Double?; var skinTemp: Double?
    var respiratoryRate: Double?; var sleepMin: Double?; var sleepNeededMin: Double?; var sleepPerformance: Double?
    var sleepEfficiency: Double?; var deepMin: Double?; var remMin: Double?; var lightMin: Double?; var awakeMin: Double?
    var strain: Double?; var calibrating: Bool?
    var id: String { date }
    var day: Date { DateFormatter.isoDay.date(from: date) ?? Date() }
}

struct Wellness: Codable {
    let connected: Bool
    let needsReconnect: Bool
    let today: WellnessDay?
    let days: [WellnessDay]
}

extension APIClient {
    func wellness(date: String? = nil) async throws -> Wellness { try await get("integrations/whoop/wellness" + (date.map { "?date=\($0)" } ?? "")) }
}

func recoveryColor(_ r: Double?) -> Color {
    guard let r else { return Theme.muted }
    return r >= 67 ? Color(red: 0.09, green: 0.64, blue: 0.29) : r >= 34 ? Color(red: 0.79, green: 0.54, blue: 0.02) : Color(red: 0.86, green: 0.15, blue: 0.15)
}
func hmText(_ m: Double?) -> String { guard let m else { return "—" }; let x = Int(m); return "\(x / 60):" + String(format: "%02d", x % 60) }

struct WellnessCard: View {
    @Environment(AppStore.self) private var store
    @State private var data: Wellness?
    @State private var open = false

    var body: some View {
        VStack(spacing: 0) {
            if let d = data, d.connected {
                Button {
                    if d.needsReconnect { Task { _ = try? await WhoopConnector.shared.connect(); await load() } } else { open = true }
                } label: {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(t("RECOVERY & SLEEP · WHOOP", "الاستشفاء والنوم · WHOOP")).font(.caption.weight(.heavy)).tracking(0.8)
                            Spacer(); Image(systemName: "chevron.forward").font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                        }
                        if d.needsReconnect {
                            Text(t("Reconnect WHOOP once to show recovery and sleep. Tap here.", "أعد ربط WHOOP مرة واحدة لإظهار الاستشفاء والنوم. اضغط هنا."))
                                .font(.subheadline).foregroundStyle(Theme.brand2)
                        } else if let td = d.today, td.recovery != nil || td.sleepMin != nil || td.strain != nil {
                            HStack {
                                stat(td.recovery.map { "\(Int($0))%" } ?? "—", t("RECOVERY", "الاستشفاء"), recoveryColor(td.recovery))
                                stat(hmText(td.sleepMin), t("SLEEP", "النوم"), Theme.ink)
                                stat(td.strain.map { String(format: "%.1f", $0) } ?? "—", t("STRAIN", "الجهد"), Color(red: 0.12, green: 0.56, blue: 0.91))
                            }
                        } else {
                            Text(t("No data for today yet — pull down to refresh.", "لا توجد بيانات اليوم بعد — اسحب الشاشة للتحديث.")).font(.subheadline).foregroundStyle(Theme.muted)
                        }
                    }
                    .foregroundStyle(Theme.ink)
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                }
                .buttonStyle(.plain)
                .sheet(isPresented: $open) { WellnessDetailView(data: d) }
            }
        }
        .task(id: store.refreshTick) { await load() }
    }

    private func stat(_ v: String, _ label: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(v).font(.system(size: 24, weight: .heavy)).monospacedDigit().foregroundStyle(color)
            Text(label).font(.caption2.weight(.bold)).tracking(0.5).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func load() async { data = try? await APIClient.shared.wellness() }
}

struct WellnessDetailView: View {
    let data: Wellness
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Date?

    private var shown: WellnessDay? {
        if let selected, let d = data.days.first(where: { Calendar.current.isDate($0.day, inSameDayAs: selected) }) { return d }
        return data.today
    }

    var body: some View {
        let td = shown ?? WellnessDay(date: "")
        let past = data.days.filter { $0.date != td.date }
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(t("RECOVERY · LAST 7 DAYS", "الاستشفاء آخر 7 أيام")).font(.caption.weight(.heavy)).tracking(0.8)
                        Text(td.recovery.map { "\(Int($0))%" } ?? "—").heroFont(40, weight: .heavy).foregroundStyle(recoveryColor(td.recovery))
                            .contentTransition(.numericText())
                        if td.calibrating == true { Text(t("WHOOP is still calibrating", "WHOOP ما زال يعاير قياساتك")).font(.caption).foregroundStyle(Theme.muted) }
                        Chart(data.days) { d in
                            BarMark(x: .value("day", d.day, unit: .day), y: .value("rec", d.recovery ?? 0))
                                .foregroundStyle(recoveryColor(d.recovery).opacity(d.date == td.date ? 1 : 0.55)).cornerRadius(5)
                        }
                        .chartYScale(domain: 0...100).chartYAxis(.hidden)
                        .chartXAxis { AxisMarks(values: .stride(by: .day)) { _ in AxisValueLabel(format: .dateTime.weekday(.narrow)) } }
                        .chartXSelection(value: $selected)
                        .frame(height: 120)
                    }
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        tile(t("HRV", "تقلّب النبض HRV"), td.hrv.map { "\(Int($0))" } ?? "—", "ms", vsAvg(td.hrv, past.compactMap(\.hrv), higherIsBetter: true))
                        tile(t("RESTING HR", "نبض الراحة"), td.restingHr.map { "\(Int($0))" } ?? "—", "bpm", vsAvg(td.restingHr, past.compactMap(\.restingHr), higherIsBetter: false))
                        tile(t("BLOOD OXYGEN", "أكسجين الدم"), td.spo2.map { String(format: "%.1f", $0) } ?? "—", "%",
                             td.spo2.map { $0 >= 95 ? (t("✓ within 95–100%", "✓ ضمن 95–100%"), true) : (t("↓ below 95%", "↓ أقل من 95%"), false) })
                        tile(t("SKIN TEMP", "حرارة الجلد"), td.skinTemp.map { String(format: "%.1f", $0) } ?? "—", "°C", nil)
                        tile(t("RESPIRATORY RATE", "معدل التنفس"), td.respiratoryRate.map { String(format: "%.1f", $0) } ?? "—", "rpm", vsAvg(td.respiratoryRate, past.compactMap(\.respiratoryRate), higherIsBetter: false))
                        tile(t("SLEEP", "النوم"), hmText(td.sleepMin), "", td.sleepNeededMin.map { need in (t("need \(hmText(need))", "الاحتياج \(hmText(need))"), (td.sleepMin ?? 0) >= need * 0.85) })
                        tile(t("SLEEP PERFORMANCE", "أداء النوم"), td.sleepPerformance.map { "\(Int($0))" } ?? "—", "%",
                             td.sleepPerformance.map { $0 >= 85 ? (t("✓ optimal", "✓ ممتاز"), true) : $0 >= 70 ? (t("✓ sufficient", "✓ جيد"), true) : (t("↓ poor", "↓ ضعيف"), false) })
                        tile(t("SLEEP EFFICIENCY", "كفاءة النوم"), td.sleepEfficiency.map { "\(Int($0))" } ?? "—", "%", nil)
                        tile(t("DEEP SLEEP", "نوم عميق"), hmText(td.deepMin), "", nil)
                        tile(t("REM SLEEP", "نوم REM"), hmText(td.remMin), "", nil)
                        tile(t("LIGHT SLEEP", "نوم خفيف"), hmText(td.lightMin), "", nil)
                        tile(t("DAY STRAIN", "الجهد اليومي"), td.strain.map { String(format: "%.1f", $0) } ?? "—", "/ 21", nil)
                    }
                    if (td.recovery ?? 100) < 34 || (td.sleepMin ?? 999) < 360 {
                        Text(t("Low recovery or short sleep: hunger and sugar cravings rise today. Focus on protein, water and simple food, and go easy on yourself.",
                               "استشفاء منخفض أو نوم قليل: الجوع والرغبة في الحلويات تزيد اليوم. ركّز على البروتين والماء والأكل البسيط، ولا تشدّ على نفسك."))
                            .font(.subheadline).padding(14).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.yellow.opacity(0.6), in: RoundedRectangle(cornerRadius: 20))
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle(t("Recovery & sleep", "الاستشفاء والنوم")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button { dismiss() } label: { Image(systemName: "chevron.backward") } } }
        }
    }

    private func vsAvg(_ v: Double?, _ others: [Double], higherIsBetter: Bool) -> (String, Bool)? {
        guard let v, !others.isEmpty else { return nil }
        let a = others.reduce(0, +) / Double(others.count)
        let label = String(format: "%.1f", a)
        if abs(v - a) <= max(1, abs(a) * 0.05) { return (t("✓ near your avg \(label)", "✓ قريب من متوسطك \(label)"), true) }
        let better = higherIsBetter ? v > a : v < a
        return (v > a ? t("↑ above your avg \(label)", "↑ أعلى من متوسطك \(label)") : t("↓ below your avg \(label)", "↓ أقل من متوسطك \(label)"), better)
    }

    private func tile(_ label: String, _ value: String, _ unit: String, _ chip: (String, Bool)?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.caption2.weight(.heavy)).tracking(0.6).foregroundStyle(Theme.muted).lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).heroFont(30, weight: .heavy).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                Text(unit).font(.subheadline.weight(.semibold))
            }
            Spacer(minLength: 0)
            if let chip {
                Text(chip.0).font(.caption.weight(.bold)).foregroundStyle(chip.1 ? Theme.good : Theme.warn)
                    .padding(.horizontal, 8).padding(.vertical, 4).background(chip.1 ? Theme.goodSoft : Theme.accentSoft, in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(14).frame(maxWidth: .infinity, minHeight: 124, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}
