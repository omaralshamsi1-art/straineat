import SwiftUI
import Charts

private let waterBlue = Color(red: 0.29, green: 0.66, blue: 1.0)

private func liters(_ ml: Double) -> String { fmt1(ml / 1000) }

/// 💧 Today water: progress, quick taps (+250 / +500 / custom), undo; tap the header for details.
struct WaterCard: View {
    @Environment(AppStore.self) private var store
    let isToday: Bool
    let fastingDay: Bool
    @State private var day: WaterDay?
    @State private var custom = false
    @State private var customText = "330"
    @State private var open = false
    @State private var busy = false

    var body: some View {
        Group {
            if let w = day {
                VStack(alignment: .leading, spacing: 8) {
                    Button { open = true } label: {
                        HStack(alignment: .firstTextBaseline) {
                            Label(t("WATER", "الماء"), systemImage: "drop.fill").font(.caption.weight(.heavy)).tracking(appLang == .ar ? 0 : 1.2)
                                .labelStyle(.titleAndIcon).symbolRenderingMode(.hierarchical).foregroundStyle(Theme.ink)
                            Spacer()
                            Text(w.targetMl.map { "\(liters(w.intakeMl)) / \(liters($0)) " + t("L", "لتر") } ?? "\(Int(w.intakeMl)) " + t("ml", "مل"))
                                .font(.headline.weight(.heavy)).monospacedDigit().environment(\.layoutDirection, .leftToRight)
                        }
                    }
                    .buttonStyle(.plain)
                    bar(w)
                    Text(status(w)).font(.caption).foregroundStyle(statusColor(w)).fixedSize(horizontal: false, vertical: true)
                    if isToday {
                        HStack(spacing: 8) {
                            pill("+250 " + t("ml", "مل")) { await add(250) }
                            pill("+500 " + t("ml", "مل")) { await add(500) }
                            pill(t("Amount…", "كمية…")) { custom = true }
                            if let last = w.entries.last {
                                Button { Task { await undo(last) } } label: { Image(systemName: "arrow.uturn.backward").font(.subheadline.weight(.bold)).frame(width: 40, height: 40).background(Theme.card2, in: Circle()) }
                                    .buttonStyle(.plain).accessibilityLabel(t("Undo", "تراجع")).foregroundStyle(Theme.muted)
                            }
                        }
                        .disabled(busy)
                    }
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .sheet(isPresented: $open) { WaterDetailView(day: w) { day = $0; await replan() } }
                .alert(t("How many ml did you drink?", "كم مل شربت؟"), isPresented: $custom) {
                    TextField("330", text: $customText).keyboardType(.numberPad)
                    Button(t("Add", "إضافة")) { Task { if let ml = Int(customText), (10...3000).contains(ml) { await add(ml) } } }
                    Button(t("Cancel", "إلغاء"), role: .cancel) {}
                }
            }
        }
        .task(id: "\(store.refreshTick)-\(store.selectedDateKey)") { await load() }
    }

    private func bar(_ w: WaterDay) -> some View {
        GeometryReader { g in
            let tgt = w.targetMl ?? 0
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.card2)
                Capsule().fill(waterBlue).frame(width: tgt > 0 ? g.size.width * min(1, w.intakeMl / tgt) : 0)
                if isToday, tgt > 0, let e = w.expectedByNowMl, e > 0, e < tgt {
                    Rectangle().fill(Theme.ink.opacity(0.45)).frame(width: 2, height: 12).offset(x: g.size.width * e / tgt - 1)
                }
            }
        }
        .frame(height: 8)
    }
    private func status(_ w: WaterDay) -> String {
        if let warn = w.notes.first(where: { $0.level == "warn" }) { return warn.text }
        guard let tgt = w.targetMl else { return t("Tracking only — your doctor sets your fluid amount.", "نتابع فقط — كمية السوائل يحددها طبيبك.") }
        if w.intakeMl >= tgt { return t("✓ Water goal reached today", "✓ وصلت هدف الماء اليوم") }
        if isToday, let e = w.expectedByNowMl, e - w.intakeMl >= 500 {
            let b = Int(((e - w.intakeMl) / 50).rounded() * 50)
            return t("\(b) ml behind for this time", "متأخر \(b) مل عن هالوقت")
        }
        let left = Int(w.remainingMl ?? 0)
        return t("\(left) ml left", "باقي \(left) مل") + (w.workoutMl > 0 ? t(" · +\(Int(w.workoutMl)) for training", " · +\(Int(w.workoutMl)) للتمرين") : "")
    }
    private func statusColor(_ w: WaterDay) -> Color {
        if w.notes.contains(where: { $0.level == "warn" }) { return Theme.bad }
        if let tgt = w.targetMl, w.intakeMl >= tgt { return Theme.good }
        return Theme.muted
    }
    private func pill(_ label: String, _ action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            Text(label).font(.subheadline.weight(.bold)).lineLimit(1).minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, minHeight: 40).background(Theme.card2, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        day = try? await APIClient.shared.water(date: store.selectedDateKey)
        await replan()
    }
    private func replan() async { if let d = day, isToday { await WaterNotifications.sync(d, fastingDay: fastingDay) } }
    private func add(_ ml: Int) async {
        busy = true; defer { busy = false }
        guard let d = try? await APIClient.shared.addWater(ml: ml) else { return }
        day = d
        WidgetBridge.update(water: d)
        if let e = d.entries.last { await HealthKitManager.shared.saveWater(ml: e.ml, id: e.id, at: e.at) }
        await replan()
    }
    private func undo(_ e: WaterDay.Entry) async {
        busy = true; defer { busy = false }
        guard let d = try? await APIClient.shared.deleteWater(id: e.id) else { return }
        day = d
        WidgetBridge.update(water: d)
        await HealthKitManager.shared.deleteWater(id: e.id)
        await replan()
    }
}

struct WaterDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @State var day: WaterDay
    var onChange: (WaterDay) async -> Void
    @State private var hist: [WaterHistory.Day] = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(t("Water, last 7 days", "الماء آخر 7 أيام")).font(.caption.weight(.heavy)).foregroundStyle(Theme.muted)
                        Text("\(liters(day.intakeMl)) / \(day.targetMl.map(liters) ?? "—") " + t("L", "لتر"))
                            .font(.largeTitle.weight(.heavy)).monospacedDigit().environment(\.layoutDirection, .leftToRight)
                        if !hist.isEmpty {
                            Chart(hist) { d in
                                BarMark(x: .value("day", String(d.date.suffix(2))), y: .value("L", d.intakeMl / 1000))
                                    .foregroundStyle(waterBlue.opacity(d.id == hist.last?.id ? 1 : 0.45)).cornerRadius(5)
                                if let tg = d.targetMl, d.id == hist.last?.id {
                                    RuleMark(y: .value("target", tg / 1000)).foregroundStyle(Theme.ink.opacity(0.45)).lineStyle(StrokeStyle(dash: [4, 4]))
                                }
                            }
                            .frame(height: 130)
                        }
                    }
                    .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 18))

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        tile(t("Goal", "الهدف"), day.targetMl.map { "\(liters($0)) " + t("L", "لتر") } ?? t("Set by your doctor", "يحدده طبيبك"))
                        tile(t("Drank", "شربت"), "\(liters(day.intakeMl)) " + t("L", "لتر"))
                        tile(t("Water logged", "ماء مسجّل"), "\(Int(day.manualMl)) " + t("ml", "مل"))
                        tile(t("Drinks from your meals", "مشروبات من وجباتك"), "\(Int(day.drinksMl)) " + t("ml", "مل"))
                        if day.healthMl > 0 { tile(t("From Apple Health", "من Apple Health"), "\(Int(day.healthMl)) " + t("ml", "مل")) }
                    }
                    ForEach(day.notes, id: \.self) { Notice(text: $0.text, level: $0.level) }
                    Text(t("Drinks goal: 2.2 L for women and 3.0 L for men (US NASEM reference — about 80% of the body's water comes from drinks), more with training and heat. Coffee, tea and juice logged as meals count.",
                           "الهدف من المشروبات: 2.2 لتر للنساء و3.0 للرجال (المرجع الأمريكي NASEM — حوالي 80% من ماء الجسم يجي من المشروبات)، ويزيد مع التمرين والحر. القهوة والشاي والعصير المسجّلة كوجبات تنحسب."))
                        .font(.caption).foregroundStyle(Theme.muted)
                    if !day.entries.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(t("Today's log", "سجل اليوم")).font(.headline).padding(.bottom, 6)
                            ForEach(day.entries.reversed()) { e in
                                HStack {
                                    Text(e.at.formatted(.dateTime.hour().minute().locale(appLocale))).monospacedDigit()
                                    Spacer()
                                    Text("\(Int(e.ml)) " + t("ml", "مل")).bold()
                                    Button(t("Delete", "حذف"), role: .destructive) { Task { await remove(e) } }.font(.subheadline).padding(.leading, 12)
                                }
                                .padding(.vertical, 8)
                                Divider()
                            }
                        }
                        .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
                    }
                }
                .padding()
            }
            .background(Theme.bg)
            .navigationTitle(t("Water", "الماء")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("Done", "تم")) { dismiss() } } }
            .task { hist = (try? await APIClient.shared.waterHistory())?.days ?? [] }
        }
    }
    private func tile(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption).foregroundStyle(Theme.muted)
            Text(value).font(.title3.weight(.heavy)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
    }
    private func remove(_ e: WaterDay.Entry) async {
        guard let d = try? await APIClient.shared.deleteWater(id: e.id) else { return }
        day = d
        await HealthKitManager.shared.deleteWater(id: e.id)
        await onChange(d)
    }
}
