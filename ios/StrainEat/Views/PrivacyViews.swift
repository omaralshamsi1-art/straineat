import SwiftUI

// MARK: - Third-party AI consent (App Store 5.1.2(i)) + account deletion (5.1.1(v)) + legal links

/// Asks once, before the first meal photo / description / assistant message goes to the AI provider.
@MainActor @Observable
final class AIConsent {
    static let shared = AIConsent()
    var granted: Bool = UserDefaults.standard.bool(forKey: "aiConsent")
    var asking = false
    @ObservationIgnored private var waiter: CheckedContinuation<Bool, Never>?

    /// true → go ahead; false → the user said "not now".
    func ensure() async -> Bool {
        if granted { return true }
        if UserDefaults.standard.bool(forKey: "screenshotMode") { return true }
        // Already agreed on another device / the web app?
        struct P: Decodable { let aiConsentAt: String? }
        if let p: P = try? await APIClient.shared.get("profile"), p.aiConsentAt != nil { set(true); return true }
        return await withCheckedContinuation { c in
            waiter?.resume(returning: false)
            waiter = c
            asking = true
        }
    }

    func answer(_ yes: Bool) async {
        if yes {
            do {
                try await APIClient.shared.setAIConsent(true)
                set(true)
            } catch {
                // Saving the stamp failed (offline) — still respect the user's yes locally; it syncs next time.
                set(true)
            }
        }
        asking = false
        waiter?.resume(returning: yes)
        waiter = nil
    }

    func withdraw() async throws {
        try await APIClient.shared.setAIConsent(false)
        set(false)
    }

    func sync(from at: String?) { set(at != nil) }

    private func set(_ v: Bool) {
        granted = v
        UserDefaults.standard.set(v, forKey: "aiConsent")
    }
}

struct AIConsentSheet: View {
    @State private var busy = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: "sparkles").font(.system(size: 34, weight: .semibold)).foregroundStyle(Theme.brand2)
                Text(t("We use AI to analyse your meals", "نستخدم الذكاء الاصطناعي لتحليل وجباتك")).font(.title2.weight(.bold))
                Text(t("To estimate calories and nutrition and answer your questions, we send to Google (Gemini API):",
                       "عشان نقدّر السعرات والقيم الغذائية ونرد على أسئلتك، نرسل إلى Google (Gemini API):"))
                VStack(alignment: .leading, spacing: 6) {
                    Label(t("Your meal photo, or its written or spoken description (as text)", "صورة الوجبة أو وصفها المكتوب أو الصوتي (بعد تحويله لنص)"), systemImage: "photo")
                    Label(t("The context needed to answer, such as your targets, today's totals, burn and workouts", "السياق اللازم للإجابة، مثل أهدافك ومجموع يومك وحرقك وتمارينك"), systemImage: "chart.bar")
                }
                .font(.subheadline)
                Text(t("We don't keep the photo after analysis, and we never sell your data or use it for ads. Apple Health data is never used for advertising. You can withdraw consent in Plan › Privacy any time.",
                       "ما نحفظ الصورة بعد التحليل، وما نبيع بياناتك ولا نستخدمها للإعلانات، وبيانات صحة Apple ما تُستخدم لأي إعلان. تقدر تسحب الموافقة من الخطة › الخصوصية أي وقت."))
                    .font(.footnote).foregroundStyle(Theme.muted)
                Text(t("Results are estimates, not medical advice.", "النتائج تقديرية وليست استشارة طبية.")).font(.footnote).foregroundStyle(Theme.muted)
                Link(t("Privacy Policy", "سياسة الخصوصية"), destination: LegalLinks.url("privacy")).font(.footnote.weight(.semibold))
                Button { busy = true; Task { await AIConsent.shared.answer(true); busy = false } } label: {
                    if busy { ProgressView().tint(.white) } else { Text(t("Agree and continue", "موافق، كمّل")) }
                }
                .buttonStyle(PrimaryButtonStyle(color: Theme.brand))
                .disabled(busy)
                Button { Task { await AIConsent.shared.answer(false) } } label: {
                    Text(t("Not now", "مو الحين")).frame(maxWidth: .infinity)
                }
                .padding(.top, 2)
            }
            .padding(22)
        }
        .interactiveDismissDisabled()
        .presentationDetents([.large])
    }
}

enum LegalLinks {
    static func url(_ page: String) -> URL {
        var c = URLComponents(url: APIClient.shared.baseURL.appendingPathComponent(page), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "lang", value: appLang == .ar ? "ar" : "en")]
        return c.url!
    }
}

struct PrivacyCard: View {
    @Environment(AppStore.self) private var store
    var aiConsentAt: String?
    @State private var consent = AIConsent.shared
    @State private var confirmDelete = false
    @State private var typed = ""
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        Card(title: t("Privacy & data", "الخصوصية والبيانات"), icon: "lock.shield") {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t("AI analysis", "التحليل بالذكاء الاصطناعي")).font(.subheadline.weight(.semibold))
                    Text(consent.granted ? t("Allowed", "مسموح") : t("Off", "غير مفعّلة")).font(.caption).foregroundStyle(Theme.muted)
                }
                Spacer()
                Button(consent.granted ? t("Withdraw", "سحب الموافقة") : t("Allow", "السماح")) {
                    Task {
                        if consent.granted {
                            do { try await consent.withdraw(); message = t("Consent withdrawn", "تم سحب الموافقة") } catch { message = error.localizedDescription }
                        } else { _ = await consent.ensure() }
                    }
                }
                .font(.subheadline.weight(.semibold))
            }
            Text(t("StrainEat is a tracking tool, not a substitute for a doctor. Numbers are estimates; check with your doctor before major changes to your diet or activity.",
                   "StrainEat أداة تتبّع وليس بديلاً عن الطبيب. الأرقام تقديرية؛ استشر طبيبك قبل أي تغيير كبير في أكلك أو نشاطك."))
                .font(.caption).foregroundStyle(Theme.muted)
            HStack(spacing: 14) {
                Link(t("Privacy Policy", "سياسة الخصوصية"), destination: LegalLinks.url("privacy"))
                Link(t("Terms", "الشروط"), destination: LegalLinks.url("terms"))
                Link(t("Support", "الدعم"), destination: LegalLinks.url("support"))
            }
            .font(.footnote.weight(.semibold))
            if let message { Text(message).font(.caption).foregroundStyle(Theme.muted) }
            Button(role: .destructive) { typed = ""; confirmDelete = true } label: {
                Text(t("Delete account", "حذف الحساب")).frame(maxWidth: .infinity)
            }
            .disabled(busy)
        }
        .onAppear { if let aiConsentAt { consent.sync(from: aiConsentAt) } }
        .alert(t("Delete your account?", "حذف حسابك؟"), isPresented: $confirmDelete) {
            TextField("DELETE", text: $typed).textInputAutocapitalization(.characters).autocorrectionDisabled()
            Button(t("Delete permanently", "حذف نهائي"), role: .destructive) { Task { await deleteAccount() } }
            Button(t("Cancel", "إلغاء"), role: .cancel) {}
        } message: {
            Text(t("This permanently erases your account and all your meals, weights, water, plan and settings, and disconnects WHOOP and AI apps. Type DELETE to confirm.",
                   "يمسح حسابك وكل وجباتك وأوزانك وماءك وخطتك وإعداداتك نهائياً، ويلغي ربط WHOOP وتطبيقات الذكاء الاصطناعي. اكتب DELETE للتأكيد."))
        }
    }

    private func deleteAccount() async {
        guard typed.trimmingCharacters(in: .whitespaces).uppercased() == "DELETE" else {
            message = t("Type DELETE to confirm", "اكتب DELETE للتأكيد"); return
        }
        busy = true; defer { busy = false }
        do {
            try await APIClient.shared.deleteAccount()
            UserDefaults.standard.set(false, forKey: "aiConsent")
            consent.sync(from: nil)
            store.signOut()
        } catch { message = error.localizedDescription }
    }
}

extension APIClient {
    func setAIConsent(_ on: Bool) async throws {
        struct R: Decodable { let aiConsentAt: String? }
        let _: R = try await put("profile", ["aiConsent": on])
    }
    func deleteAccount() async throws {
        struct R: Decodable { let deleted: Bool }
        let _: R = try await deleteJSON("account", ["confirm": "DELETE"])
    }
}
