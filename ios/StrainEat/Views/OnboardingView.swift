import Charts
import SwiftUI

/// Step-by-step setup: one question per screen, rulers for height/weight, a nutrition report and a forecast.
struct OnboardingView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var existing: Profile? = nil

    enum Step: String { case goal, sex, dob, height, weight, target, diet, health, activity, pace, report, meals }

    @State private var index = 0
    @State private var goal = "lose"
    @State private var sex: String?
    @State private var sexAnswered = false
    @State private var birthDate = Calendar.current.date(byAdding: .year, value: -30, to: Date()) ?? Date()
    @State private var heightCm = 170
    @State private var weightKg = 75.0
    @State private var targetKg = 69.0
    @State private var targetChosen = false
    @State private var diet = "normal"
    @State private var conditions: Set<String> = []
    @State private var pregnant = false
    @State private var edHistory = false
    @State private var activity = "light"
    @State private var pace = "moderate"
    @State private var byDate = false
    @State private var targetDate = Calendar.current.date(byAdding: .month, value: 3, to: Date()) ?? Date()
    @State private var paceCheck: Plan?
    @State private var acked = false
    @State private var meals = 3
    @State private var lbUnits = false
    @State private var ftUnits = false
    @State private var paceOptions: [String: Plan] = [:]
    @State private var report: Plan?
    @State private var phase = 0 // 0 questions, 1 saving, 2 final report
    @State private var saved: Plan?
    @State private var error: String?
    @State private var loaded = false

    private var steps: [Step] {
        let all: [Step] = [.goal, .sex, .dob, .height, .weight, .target, .diet, .health, .activity, .pace, .report, .meals]
        return goal == "maintain" ? all.filter { $0 != .target && $0 != .pace } : all
    }
    private var step: Step { steps[min(index, steps.count - 1)] }

    var body: some View {
        ZStack(alignment: .bottom) {
            Theme.bg.ignoresSafeArea()
            switch phase {
            case 1: savingView
            case 2: finalView
            default: questionView
            }
        }
        .task { prefill() }
        .interactiveDismissDisabled(existing == nil)
    }

    // MARK: Question screens

    private var questionView: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 14) {
                    content
                    if let error { Notice(text: error, level: "danger") }
                }
                .padding(.horizontal, 20).padding(.bottom, 110)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .overlay(alignment: .bottom) {
            Button(action: next) { Text(isLast ? (existing == nil ? t("Start my plan", "ابدأ خطتي") : t("Save changes", "حفظ التعديلات")) : t("Next", "التالي")) }
                .buttonStyle(PillButtonStyle())
                .padding(.horizontal, 24).padding(.bottom, 12)
                .background(LinearGradient(colors: [Theme.bg.opacity(0), Theme.bg], startPoint: .top, endPoint: .center).ignoresSafeArea())
        }
    }

    private var isLast: Bool { index >= steps.count - 1 }

    private var header: some View {
        VStack(spacing: 18) {
            HStack {
                Button {
                    if index > 0 { withAnimation(.snappy) { index -= 1 } } else if existing != nil { dismiss() }
                } label: {
                    Image(systemName: "chevron.backward").font(.headline).foregroundStyle(Theme.ink)
                        .frame(width: 46, height: 46).background(Theme.card, in: Circle())
                        .shadow(color: .black.opacity(0.06), radius: 8, y: 3)
                }
                .opacity(index == 0 && existing == nil ? 0 : 1)
                Spacer()
                (Text("\(index + 1)").foregroundColor(Theme.ink) + Text("/\(steps.count)").foregroundColor(Theme.muted))
                    .font(.headline).monospacedDigit()
                    .environment(\.layoutDirection, .leftToRight)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.line)
                    Capsule().fill(Theme.brand2).frame(width: g.size.width * CGFloat(index + 1) / CGFloat(steps.count))
                }
            }
            .frame(height: 7)
            .animation(.easeOut, value: index)
        }
        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 18)
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .goal:
            title(t("What's your goal?", "ما هدفك؟"), t("We'll build a safe, realistic daily plan for your goal.", "نبني لك خطة يومية آمنة وواقعية بحسب هدفك."))
            option("📉", t("Lose weight", "إنقاص الوزن"), t("Moderate deficit + high protein to keep muscle", "عجز معتدل + بروتين عالٍ للحفاظ على العضل"), goal == "lose") { goal = "lose"; targetChosen = false }
            option("⚖️", t("Maintain my weight", "المحافظة على وزني"), t("Balanced eating that matches your burn", "أكل متوازن يطابق حرقك"), goal == "maintain") { goal = "maintain" }
            option("💪", t("Gain weight (muscle)", "زيادة الوزن (عضل)"), t("A small surplus focused on muscle, not fat", "فائض صغير يركّز على بناء العضل لا الدهون"), goal == "gain") { goal = "gain"; targetChosen = false }
        case .sex:
            title(t("What's your sex?", "ما جنسك؟"), t("It changes how your base burn is calculated.", "يغيّر طريقة حساب حرقك الأساسي."))
            option("👨", t("Male", "ذكر"), nil, sex == "male") { sex = "male"; sexAnswered = true }
            option("👩", t("Female", "أنثى"), nil, sex == "female") { sex = "female"; sexAnswered = true }
            option("🙂", t("Prefer not to say", "أفضّل عدم الذكر"), t("We'll use an average estimate", "نستخدم متوسطاً تقديرياً"), sex == nil && sexAnswered) { sex = nil; sexAnswered = true }
        case .dob:
            title(t("What's your date of birth?", "ما تاريخ ميلادك؟"), nil)
            DatePicker("", selection: $birthDate, in: dobRange, displayedComponents: .date)
                .datePickerStyle(.wheel).labelsHidden()
                .environment(\.locale, appLocale)
                .frame(maxWidth: .infinity)
        case .height:
            title(t("How tall are you?", "كم طولك؟"), nil)
            UnitToggle(left: t("cm", "سم"), right: "ft", isRight: $ftUnits)
            HStack(spacing: 18) {
                VerticalRuler(value: $heightCm, range: 100...230, label: { ftUnits ? feet(Double($0)) : "\($0)" })
                    .frame(width: 150, height: 360)
                VStack {
                    (Text(ftUnits ? feet(Double(heightCm)) : "\(heightCm)").font(.system(size: 40, weight: .heavy, design: .rounded))
                     + Text(ftUnits ? "" : " " + t("cm", "سم")).font(.headline).foregroundColor(Theme.brand2))
                        .monospacedDigit()
                }
                .frame(maxWidth: .infinity).padding(.vertical, 24)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 22))
            }
            .environment(\.layoutDirection, .leftToRight)
        case .weight, .target:
            let isTarget = step == .target
            title(isTarget ? (goal == "lose" ? t("What's your target weight?", "ما وزنك المستهدف؟") : t("What weight do you want to reach?", "ما الوزن الذي تريد الوصول إليه؟"))
                  : t("What's your current weight?", "كم وزنك الحالي؟"), nil)
            UnitToggle(left: t("kg", "كغ"), right: "lb", isRight: $lbUnits)
            let kg = isTarget ? targetKg : weightKg
            (Text(weightText(kg)).font(.system(size: 64, weight: .heavy, design: .rounded))
             + Text(" " + (lbUnits ? "lb" : t("kg", "كغ"))).font(.title3.bold()).foregroundColor(Theme.brand2))
                .monospacedDigit().environment(\.layoutDirection, .leftToRight)
            if isTarget, abs(targetKg - weightKg) >= 0.1 {
                Text("\(targetKg < weightKg ? "↓" : "↑") \(weightText(abs(targetKg - weightKg))) \(lbUnits ? "lb" : t("kg", "كغ"))")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted)
            }
            HorizontalRuler(value: isTarget ? $targetKg : $weightKg, range: 30...220, label: { lbUnits ? "\(Int((Double($0) * 2.20462).rounded()))" : "\($0)" })
                .frame(height: 110)
                .onChange(of: targetKg) { _, _ in if isTarget { targetChosen = true } }
            bmiRow(kg: kg, target: isTarget)
        case .diet:
            title(t("What's your usual eating style?", "ما نمط أكلك المعتاد؟"), t("We'll suggest meals and swaps that fit it.", "نقترح وجبات وبدائل تناسبه."))
            ForEach(dietOptions, id: \.0) { o in option(o.1, o.2, o.3, diet == o.0) { diet = o.0 } }
        case .health:
            title(t("Any health conditions?", "هل لديك أي حالة صحية؟"),
                  t("Optional and never shown to anyone — it helps us suggest what suits you. You can pick more than one.", "اختياري ولا يظهر لأحد — يساعدنا على اقتراح ما يناسبك. يمكنك اختيار أكثر من حالة."))
            option("👍", t("None of these", "لا شيء مما يلي"), nil, conditions.isEmpty && !pregnant && !edHistory) { conditions = []; pregnant = false; edHistory = false }
            ForEach(conditionOptions, id: \.0) { o in
                option(o.1, o.2, nil, conditions.contains(o.0)) { if conditions.contains(o.0) { conditions.remove(o.0) } else { conditions.insert(o.0) } }
            }
            option("🤰", t("Pregnant or breastfeeding", "حامل أو مرضعة"), t("We won't set a calorie deficit", "لن نضع عجزاً في السعرات"), pregnant) { pregnant.toggle() }
            option("🫶", t("I've struggled with eating or dieting", "مررت بصعوبات مع الأكل أو الحميات"), t("We won't show a weight-loss target", "لن نعرض هدف إنقاص"), edHistory) { edHistory.toggle() }
            Text(t("This app is a tracking tool, not a substitute for a doctor or dietitian.", "التطبيق أداة للمتابعة وليس بديلاً عن الطبيب أو أخصائي التغذية."))
                .font(.caption).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
        case .activity:
            title(t("What's your activity level?", "ما مستوى نشاطك؟"), t("If you connect your watch, we correct this automatically after 7 days of data.", "إذا ربطت ساعتك نصحّح هذا تلقائياً بعد 7 أيام من القياسات."))
            ForEach(activityOptions, id: \.0) { o in option(o.1, o.2, o.3, activity == o.0) { activity = o.0 } }
        case .pace:
            title(t("Choose your pace", "اختر سرعة تقدمك"), t("Every option stays within your safe limits.", "كل الخيارات ضمن الحدود الآمنة لك."))
            ForEach(paceList, id: \.0) { p in
                let plan = paceOptions[p.0]
                if p.0 == "intense" && plan?.intense != true {
                    let why = plan?.notices.first { $0.code == "intense_unavailable" }?.text
                    option(p.1, t("Intense", "مكثّف"), why ?? t("Not available for you", "غير متاح لك"), false) {}
                        .disabled(true).opacity(0.55)
                } else {
                    option(p.1, (p.0 == "intense" ? t("Intense · ", "مكثّف · ") : "") + (plan?.weeksToGoal.map { t("\(fmt($0)) weeks", "\(fmt($0)) أسبوعاً") } ?? paceName(p.0)),
                           plan.map(paceLine), !byDate && pace == p.0) { byDate = false; pace = p.0 }
                }
            }
            option("📅", t("I want to get there by a date", "أبي أوصل بتاريخ محدد"), t("We work out the pace you need", "نحسب لك السرعة المطلوبة"), byDate) { byDate = true }
            if byDate {
                DatePicker(t("Date to reach your goal", "تاريخ الوصول للهدف"), selection: $targetDate,
                           in: (Calendar.current.date(byAdding: .day, value: 14, to: Date()) ?? Date())...(Calendar.current.date(byAdding: .year, value: 3, to: Date()) ?? Date()),
                           displayedComponents: .date)
                    .environment(\.locale, appLocale).padding(.horizontal, 6)
            }
            if let c = paceCheck {
                if byDate { Notice(text: paceLine(c), level: "info") }
                ForEach(c.notices.filter { ["deadline_ok", "deadline_unrealistic", "deadline_close", "intense", "floor"].contains($0.code ?? "") }, id: \.self) { Notice(text: $0.text, level: $0.level) }
                if c.intense == true, let adv = c.advice, !adv.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(t("Before you start intense loss:", "قبل ما تبدأ النزول المكثّف:")).font(.subheadline.weight(.bold))
                        ForEach(adv, id: \.self) { a in
                            HStack(alignment: .top, spacing: 6) { Text("•"); Text(a.text).fixedSize(horizontal: false, vertical: true) }.font(.subheadline)
                        }
                        Toggle(t("I've read the advice and want to continue", "قرأت النصائح وأبي أكمل"), isOn: $acked)
                            .font(.subheadline.weight(.bold)).tint(Theme.brand).padding(.top, 4)
                    }
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.warn.opacity(0.18), in: RoundedRectangle(cornerRadius: 18))
                }
            }
            Color.clear.frame(height: 1)
                .task(id: "pace-\(goal)-\(weightKg)-\(targetKg)-\(activity)") { await loadPaces() }
                .task(id: "check-\(pace)-\(byDate)-\(DateFormatter.isoDay.string(from: targetDate))-\(weightKg)-\(targetKg)") { acked = false; await checkPace() }
        case .report:
            title(t("Your nutrition report", "تقرير التغذية حسب إجاباتك"), nil)
            if let p = report { reportCard(p) } else { ProgressView().padding(40) }
            Color.clear.frame(height: 1).task(id: "report-\(pace)-\(goal)-\(weightKg)-\(diet)") { await loadReport() }
        case .meals:
            title(t("How many meals do you usually eat a day?", "كم وجبة تأكل عادةً في اليوم؟"), t("We use it to split your calories and remind you at meal times.", "نستخدمها لتقسيم سعراتك ولتذكيرك في أوقات وجباتك."))
            option("1️⃣", t("One meal a day", "وجبة واحدة يومياً"), nil, meals == 1) { meals = 1 }
            option("2️⃣", t("Two meals a day", "وجبتان يومياً"), nil, meals == 2) { meals = 2 }
            option("3️⃣", t("Three meals a day", "ثلاث وجبات يومياً"), nil, meals == 3) { meals = 3 }
            option("➕", t("More than three meals", "أكثر من ثلاث وجبات"), nil, meals >= 4) { meals = 4 }
        }
    }

    // MARK: Saving & final report

    private var savingView: some View {
        VStack(spacing: 24) {
            ZStack {
                Circle().stroke(Theme.line, lineWidth: 16)
                Circle().trim(from: 0, to: 0.75).stroke(Theme.brand2, style: StrokeStyle(lineWidth: 16, lineCap: .round))
                    .rotationEffect(.degrees(saving ? 360 : 0))
                    .animation(.linear(duration: 1).repeatForever(autoreverses: false), value: saving)
                Image(systemName: "chart.bar.fill").font(.system(size: 38)).foregroundStyle(Theme.brand2)
            }
            .frame(width: 150, height: 150)
            .onAppear { saving = true }
            Text(t("Preparing your plan", "نجهّز خطتك")).font(.title.bold())
            Text(t("Setting up your nutrition plan and analysing your goal…", "نضبط خطتك الغذائية ونحلّل هدفك…"))
                .foregroundStyle(Theme.muted).multilineTextAlignment(.center)
        }
        .padding(40).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    @State private var saving = false

    private var finalView: some View {
        ScrollView {
            VStack(spacing: 16) {
                Text(t("Your health report is ready", "تقريرك الصحي جاهز")).font(.title.bold()).padding(.top, 24)
                if let p = saved {
                    forecastCard(p)
                    Text(t("Your daily target", "هدفك اليومي")).font(.title2.bold())
                    VStack(alignment: .leading, spacing: 8) {
                        Text(t("Your recommended daily calories", "السعرات اليومية الموصى بها لك")).foregroundStyle(Theme.muted)
                        (Text(fmt(p.targetKcal)).font(.system(size: 46, weight: .heavy, design: .rounded)).foregroundColor(Theme.brand2)
                         + Text(" " + t("kcal", "سعرة")).font(.headline).foregroundColor(Theme.muted))
                        Text(t("Protein \(fmt(p.proteinG)) g · Carbs \(fmt(p.carbsG)) g · Fat \(fmt(p.fatG)) g", "بروتين \(fmt(p.proteinG)) غ · كربوهيدرات \(fmt(p.carbsG)) غ · دهون \(fmt(p.fatG)) غ"))
                            .font(.footnote).foregroundStyle(Theme.muted)
                        Divider()
                        HStack {
                            summary(t("Sex", "الجنس"), sex == "male" ? t("Male", "ذكر") : sex == "female" ? t("Female", "أنثى") : "—")
                            summary(t("Age", "العمر"), p.ageYears.map { "\($0)" } ?? "—")
                            summary(t("Height", "الطول"), "\(heightCm) " + t("cm", "سم"))
                        }
                    }
                    .padding(20).background(Theme.card, in: RoundedRectangle(cornerRadius: 24))
                    ForEach(p.notices, id: \.self) { Notice(text: $0.text, level: $0.level) }
                    IntenseAdvice(plan: p)
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 110)
        }
        .overlay(alignment: .bottom) {
            Button(t("Get started", "ابدأ الآن")) { store.needsOnboarding = false; Task { await store.refresh() }; dismiss() }
                .buttonStyle(PillButtonStyle()).padding(.horizontal, 24).padding(.bottom, 12)
        }
    }

    private func forecastCard(_ p: Plan) -> some View {
        let start = weightKg, end = goal == "maintain" ? weightKg : (p.targetWeightKg ?? targetKg)
        let weeks = max(4.0, p.weeksToGoal ?? 12)
        let pts: [(Double, Double)] = (0...20).map { k in
            let f = Double(k) / 20, e = 1 - pow(1 - min(1, f / 0.8), 2)
            return (f * weeks * 1.15, start + (end - start) * e)
        }
        let eta = p.etaDate.flatMap { DateFormatter.isoDay.date(from: $0) }
        return VStack(alignment: .leading, spacing: 8) {
            Chart {
                ForEach(Array(pts.enumerated()), id: \.offset) { _, pt in
                    LineMark(x: .value("w", pt.0), y: .value("kg", pt.1))
                        .interpolationMethod(.catmullRom).lineStyle(StrokeStyle(lineWidth: 5, lineCap: .round)).foregroundStyle(Theme.brand2)
                }
                PointMark(x: .value("w", 0.0), y: .value("kg", start)).symbolSize(500).foregroundStyle(Theme.accent)
                    .annotation(position: .overlay) { Text(fmt1(start)).font(.caption2.bold()).foregroundStyle(.white) }
                PointMark(x: .value("w", weeks), y: .value("kg", end)).symbolSize(120).foregroundStyle(Theme.brand2)
                    .annotation(position: .top) { Text("\(fmt1(end)) " + t("kg", "كغ")).font(.caption.bold()).foregroundStyle(Theme.brand2) }
            }
            .chartXAxis(.hidden).chartYAxis(.hidden)
            .chartYScale(domain: (min(start, end) - 3)...(max(start, end) + 3))
            .frame(height: 170)
            HStack {
                Text(t("Today", "اليوم")).foregroundStyle(Theme.muted)
                Spacer()
                if let eta { Text(eta.formatted(.dateTime.day().month(.abbreviated).year().locale(appLocale))).bold() }
            }
            .font(.footnote)
        }
        .padding(20).background(Theme.card, in: RoundedRectangle(cornerRadius: 24))
        .environment(\.layoutDirection, .leftToRight)
    }

    private func summary(_ k: String, _ v: String) -> some View {
        VStack(spacing: 3) { Text(k).font(.caption).foregroundStyle(Theme.muted); Text(v).font(.headline).monospacedDigit() }
            .frame(maxWidth: .infinity)
    }

    // MARK: Pieces

    private func title(_ heading: String, _ sub: String?) -> some View {
        VStack(spacing: 6) {
            Text(heading).font(.system(size: 26, weight: .heavy)).multilineTextAlignment(.center)
            if let sub { Text(sub).font(.subheadline).foregroundStyle(Theme.muted).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity).padding(.bottom, 8)
    }

    private func option(_ icon: String, _ heading: String, _ sub: String?, _ on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Text(icon).font(.system(size: 26)).frame(width: 50, height: 50).background(Theme.brandSoft, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(heading).font(.headline).foregroundStyle(Theme.ink)
                    if let sub { Text(sub).font(.footnote).foregroundStyle(Theme.muted) }
                }
                Spacer(minLength: 0)
                ZStack {
                    Circle().stroke(on ? Theme.brand2 : Theme.line, lineWidth: 2).frame(width: 24, height: 24)
                    if on { Circle().fill(Theme.brand2).frame(width: 24, height: 24); Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(Theme.bg) }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(on ? Theme.brandSoft.opacity(0.5) : Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(on ? Theme.brand2 : Theme.line, lineWidth: 1.5))
            .overlay(alignment: .leading) { if on { Capsule().fill(Theme.brand2).frame(width: 4).padding(.vertical, 14) } }
        }
        .buttonStyle(.plain)
    }

    private func bmiRow(kg: Double, target: Bool) -> some View {
        let h = Double(heightCm) / 100
        let bmi = h > 0 ? kg / (h * h) : 0
        let color = bmi < 18.5 ? Theme.warn : bmi < 25 ? Theme.good : bmi < 30 ? Theme.warn : Theme.bad
        let msg: String
        if target {
            if bmi < 18.5 { msg = t("This target is below a healthy weight — we recommend a higher one.", "هذا الهدف أقل من الوزن الصحي — ننصح بهدف أعلى.") }
            else if goal == "lose" && bmi < 25 { msg = t("A great target within a healthy weight — gradual loss makes a big difference.", "هدف ممتاز ضمن الوزن الصحي — خسارة تدريجية تصنع فرقاً كبيراً.") }
            else if goal == "lose" { msg = t("Great step — even losing 5–10% of your weight clearly improves your health.", "خطوة رائعة — حتى خسارة 5–10٪ من وزنك تحسّن صحتك بوضوح.") }
            else { msg = t("A gradual gain with resistance training builds muscle, not fat.", "زيادة تدريجية مع تمارين المقاومة تبني العضل لا الدهون.") }
        } else {
            msg = bmi < 18.5 ? t("Your BMI is below normal — we'll focus on eating enough.", "مؤشرك أقل من الطبيعي — سنركّز على تغذية كافية.")
                : bmi < 25 ? t("Your BMI is in the normal range — well done!", "مؤشرك ضمن الطبيعي — أحسنت!")
                : bmi < 30 ? t("Your BMI is a little above normal — small daily changes help.", "مؤشرك أعلى من الطبيعي قليلاً — تعديلات يومية بسيطة تفيد.")
                : t("Your BMI is high — a gradual, safe plan will help.", "مؤشرك مرتفع — خطة تدريجية آمنة ستساعدك.")
        }
        return HStack(spacing: 16) {
            VStack(spacing: 4) {
                Text(fmt1(bmi)).font(.system(size: 38, weight: .heavy, design: .rounded)).foregroundStyle(color).monospacedDigit()
                Text(t("BMI", "مؤشر كتلة الجسم")).font(.caption).foregroundStyle(Theme.muted)
            }
            Divider().frame(height: 60)
            Text(msg).font(.subheadline).foregroundStyle(Theme.muted)
            Spacer(minLength: 0)
        }
        .padding(.top, 16)
    }

    private func reportCard(_ p: Plan) -> some View {
        let pr = p.proteinG * 4, cb = p.carbsG * 4, ft = p.fatG * 9, tot = max(1, pr + cb + ft)
        let rows: [(String, Double, Double, Color)] = [(t("Carbs", "كربوهيدرات"), cb, p.carbsG, Theme.carbs), (t("Protein", "بروتين"), pr, p.proteinG, Theme.protein), (t("Fat", "دهون"), ft, p.fatG, Theme.fat)]
        return VStack(alignment: .leading, spacing: 10) {
            Text(t("Your daily calorie target", "هدفك اليومي من السعرات")).foregroundStyle(Theme.muted)
            (Text(fmt(p.targetKcal)).font(.system(size: 46, weight: .heavy, design: .rounded)) + Text(" " + t("kcal/day", "سعرة/يوم")).font(.headline).foregroundColor(Theme.muted))
            if let bmr = p.bmr {
                Text(t("Base burn (BMR): \(fmt(bmr)) kcal · daily burn: \(fmt(p.maintenanceKcal)) kcal", "حرقك الأساسي (BMR): \(fmt(bmr)) سعرة · حرقك اليومي: \(fmt(p.maintenanceKcal)) سعرة"))
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
            GeometryReader { g in
                HStack(spacing: 0) { ForEach(rows, id: \.0) { r in r.3.frame(width: g.size.width * r.1 / tot) } }
                    .clipShape(Capsule())
            }
            .frame(height: 14).padding(.vertical, 8)
            ForEach(rows, id: \.0) { r in
                HStack {
                    Circle().fill(r.3).frame(width: 12, height: 12)
                    Text(r.0)
                    Spacer()
                    Text("\(Int((r.1 / tot * 100).rounded()))%").font(.title3.bold()).monospacedDigit()
                    Text("\(fmt(r.2)) " + t("g", "غ")).foregroundStyle(Theme.muted).frame(width: 64, alignment: .trailing).monospacedDigit()
                }
                Divider()
            }
            HStack { Circle().fill(Theme.fiber).frame(width: 12, height: 12); Text(t("Fibre", "ألياف")); Spacer(); Text("\(fmt(p.fiberG)) " + t("g", "غ")).foregroundStyle(Theme.muted) }
            ForEach(p.notices, id: \.self) { Notice(text: $0.text, level: $0.level) }
                    IntenseAdvice(plan: p)
        }
        .padding(20).background(Theme.card, in: RoundedRectangle(cornerRadius: 24))
    }

    // MARK: Options

    private var dietOptions: [(String, String, String, String?)] {
        [("normal", "🍽️", t("Normal", "عادي"), t("No special dietary restrictions", "بدون قيود غذائية خاصة")), ("vegetarian", "🥕", t("Vegetarian", "نباتي"), nil),
         ("vegan", "🥦", t("Vegan", "نباتي صرف"), nil), ("keto", "🥑", t("Keto", "كيتو"), nil), ("low_carb", "🥩", t("Low-carb", "قليل الكربوهيدرات"), nil),
         ("mediterranean", "🫒", t("Mediterranean", "حمية البحر المتوسط"), nil), ("paleo", "🍗", t("Paleo", "باليو"), nil), ("light", "🥗", t("Light eating", "أكل خفيف"), nil)]
    }
    private var conditionOptions: [(String, String, String)] {
        [("hypertension", "💓", t("High blood pressure", "ارتفاع ضغط الدم")), ("high_cholesterol", "🧈", t("High cholesterol", "ارتفاع الكوليسترول")),
         ("obesity", "⚖️", t("Obesity", "السمنة")), ("kidney", "🫘", t("Kidney disease", "أمراض الكلى")), ("heart", "❤️", t("Heart disease", "أمراض القلب")),
         ("thyroid", "🦋", t("Thyroid condition", "الغدة الدرقية")), ("diabetes", "🩸", t("Diabetes", "السكري"))]
    }
    private var activityOptions: [(String, String, String, String)] {
        [("sedentary", "🪑", t("Sedentary", "قليل الحركة"), t("Most of my day is spent sitting or at a desk", "أغلب يومي جالس أو على المكتب")),
         ("light", "🚶", t("Lightly active", "نشاط خفيف"), t("Walking or exercise 1–3 times a week", "مشي أو تمرين 1–3 مرات أسبوعياً")),
         ("moderate", "🏃", t("Moderately active", "نشاط متوسط"), t("Exercise 3–5 times a week", "تمرين 3–5 مرات أسبوعياً")),
         ("active", "🏋️", t("Active", "نشيط"), t("Exercise 6–7 days", "تمرين 6–7 أيام")),
         ("very_active", "⚡", t("Very active", "نشيط جداً"), t("Hard training or physical work", "تمارين قوية أو عمل بدني"))]
    }
    private func paceName(_ p: String) -> String {
        ["relaxed": t("Relaxed", "مريحة"), "moderate": t("Moderate", "متوسطة"), "fast": t("Faster", "أسرع"), "intense": t("Intense", "مكثّف")][p] ?? p
    }
    private var paceList: [(String, String)] {
        [("relaxed", "🐢"), ("moderate", "🚶"), ("fast", "🚀")] + (goal == "lose" ? [("intense", "🔥")] : [])
    }
    private func paceLine(_ pl: Plan) -> String {
        let w = abs(pl.weeklyChangeKg ?? 0)
        return t("\(fmt1(w)) kg per week · \(fmt(pl.targetKcal)) kcal per day", "\(fmt1(w)) كغ أسبوعياً · \(fmt(pl.targetKcal)) سعرة يومياً")
    }

    private var dobRange: ClosedRange<Date> {
        let c = Calendar.current
        return (c.date(byAdding: .year, value: -100, to: Date()) ?? Date())...(c.date(byAdding: .year, value: -13, to: Date()) ?? Date())
    }
    private func weightText(_ kg: Double) -> String { fmt1(lbUnits ? kg * 2.20462 : kg) }
    private func feet(_ cm: Double) -> String { let i = cm / 2.54; let f = Int(i / 12); return "\(f)′\(Int((i - Double(f) * 12).rounded()))″" }

    // MARK: Logic

    private func patch() -> [String: Any] {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: birthDate)
        var p: [String: Any] = [
            "goal": goal, "activityLevel": activity, "pace": pace, "dietStyle": diet, "conditions": Array(conditions).sorted(), "mealsPerDay": meals,
            "birthDate": String(format: "%04d-%02d-%02d", c.year ?? 1990, c.month ?? 1, c.day ?? 1),
            "heightCm": heightCm, "timezone": TimeZone.current.identifier,
            "screening": ["pregnant": pregnant, "breastfeeding": false, "medicalSupervision": false, "edHistory": edHistory] as [String: Any],
        ]
        p["sex"] = sex ?? NSNull()
        p["targetWeightKg"] = goal == "maintain" ? NSNull() as Any : (targetKg * 10).rounded() / 10 as Any
        p["targetDate"] = goal != "maintain" && byDate ? DateFormatter.isoDay.string(from: targetDate) as Any : NSNull() as Any
        return p
    }
    private func previewPatch(pace override: String? = nil) -> [String: Any] {
        var p = patch(); p["weightKg"] = (weightKg * 10).rounded() / 10
        if let override { p["pace"] = override; p["targetDate"] = NSNull() }
        return p
    }

    private func loadPaces() async {
        var out: [String: Plan] = [:]
        for p in paceList.map(\.0) { if let plan = try? await APIClient.shared.planPreview(previewPatch(pace: p)) { out[p] = plan } }
        paceOptions = out
    }
    private func checkPace() async {
        paceCheck = try? await APIClient.shared.planPreview(previewPatch())
    }
    private func loadReport() async {
        report = nil
        do { report = try await APIClient.shared.planPreview(previewPatch()) } catch { self.error = error.localizedDescription }
    }

    private func next() {
        error = nil
        if step == .sex && !sexAnswered && sex == nil { error = t("Pick an answer to continue", "اختر إجابة للمتابعة"); return }
        if step == .weight {
            let fits = goal == "lose" ? targetKg < weightKg : goal == "gain" ? targetKg > weightKg : true
            if !targetChosen || !fits { targetKg = ((weightKg * (goal == "gain" ? 1.06 : 0.92)) * 2).rounded() / 2 }
        }
        if step == .target {
            if goal == "lose" && targetKg >= weightKg { error = t("Your target weight should be below your current weight", "الوزن المستهدف يجب أن يكون أقل من وزنك الحالي"); return }
            if goal == "gain" && targetKg <= weightKg { error = t("Your target weight should be above your current weight", "الوزن المستهدف يجب أن يكون أعلى من وزنك الحالي"); return }
        }
        if step == .pace, paceCheck?.intense == true, !acked {
            error = t("Read the advice and confirm to continue", "اقرأ النصائح وأكّد قبل المتابعة"); return
        }
        if !isLast { withAnimation(.snappy) { index += 1 }; return }
        Task { await finish() }
    }

    private func finish() async {
        withAnimation { phase = 1 }
        do {
            var body = patch()
            body["onboarded"] = true
            let started = Date()
            try await APIClient.shared.updateProfile(body)
            try await APIClient.shared.addWeight((weightKg * 10).rounded() / 10)
            let plan = try await APIClient.shared.plan()
            let left = 1.8 - Date().timeIntervalSince(started)
            if left > 0 { try? await Task.sleep(nanoseconds: UInt64(left * 1_000_000_000)) }
            saved = plan
            withAnimation { phase = 2 }
        } catch {
            self.error = error.localizedDescription
            withAnimation { phase = 0 }
        }
    }

    private func prefill() {
        guard !loaded else { return }
        loaded = true
        Task {
            let p: Profile?
            if let existing { p = existing } else { p = try? await APIClient.shared.profile() }
            guard let p else { return }
            if p.onboarded == true { goal = p.goal }
            sex = p.sex; sexAnswered = p.onboarded == true
            if let s = p.birthDate, let d = DateFormatter.isoDay.date(from: s) { birthDate = d }
            else if let y = p.birthYear, let d = Calendar.current.date(from: DateComponents(year: y, month: 1, day: 1)) { birthDate = d }
            if let h = p.heightCm { heightCm = Int(h.rounded()) }
            if let w = p.weightKg { weightKg = (w * 10).rounded() / 10 }
            if let tw = p.targetWeightKg { targetKg = tw; targetChosen = true } else { targetKg = (weightKg * 0.92).rounded() }
            activity = p.activityLevel
            pace = p.pace ?? "moderate"
            if let td = p.targetDate, let d = DateFormatter.isoDay.date(from: td) { byDate = true; targetDate = d }
            diet = p.dietStyle ?? "normal"
            conditions = Set(p.conditions ?? [])
            meals = p.mealsPerDay ?? 3
            pregnant = p.screening?.pregnant ?? false
            edHistory = p.screening?.edHistory ?? false
        }
    }
}

// MARK: - Reusable controls

struct PillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title3.weight(.bold))
            .frame(maxWidth: .infinity).padding(.vertical, 17)
            .foregroundStyle(Theme.bg)
            .background(Theme.brand.opacity(configuration.isPressed ? 0.8 : 1), in: Capsule())
    }
}

struct UnitToggle: View {
    let left: String
    let right: String
    @Binding var isRight: Bool
    var body: some View {
        HStack(spacing: 4) {
            seg(left, !isRight) { isRight = false }
            seg(right, isRight) { isRight = true }
        }
        .padding(4).frame(width: 210)
        .background(Theme.card, in: Capsule())
        .overlay(Capsule().stroke(Theme.line))
        .environment(\.layoutDirection, .leftToRight)
    }
    private func seg(_ s: String, _ on: Bool, _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            Text(s).font(.headline).frame(maxWidth: .infinity).padding(.vertical, 9)
                .foregroundStyle(on ? .white : Theme.muted)
                .background(on ? Theme.brand2 : .clear, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// Horizontal ruler in 0.1 steps; the centre line marks the value.
struct HorizontalRuler: View {
    @Binding var value: Double
    let range: ClosedRange<Int>
    var label: (Int) -> String
    @State private var pos: Int?
    private let step: CGFloat = 8

    var body: some View {
        GeometryReader { g in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .bottom, spacing: 0) {
                    ForEach(range.lowerBound * 10...range.upperBound * 10, id: \.self) { i in
                        VStack(spacing: 6) {
                            if i % 10 == 0 { Text(label(i / 10)).font(.title3.bold()).foregroundStyle(Theme.muted).fixedSize() } else { Spacer(minLength: 0) }
                            Rectangle().fill(Theme.line).frame(width: 2, height: i % 10 == 0 ? 52 : i % 5 == 0 ? 38 : 26)
                        }
                        .frame(width: step, height: 100, alignment: .bottom)
                        .id(i)
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, g.size.width / 2 - step / 2, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $pos, anchor: .center)
            .overlay { Rectangle().fill(Theme.brand2).frame(width: 3, height: 84).offset(y: 8) }
            .onAppear { pos = Int((value * 10).rounded()) }
            .onChange(of: pos) { _, p in if let p { value = Double(p) / 10 } }
        }
        .environment(\.layoutDirection, .leftToRight)
    }
}

/// Vertical ruler in 1 cm steps; larger values at the top.
struct VerticalRuler: View {
    @Binding var value: Int
    let range: ClosedRange<Int>
    var label: (Int) -> String
    @State private var pos: Int?
    private let step: CGFloat = 10

    var body: some View {
        GeometryReader { g in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(range.reversed()), id: \.self) { v in
                        HStack(spacing: 8) {
                            Rectangle().fill(Theme.line).frame(width: v % 10 == 0 ? 70 : v % 5 == 0 ? 52 : 36, height: 2)
                            if v % 10 == 0 { Text(label(v)).font(.title3.bold()).foregroundStyle(Theme.muted).fixedSize() }
                        }
                        .frame(height: step, alignment: .leading)
                        .id(v)
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.vertical, g.size.height / 2 - step / 2, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $pos, anchor: .center)
            .overlay(alignment: .leading) { Rectangle().fill(Theme.brand2).frame(width: 90, height: 3) }
            .onAppear { pos = value }
            .onChange(of: pos) { _, p in if let p { value = p } }
        }
    }
}
