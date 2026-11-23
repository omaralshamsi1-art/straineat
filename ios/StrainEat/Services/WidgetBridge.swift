import Foundation
import WidgetKit

/// Pushes today's numbers to the home-screen widget.
enum WidgetBridge {
    static func update(balance b: Balance?, water: WaterDay?, steps: StepsDay?) {
        guard let b, b.date == WidgetSnapshot.todayKey else { return }
        var s = WidgetSnapshot.load() ?? WidgetSnapshot(date: b.date, updatedAt: Date(), lang: appLang.rawValue, eatenKcal: 0, proteinG: 0)
        s.date = b.date
        s.updatedAt = Date()
        s.lang = appLang.rawValue
        s.leftKcal = b.remainingKcal
        s.targetKcal = b.targetIntakeKcal
        s.eatenKcal = b.intake.calories
        s.burnKcal = b.burn?.totalKcal
        s.expectedBurnKcal = b.expectedBurnKcal
        s.proteinG = b.intake.proteinG
        s.proteinTargetG = b.macroTargets?.proteinG
        if let w = water { s.waterMl = w.intakeMl; s.waterTargetMl = w.targetMl }
        if let st = steps { s.steps = st.steps; s.stepsGoal = st.goal }
        publish(s)
    }

    static func update(water w: WaterDay) {
        guard var s = WidgetSnapshot.load(), s.date == w.date else { return }
        s.waterMl = w.intakeMl; s.waterTargetMl = w.targetMl; s.updatedAt = Date()
        publish(s)
    }

    private static func publish(_ s: WidgetSnapshot) {
        guard s != WidgetSnapshot.load() else { return }
        s.save()
        WidgetCenter.shared.reloadAllTimelines()
    }
}
