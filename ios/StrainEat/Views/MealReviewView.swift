import SwiftUI

/// Shows the agent's result and lets the user correct anything before confirming.
struct MealReviewView: View {
    private var originalName: String {
        appLang == .ar ? (meal.final.mealNameAr.isEmpty ? meal.final.mealName : meal.final.mealNameAr)
                       : (meal.final.mealName.isEmpty ? meal.final.mealNameAr : meal.final.mealName)
    }
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var meal: Meal
    var onDone: (() -> Void)? = nil

    @State private var items: [MealItem] = []
    @State private var mealName = ""
    @State private var restaurant = ""
    @State private var portion = 1.0
    @State private var kind = "meal"
    @State private var busy = false
    @State private var error: String?

    private var dirty: Bool {
        items != meal.final.items || mealName != originalName || restaurant != (meal.final.restaurant ?? "") || portion != 1 || kind != (meal.kind ?? "meal")
    }
    private var liveTotals: Nutrients {
        items.reduce(into: Nutrients()) { t, i in
            t.calories += i.calories * portion; t.proteinG += i.proteinG * portion
            t.carbsG += i.carbsG * portion; t.fatG += i.fatG * portion; t.fiberG += i.fiberG * portion
            t.sugarG += i.sugarG * portion; t.sodiumMg += i.sodiumMg * portion
        }
    }

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    TextField(t("Meal name", "اسم الوجبة"), text: $mealName).font(.title3.bold())
                    TextField(t("Restaurant", "المطعم"), text: $restaurant).foregroundStyle(.secondary)
                    HStack {
                        SourceBadge(source: meal.final.source, confidence: meal.final.confidence)
                        Spacer()
                        Text(meal.final.servingDescription).font(.caption).foregroundStyle(.secondary)
                    }
                    Picker(t("Type", "النوع"), selection: $kind) {
                        Text(t("🍽️ Meal", "🍽️ وجبة")).tag("meal")
                        Text(t("🍎 Snack", "🍎 سناك")).tag("snack")
                        Text(t("☕ Drink", "☕ مشروب")).tag("drink")
                    }
                    .pickerStyle(.segmented)
                    .padding(.top, 6)
                }
            }
            if let sc = meal.score {
                Section {
                    HStack(spacing: 14) {
                        ZStack {
                            Circle().fill(scoreColor(sc).opacity(0.15))
                            Text(fmt1(sc.score)).font(.title2.bold()).foregroundStyle(scoreColor(sc))
                        }
                        .frame(width: 56, height: 56)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(sc.label).font(.headline)
                            FlowReasons(reasons: sc.reasons)
                        }
                    }
                    if let note = meal.final.coachNoteAr, !note.isEmpty {
                        Label(note, systemImage: "sparkles").font(.callout).foregroundStyle(Theme.brand2)
                    }
                } header: { Text(t("Meal score", "تقييم الوجبة")) }
            }
            if let swaps = meal.final.swaps, !swaps.isEmpty {
                Section(t("Smarter swaps", "بدائل أذكى")) {
                    ForEach(swaps, id: \.self) { sw in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(t("Instead of \(sw.insteadOfAr) → \(sw.chooseAr)", "بدل \(sw.insteadOfAr) ← \(sw.chooseAr)")).font(.subheadline.weight(.semibold))
                                Spacer()
                                Text(signed(sw.deltaKcal)).font(.caption.bold()).monospacedDigit()
                                    .foregroundStyle(Theme.status(meal.final.totals.calories > 0 && sw.deltaKcal <= 0))
                                    .environment(\.layoutDirection, .leftToRight)
                            }
                            Text(sw.whyAr).font(.caption).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
            Section(t("Total", "الإجمالي")) {
                HStack {
                    Text("\(Int(liveTotals.calories))").font(.system(size: 34, weight: .bold)).monospacedDigit()
                    Text(t("kcal", "سعرة"))
                    Spacer()
                }
                MacroBar(n: liveTotals)
                VStack(alignment: .leading) {
                    Text(t("Portion you ate: \(Int((portion * 100).rounded()))%", "الكمية التي أكلتها: \(Int((portion * 100).rounded()))%"))
                    Slider(value: $portion, in: 0.25...2, step: 0.25)
                }
            }
            Section {
                ForEach($items) { $item in ItemEditor(item: $item) }
                    .onDelete { items.remove(atOffsets: $0) }
                Button { items.append(.blank()) } label: { Label(t("Add item", "إضافة صنف"), systemImage: "plus") }
            } header: { Text(t("Ingredients (tap to edit)", "المكونات (اضغط للتعديل)")) }

            if !meal.final.assumptions.isEmpty {
                Section(t("Agent's assumptions — edit if they're wrong", "افتراضات الوكيل — عدّل إذا لم تكن صحيحة")) {
                    ForEach(meal.final.assumptions, id: \.self) { Text("• \($0)").font(.callout) }
                }
            }
            if !meal.final.warnings.isEmpty {
                Section(t("Warnings", "تنبيهات")) {
                    ForEach(meal.final.warnings, id: \.self) { Text($0).font(.callout).foregroundStyle(.orange) }
                }
            }
            if !meal.final.sources.isEmpty {
                Section(t("Sources", "المصادر")) {
                    ForEach(meal.final.sources, id: \.url) { s in
                        if let u = URL(string: s.url) { Link(s.title, destination: u).lineLimit(1) }
                    }
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }

            Section {
                Button { Task { await confirm() } } label: {
                    HStack { Spacer(); if busy { ProgressView() } else { Text(meal.isConfirmed ? t("Save changes", "حفظ التعديلات") : t("Confirm and add to today", "تأكيد وإضافة لليوم")).bold().foregroundStyle(Theme.brand2) }; Spacer() }
                }.disabled(busy || items.isEmpty)
                Button(role: .destructive) { Task { await remove() } } label: { HStack { Spacer(); Text(t("Delete meal", "حذف الوجبة")).bold(); Spacer() } }
                    .foregroundStyle(Theme.dangerText)
                    .listRowBackground(Theme.dangerSoft)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(t("Review meal", "مراجعة الوجبة"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            items = meal.final.items
            mealName = originalName
            restaurant = meal.final.restaurant ?? ""
            kind = meal.kind ?? "meal"
        }
    }

    private func confirm() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            if dirty {
                // The user edits the name in the UI language; the other one is only filled when empty.
                let en = appLang == .en
                meal = try await APIClient.shared.updateMeal(
                    id: meal.id, items: items,
                    mealName: en || meal.final.mealName.isEmpty ? mealName : nil,
                    mealNameAr: !en || meal.final.mealNameAr.isEmpty ? mealName : nil,
                    restaurant: restaurant.isEmpty ? nil : restaurant,
                    portionFactor: portion == 1 ? nil : portion,
                    kind: kind)
            }
            meal = try await APIClient.shared.confirmMeal(id: meal.id)
            try? await HealthKitManager.shared.save(meal: meal)
            await store.refresh()
            onDone?()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }

    private func remove() async {
        busy = true
        defer { busy = false }
        do {
            try await APIClient.shared.deleteMeal(id: meal.id)
            try? await HealthKitManager.shared.delete(mealId: meal.id)
            await store.refresh()
            onDone?()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct ItemEditor: View {
    @Binding var item: MealItem
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            TextField(t("Name", "الاسم"), text: appLang == .ar ? $item.nameAr : $item.name)
            HStack {
                num(t("Quantity", "الكمية"), $item.quantity)
                TextField(t("Unit", "الوحدة"), text: $item.unit)
            }
            num(t("Weight (g)", "الوزن (غ)"), Binding(get: { item.grams ?? 0 }, set: { item.grams = $0 > 0 ? $0 : nil }))
            num(t("Calories", "السعرات"), $item.calories)
            num(t("Protein (g)", "بروتين (غ)"), $item.proteinG)
            num(t("Carbs (g)", "كربوهيدرات (غ)"), $item.carbsG)
            num(t("Fat (g)", "دهون (غ)"), $item.fatG)
            num(t("Fibre (g)", "ألياف (غ)"), $item.fiberG)
            num(t("Sugar (g)", "سكر (غ)"), $item.sugarG)
            num(t("Sodium (mg)", "صوديوم (ملغ)"), $item.sodiumMg)
        } label: {
            HStack {
                VStack(alignment: .leading) {
                    Text(appLang == .ar ? (item.nameAr.isEmpty ? item.name : item.nameAr) : (item.name.isEmpty ? item.nameAr : item.name))
                    Text("\(item.quantity.formatted()) \(item.unit)\(item.grams.map { t(" • \(Int($0)) g", " • \(Int($0)) غ") } ?? "")")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(Int(item.calories))").monospacedDigit()
            }
        }
    }

    private func num(_ label: String, _ value: Binding<Double>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField(label, value: value, format: .number.precision(.fractionLength(0...1)))
                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 90)
        }
    }
}

private func scoreColor(_ s: MealScore) -> Color {
    s.score >= 7 ? Theme.good : s.score >= 4.5 ? Theme.warn : Theme.bad
}

struct FlowReasons: View {
    let reasons: [MealScore.Reason]
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(reasons, id: \.self) { r in
                Label(r.text, systemImage: r.good ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                    .font(.caption).foregroundStyle(r.good ? Theme.good : Theme.warn)
            }
        }
    }
}

struct MacroBar: View {
    let n: Nutrients
    var body: some View {
        HStack {
            macro(t("Protein", "بروتين"), n.proteinG, Theme.protein)
            macro(t("Carbs", "كربوهيدرات"), n.carbsG, Theme.carbs)
            macro(t("Fat", "دهون"), n.fatG, Theme.fat)
            macro(t("Fibre", "ألياف"), n.fiberG, Theme.fiber)
        }
    }
    private func macro(_ label: String, _ g: Double, _ c: Color) -> some View {
        VStack { Text(t("\(fmt(g)) g", "\(fmt(g)) غ")).bold().foregroundStyle(c); Text(label).font(.caption).foregroundStyle(Theme.muted) }.frame(maxWidth: .infinity)
    }
}

struct SourceBadge: View {
    let source: NutritionSource
    let confidence: Double
    private var color: Color {
        switch source {
        case .restaurantPublished, .knownMeal: return .green
        case .database: return .blue
        case .estimate: return .orange
        }
    }
    var body: some View {
        Text(t("\(source.labelAr) • \(Int(confidence * 100))% confidence", "\(source.labelAr) • ثقة \(Int(confidence * 100))٪"))
            .font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 4)
            .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }
}
