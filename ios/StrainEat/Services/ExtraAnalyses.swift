import StoreKit
import SwiftUI

struct CreditsStatus: Decodable {
    let balance: Int
    let freeLeftToday: Int
    let dailyLimit: Int
    let pack: Int
    let productId: String
    let appAccountToken: String
}

private struct RedeemResponse: Decodable { let ok: Bool }

/// Extra AI analyses: a consumable In-App Purchase that the server verifies with Apple before adding credits.
@MainActor @Observable
final class ExtraAnalyses {
    static let shared = ExtraAnalyses()

    var status: CreditsStatus?
    var product: Product?
    var busy = false
    var message: String?
    /// Set by any screen whose analysis hit the daily limit; RootView shows the sheet.
    var offer = false

    private var listener: Task<Void, Never>?

    /// Called once at launch: delivers purchases that finished while the app was closed or interrupted.
    func start() {
        guard listener == nil else { return }
        listener = Task { [weak self] in
            for await result in Transaction.updates { await self?.deliver(result) }
        }
        Task { for await result in Transaction.unfinished { await self.deliver(result) } }
    }

    func refresh() async {
        status = try? await APIClient.shared.get("iap/credits")
        if product == nil, let id = status?.productId {
            product = try? await Product.products(for: [id]).first
        }
    }

    func buy() async {
        await refresh()
        guard let product, let s = status else { message = t("Purchases aren't available right now.", "الشراء غير متاح الآن."); return }
        busy = true; message = nil
        defer { busy = false }
        do {
            var options: Set<Product.PurchaseOption> = []
            if let token = UUID(uuidString: s.appAccountToken) { options.insert(.appAccountToken(token)) }
            switch try await product.purchase(options: options) {
            case let .success(result):
                if await deliver(result) {
                    message = t("Added \(s.pack) analyses ✓", "تمت إضافة \(s.pack) تحليل ✓")
                    offer = false
                }
            case .pending:
                message = t("Waiting for approval — the analyses will be added once it's approved.", "بانتظار الموافقة — بتنضاف التحليلات بعد الموافقة.")
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            message = error.localizedDescription
        }
        await refresh()
    }

    /// Sends a verified transaction to the server, then finishes it. Unfinished ones are retried by StoreKit.
    @discardableResult
    private func deliver(_ result: VerificationResult<Transaction>) async -> Bool {
        guard case let .verified(tx) = result else { message = t("Apple couldn't verify this purchase.", "تعذّر التحقق من الشراء عند Apple."); return false }
        do {
            let _: RedeemResponse = try await APIClient.shared.post("iap/apple", ["transactionId": String(tx.id)])
            await tx.finish()
            await refresh()
            return true
        } catch {
            message = t("The purchase went through, but we couldn't add it yet — it will be retried automatically.", "تم الدفع لكن ما قدرنا نضيف الرصيد للحين — بنعيد المحاولة تلقائياً.")
            return false
        }
    }
}

/// Shown when the day's free analyses are used up.
struct ExtraAnalysesSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var store = ExtraAnalyses.shared

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "sparkles").font(.system(size: 40)).foregroundStyle(Theme.brand2).padding(.top, 28)
            Text(t("You've used today's free analyses", "خلصت تحاليل اليوم المجانية"))
                .font(.title2.bold()).multilineTextAlignment(.center)
            Text(t("They reset tomorrow. Want to keep going now?", "بترجع لك بكرة. تبي تكمّل الحين؟"))
                .foregroundStyle(Theme.muted).multilineTextAlignment(.center)

            VStack(spacing: 6) {
                Text(t("\(store.status?.pack ?? 30) extra analyses", "\(store.status?.pack ?? 30) تحليل إضافي")).font(.title3.weight(.bold))
                Text(t("Used after the daily free ones · never expire", "تُستخدم بعد المجانية · ما تنتهي")).font(.footnote).foregroundStyle(Theme.muted)
                if let b = store.status?.balance, b > 0 {
                    Text(t("You have \(b) left", "عندك \(b) متبقية")).font(.footnote.weight(.semibold)).foregroundStyle(Theme.good)
                }
            }
            .frame(maxWidth: .infinity).padding(18)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))

            Button { Task { await store.buy(); if !store.offer { dismiss() } } } label: {
                if store.busy { ProgressView().tint(Theme.bg) } else {
                    Text(store.product.map { t("Buy for \($0.displayPrice)", "اشترِ بـ \($0.displayPrice)") } ?? t("Buy", "اشترِ"))
                        .font(.headline)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(store.busy || store.product == nil)

            if let m = store.message { Text(m).font(.footnote).foregroundStyle(Theme.muted).multilineTextAlignment(.center) }

            Button(t("Not now", "مو الحين")) { store.offer = false; dismiss() }
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted)
            Text(t("Payment is handled by Apple. Your account can't move the pack to another account.", "الدفع عن طريق Apple. الباقة مرتبطة بحسابك."))
                .font(.caption2).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22)
        .presentationDetents([.medium, .large])
        .task { await store.refresh() }
    }
}

/// Small line for Settings: balance + buy.
struct ExtraAnalysesRow: View {
    @State private var store = ExtraAnalyses.shared
    var body: some View {
        Card(title: t("AI analyses", "تحليلات الذكاء الاصطناعي"), icon: "sparkles") {
            if let s = store.status {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(t("Free today: \(s.freeLeftToday) of \(s.dailyLimit)", "المجانية اليوم: \(s.freeLeftToday) من \(s.dailyLimit)")).font(.subheadline)
                        Text(t("Extra: \(s.balance)", "الإضافية: \(s.balance)")).font(.subheadline.weight(.semibold))
                    }
                    Spacer()
                    Button(t("Buy \(s.pack)", "اشترِ \(s.pack)")) { store.offer = true }
                        .buttonStyle(SoftButtonStyle()).frame(width: 110)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task { await store.refresh() }
    }
}
