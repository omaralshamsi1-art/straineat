import Foundation
import HealthKit

/// Apple Health integration:
/// - READ active + basal energy burned → pushed to the backend as the day's burn
/// - WRITE confirmed meals as an HKCorrelation(.food) so they appear in Health and in apps that read it
@MainActor
final class HealthKitManager {
    static let shared = HealthKitManager()
    private let store = HKHealthStore()

    private let readTypes: Set<HKObjectType> = [
        HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.basalEnergyBurned),
        HKQuantityType(.bodyMass),
        HKQuantityType(.height),
        HKQuantityType(.heartRate),
        HKObjectType.workoutType(),
        HKQuantityType(.dietaryWater),
    ]

    private let dietary: [(KeyPath<Nutrients, Double>, HKQuantityTypeIdentifier, HKUnit)] = [
        (\.calories, .dietaryEnergyConsumed, .kilocalorie()),
        (\.proteinG, .dietaryProtein, .gram()),
        (\.carbsG, .dietaryCarbohydrates, .gram()),
        (\.fatG, .dietaryFatTotal, .gram()),
        (\.fiberG, .dietaryFiber, .gram()),
        (\.sugarG, .dietarySugar, .gram()),
        (\.sodiumMg, .dietarySodium, .gramUnit(with: .milli)),
    ]

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    func requestAuthorization() async throws {
        guard isAvailable else { return }
        let share = Set(dietary.map { HKQuantityType($0.1) as HKSampleType }).union([HKQuantityType(.dietaryWater)])
        try await store.requestAuthorization(toShare: share, read: readTypes.union(share.map { $0 as HKObjectType }))
    }

    // MARK: Burn

    func energy(on day: Date) async throws -> (active: Double, basal: Double) {
        let start = Calendar.current.startOfDay(for: day)
        let end = min(Calendar.current.date(byAdding: .day, value: 1, to: start)!, Date())
        async let a = sum(.activeEnergyBurned, start, end)
        async let b = sum(.basalEnergyBurned, start, end)
        return try await (a, b)
    }

    private func sum(_ id: HKQuantityTypeIdentifier, _ start: Date, _ end: Date) async throws -> Double {
        let predicate = HKSamplePredicate.quantitySample(
            type: HKQuantityType(id),
            predicate: HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate))
        let query = HKStatisticsQueryDescriptor(predicate: predicate, options: .cumulativeSum)
        return try await query.result(for: store)?.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
    }

    /// Reads the last `days` days of burn and sends them to the backend. Returns today's kcal (nil = nothing read).
    @discardableResult
    func syncBurnToServer(days: Int = 2) async -> Double? {
        guard isAvailable else { return nil }
        var samples: [EnergySample] = []
        for offset in 0..<days {
            let day = Calendar.current.date(byAdding: .day, value: -offset, to: Date())!
            guard let e = try? await energy(on: day), e.active + e.basal > 0 else { continue }
            samples.append(EnergySample(date: DateFormatter.isoDay.string(from: day), source: "apple_health",
                                        activeKcal: e.active.rounded(), basalKcal: e.basal.rounded(), totalKcal: nil))
        }
        guard !samples.isEmpty else { return nil }
        do { try await APIClient.shared.pushEnergy(samples) } catch { return nil }
        let today = DateFormatter.isoDay.string(from: Date())
        return samples.first { $0.date == today }.map { ($0.activeKcal ?? 0) + ($0.basalKcal ?? 0) }
    }

    // MARK: Water

    /// Water other apps wrote to Health (Google Health / Fitbit, water apps) — StrainEat's own samples are left out
    /// because the server already has them. Sends daily totals for the last `days` days.
    func syncWaterToServer(days: Int = 3) async {
        guard isAvailable else { return }
        let notMine = NSCompoundPredicate(notPredicateWithSubpredicate: HKQuery.predicateForObjects(from: HKSource.default()))
        var samples: [[String: Any]] = []
        for offset in 0..<days {
            let day = Calendar.current.date(byAdding: .day, value: -offset, to: Date())!
            let start = Calendar.current.startOfDay(for: day)
            let end = min(Calendar.current.date(byAdding: .day, value: 1, to: start)!, Date())
            let pred = NSCompoundPredicate(andPredicateWithSubpredicates: [HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate), notMine])
            let q = HKStatisticsQueryDescriptor(predicate: HKSamplePredicate.quantitySample(type: HKQuantityType(.dietaryWater), predicate: pred), options: .cumulativeSum)
            guard let ml = try? await q.result(for: store)?.sumQuantity()?.doubleValue(for: .literUnit(with: .milli)) else { continue }
            samples.append(["date": DateFormatter.isoDay.string(from: day), "ml": Int(ml.rounded())])
        }
        if !samples.isEmpty { try? await APIClient.shared.pushWater(samples) }
    }

    /// Writes a water tap to Health (tagged with the entry id so undo can remove it).
    func saveWater(ml: Double, id: String, at: Date) async {
        guard isAvailable else { return }
        let s = HKQuantitySample(type: HKQuantityType(.dietaryWater), quantity: HKQuantity(unit: .literUnit(with: .milli), doubleValue: ml),
                                 start: at, end: at, metadata: [HKMetadataKeyExternalUUID: id])
        try? await store.save(s)
    }
    func deleteWater(id: String) async {
        guard isAvailable else { return }
        let pred = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeyExternalUUID, allowedValues: [id])
        try? await store.deleteObjects(of: HKQuantityType(.dietaryWater), predicate: pred)
    }

    // MARK: Workouts → server (activity type, duration, kcal, heart rate, distance)

    func syncWorkoutsToServer(days: Int = 3) async {
        guard isAvailable else { return }
        let start = Calendar.current.date(byAdding: .day, value: -days, to: Calendar.current.startOfDay(for: Date()))!
        let query = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: start, end: Date()))],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)],
            limit: 100)
        guard let workouts = try? await query.result(for: store), !workouts.isEmpty else { return }
        let items: [WorkoutUpload] = workouts.map { w in
            let kcal = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
            let hr = w.statistics(for: HKQuantityType(.heartRate))
            let bpm = HKUnit.count().unitDivided(by: .minute())
            let distance = [HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling), HKQuantityType(.distanceSwimming)]
                .compactMap { w.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .meter()) }.first
            return WorkoutUpload(externalId: w.uuid.uuidString, sport: Self.sportName(w.workoutActivityType),
                                 start: w.startDate, end: w.endDate, kcal: kcal,
                                 avgHr: hr?.averageQuantity()?.doubleValue(for: bpm),
                                 maxHr: hr?.maximumQuantity()?.doubleValue(for: bpm), distanceM: distance)
        }
        try? await APIClient.shared.pushWorkouts(items)
    }

    /// Names match the server's sport table (same spelling as HKWorkoutActivityType cases).
    static func sportName(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .running: return "running"
        case .walking: return "walking"
        case .hiking: return "hiking"
        case .cycling: return "cycling"
        case .traditionalStrengthTraining: return "traditionalStrengthTraining"
        case .functionalStrengthTraining: return "functionalStrengthTraining"
        case .crossTraining: return "crossfit"
        case .coreTraining: return "coreTraining"
        case .swimming: return "swimming"
        case .rowing: return "rowing"
        case .highIntensityIntervalTraining: return "highIntensityIntervalTraining"
        case .mixedCardio: return "mixedCardio"
        case .elliptical: return "elliptical"
        case .stairClimbing, .stairs: return "stairClimbing"
        case .jumpRope: return "jumpRope"
        case .cardioDance, .socialDance: return "cardioDance"
        case .yoga: return "yoga"
        case .pilates: return "pilates"
        case .flexibility: return "flexibility"
        case .cooldown: return "cooldown"
        case .mindAndBody: return "mindAndBody"
        case .taiChi: return "taiChi"
        case .tennis: return "tennis"
        case .squash: return "squash"
        case .badminton: return "badminton"
        case .tableTennis: return "tableTennis"
        case .pickleball: return "pickleball"
        case .paddleSports: return "paddleboarding"
        case .golf: return "golf"
        case .soccer: return "soccer"
        case .basketball: return "basketball"
        case .volleyball: return "volleyball"
        case .handball: return "handball"
        case .cricket: return "cricket"
        case .boxing: return "boxing"
        case .kickboxing: return "kickboxing"
        case .martialArts: return "martialArts"
        case .wrestling: return "wrestling"
        case .climbing: return "climbing"
        case .equestrianSports: return "equestrianSports"
        default: return "other"
        }
    }

    /// Wakes the app when new active energy is written (watch workouts etc.) and re-syncs.
    func enableBackgroundSync() {
        guard isAvailable else { return }
        let type = HKQuantityType(.activeEnergyBurned)
        let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
            guard error == nil else { completion(); return }
            Task { @MainActor in
                await HealthKitManager.shared.syncBurnToServer(days: 1)
                completion()
            }
        }
        store.execute(query)
        store.enableBackgroundDelivery(for: type, frequency: .hourly) { _, _ in }
        // new workouts (Apple Watch, Fitness+, Strava… anything that writes to Health)
        let wq = HKObserverQuery(sampleType: HKObjectType.workoutType(), predicate: nil) { _, completion, error in
            guard error == nil else { completion(); return }
            Task { @MainActor in
                await HealthKitManager.shared.syncWorkoutsToServer(days: 2)
                completion()
            }
        }
        store.execute(wq)
        store.enableBackgroundDelivery(for: HKObjectType.workoutType(), frequency: .immediate) { _, _ in }
    }

    // MARK: Meals → Health

    func save(meal: Meal) async throws {
        guard isAvailable else { return }
        try await delete(mealId: meal.id) // idempotent re-save after edits
        let t = meal.final.totals
        let meta: [String: Any] = [
            HKMetadataKeyFoodType: meal.final.mealNameAr.isEmpty ? meal.final.mealName : meal.final.mealNameAr,
            HKMetadataKeyExternalUUID: meal.id,
        ]
        var samples = Set<HKSample>()
        for (keyPath, id, unit) in dietary {
            let value = t[keyPath: keyPath]
            guard value > 0 else { continue }
            // units match the backend: kcal, g, and mg for sodium
            samples.insert(HKQuantitySample(type: HKQuantityType(id), quantity: HKQuantity(unit: unit, doubleValue: value),
                                            start: meal.eatenAt, end: meal.eatenAt, metadata: meta))
        }
        guard !samples.isEmpty else { return }
        let food = HKCorrelation(type: HKCorrelationType(.food), start: meal.eatenAt, end: meal.eatenAt,
                                 objects: samples, metadata: meta)
        try await store.save(food)
    }

    func delete(mealId: String) async throws {
        guard isAvailable else { return }
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeyExternalUUID, allowedValues: [mealId])
        let query = HKSampleQueryDescriptor(
            predicates: [.sample(type: HKCorrelationType(.food), predicate: predicate)], sortDescriptors: [])
        let found = try await query.result(for: store)
        let objects: [HKObject] = found.flatMap { s -> [HKObject] in
            guard let c = s as? HKCorrelation else { return [s] }
            return Array(c.objects) + [c]
        }
        if !objects.isEmpty { try await store.delete(objects) }
    }
}
