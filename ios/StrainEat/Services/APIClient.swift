import Foundation
import UIKit

enum APIError: LocalizedError {
    case http(Int, String)
    var errorDescription: String? {
        switch self { case let .http(code, msg): return t("Server error (\(code)): \(msg)", "خطأ من الخادم (\(code)): \(msg)") }
    }
}

/// Talks to the StrainEat backend. Auth: the owner's server key (+ X-User-Id), or an account token (Bearer).
final class APIClient {
    static let shared = APIClient()

    var baseURL: URL {
        let stored = UserDefaults.standard.string(forKey: "apiBaseURL")
        let fallback = Bundle.main.object(forInfoDictionaryKey: "StrainEatAPIBaseURL") as? String ?? "http://localhost:3000"
        return URL(string: (stored?.isEmpty == false ? stored! : fallback))!
    }
    var accessToken: String? { UserDefaults.standard.string(forKey: "accessToken").flatMap { $0.isEmpty ? nil : $0 } }
    var devUserId: String { UserDefaults.standard.string(forKey: "devUserId") ?? "local-user" }
    var apiKey: String? { UserDefaults.standard.string(forKey: "apiKey").flatMap { $0.isEmpty ? nil : $0 } }

    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 120 // agent may search the web
        return URLSession(configuration: c)
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let withFrac = ISO8601DateFormatter(); withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { dec in
            let s = try dec.singleValueContainer().decode(String.self)
            if let date = withFrac.date(from: s) ?? plain.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: dec.codingPath, debugDescription: "Bad date \(s)"))
        }
        return d
    }()
    private let encoder = JSONEncoder()

    // MARK: Meals

    func analyze(image: UIImage, mealName: String?, restaurant: String?, portion: String?, note: String?) async throws -> AnalyzeResponse {
        guard let jpeg = image.resizedForUpload().jpegData(compressionQuality: 0.8) else { throw APIError.http(0, "image") }
        var form = MultipartForm()
        form.addFile(name: "photo", filename: "meal.jpg", mime: "image/jpeg", data: jpeg)
        for (k, v) in [("mealName", mealName), ("restaurant", restaurant), ("portion", portion), ("note", note)] {
            if let v, !v.trimmingCharacters(in: .whitespaces).isEmpty { form.addField(name: k, value: v) }
        }
        form.addField(name: "eatenAt", value: ISO8601DateFormatter().string(from: Date()))
        var req = request("meals/analyze", method: "POST")
        req.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        req.httpBody = form.finalize()
        return try await send(req)
    }

    func updateMeal(id: String, items: [MealItem]? = nil, mealName: String? = nil, mealNameAr: String? = nil, restaurant: String? = nil, portionFactor: Double? = nil, kind: String? = nil) async throws -> Meal {
        struct Patch: Encodable { var items: [MealItem]?; var meal_name: String?; var meal_name_ar: String?; var restaurant: String?; var portionFactor: Double?; var kind: String? }
        var req = request("meals/\(id)", method: "PATCH")
        req.httpBody = try encoder.encode(Patch(items: items, meal_name: mealName, meal_name_ar: mealNameAr, restaurant: restaurant, portionFactor: portionFactor, kind: kind))
        return try await send(req)
    }

    func confirmMeal(id: String) async throws -> Meal { try await send(request("meals/\(id)/confirm", method: "POST")) }

    func deleteMeal(id: String) async throws {
        let _: [String: Bool] = try await send(request("meals/\(id)", method: "DELETE"))
    }

    func meal(id: String) async throws -> Meal { try await send(request("meals/\(id)")) }

    // MARK: Energy / balance

    func balance(date: Date = Date()) async throws -> Balance {
        try await send(request("balance?date=\(DateFormatter.isoDay.string(from: date))"))
    }

    func pushEnergy(_ samples: [EnergySample]) async throws {
        struct Body: Encodable { let samples: [EnergySample] }
        var req = request("energy/samples", method: "POST")
        req.httpBody = try encoder.encode(Body(samples: samples))
        let _: [String: Int] = try await send(req)
    }

    func pushWorkouts(_ items: [WorkoutUpload]) async throws {
        struct Body: Encodable { let source = "apple_health"; let workouts: [WorkoutUpload] }
        var req = request("workouts", method: "POST")
        let enc = JSONEncoder(); enc.dateEncodingStrategy = .iso8601
        req.httpBody = try enc.encode(Body(workouts: items))
        let _: [String: Int] = try await send(req)
    }

    // MARK: Profile & plan

    func profile() async throws -> Profile { try await send(request("profile")) }
    /// Partial update — only the keys given are changed on the server.
    @discardableResult
    func updateProfile(_ patch: [String: Any]) async throws -> Profile {
        try await send(jsonRequest("profile", method: "PUT", patch))
    }
    func plan() async throws -> Plan { try await send(request("plan")) }
    func planPreview(_ patch: [String: Any]) async throws -> Plan { try await send(jsonRequest("plan/preview", method: "POST", patch)) }
    func weights(days: Int = 90) async throws -> WeightLog { try await send(request("weights?days=\(days)")) }
    func addWeight(_ kg: Double) async throws {
        let _: WeightLog = try await send(jsonRequest("weights", method: "POST", ["kg": kg]))
    }
    func history(days: Int = 7) async throws -> History { try await send(request("history?days=\(days)")) }

    // MARK: Coach & motivation

    func motivation() async throws -> Motivation { try await send(request("motivation")) }
    func suggest(force: Bool = false) async throws -> Suggestions {
        try await send(request("coach/suggest\(force ? "?force=1" : "")", method: "POST"))
    }
    func weekly(force: Bool = false) async throws -> WeeklyReport {
        try await send(request("coach/weekly\(force ? "?force=1" : "")"))
    }

    // MARK: Fast logging

    func analyzeText(_ text: String, restaurant: String?) async throws -> AnalyzeResponse {
        var body: [String: Any] = ["text": text, "eatenAt": ISO8601DateFormatter().string(from: Date())]
        if let restaurant, !restaurant.trimmingCharacters(in: .whitespaces).isEmpty { body["restaurant"] = restaurant }
        return try await send(jsonRequest("meals/analyze-text", method: "POST", body))
    }
    func favorites() async throws -> [Favorite] { try await send(request("meals/favorites")) }
    func logFavorite(key: String, portion: Double) async throws {
        let _: Meal = try await send(jsonRequest("meals/favorites/log", method: "POST",
            ["key": key, "portionFactor": portion, "eatenAt": ISO8601DateFormatter().string(from: Date())]))
    }
    func barcode(_ code: String) async throws -> BarcodeProduct {
        let safe = code.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? code
        return try await send(request("foods/barcode/\(safe)"))
    }
    /// Manual meal (used for barcode products — no AI call).
    func createMeal(from p: BarcodeProduct, grams: Double) async throws -> Meal {
        let f = grams / 100
        let n = p.per100
        let r = { (v: Double) in (v * f * 10).rounded() / 10 }
        let item: [String: Any] = [
            "name": p.name, "name_ar": p.title, "quantity": grams, "unit": "g", "grams": grams,
            "calories": r(n.calories), "protein_g": r(n.proteinG), "carbs_g": r(n.carbsG), "fat_g": r(n.fatG),
            "fiber_g": r(n.fiberG), "sugar_g": r(n.sugarG), "sodium_mg": r(n.sodiumMg),
        ]
        var body: [String: Any] = [
            "meal_name": p.name, "meal_name_ar": p.title, "source": "database", "confidence": 0.9, "items": [item],
            "sources": [["title": "Open Food Facts", "url": "https://world.openfoodfacts.org/product/\(p.barcode)"]],
            "eatenAt": ISO8601DateFormatter().string(from: Date()),
        ]
        if let b = p.brand { body["restaurant"] = b }
        return try await send(jsonRequest("meals", method: "POST", body))
    }

    /// Log a suggested option as a confirmed meal (no AI call).
    func logSuggestion(title: String, restaurant: String?, kcal: Double, protein: Double, carbs: Double, fat: Double) async throws {
        let item: [String: Any] = ["name": title, "name_ar": title, "quantity": 1, "unit": "serving", "calories": kcal, "protein_g": protein,
                                   "carbs_g": carbs, "fat_g": fat, "fiber_g": 0, "sugar_g": 0, "sodium_mg": 0]
        var body: [String: Any] = ["meal_name": title, "meal_name_ar": title, "source": "estimate", "confidence": 0.7, "items": [item],
                                   "eatenAt": ISO8601DateFormatter().string(from: Date())]
        if let restaurant { body["restaurant"] = restaurant }
        let meal: Meal = try await send(jsonRequest("meals", method: "POST", body))
        _ = try await confirmMeal(id: meal.id)
    }

    func schedule() async throws -> DaySchedule { try await send(request("schedule")) }

    // MARK: Accounts

    func login(email: String, password: String) async throws -> AuthResponse {
        try await send(jsonRequest("auth/login", method: "POST", ["email": email, "password": password]))
    }
    func register(inviteCode: String?, name: String, email: String, password: String, claimUserId: String? = nil) async throws -> AuthResponse {
        var body: [String: Any] = ["name": name, "email": email, "password": password]
        if let inviteCode { body["inviteCode"] = inviteCode }
        if let claimUserId { body["claimUserId"] = claimUserId }
        return try await send(jsonRequest("auth/register", method: "POST", body))
    }
    func me() async throws -> AuthUser { try await send(request("auth/me")) }
    func invites() async throws -> [Invite] { try await send(request("auth/invites")) }
    func createInvite() async throws -> Invite { try await send(request("auth/invites", method: "POST")) }

    // MARK: WHOOP

    func whoopConnectURL() async throws -> URL {
        struct R: Decodable { let url: URL }
        let r: R = try await send(request("integrations/whoop/connect"))
        return r.url
    }
    func whoopStatus() async throws -> Bool { try await whoopInfo().connected }
    /// Connection + which WHOOP account is linked + what the last sync brought back.
    func whoopInfo() async throws -> WhoopInfo { try await send(request("integrations/whoop/status")) }
    /// Returns how many WHOOP cycles came back (0 = WHOOP sent nothing for this account).
    @discardableResult
    func whoopSync(from: Date, to: Date) async throws -> Int {
        let f = DateFormatter.isoDay
        struct R: Decodable { let cycles: Int }
        let r: R = try await send(request("integrations/whoop/sync?from=\(f.string(from: from))&to=\(f.string(from: to))", method: "POST"))
        return r.cycles
    }
    func whoopDisconnect() async throws {
        struct R: Decodable { let connected: Bool }
        let _: R = try await send(request("integrations/whoop", method: "DELETE"))
    }

    // MARK: generic helpers (used by feature extensions in other files)

    func get<T: Decodable>(_ path: String) async throws -> T { try await send(request(path)) }
    func post<T: Decodable>(_ path: String, _ body: [String: Any]) async throws -> T { try await send(jsonRequest(path, method: "POST", body)) }
    func delete<T: Decodable>(_ path: String) async throws -> T { try await send(request(path, method: "DELETE")) }

    // MARK: plumbing

    private func request(_ path: String, method: String = "GET") -> URLRequest {
        var req = URLRequest(url: URL(string: path, relativeTo: baseURL.appendingPathComponent("/"))!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(appLang.rawValue, forHTTPHeaderField: "Accept-Language")
        // Owner: server key + user id. Invited users: account token from /auth/login.
        if let apiKey {
            req.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
            req.setValue(devUserId, forHTTPHeaderField: "X-User-Id")
        } else if let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else {
            req.setValue(devUserId, forHTTPHeaderField: "X-User-Id")
        }
        return req
    }

    private func jsonRequest(_ path: String, method: String, _ body: [String: Any]) -> URLRequest {
        var req = request(path, method: method)
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return req
    }

    private func send<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, resp) = try await session.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
            if code == 401 { await MainActor.run { NotificationCenter.default.post(name: .strainEatUnauthorized, object: nil) } }
            throw APIError.http(code, msg ?? String(data: data, encoding: .utf8) ?? "")
        }
        return try decoder.decode(T.self, from: data)
    }
}

extension Notification.Name { static let strainEatUnauthorized = Notification.Name("strainEatUnauthorized") }

struct MultipartForm {
    private let boundary = "StrainEat-\(UUID().uuidString)"
    private var body = Data()
    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func addField(name: String, value: String) {
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
    }
    mutating func addFile(name: String, filename: String, mime: String, data: Data) {
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n".data(using: .utf8)!)
    }
    func finalize() -> Data { body + "--\(boundary)--\r\n".data(using: .utf8)! }
}

extension UIImage {
    /// Claude vision works best ≤ ~1568 px on the long edge; also keeps uploads small.
    func resizedForUpload(maxSide: CGFloat = 1568) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let scale = maxSide / longest
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default(); format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}

struct WhoopInfo: Decodable {
    struct Account: Decodable { let name: String?; let email: String? }
    struct LastSync: Decodable { let at: Date; let cycles: Int; let days: Int; let workouts: Int; let wellness: Int }
    let connected: Bool
    let account: Account?
    let lastSync: LastSync?
}
