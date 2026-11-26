import SwiftUI

// MARK: Models

struct AssistantActionResult: Codable, Hashable {
    var name: String?
    var name_ar: String?
    var kcal: Double?
    var targetKcal: Double?
    var kg: Double?
    var error: String?
}

struct AssistantAction: Codable, Hashable, Identifiable {
    let id: String
    let kind: String
    let summary: String
    var status: String
    var result: AssistantActionResult?
}

struct AssistantMessage: Codable, Hashable, Identifiable {
    var id = UUID()
    let role: String
    let text: String
    var actions: [AssistantAction]?
    var options: [String]?
    enum CodingKeys: String, CodingKey { case role, text, actions, options }
}

private struct AssistantHistory: Codable { let messages: [AssistantMessage] }
private struct AssistantReply: Codable { let message: AssistantMessage }
private struct AssistantActionReply: Codable { let action: AssistantAction }

extension APIClient {
    func assistantHistory() async throws -> [AssistantMessage] {
        let r: AssistantHistory = try await get("assistant/history"); return r.messages
    }
    func assistantChat(_ message: String, screen: String) async throws -> AssistantMessage {
        let r: AssistantReply = try await post("assistant/chat", ["message": message, "screen": screen]); return r.message
    }
    func assistantAction(_ id: String, confirm: Bool) async throws -> AssistantAction {
        let r: AssistantActionReply = try await post("assistant/actions/\(id)/\(confirm ? "confirm" : "dismiss")", [:]); return r.action
    }
    func assistantClear() async throws {
        let _: [String: Bool] = try await delete("assistant/history")
    }
}

// MARK: Floating button

struct AskFab: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "sparkles")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Color(red: 0.11, green: 0.08, blue: 0.03))
                .frame(width: 54, height: 54)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .shadow(color: .black.opacity(0.22), radius: 12, y: 6)
        }
        .accessibilityLabel(t("Ask StrainEat", "اسأل StrainEat"))
    }
}

// MARK: Chat sheet

struct AssistantView: View {
    let screen: String
    var onChanged: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var messages: [AssistantMessage] = []
    @State private var input = ""
    @State private var busy = false
    @State private var working: Set<String> = []
    @State private var error: String?
    @State private var consentModel = AIConsent.shared
    @State private var speech = SpeechInput()
    @FocusState private var focused: Bool

    private var suggestions: [String] {
        [t("Should I log water in Today's meals?", "هل أسجّل الماء في وجبات اليوم؟"),
         t("How was my week vs my target?", "كيف كان أسبوعي مقارنة بهدفي؟"),
         t("How much protein do I have left today?", "كم بروتين بقي لي اليوم؟"),
         t("How do I log a restaurant meal accurately?", "كيف أسجّل وجبة من مطعم بدقة؟"),
         t("What do the numbers on Today mean?", "ماذا تعني الأرقام في شاشة اليوم؟")]
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            if messages.isEmpty { welcome }
                            ForEach(messages) { m in bubble(m).id(m.id) }
                            if !busy, let last = messages.last, last.role != "user", let opts = last.options, !opts.isEmpty {
                                ForEach(opts, id: \.self) { q in chip(q) }
                            }
                            if busy {
                                Text(t("Thinking…", "يفكّر…")).foregroundStyle(Theme.muted)
                                    .padding(12).background(Theme.card, in: RoundedRectangle(cornerRadius: 18)).id("typing")
                            }
                        }
                        .padding(14)
                    }
                    .onChange(of: messages.count) { if let last = messages.last?.id { withAnimation { proxy.scrollTo(last, anchor: .bottom) } } }
                    .onChange(of: busy) { if busy { withAnimation { proxy.scrollTo("typing", anchor: .bottom) } } }
                }
                inputBar
            }
            .screenBackground()
            .navigationTitle(t("Ask StrainEat", "اسأل StrainEat"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("Close", "إغلاق")) { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button(t("Clear", "مسح")) { Task { try? await APIClient.shared.assistantClear(); messages = [] } }
                        .disabled(messages.isEmpty)
                }
            }
            .alert(t("Error", "خطأ"), isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(error ?? "") }
            .task { if let h = try? await APIClient.shared.assistantHistory() { messages = h } }
            .sheet(isPresented: $consentModel.asking) { AIConsentSheet() }
            .onDisappear { speech.stop() }
        }
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(t("Hi! I'm the StrainEat assistant. Ask me how any screen works, or about your eating and progress — I read your data and give personal advice. I can also log a meal or your weight once you confirm.",
                   "أهلاً! أنا مساعد StrainEat. اسألني عن طريقة استخدام أي شاشة، أو عن أكلك وتقدّمك — أقرأ بياناتك وأعطيك نصيحة مخصّصة. أقدر أيضاً أسجّل وجبة أو وزنك بعد تأكيدك."))
                .padding(12).background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
            ForEach(suggestions, id: \.self) { q in chip(q) }
        }
    }

    private func chip(_ q: String) -> some View {
        Button { Task { await send(q) } } label: {
            Text(q).font(.subheadline).multilineTextAlignment(.leading)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Theme.brandSoft, in: Capsule()).overlay(Capsule().stroke(Theme.brand2))
        }
        .foregroundStyle(Theme.ink)
    }

    @ViewBuilder private func bubble(_ m: AssistantMessage) -> some View {
        if m.role == "user" {
            HStack { Spacer(minLength: 40)
                Text(m.text).foregroundStyle(.white).padding(12)
                    .background(Theme.plum, in: RoundedRectangle(cornerRadius: 18))
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text(markdown(m.text)).foregroundStyle(Theme.ink)
                ForEach(m.actions ?? []) { a in actionCard(a, in: m) }
            }
            .padding(12)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 18))
            .padding(.trailing, 30)
        }
    }

    private func markdown(_ s: String) -> AttributedString {
        let lines = s.split(separator: "\n", omittingEmptySubsequences: false).map { line -> String in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") { return "• " + trimmed.dropFirst(2) }
            return String(line)
        }
        let joined = lines.joined(separator: "\n")
        return (try? AttributedString(markdown: joined, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(joined)
    }

    private func kindTitle(_ k: String) -> String {
        switch k {
        case "log_meal": return t("Log meal", "تسجيل وجبة")
        case "log_weight": return t("Log weight", "تسجيل الوزن")
        default: return t("Update plan", "تعديل الخطة")
        }
    }

    @ViewBuilder private func actionCard(_ a: AssistantAction, in m: AssistantMessage) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(kindTitle(a.kind)).font(.caption).foregroundStyle(Theme.muted)
            Text(a.summary).font(.subheadline.weight(.semibold))
            switch a.status {
            case "done":
                Label(doneText(a), systemImage: "checkmark.circle.fill").font(.footnote.weight(.semibold)).foregroundStyle(Theme.good)
            case "dismissed":
                Text(t("Cancelled", "أُلغي")).font(.footnote).foregroundStyle(Theme.muted)
            case "failed":
                Text(t("Couldn't complete", "تعذّر التنفيذ") + (a.result?.error.map { " — \($0)" } ?? "")).font(.footnote).foregroundStyle(Theme.bad)
            default:
                HStack(spacing: 8) {
                    Button { Task { await act(a, confirm: true) } } label: {
                        Text(working.contains(a.id) ? t("Working…", "جارٍ التنفيذ…") : t("Confirm", "تأكيد")).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(Theme.ink).foregroundStyle(Theme.bg)
                    Button { Task { await act(a, confirm: false) } } label: { Text(t("Cancel", "إلغاء")).frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered).tint(Theme.ink)
                }
                .disabled(working.contains(a.id))
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line))
    }

    private func doneText(_ a: AssistantAction) -> String {
        let r = a.result
        switch a.kind {
        case "log_meal":
            let kcal = Int((r?.kcal ?? 0).rounded())
            return t("Added: \(pick(r?.name, r?.name_ar)) · \(kcal) kcal", "تمت الإضافة: \(pick(r?.name, r?.name_ar)) · \(kcal) سعرة")
        case "update_plan":
            let kcal = Int((r?.targetKcal ?? 0).rounded())
            return t("Saved · new target \(kcal) kcal", "تم الحفظ · هدفك الجديد \(kcal) سعرة")
        default: return t("Saved", "تم الحفظ")
        }
    }

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Button {
                if speech.isRecording { speech.stop() } else {
                    let base = input.isEmpty ? "" : input + " "
                    Task { await speech.start { input = base + $0 } }
                }
            } label: {
                Image(systemName: speech.isRecording ? "stop.fill" : "mic.fill")
                    .frame(width: 44, height: 44)
                    .foregroundStyle(speech.isRecording ? .white : Theme.ink)
                    .background(speech.isRecording ? Theme.bad : Theme.card2, in: RoundedRectangle(cornerRadius: 14))
            }
            .accessibilityLabel(t("Speak", "تحدث"))
            TextField(t("Ask anything…", "اكتب سؤالك…"), text: $input, axis: .vertical)
                .lineLimit(1...5)
                .focused($focused)
                .padding(.horizontal, 12).padding(.vertical, 11)
                .background(Theme.card2, in: RoundedRectangle(cornerRadius: 14))
                .onSubmit { Task { await send(input) } }
            Button { Task { await send(input) } } label: {
                Image(systemName: "paperplane.fill")
                    .frame(width: 44, height: 44).foregroundStyle(Theme.bg)
                    .background(Theme.ink, in: Circle())
            }
            .disabled(busy || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel(t("Send", "إرسال"))
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Theme.card)
        .onChange(of: speech.error) { if let e = speech.error { error = e } }
    }

    private func send(_ raw: String) async {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy else { return }
        speech.stop()
        guard await AIConsent.shared.ensure() else { return }
        busy = true; input = ""
        let mine = AssistantMessage(role: "user", text: text)
        messages.append(mine)
        do {
            let reply = try await APIClient.shared.assistantChat(text, screen: screen)
            messages.append(reply)
        } catch {
            messages.removeAll { $0.id == mine.id }
            input = text
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func act(_ a: AssistantAction, confirm: Bool) async {
        working.insert(a.id)
        defer { working.remove(a.id) }
        do {
            let updated = try await APIClient.shared.assistantAction(a.id, confirm: confirm)
            for i in messages.indices {
                if let j = messages[i].actions?.firstIndex(where: { $0.id == a.id }) { messages[i].actions?[j] = updated }
            }
            if updated.status == "done" { onChanged() }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
