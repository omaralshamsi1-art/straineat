import SwiftUI

// MARK: - Private challenge groups (each member scored against their own targets; weight/food never shown)

struct GroupSummary: Codable, Identifiable { let id: String; let name: String; let members: Int; let owner: Bool }
struct GroupMember: Codable, Identifiable { let id: String; let name: String; let color: String; let me: Bool; let owner: Bool }
struct GroupMe: Codable { let name: String; let color: String; let shareMilestones: Bool }
struct GroupInfo: Codable { let id: String; let name: String; let owner: Bool; let code: String; let me: GroupMe; let members: [GroupMember] }
struct BoardDetail: Codable {
    let kind: String
    let ok: Bool?
    let value: Double?
    let target: Double?
    let hit: Int?
    let of: Int?
    let points: Int?
    let max: Int?
}
struct BoardRow: Codable, Identifiable { let rank: Int; let id: String; let name: String; let color: String; let pct: Int; let detail: BoardDetail; let me: Bool }
struct BoardChampion: Codable { let name: String; let pct: Int; let me: Bool }
struct BoardGroup: Codable { let id: String; let name: String; let members: Int; let owner: Bool }
struct Board: Codable { let group: BoardGroup; let tab: String; let period: String; let updatedAt: String; let average: Int?; let champion: BoardChampion?; let rows: [BoardRow]; let me: BoardRow? }
struct FeedItem: Codable, Identifiable { let kind: String; let name: String; let me: Bool; let n: Int; var id: String { "\(kind)-\(name)-\(n)" } }
struct GroupFeed: Codable { let items: [FeedItem] }

extension APIClient {
    func groups() async throws -> [GroupSummary] { try await get("groups") }
    func createGroup(name: String, displayName: String) async throws -> GroupInfo { try await post("groups", ["name": name, "displayName": displayName]) }
    func joinGroup(code: String, displayName: String) async throws -> GroupInfo { try await post("groups/join", ["code": code, "displayName": displayName]) }
    func groupInfo(_ id: String) async throws -> GroupInfo { try await get("groups/\(id)") }
    func board(_ id: String, tab: String, period: String) async throws -> Board { try await get("groups/\(id)/board?tab=\(tab)&period=\(period)") }
    func groupFeed(_ id: String) async throws -> GroupFeed { try await get("groups/\(id)/feed") }
    func updateGroupMe(_ id: String, _ body: [String: Any]) async throws -> GroupInfo { try await patch("groups/\(id)/me", body) }
    func rotateGroupCode(_ id: String) async throws -> GroupInfo { try await post("groups/\(id)/code", [:]) }
    func removeGroupMember(_ id: String, _ member: String) async throws -> GroupInfo { try await delete("groups/\(id)/members/\(member)") }
    func leaveGroup(_ id: String) async throws { struct R: Decodable { let left: Bool }; let _: R = try await post("groups/\(id)/leave", [:]) }
}

private func hexColor(_ s: String) -> Color {
    Color(UIColor(hex: UInt32(s.replacingOccurrences(of: "#", with: ""), radix: 16) ?? 0xB9A7F5))
}

enum ChallengeTab: String, CaseIterable, Identifiable {
    case total, steps, protein, calories, water, strain
    var id: String { rawValue }
    var label: String {
        switch self {
        case .total: t("Total", "المجموع")
        case .steps: t("Steps", "الخطوات")
        case .protein: t("Protein", "البروتين")
        case .calories: t("Calories", "السعرات")
        case .water: t("Water", "الماء")
        case .strain: t("Strain", "الجهد")
        }
    }
}
enum ChallengePeriod: String, CaseIterable, Identifiable {
    case day, week, month
    var id: String { rawValue }
    var label: String { switch self { case .day: t("Today", "اليوم"); case .week: t("Week", "الأسبوع"); case .month: t("Month", "الشهر") } }
}

func boardSub(_ tab: String, _ r: BoardRow) -> String {
    let d = r.detail
    switch d.kind {
    case "points": return t("\(d.points ?? 0) of \(d.max ?? 0) pts", "\(d.points ?? 0) نقطة من \(d.max ?? 0)")
    case "days": return t("\(d.hit ?? 0)/\(d.of ?? 0) days on target", "\(d.hit ?? 0)/\(d.of ?? 0) أيام وصل الهدف")
    case "status": return (d.ok ?? false) ? t("✓ On target", "✓ ضمن الهدف") : t("Not on target yet", "ما وصل الهدف بعد")
    default:
        let v = d.value ?? 0, tg = d.target
        switch tab {
        case "steps": return tg != nil && r.me ? t("\(fmt(v)) of \(fmt(tg!)) steps", "\(fmt(v)) من \(fmt(tg!)) خطوة") : t("\(fmt(v)) steps", "\(fmt(v)) خطوة")
        case "water": return t("\(fmt1(v / 1000)) L", "\(fmt1(v / 1000)) لتر")
        case "protein": return tg != nil ? t("\(fmt(v)) of \(fmt(tg!)) g protein", "\(fmt(v)) من \(fmt(tg!)) غ بروتين") : t("\(fmt(v)) g protein", "\(fmt(v)) غ بروتين")
        case "calories": return tg != nil ? t("\(fmt(v)) of \(fmt(tg!)) kcal", "\(fmt(v)) من \(fmt(tg!)) سعرة") : t("\(fmt(v)) kcal", "\(fmt(v)) سعرة")
        case "strain": return tg != nil ? t("Strain \(fmt1(v)) · your avg \(fmt1(tg!))", "جهد \(fmt1(v)) · معدلك \(fmt1(tg!))") : t("Strain \(fmt1(v))", "جهد \(fmt1(v))")
        default: return ""
        }
    }
}

struct RingAvatar: View {
    let pct: Int; let color: String; let name: String; var size: CGFloat = 52
    var body: some View {
        ZStack {
            Circle().stroke(Theme.card2, lineWidth: 4)
            Circle().trim(from: 0, to: CGFloat(min(max(pct, 0), 100)) / 100)
                .stroke(Theme.brand2, style: StrokeStyle(lineWidth: 4, lineCap: .round)).rotationEffect(.degrees(-90))
            Circle().fill(hexColor(color)).padding(7)
            Text(String(name.prefix(1))).font(.system(size: size * 0.32, weight: .heavy)).foregroundStyle(Color(UIColor(hex: 0x111113)))
        }
        .frame(width: size, height: size)
    }
}

struct BoardRowView: View {
    let tab: String; let r: BoardRow
    var body: some View {
        HStack(spacing: 12) {
            RingAvatar(pct: r.pct, color: r.color, name: r.name)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("\(r.rank). \(r.me ? t("You", "أنت") : r.name)").font(.headline.weight(.heavy)).lineLimit(1)
                    Text(ltr("\(r.pct)%")).font(.headline.weight(.heavy)).foregroundStyle(Theme.brand2)
                }
                Text(boardSub(tab, r)).font(.subheadline).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6).padding(.horizontal, r.me ? 10 : 0)
        .background(r.me ? Theme.brand2.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// Progress-tab card: weekly total for your first group, or a call to action.
struct ChallengeCard: View {
    @State private var groups: [GroupSummary]?
    @State private var board: Board?
    @State private var selected: String? = UserDefaults.standard.string(forKey: "challengeGroup")
    @State private var sheet: ChallengeSheet?
    enum ChallengeSheet: Identifiable { case create, join, board(String); var id: String { switch self { case .create: "c"; case .join: "j"; case .board(let g): "b\(g)" } } }

    var body: some View {
        Card(title: t("Weekly challenge", "تحدي الأسبوع"), icon: "trophy.fill") {
            if let groups, groups.isEmpty {
                Text(t("Private, invite-only groups. Everyone is measured against their own targets — steps, protein, water and consistency. Your weight and food are never shown.",
                       "مجموعات خاصة بدعوة. كل شخص ينقاس على هدفه هو — الخطوات والبروتين والماء والالتزام. وزنك وأكلك ما يظهرون لأحد."))
                    .font(.subheadline).foregroundStyle(Theme.muted)
                HStack {
                    Button(t("New group", "مجموعة جديدة")) { sheet = .create }.buttonStyle(PrimaryButtonStyle())
                    Button(t("Join with a code", "انضم بكود")) { sheet = .join }.buttonStyle(SoftButtonStyle())
                }
            } else if let board {
                if let gs = groups, gs.count > 1 {
                    Picker("", selection: Binding(get: { board.group.id }, set: { selected = $0; UserDefaults.standard.set($0, forKey: "challengeGroup"); Task { await load() } })) {
                        ForEach(gs) { Text($0.name).tag($0.id) }
                    }.pickerStyle(.menu)
                } else {
                    Text(board.group.name).font(.subheadline.weight(.bold)).foregroundStyle(Theme.muted)
                }
                Text(t("Resets every Monday", "يبدأ من جديد كل اثنين") + (board.average.map { t(" · group avg \($0)%", " · متوسط المجموعة \($0)٪") } ?? ""))
                    .font(.footnote).foregroundStyle(Theme.muted)
                ForEach(Array(board.rows.prefix(3)) + ((board.me?.rank ?? 0) > 3 ? [board.me!] : [])) { BoardRowView(tab: "total", r: $0) }
                HStack {
                    Button(t("Open leaderboard", "افتح اللوحة")) { sheet = .board(board.group.id) }.buttonStyle(PrimaryButtonStyle())
                    InviteButton(groupId: board.group.id)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task { await load() }
        .sheet(item: $sheet, onDismiss: { Task { await load() } }) { s in
            switch s {
            case .create: CreateGroupView { id in selected = id; UserDefaults.standard.set(id, forKey: "challengeGroup"); sheet = .board(id) }
            case .join: JoinGroupView { id in selected = id; UserDefaults.standard.set(id, forKey: "challengeGroup"); sheet = .board(id) }
            case .board(let id): GroupBoardView(groupId: id)
            }
        }
    }

    private func load() async {
        guard let gs = try? await APIClient.shared.groups() else { return }
        groups = gs
        guard let id = gs.first(where: { $0.id == selected })?.id ?? gs.first?.id else { board = nil; return }
        board = try? await APIClient.shared.board(id, tab: "total", period: "week")
    }
}

struct InviteButton: View {
    let groupId: String
    @State private var info: GroupInfo?
    var body: some View {
        Group {
            if let info {
                ShareLink(item: inviteText(info)) { Text(t("Invite", "ادعُ شخص")).frame(maxWidth: .infinity) }.buttonStyle(SoftButtonStyle())
            } else {
                Button(t("Invite", "ادعُ شخص")) {}.buttonStyle(SoftButtonStyle()).disabled(true)
            }
        }
        .task { info = try? await APIClient.shared.groupInfo(groupId) }
    }
}

func inviteText(_ g: GroupInfo) -> String {
    let url = "\(APIClient.shared.baseURL.absoluteString)/app/#join=\(g.code)"
    return t("Join my group “\(g.name)” on StrainEat — we compete on sticking to our own goals. Code: \(g.code)\n\(url)",
             "انضم لمجموعتي «\(g.name)» في StrainEat — نتنافس على الالتزام بأهدافنا. الكود: \(g.code)\n\(url)")
}

struct GroupBoardView: View {
    let groupId: String
    @Environment(\.dismiss) private var dismiss
    @State private var tab: ChallengeTab = .total
    @State private var period: ChallengePeriod = .week
    @State private var board: Board?
    @State private var feed: [FeedItem] = []
    @State private var info: GroupInfo?
    @State private var myName = ""
    @State private var share = false
    @State private var message: String?
    @State private var confirmLeave = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(ChallengeTab.allCases) { tb in
                                Button { tab = tb } label: {
                                    Text(tb.label).font(.subheadline.weight(.bold)).foregroundStyle(tab == tb ? Theme.ink : Theme.muted)
                                        .padding(.horizontal, 12).padding(.vertical, 8)
                                        .overlay(alignment: .bottom) { if tab == tb { Rectangle().fill(Theme.brand2).frame(height: 3) } }
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                    Picker("", selection: $period) { ForEach(ChallengePeriod.allCases) { Text($0.label).tag($0) } }.pickerStyle(.segmented)
                    if let b = board {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(t("PERFORMANCE", "الأداء")).font(.caption.weight(.heavy)).foregroundStyle(Theme.brand2)
                                Text(b.average.map { t("Group average \($0)%", "متوسط المجموعة \($0)٪") } ?? "—").font(.footnote).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Text(period.label).font(.footnote.weight(.bold))
                        }
                        if let c = b.champion {
                            Text("🏆 " + (c.me ? t("You lead \(tab.label) — \(c.pct)% of your goal", "أنت الأول في \(tab.label) — \(c.pct)٪ من هدفك")
                                                : t("\(c.name) leads \(tab.label) — \(c.pct)% of target", "\(c.name) الأول في \(tab.label) — \(c.pct)٪ من الهدف")))
                                .font(.subheadline).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                                .background(Theme.brand2.opacity(0.14), in: RoundedRectangle(cornerRadius: 14))
                        }
                        if b.rows.isEmpty {
                            Text(tab == .strain ? t("Strain shows for WHOOP members after a week of data.", "الجهد يظهر لأعضاء WHOOP بعد أسبوع من البيانات.") : t("No data for this period yet.", "ما فيه بيانات بعد لهذي الفترة."))
                                .font(.footnote).foregroundStyle(Theme.muted).frame(maxWidth: .infinity).padding(.vertical, 24)
                        }
                        ForEach(b.rows) { BoardRowView(tab: tab.rawValue, r: $0) }
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
                    }
                    if !feed.isEmpty {
                        Card(title: t("Latest wins", "آخر الإنجازات"), icon: "sparkles") {
                            ForEach(feed) { i in
                                let who = i.me ? t("You", "أنت") : i.name
                                Text(i.kind == "streak" ? t("🔥 \(who) — \(i.n)-day logging streak", "🔥 \(who) — \(i.n) يوم تسجيل متواصل")
                                     : i.kind == "protein" ? t("💪 \(who) — hit protein \(i.n) days this week", "💪 \(who) — وصل هدف البروتين \(i.n) أيام هالأسبوع")
                                     : t("🎉 \(who) — reached \(i.n)% of their weight goal", "🎉 \(who) — وصل \(i.n)٪ من هدف الوزن")).font(.subheadline)
                            }
                        }
                    }
                    if let info { settings(info) }
                    if let message { Text(message).font(.caption).foregroundStyle(Theme.muted) }
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle(board?.group.name ?? info?.name ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("Close", "إغلاق")) { dismiss() } } }
            .task(id: "\(tab.rawValue)|\(period.rawValue)") { await loadBoard() }
            .task { await loadInfo(); feed = (try? await APIClient.shared.groupFeed(groupId))?.items ?? [] }
            .confirmationDialog(t("Leave this group?", "تغادر المجموعة؟"), isPresented: $confirmLeave, titleVisibility: .visible) {
                Button(t("Leave group", "مغادرة المجموعة"), role: .destructive) { Task { try? await APIClient.shared.leaveGroup(groupId); UserDefaults.standard.removeObject(forKey: "challengeGroup"); dismiss() } }
            }
        }
    }

    @ViewBuilder private func settings(_ g: GroupInfo) -> some View {
        Card(title: t("Group", "المجموعة"), icon: "person.3.fill") {
            Text(t("Your name in the group", "اسمك في المجموعة")).font(.footnote).foregroundStyle(Theme.muted)
            HStack {
                TextField("", text: $myName).padding(10).background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
                Button(t("Save", "حفظ")) { Task { info = try? await APIClient.shared.updateGroupMe(groupId, ["displayName": myName]); message = t("Saved ✓", "تم الحفظ ✓") } }
                    .buttonStyle(PrimaryButtonStyle()).frame(width: 90)
            }
            Toggle(isOn: Binding(get: { share }, set: { v in share = v; Task { _ = try? await APIClient.shared.updateGroupMe(groupId, ["shareMilestones": v]) } })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t("Share weight-goal milestones", "شارك مراحل هدف الوزن")).font(.subheadline.weight(.semibold))
                    Text(t("Like “reached 50% of their goal” — never a weight number", "مثل «وصل 50٪ من هدفه» — بدون أي رقم وزن")).font(.caption).foregroundStyle(Theme.muted)
                }
            }
            ShareLink(item: inviteText(g)) { Text(t("Invite someone", "ادعُ شخص")).frame(maxWidth: .infinity) }.buttonStyle(SoftButtonStyle())
            ForEach(g.members) { m in
                HStack {
                    RingAvatar(pct: 100, color: m.color, name: m.name, size: 34)
                    Text(m.me ? t("You", "أنت") : m.name).font(.subheadline.weight(.semibold))
                    if m.owner { Text(t("Owner", "المنشئ")).font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 2).background(Theme.card2, in: Capsule()) }
                    Spacer()
                    if g.owner && !m.me {
                        Button(t("Remove", "إزالة"), role: .destructive) { Task { info = try? await APIClient.shared.removeGroupMember(groupId, m.id) } }.font(.footnote)
                    }
                }
            }
            if g.owner {
                Button(t("New invite link (old one stops working)", "رابط دعوة جديد (يلغي القديم)")) { Task { info = try? await APIClient.shared.rotateGroupCode(groupId); message = t("New link created", "تم إنشاء رابط جديد") } }.font(.footnote)
            }
            Button(t("Leave group", "مغادرة المجموعة"), role: .destructive) { confirmLeave = true }.font(.footnote)
        }
    }

    private func loadBoard() async {
        board = nil
        do { board = try await APIClient.shared.board(groupId, tab: tab.rawValue, period: period.rawValue) } catch { message = error.localizedDescription }
    }
    private func loadInfo() async {
        if let g = try? await APIClient.shared.groupInfo(groupId) { info = g; myName = g.me.name; share = g.me.shareMilestones }
    }
}

struct CreateGroupView: View {
    var onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var me = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section(t("Group name", "اسم المجموعة")) { TextField(t("e.g. SHEEN team", "مثلاً: فريق SHEEN"), text: $name) }
                Section(t("Name members will see", "اسمك اللي يشوفه الأعضاء")) { TextField("", text: $me) }
                Section { Text(t("Members only see your name and your % of your own targets — never your weight or food.", "الأعضاء يشوفون اسمك ونسبتك من أهدافك بس — مب وزنك ولا أكلك.")).font(.footnote).foregroundStyle(Theme.muted) }
                if let error { Text(error).foregroundStyle(Theme.bad) }
            }
            .navigationTitle(t("New group", "مجموعة جديدة"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("Cancel", "إلغاء")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("Create", "إنشاء")) {
                        busy = true
                        Task {
                            do { let g = try await APIClient.shared.createGroup(name: name, displayName: me); onDone(g.id) } catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    }.disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

struct JoinGroupView: View {
    var onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var me = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section(t("Invite code", "كود الدعوة")) { TextField("ABCD2345", text: $code).textInputAutocapitalization(.characters).autocorrectionDisabled() }
                Section(t("Name members will see", "اسمك اللي يشوفه الأعضاء")) { TextField("", text: $me) }
                Section { Text(t("Members only see your name and your % of your own targets — never your weight or food.", "الأعضاء يشوفون اسمك ونسبتك من أهدافك بس — مب وزنك ولا أكلك.")).font(.footnote).foregroundStyle(Theme.muted) }
                if let error { Text(error).foregroundStyle(Theme.bad) }
            }
            .navigationTitle(t("Join a group", "انضم لمجموعة"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("Cancel", "إلغاء")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("Join", "انضمام")) {
                        busy = true
                        Task {
                            do { let g = try await APIClient.shared.joinGroup(code: code, displayName: me); onDone(g.id) } catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    }.disabled(busy || code.count < 6)
                }
            }
        }
    }
}
