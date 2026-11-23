import Foundation

struct Nutrients: Codable, Hashable {
    var calories: Double = 0
    var proteinG: Double = 0
    var carbsG: Double = 0
    var fatG: Double = 0
    var fiberG: Double = 0
    var sugarG: Double = 0
    var sodiumMg: Double = 0

    enum CodingKeys: String, CodingKey {
        case calories
        case proteinG = "protein_g", carbsG = "carbs_g", fatG = "fat_g"
        case fiberG = "fiber_g", sugarG = "sugar_g", sodiumMg = "sodium_mg"
    }
}

struct MealItem: Codable, Hashable, Identifiable {
    var id = UUID()
    var name: String
    var nameAr: String
    var quantity: Double
    var unit: String
    var grams: Double?
    var calories: Double
    var proteinG: Double
    var carbsG: Double
    var fatG: Double
    var fiberG: Double
    var sugarG: Double
    var sodiumMg: Double

    enum CodingKeys: String, CodingKey {
        case name, quantity, unit, grams, calories
        case nameAr = "name_ar"
        case proteinG = "protein_g", carbsG = "carbs_g", fatG = "fat_g"
        case fiberG = "fiber_g", sugarG = "sugar_g", sodiumMg = "sodium_mg"
    }

    static func blank() -> MealItem {
        MealItem(name: "Item", nameAr: "صنف", quantity: 1, unit: "serving", grams: nil,
                 calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0)
    }
}

struct SourceRef: Codable, Hashable { var title: String; var url: String }

enum NutritionSource: String, Codable {
    case restaurantPublished = "restaurant_published"
    case knownMeal = "known_meal"
    case database
    case estimate

    var labelAr: String {
        switch self {
        case .restaurantPublished: return t("Published by the restaurant", "قيمة معلنة من المطعم")
        case .knownMeal: return t("From your past meals", "من وجباتك السابقة")
        case .database: return t("Nutrition database", "قاعدة بيانات غذائية")
        case .estimate: return t("Rough estimate from the photo", "تقدير تقريبي من الصورة")
        }
    }
}

struct NutritionEstimate: Codable, Hashable {
    var mealName: String
    var mealNameAr: String
    var restaurant: String?
    var source: NutritionSource
    var confidence: Double
    var servingDescription: String
    var items: [MealItem]
    var totals: Nutrients
    var sources: [SourceRef]
    var assumptions: [String]
    var warnings: [String]
    var swaps: [Swap]?
    var coachNoteAr: String?

    enum CodingKeys: String, CodingKey {
        case restaurant, source, confidence, items, totals, sources, assumptions, warnings, swaps
        case mealName = "meal_name", mealNameAr = "meal_name_ar", servingDescription = "serving_description"
        case coachNoteAr = "coach_note_ar"
    }
}

struct Meal: Codable, Identifiable, Hashable {
    let id: String
    var eatenAt: Date
    var date: String
    var status: String
    var estimate: NutritionEstimate
    var final: NutritionEstimate
    var edited: Bool
    var score: MealScore?
    var kind: String?
    var isConfirmed: Bool { status == "confirmed" }
}

/// The day's eating plan from GET /schedule.
struct DaySchedule: Codable {
    struct Item: Codable, Hashable { let id: String; let name: String; let nameAr: String; let kcal: Double; let kind: String
        var displayName: String { appLang == .ar ? (nameAr.isEmpty ? name : nameAr) : (name.isEmpty ? nameAr : name) }
        enum CodingKeys: String, CodingKey { case id, name, kcal, kind; case nameAr = "name_ar" } }
    struct Slot: Codable, Hashable, Identifiable {
        let id: String; let kind: String; let time: String; let targetKcal: Double; let status: String; let eatenKcal: Double
        let items: [Item]; let labelEn: String; let labelAr: String
        var label: String { appLang == .ar ? labelAr : labelEn }
        enum CodingKeys: String, CodingKey { case id, kind, time, targetKcal, status, eatenKcal, items; case labelEn = "label_en", labelAr = "label_ar" }
    }
    let date: String
    let custom: Bool
    let ramadan: Bool
    let slots: [Slot]
    let drinks: [Item]
    let drinksKcal: Double
    let extras: [Item]?
}

struct AnalyzeResponse: Codable {
    struct AgentInfo: Codable { let model: String; let searchesUsed: Int }
    let meal: Meal
    let agent: AgentInfo
}

struct Balance: Codable {
    struct Burn: Codable { let source: String; let totalKcal: Double; let activeKcal: Double?; let basalKcal: Double? }
    struct MealRow: Codable, Identifiable {
        let id: String; let eatenAt: Date; let status: String
        let name: String; let nameAr: String; let restaurant: String?; let source: String; let calories: Double
        let proteinG: Double?
        let kind: String?
        var displayName: String { appLang == .ar ? (nameAr.isEmpty ? name : nameAr) : (name.isEmpty ? nameAr : name) }
        enum CodingKeys: String, CodingKey { case id, eatenAt, status, name, restaurant, source, calories, kind; case nameAr = "name_ar"; case proteinG = "protein_g" }
    }
    struct Split: Codable { let protein: Int; let carbs: Int; let fat: Int }
    struct MacroTargets: Codable {
        let proteinG: Double; let carbsG: Double; let fatG: Double; let fiberG: Double
        enum CodingKeys: String, CodingKey { case proteinG = "protein_g", carbsG = "carbs_g", fatG = "fat_g", fiberG = "fiber_g" }
    }
    struct Tip: Codable, Hashable { let kind: String; let textAr: String; let textEn: String?
        var text: String { pick(textEn, textAr) }
        enum CodingKeys: String, CodingKey { case kind; case textAr = "text_ar", textEn = "text_en" } }
    let date: String
    let intake: Nutrients
    let pendingDrafts: Nutrients
    let burn: Burn?
    let burnIsPartialDay: Bool
    let estimatedTdee: Double?
    var expectedBurnKcal: Double?
    var goalDeltaKcal: Double?
    let goal: String
    let targetIntakeKcal: Double?
    let remainingKcal: Double?
    let netKcal: Double?
    let macroTargets: MacroTargets?
    let macroSplitPct: Split
    let ramadan: RamadanView?
    let tips: [Tip]?
    let onboarded: Bool?
    let activity: DayActivity?
    let meals: [MealRow]
    /** plan target before the extra-burn allowance, the allowance, and the projected full-day burn */
    var baseTargetKcal: Double?
    var burnBonusKcal: Double?
    var projectedBurnKcal: Double?
    /** morning plan + after-workout note (server-built, both languages) */
    var cards: [InsightCard]?
}

struct InsightCard: Codable, Hashable, Identifiable {
    let id: String
    let kind: String
    let tone: String
    let titleAr: String; let titleEn: String
    let linesAr: [String]; let linesEn: [String]
    var title: String { appLang == .ar ? titleAr : titleEn }
    var lines: [String] { appLang == .ar ? linesAr : linesEn }
    enum CodingKeys: String, CodingKey { case id, kind, tone; case titleAr = "title_ar", titleEn = "title_en", linesAr = "lines_ar", linesEn = "lines_en" }
}

struct RamadanView: Codable {
    struct Split: Codable { let suhoor: Double; let iftar: Double; let evening: Double }
    let active: Bool
    /// ramadan | manual | weekday | white
    var kind: String?
    let detected: Bool
    let needsChoice: Bool
    let fasting: Bool
    let suhoorTime: String
    let iftarTime: String
    let split: Split?
    let minutesToIftar: Int?
}

struct Workout: Codable, Identifiable {
    let id: String
    let source: String
    let sport: String
    let sportAr: String?
    let kind: String?
    let start: Date
    let end: Date
    let durationMin: Double
    let kcal: Double?
    let strain: Double?
    let avgHr: Double?
    let maxHr: Double?
    let distanceM: Double?
    let sportEn: String?
    var displayName: String { (appLang == .ar ? sportAr : sportEn) ?? sport }
}

struct DayActivity: Codable {
    let date: String
    let workouts: [Workout]
    let totalMin: Double
    let totalKcal: Double
    let maxStrain: Double?
}

struct MealScore: Codable, Hashable {
    struct Reason: Codable, Hashable { let good: Bool; let textAr: String; let textEn: String?
        var text: String { pick(textEn, textAr) }
        enum CodingKeys: String, CodingKey { case good; case textAr = "text_ar", textEn = "text_en" } }
    let score: Double
    let grade: String
    let labelAr: String
    let labelEn: String?
    let reasons: [Reason]
    var label: String { pick(labelEn, labelAr) }
    enum CodingKeys: String, CodingKey { case score, grade, reasons; case labelAr = "label_ar", labelEn = "label_en" }
}

struct Swap: Codable, Hashable {
    let insteadOfAr: String
    let chooseAr: String
    let deltaKcal: Double
    let deltaProteinG: Double
    let whyAr: String
    enum CodingKeys: String, CodingKey {
        case insteadOfAr = "instead_of_ar", chooseAr = "choose_ar", deltaKcal = "delta_kcal"
        case deltaProteinG = "delta_protein_g", whyAr = "why_ar"
    }
}

struct PlanNotice: Codable, Hashable { let level: String; let code: String?; let textAr: String; let textEn: String?
    var text: String { pick(textEn, textAr) }
    enum CodingKeys: String, CodingKey { case level, code; case textAr = "text_ar", textEn = "text_en" } }

struct Plan: Codable {
    struct BurnData: Codable { let days: Int; let needed: Int; let window: Int; let avgKcal: Double? }
    let goal: String
    let effectiveGoal: String
    let pace: String?
    let maintenanceKcal: Double
    let maintenanceSource: String
    let dailyDeltaKcal: Double
    let targetKcal: Double
    let floorKcal: Double?
    let limitedByFloor: Bool?
    let weeklyChangeKg: Double?
    let proteinG: Double
    let fatG: Double
    let carbsG: Double
    let fiberG: Double
    let bmi: Double?
    let targetBmi: Double?
    let etaDate: String?
    let weeksToGoal: Double?
    let notices: [PlanNotice]
    let currentWeightKg: Double?
    let startWeightKg: Double?
    let targetWeightKg: Double?
    let progressPct: Double?
    let changeSinceStartKg: Double?
    let burnData: BurnData?
    let activityLevel: String?
    let bmr: Double?
    let ageYears: Int?
    struct Advice: Codable, Hashable { let textAr: String; let textEn: String?
        var text: String { pick(textEn, textAr) }
        enum CodingKeys: String, CodingKey { case textAr = "text_ar", textEn = "text_en" } }
    struct Deadline: Codable { let date: String; let requiredKgWeek: Double; let feasible: Bool }
    struct DeviceCalibration: Codable { let factor: Double; let accuracyPct: Int; let days: Int }
    let intense: Bool?
    let maxSafeKgWeek: Double?
    let deadline: Deadline?
    let advice: [Advice]?
    let deviceCalibration: DeviceCalibration?
}

struct WeightEntry: Codable, Identifiable { let date: String; let kg: Double; let trend: Double; let source: String?
    var id: String { date }
    var day: Date { DateFormatter.isoDay.date(from: date) ?? Date() } }
struct WeightLog: Codable { let entries: [WeightEntry]; let current: Double? }

struct HistoryDay: Codable, Identifiable {
    let date: String; let intakeKcal: Double; let proteinG: Double; let meals: Int; let burnKcal: Double?; let targetKcal: Double?
    var id: String { date }
    var day: Date { DateFormatter.isoDay.date(from: date) ?? Date() }
}
struct History: Codable { let days: [HistoryDay]; let avgIntakeKcal: Double?; let daysOnTarget: Int; let loggedDays: Int }

struct Motivation: Codable {
    struct Streak: Codable { let current: Int; let best: Int; let loggedToday: Bool? }
    struct Badge: Codable, Identifiable { let id: String; let titleAr: String; let descAr: String; let titleEn: String?; let descEn: String?; let earned: Bool; let progress: Double; let target: Double
        var title: String { pick(titleEn, titleAr) }
        var desc: String { pick(descEn, descAr) }
        enum CodingKeys: String, CodingKey { case id, earned, progress, target; case titleAr = "title_ar", descAr = "desc_ar", titleEn = "title_en", descEn = "desc_en" } }
    struct Challenge: Codable { let id: String; let titleAr: String; let descAr: String; let titleEn: String?; let descEn: String?; let unitEn: String?; let target: Double; let unit: String; let progress: Double; let done: Bool; let daysLeft: Int
        var title: String { pick(titleEn, titleAr) }
        var unitText: String { pick(unitEn, unit) }
        enum CodingKeys: String, CodingKey { case id, target, unit, progress, done, daysLeft; case titleAr = "title_ar", descAr = "desc_ar", titleEn = "title_en", descEn = "desc_en", unitEn = "unit_en" } }
    let streak: Streak
    let onTargetStreak: Streak?
    let badges: [Badge]
    let earnedCount: Int
    let challenge: Challenge?
}

struct Suggestions: Codable {
    struct Option: Codable, Hashable { let titleAr: String; let whereAr: String; let kcal: Double; let proteinG: Double; let whyAr: String
        enum CodingKeys: String, CodingKey { case kcal; case titleAr = "title_ar", whereAr = "where_ar", proteinG = "protein_g", whyAr = "why_ar" } }
    struct Ingredient: Codable, Hashable { let item: String; let amount: String }
    struct Home: Codable, Hashable {
        let title: String; let prepMin: Double; let ingredients: [Ingredient]; let steps: [String]; let why: String
        let kcal: Double; let proteinG: Double; let carbsG: Double; let fatG: Double
        enum CodingKeys: String, CodingKey { case title, ingredients, steps, why, kcal; case prepMin = "prep_min", proteinG = "protein_g", carbsG = "carbs_g", fatG = "fat_g" }
    }
    struct Out: Codable, Hashable {
        let title: String; let restaurant: String; let orderTip: String; let why: String
        let kcal: Double; let proteinG: Double; let carbsG: Double; let fatG: Double
        enum CodingKeys: String, CodingKey { case title, restaurant, why, kcal; case orderTip = "order_tip", proteinG = "protein_g", carbsG = "carbs_g", fatG = "fat_g" }
    }
    let slot: String
    let remainingKcal: Double
    let proteinLeftG: Double
    let introAr: String
    let options: [Option]
    let home: [Home]?
    let healthy: [Out]?
    let fast: [Out]?
    let mapsArea: String?
    enum CodingKeys: String, CodingKey { case slot, remainingKcal, proteinLeftG, options, home, healthy, fast, mapsArea; case introAr = "intro_ar" }
}

struct WeeklyReport: Codable {
    struct Stats: Codable {
        let from: String; let to: String; let loggedDays: Int; let daysOnTarget: Int
        let avgKcal: Double?; let targetKcal: Double?; let avgProtein: Double?; let proteinTarget: Double?
        let avgFiber: Double?; let fiberTarget: Double?; let avgBurn: Double?; let avgDeficit: Double?
        let weightChangeKg: Double?; let workouts: Int; let workoutMinutes: Double; let goal: String
    }
    struct Narrative: Codable {
        let headlineAr: String; let winsAr: [String]; let improveAr: [String]; let nextWeekGoalAr: String
        enum CodingKeys: String, CodingKey { case headlineAr = "headline_ar", winsAr = "wins_ar", improveAr = "improve_ar", nextWeekGoalAr = "next_week_goal_ar" }
    }
    let stats: Stats
    let narrative: Narrative
}

struct Favorite: Codable, Identifiable, Hashable {
    let key: String; let name: String; let nameAr: String?; let restaurant: String?
    let calories: Double; let proteinG: Double?; let timesLogged: Int?
    var id: String { key }
    var title: String { appLang == .ar ? (nameAr?.isEmpty == false ? nameAr! : name) : name }
    enum CodingKeys: String, CodingKey { case key, name, restaurant, calories, timesLogged; case nameAr = "name_ar", proteinG = "protein_g" }
}

struct BarcodeProduct: Codable {
    struct Per100: Codable {
        let calories: Double; let proteinG: Double; let carbsG: Double; let fatG: Double; let fiberG: Double; let sugarG: Double; let sodiumMg: Double
        enum CodingKeys: String, CodingKey { case calories; case proteinG = "protein_g", carbsG = "carbs_g", fatG = "fat_g", fiberG = "fiber_g", sugarG = "sugar_g", sodiumMg = "sodium_mg" }
    }
    let barcode: String; let name: String; let nameAr: String?; let brand: String?
    let servingG: Double?; let servingLabel: String?; let per100: Per100; let imageUrl: String?
    var title: String { appLang == .ar ? (nameAr?.isEmpty == false ? nameAr! : name) : name }
    enum CodingKeys: String, CodingKey { case barcode, name, brand, servingG, servingLabel, per100, imageUrl; case nameAr = "name_ar" }
}

struct AuthUser: Codable { let id: String; let email: String?; let name: String?; let role: String; let account: Bool? }
struct AuthResponse: Codable { let token: String; let user: AuthUser }
struct Invite: Codable, Identifiable { let code: String; let usedBy: String?; let usedByName: String?; let createdAt: Date; let expiresAt: Date
    var id: String { code } }

/// Only the fields the app reads; writes go through `APIClient.updateProfile(_:)` as partial patches.
struct Profile: Codable {
    struct Ramadan: Codable { var enabled: Bool?; var suhoorTime: String; var iftarTime: String; var fastDays: [Int]?; var whiteDays: Bool? }
    struct Reminders: Codable { var meals: Bool; var weight: Bool; var water: Bool? }
    var hotEnvironment: Bool?
    struct Screening: Codable { var pregnant: Bool?; var breastfeeding: Bool?; var medicalSupervision: Bool?; var edHistory: Bool? }
    var sex: String?
    var birthYear: Int?
    var heightCm: Double?
    var weightKg: Double?
    var activityLevel: String
    var goal: String
    var preferredEnergySource: String?
    var timezone: String
    var city: String?
    var area: String?
    var targetWeightKg: Double?
    var targetDate: String?
    var pace: String?
    var screening: Screening?
    var onboarded: Bool?
    var ramadan: Ramadan?
    var reminders: Reminders?
    var language: String?
    var birthDate: String?
    var dietStyle: String?
    var conditions: [String]?
    var mealsPerDay: Int?
    var mealSchedule: MealScheduleSetting?
    var medReminders: [MedReminder]?
}

struct MedReminder: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var dose: String
    var kind: String
    var times: [String]
    var enabled: Bool
    var dict: [String: Any] { ["id": id, "name": name, "dose": dose, "kind": kind, "times": times, "enabled": enabled] }
}

struct EnergySample: Codable {
    let date: String
    let source: String
    var activeKcal: Double?
    var basalKcal: Double?
    var totalKcal: Double?
}

extension DateFormatter {
    static let isoDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

struct WorkoutUpload: Encodable {
    let externalId: String
    let sport: String
    let start: Date
    let end: Date
    let kcal: Double?
    let avgHr: Double?
    let maxHr: Double?
    let distanceM: Double?
}

struct MealScheduleSetting: Codable, Hashable {
    struct Slot: Codable, Hashable { var id: String; var kind: String?; var time: String }
    var custom: Bool?
    var slots: [Slot]
}

struct WaterDay: Codable {
    struct Entry: Codable, Identifiable, Hashable { let id: String; let date: String; let ml: Double; let source: String; let at: Date }
    struct Drink: Codable, Hashable { let id: String; let name: String; let nameAr: String?; let ml: Double
        enum CodingKeys: String, CodingKey { case id, name, ml; case nameAr = "name_ar" } }
    let date: String
    let targetMl: Double?
    let baseMl: Double
    let workoutMl: Double
    let heatMl: Double
    let supervised: Bool
    let intakeMl: Double
    let manualMl: Double
    let healthMl: Double
    let drinksMl: Double
    let expectedByNowMl: Double?
    let remainingMl: Double?
    let entries: [Entry]
    let drinks: [Drink]
    let notes: [PlanNotice]
}
struct WaterHistory: Codable { struct Day: Codable, Identifiable { let date: String; let intakeMl: Double; let targetMl: Double?; var id: String { date } }; let days: [Day] }

struct StepsDay: Codable { let date: String; let steps: Double?; let goal: Double; let fullGoal: Double; let avg7: Double? }
