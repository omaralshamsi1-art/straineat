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

    var photo: UIImage? = nil
    @State private var plan: Plan?
    @State private var editing: Int?
    @State private var showItems = false
    @State private var showMore = false

    private var hasMore: Bool {
        !(meal.final.swaps ?? []).isEmpty || !meal.final.assumptions.isEmpty || !meal.final.warnings.isEmpty || !meal.final.sources.isEmpty || meal.score != nil
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                heroCard
                resultCard
                ingredientsCard
                if hasMore { moreCard }
                if let error { Notice(text: error, level: "danger") }
                Button { Task { await confirm() } } label: {
                    if busy { ProgressView().tint(Theme.bg) } else {
                        Text(meal.isConfirmed ? t("Save changes", "حفظ التعديلات") : t("Add to today ✓", "أضف لليوم ✓")).font(.title3.weight(.bold))
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || items.isEmpty)
                Button(t("Delete meal", "حذف الوجبة")) { Task { await remove() } }
                    .font(.subheadline.weight(.bold)).foregroundStyle(Theme.bad).padding(.vertical, 8)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(t("Your meal", "وجبتك"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            items = meal.final.items
            mealName = originalName
            restaurant = meal.final.restaurant ?? ""
            kind = meal.kind ?? "meal"
        }
        .task { plan = try? await APIClient.shared.plan() }
        .sheet(item: Binding(get: { editing.map { EditIndex(id: $0) } }, set: { editing = $0?.id })) { e in
            if e.id < items.count {
                ItemSheet(item: $items[e.id], onDelete: { items.remove(at: e.id); editing = nil })
                    .presentationDetents([.medium, .large])
                    .environment(\.layoutDirection, appLayoutDirection)
            }
        }
    }

    // MARK: cards

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 14) {
                Group {
                    if let photo { Image(uiImage: photo).resizable().scaledToFill() }
                    else { Text(kind == "drink" ? "☕" : kind == "snack" ? "🍎" : "🍽️").font(.system(size: 38)).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.card2) }
                }
                .frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .top, spacing: 6) {
                        TextField(t("Meal name", "اسم الوجبة"), text: $mealName, axis: .vertical)
                            .font(.title3.weight(.heavy)).lineLimit(1...3)
                        Image(systemName: "pencil").font(.footnote).foregroundStyle(Theme.muted).padding(.top, 4)
                    }
                    HStack(spacing: 8) {
                        SourceBadge(source: meal.final.source, confidence: meal.final.confidence)
                        Text(meal.final.servingDescription).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                }
            }
            HStack(spacing: 6) {
                kindChip("meal", t("🍽️ Meal", "🍽️ وجبة"))
                kindChip("snack", t("🍎 Snack", "🍎 سناك"))
                kindChip("drink", t("☕ Drink", "☕ مشروب"))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func kindChip(_ k: String, _ title: String) -> some View {
        Button { kind = k } label: {
            Text(title).font(.footnote.weight(.bold)).lineLimit(1)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .foregroundStyle(kind == k ? Theme.bg : Theme.muted)
                .background(kind == k ? Theme.ink : Theme.card2, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private var resultCard: some View {
        let n = liveTotals
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(Int(n.calories.rounded()))").font(.system(size: 60, weight: .heavy)).monospacedDigit()
                Text(plan.map { t("kcal · \(Int((n.calories / max(1, $0.targetKcal) * 100).rounded()))% of today's goal", "سعرة · \(Int((n.calories / max(1, $0.targetKcal) * 100).rounded()))% من هدف اليوم") } ?? t("kcal", "سعرة"))
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted)
            }
            if let fit = fitLine(n.calories) {
                HStack(spacing: 8) {
                    Image(systemName: fit.ok ? "checkmark" : "exclamationmark")
                        .font(.caption.weight(.heavy)).frame(width: 26, height: 26)
                        .foregroundStyle(fit.color).background(fit.color.opacity(0.18), in: Circle())
                    Text(fit.text).font(.subheadline.weight(.bold))
                    Spacer(minLength: 4)
                    if let sc = meal.score {
                        Text("\(fmt(sc.score))/10").font(.caption.weight(.heavy))
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .foregroundStyle(scoreColor(sc)).background(scoreColor(sc).opacity(0.15), in: Capsule())
                    }
                }
            }
            if let note = smartNote {
                Text("💡 " + note).font(.subheadline).foregroundStyle(Theme.muted)
            }
            HStack(spacing: 8) {
                macroTile(t("Protein", "بروتين"), n.proteinG, plan?.proteinG, Theme.protein)
                macroTile(t("Carbs", "كارب"), n.carbsG, plan?.carbsG, Theme.carbs)
                macroTile(t("Fat", "دهون"), n.fatG, plan?.fatG, Theme.fat)
            }
            Text(t("How much did you eat?", "كم أكلت منها؟")).font(.subheadline.weight(.heavy)).padding(.top, 4)
            HStack(spacing: 0) {
                ForEach([0.25, 0.5, 0.75, 1.0, 1.5, 2.0], id: \.self) { v in
                    Button { portion = v } label: {
                        Text(portionLabel(v)).font(.subheadline.weight(.heavy))
                            .frame(maxWidth: .infinity).padding(.vertical, 9)
                            .foregroundStyle(portion == v ? Theme.bg : Theme.muted)
                            .background(portion == v ? Theme.ink : .clear, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(4)
            .background(Theme.card2, in: Capsule())
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func portionLabel(_ v: Double) -> String {
        switch v { case 0.25: "¼"; case 0.5: "½"; case 0.75: "¾"; case 1: t("Whole", "كاملة"); case 1.5: "1½"; default: "2×" }
    }

    private func macroTile(_ label: String, _ g: Double, _ target: Double?, _ c: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) { Circle().fill(c).frame(width: 8, height: 8); Text(label).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted) }
            Text(t("\(fmt(g)) g", "\(fmt(g)) غ")).font(.title3.weight(.heavy)).monospacedDigit()
            if let target, target > 0 {
                GeometryReader { geo in
                    Capsule().fill(Theme.line).overlay(alignment: .leading) {
                        Capsule().fill(c).frame(width: geo.size.width * min(1, g / target))
                    }
                }
                .frame(height: 5)
                Text(t("of \(fmt(target))", "من \(fmt(target))")).font(.caption2).foregroundStyle(Theme.muted)
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var ingredientsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(.snappy) { showItems.toggle() } } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(t("Ingredients (\(items.count))", "المكونات (\(items.count))")).font(.subheadline.weight(.heavy)).foregroundStyle(Theme.ink)
                        if !showItems { Text(items.map(\.displayName).joined(separator: " · ")).font(.caption).foregroundStyle(Theme.muted).lineLimit(1) }
                    }
                    Spacer()
                    Text(showItems ? t("Hide", "إخفاء") : t("View & edit", "عرض وتعديل")).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                }
            }
            .buttonStyle(.plain)
            if showItems {
                ForEach(items.indices, id: \.self) { i in
                    Button { editing = i } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(items[i].displayName).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                Text("\(items[i].quantity.formatted()) \(items[i].unit)\(items[i].grams.map { t(" · \(Int($0)) g", " · \(Int($0)) غ") } ?? "")")
                                    .font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Text(t("\(Int(items[i].calories.rounded())) kcal", "\(Int(items[i].calories.rounded())) سعرة")).font(.subheadline.weight(.bold)).monospacedDigit().foregroundStyle(Theme.ink)
                            Image(systemName: "chevron.forward").font(.caption).foregroundStyle(Theme.muted)
                        }
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
                .padding(.top, 6)
                Button { items.append(.blank()); editing = items.count - 1 } label: { Label(t("Add item", "إضافة صنف"), systemImage: "plus") }
                    .buttonStyle(SoftButtonStyle()).padding(.top, 10)
            }
        }
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var moreCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { withAnimation(.snappy) { showMore.toggle() } } label: {
                HStack {
                    Text(t("Swaps & analysis details", "بدائل وتفاصيل التحليل")).font(.subheadline.weight(.heavy)).foregroundStyle(Theme.ink)
                    Spacer()
                    Image(systemName: showMore ? "chevron.up" : "chevron.down").font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .buttonStyle(.plain)
            if showMore {
                if let sc = meal.score { FlowReasons(reasons: sc.reasons) }
                ForEach(meal.final.swaps ?? [], id: \.self) { sw in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(t("Instead of \(sw.insteadOfAr) → \(sw.chooseAr)", "بدل \(sw.insteadOfAr) ← \(sw.chooseAr)")).font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(signed(sw.deltaKcal)).font(.caption.bold()).monospacedDigit()
                                .environment(\.layoutDirection, .leftToRight)
                        }
                        if !sw.whyAr.isEmpty { Text(sw.whyAr).font(.caption).foregroundStyle(Theme.muted) }
                    }
                    .padding(12).background(Theme.card2, in: RoundedRectangle(cornerRadius: 14))
                }
                if !meal.final.assumptions.isEmpty {
                    Text(t("Analysis assumptions", "افتراضات التحليل")).font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                    ForEach(meal.final.assumptions, id: \.self) { Text("• \($0)").font(.callout) }
                }
                ForEach(meal.final.warnings, id: \.self) { Text($0).font(.callout).foregroundStyle(Theme.warn) }
                ForEach(meal.final.sources, id: \.url) { s in
                    if let u = URL(string: s.url) { Link(s.title, destination: u).font(.callout).lineLimit(1) }
                }
                InputField(title: t("Restaurant (optional)", "المطعم (اختياري)"), text: $restaurant)
            }
        }
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    // MARK: goal fit

    private struct Fit { let ok: Bool; let text: String; let color: Color }
    private func fitLine(_ kcal: Double) -> Fit? {
        guard let sc = meal.score, let before = sc.remainingBeforeKcal else { return nil }
        let after = Int((before - kcal).rounded())
        if sc.goal == "gain" {
            let share = kcal / max(1, sc.dailyTargetKcal ?? 1)
            let left = after > 0 ? t(" · \(after) left", " · باقي \(after)") : ""
            return share >= 0.2
                ? Fit(ok: true, text: t("Moves you toward your gain goal", "تقرّبك من هدف الزيادة") + left, color: Theme.good)
                : Fit(ok: false, text: t("Small portion for a gain goal", "حصة صغيرة لهدف الزيادة") + left, color: Theme.warn)
        }
        if after >= 0 { return Fit(ok: true, text: t("Fits your goal · \(after) left today", "مناسبة لهدفك · يبقى لك \(after)"), color: Theme.good) }
        if after >= -200 { return Fit(ok: false, text: t("Over today's budget by \(-after)", "تتجاوز ميزانية اليوم بـ\(-after)"), color: Theme.warn) }
        return Fit(ok: false, text: t("Above what's left today by \(-after)", "أعلى من المتبقي لك اليوم بـ\(-after)"), color: Theme.bad)
    }

    private var smartNote: String? {
        if let n = meal.final.coachNoteAr, !n.isEmpty { return n }
        guard let sc = meal.score, !sc.reasons.isEmpty else { return nil }
        return sc.reasons.prefix(2).map(\.text).joined(separator: " · ")
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

private struct EditIndex: Identifiable { let id: Int }

extension MealItem {
    var displayName: String { appLang == .ar ? (nameAr.isEmpty ? name : nameAr) : (name.isEmpty ? nameAr : name) }
}

/// Edit one ingredient; − / + scale every value with the quantity.
struct ItemSheet: View {
    @Binding var item: MealItem
    var onDelete: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var base: MealItem?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(t("Edit: \(item.displayName)", "تعديل: \(item.displayName)")).font(.headline)
                    Spacer()
                    Button(t("Delete", "حذف")) { onDelete() }.font(.subheadline.weight(.bold)).foregroundStyle(Theme.bad)
                }
                InputField(title: t("Name", "الاسم"), text: appLang == .ar ? $item.nameAr : $item.name)
                Text(t("Quantity", "الكمية")).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                HStack {
                    stepButton("minus") { scale(to: max(step(item.quantity - 0.01), item.quantity - step(item.quantity - 0.01))) }
                    Spacer()
                    Text("\(item.quantity.formatted()) \(item.unit)\(item.grams.map { t(" · \(Int($0)) g", " · \(Int($0)) غ") } ?? "")").font(.headline).monospacedDigit()
                    Spacer()
                    stepButton("plus") { scale(to: item.quantity + step(item.quantity)) }
                }
                .padding(6).background(Theme.card2, in: RoundedRectangle(cornerRadius: 14))
                Text(t("Values — scale with the quantity", "القيم — تتغير تلقائياً مع الكمية")).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    field(t("Calories", "السعرات"), $item.calories)
                    field(t("Protein (g)", "بروتين (غ)"), $item.proteinG)
                    field(t("Carbs (g)", "كربوهيدرات (غ)"), $item.carbsG)
                    field(t("Fat (g)", "دهون (غ)"), $item.fatG)
                    field(t("Fibre (g)", "ألياف (غ)"), $item.fiberG)
                    field(t("Weight (g)", "الوزن (غ)"), Binding(get: { item.grams ?? 0 }, set: { item.grams = $0 > 0 ? $0 : nil }))
                }
                Button(t("Done", "تم")) { dismiss() }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
            }
            .padding(20)
        }
        .onAppear { base = item }
    }

    private func step(_ q: Double) -> Double { q >= 100 ? 25 : q >= 10 ? 5 : q >= 2 ? 1 : 0.25 }

    private func scale(to q: Double) {
        guard let b = base, b.quantity > 0, q > 0 else { return }
        let f = q / b.quantity
        item.quantity = (q * 100).rounded() / 100
        item.calories = (b.calories * f).rounded()
        item.proteinG = (b.proteinG * f * 10).rounded() / 10
        item.carbsG = (b.carbsG * f * 10).rounded() / 10
        item.fatG = (b.fatG * f * 10).rounded() / 10
        item.fiberG = (b.fiberG * f * 10).rounded() / 10
        item.sugarG = (b.sugarG * f * 10).rounded() / 10
        item.sodiumMg = (b.sodiumMg * f).rounded()
        if let g = b.grams { item.grams = (g * f).rounded() }
    }

    private func stepButton(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.title3.weight(.bold)).frame(width: 44, height: 44)
                .foregroundStyle(Theme.ink).background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private func field(_ label: String, _ value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Theme.muted)
            TextField(label, value: Binding(get: { value.wrappedValue }, set: { value.wrappedValue = $0; base = item }), format: .number.precision(.fractionLength(0...1)))
                .keyboardType(.decimalPad).padding(11)
                .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
        }
    }
}
