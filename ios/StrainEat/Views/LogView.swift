import PhotosUI
import SwiftUI
import VisionKit

struct LogView: View {
    @Environment(AppStore.self) private var store
    var active: Bool = true
    var onLogged: () -> Void = {}
    var onClose: () -> Void = {}

    /// Snap opens straight into the camera; everything else is one tap from there.
    enum Stage: Equatable { case photo, text, voice, barcode }

    @State private var stage: Stage = .photo
    @State private var image: UIImage?
    @State private var showCamera = false
    @State private var result: Meal?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    switch stage {
                    case .photo:
                        if let image {
                            PhotoLogPanel(image: image, result: $result, onRetake: { self.image = nil; showCamera = true })
                        } else {
                            Button { showCamera = true } label: { Label(t("Open camera", "افتح الكاميرا"), systemImage: "camera.fill") }
                                .buttonStyle(PrimaryButtonStyle()).padding(.top, 40)
                        }
                    case .text, .voice:
                        TextLogPanel(result: $result, startVoice: stage == .voice)
                        FavoritesPanel(onLogged: onLogged)
                    case .barcode:
                        BarcodeLogPanel(result: $result, autoScan: true)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .screenBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { close() } label: { Image(systemName: "xmark") }.accessibilityLabel(t("Close", "إغلاق"))
                }
            }
            .navigationDestination(item: $result) { MealReviewView(meal: $0, onDone: { result = nil; image = nil; onLogged() }) }
        }
        .onChange(of: active, initial: true) { _, isOn in if isOn { begin() } }
        .fullScreenCover(isPresented: $showCamera) {
            CameraScreen(
                onPhoto: { img in image = img; stage = .photo; showCamera = false },
                onText: { stage = .text; showCamera = false },
                onVoice: { stage = .voice; showCamera = false },
                onBarcode: { stage = .barcode; showCamera = false },
                onClose: { showCamera = false; if image == nil { close() } }
            )
            .environment(\.layoutDirection, appLayoutDirection)
        }
    }

    private var title: String {
        switch stage {
        case .photo: t("Your meal", "وجبتك")
        case .text, .voice: t("Type your meal", "اكتب وجبتك")
        case .barcode: t("Barcode", "باركود")
        }
    }

    private func begin() {
        result = nil
        if UserDefaults.standard.string(forKey: "logMode") == "favorites" {
            UserDefaults.standard.removeObject(forKey: "logMode")
            image = nil; stage = .text
            return
        }
        image = nil; stage = .photo; showCamera = true
    }

    private func close() { image = nil; stage = .photo; onClose() }
}

// MARK: Photo — analyse first, details optional

struct PhotoLogPanel: View {
    let image: UIImage
    @Binding var result: Meal?
    var onRetake: () -> Void
    @State private var portion: String?
    @State private var noSauce = false
    @State private var fromRestaurant = false
    @State private var restaurant = ""
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?
    @State private var speech = SpeechInput()

    var body: some View {
        Image(uiImage: image).resizable().scaledToFill()
            .frame(maxWidth: .infinity).frame(height: 300)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(alignment: .topLeading) {
                Button(action: onRetake) {
                    Label(t("Retake", "صوّر من جديد"), systemImage: "arrow.counterclockwise")
                        .font(.subheadline.weight(.bold)).foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(.black.opacity(0.55), in: Capsule())
                }
                .padding(12)
            }
        if let error { Notice(text: error, level: "danger") }
        Button { Task { await analyze() } } label: {
            if busy { HStack { ProgressView().tint(Theme.bg); Text(t("Analysing…", "يحلل…")) } } else { Text(t("Analyse meal", "حلّل الوجبة")).font(.title3.weight(.bold)) }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy)

        VStack(alignment: .leading, spacing: 10) {
            Text(t("Want more accuracy? Add details (optional)", "تبي الدقة أعلى؟ أضف تفاصيل (اختياري)"))
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted)
            FlowChips {
                Chip(title: t("Half plate", "نص صحن"), on: portion == "half plate") { portion = portion == "half plate" ? nil : "half plate" }
                Chip(title: t("Full plate", "صحن كامل"), on: portion == "full plate") { portion = portion == "full plate" ? nil : "full plate" }
                Chip(title: t("No sauce", "بدون صوص"), on: noSauce) { noSauce.toggle() }
                Chip(title: t("📍 From a restaurant", "📍 من مطعم"), on: fromRestaurant) { fromRestaurant.toggle(); if !fromRestaurant { restaurant = "" } }
            }
            if fromRestaurant { InputField(title: t("Restaurant name", "اسم المطعم"), text: $restaurant) }
            HStack(spacing: 8) {
                InputField(title: t("Add a note…", "اكتب ملاحظة…"), text: $note)
                Button {
                    if speech.isRecording { speech.stop() } else { let base = note.isEmpty ? "" : note + " "; Task { await speech.start { note = base + $0 } } }
                } label: {
                    Image(systemName: speech.isRecording ? "stop.fill" : "mic.fill").font(.title3)
                        .frame(width: 50, height: 44)
                        .foregroundStyle(speech.isRecording ? .white : Theme.ink)
                        .background(speech.isRecording ? Theme.bad : Theme.card2, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain).accessibilityLabel(t("Speak", "تحدّث"))
            }
            if let e = speech.error { Text(e).font(.caption).foregroundStyle(Theme.bad) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
        .onDisappear { speech.stop() }
    }

    private func analyze() async {
        speech.stop()
        guard await AIConsent.shared.ensure() else { return }
        busy = true; error = nil
        defer { busy = false }
        let n = [note.trimmingCharacters(in: .whitespaces), noSauce ? "no sauce" : ""].filter { !$0.isEmpty }.joined(separator: ", ")
        do {
            let r = try await APIClient.shared.analyze(image: image, mealName: nil, restaurant: restaurant.trimmingCharacters(in: .whitespaces), portion: portion, note: n)
            result = r.meal
        } catch { self.error = error.localizedDescription }
    }
}

struct Chip: View {
    let title: String
    let on: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14).padding(.vertical, 9)
                .foregroundStyle(on ? Theme.onPastel : Theme.ink)
                .background(on ? Theme.yellow : Theme.card2, in: Capsule())
                .overlay(Capsule().stroke(on ? .clear : Theme.line))
        }
        .buttonStyle(.plain)
    }
}

/// Simple wrapping row for chips.
struct FlowChips: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > w { x = 0; y += row + spacing; row = 0 }
            x += s.width + spacing; row = max(row, s.height); maxX = max(maxX, x - spacing)
        }
        return CGSize(width: min(maxX, w), height: y + row)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rtl = appLayoutDirection == .rightToLeft
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > bounds.width { x = 0; y += row + spacing; row = 0 }
            let px = rtl ? bounds.maxX - x - s.width : bounds.minX + x
            v.place(at: CGPoint(x: px, y: bounds.minY + y), proposal: ProposedViewSize(s))
            x += s.width + spacing; row = max(row, s.height)
        }
    }
}

// MARK: Text & voice

struct TextLogPanel: View {
    @Binding var result: Meal?
    var startVoice = false
    @FocusState private var focused: Bool
    @State private var text = ""
    @State private var restaurant = ""
    @State private var busy = false
    @State private var error: String?
    @State private var speech = SpeechInput()

    var body: some View {
        Card(title: t("Type or say what you ate", "اكتب أو قل ما أكلت"), icon: "text.bubble") {
            Text(t("Write it your way; add the portion and restaurant if you know", "اكتب بأسلوبك، واذكر الكمية والمطعم إذا تعرف")).font(.caption).foregroundStyle(Theme.muted)
            ZStack(alignment: .topLeading) {
                TextEditor(text: $text)
                    .focused($focused)
                    .frame(minHeight: 110)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
                if text.isEmpty {
                    Text(t("e.g. chicken shawarma and a small orange juice", "مثلاً: شاورما دجاج عربي وعصير برتقال صغير")).foregroundStyle(Theme.muted).padding(16).allowsHitTesting(false)
                }
            }
            InputField(title: t("Restaurant (optional)", "المطعم (اختياري)"), text: $restaurant)
            Button {
                if speech.isRecording { speech.stop() } else {
                    Task { await speech.start { text = $0 } }
                }
            } label: {
                Label(speech.isRecording ? t("Stop recording", "إيقاف التسجيل") : t("Speak", "تحدّث بالعربي"), systemImage: speech.isRecording ? "stop.circle.fill" : "mic.fill")
            }
            .buttonStyle(SoftButtonStyle())
            if speech.isRecording { Text(t("Listening… speak clearly, then tap stop", "أستمع… تكلّم بوضوح ثم اضغط إيقاف")).font(.caption).foregroundStyle(Theme.bad) }
            if let e = speech.error { Text(e).font(.caption).foregroundStyle(Theme.bad) }
        }
        if let error { Notice(text: error, level: "danger") }
        Button { Task { await analyze() } } label: {
            if busy { HStack { ProgressView().tint(.white); Text(t("Analysing…", "يحلل…")) } } else { Text(t("Analyse meal", "حلّل الوجبة")) }
        }
        .buttonStyle(PrimaryButtonStyle(color: text.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 ? Theme.muted : Theme.brand))
        .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
        .onDisappear { speech.stop() }
        .task {
            if startVoice { await speech.start { text = $0 } } else { focused = true }
        }
    }

    private func analyze() async {
        speech.stop()
        guard await AIConsent.shared.ensure() else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let r = try await APIClient.shared.analyzeText(text.trimmingCharacters(in: .whitespacesAndNewlines), restaurant: restaurant)
            text = ""; restaurant = ""
            result = r.meal
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: Barcode

struct BarcodeLogPanel: View {
    @Binding var result: Meal?
    var autoScan = false
    @State private var scanning = false
    @State private var code = ""
    @State private var product: BarcodeProduct?
    @State private var grams = ""
    @State private var busy = false
    @State private var error: String?

    private var scannerAvailable: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }

    var body: some View {
        Card(title: t("Packaged product", "منتج مغلّف"), icon: "barcode.viewfinder") {
            if scannerAvailable {
                Button { scanning = true } label: { Label(t("Scan barcode", "امسح الباركود"), systemImage: "barcode.viewfinder") }
                    .buttonStyle(PrimaryButtonStyle())
            }
            HStack {
                TextField(t("or type the barcode number", "أو اكتب رقم الباركود"), text: $code)
                    .keyboardType(.numberPad)
                    .padding(11).background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
                Button(t("Search", "بحث")) { Task { await lookup(code) } }
                    .buttonStyle(SoftButtonStyle()).frame(width: 80)
                    .disabled(code.count < 6 || busy)
            }
            Text(t("Data from Open Food Facts (open database).", "البيانات من Open Food Facts (قاعدة مفتوحة).")).font(.caption).foregroundStyle(Theme.muted)
        }
        if busy { ProgressView() }
        if let error { Notice(text: error, level: "warn") }
        if let p = product {
            let g = Double(grams) ?? 0
            Card(title: p.title, icon: "shippingbox.fill") {
                if let b = p.brand { Text(b).font(.subheadline).foregroundStyle(Theme.muted) }
                Text(t("Per 100 g: \(fmt(p.per100.calories)) kcal • protein \(fmt1(p.per100.proteinG)) • carbs \(fmt1(p.per100.carbsG)) • fat \(fmt1(p.per100.fatG))", "لكل 100 غ: \(fmt(p.per100.calories)) سعرة • بروتين \(fmt1(p.per100.proteinG)) • كربوهيدرات \(fmt1(p.per100.carbsG)) • دهون \(fmt1(p.per100.fatG))"))
                    .font(.caption).foregroundStyle(Theme.muted)
                HStack {
                    Text(t("Amount (g)", "الكمية (غ)"))
                    TextField("100", text: $grams).keyboardType(.decimalPad)
                        .padding(10).background(Theme.card2, in: RoundedRectangle(cornerRadius: 10))
                    if let s = p.servingG { Button(t("Serving \(fmt(s))", "حصة \(fmt(s))")) { grams = String(Int(s.rounded())) }.buttonStyle(SoftButtonStyle()).frame(width: 100) }
                }
                if g > 0 {
                    Text(t("= \(fmt(p.per100.calories * g / 100)) kcal • \(fmt(p.per100.proteinG * g / 100)) g protein", "= \(fmt(p.per100.calories * g / 100)) سعرة • \(fmt(p.per100.proteinG * g / 100)) غ بروتين"))
                        .font(.headline).foregroundStyle(Theme.brand2)
                }
                Button { Task { await add(p, g) } } label: { Text(t("Add for review", "أضف للمراجعة")) }
                    .buttonStyle(PrimaryButtonStyle()).disabled(g <= 0 || busy)
            }
        }
        EmptyView()
            .onAppear { if autoScan && scannerAvailable && product == nil { scanning = true } }
            .sheet(isPresented: $scanning) {
                BarcodeScanner { found in
                    scanning = false
                    code = found
                    Task { await lookup(found) }
                }
                .ignoresSafeArea()
            }
    }

    private func lookup(_ c: String) async {
        let clean = c.filter(\.isNumber)
        guard clean.count >= 6 else { return }
        busy = true; error = nil; product = nil
        defer { busy = false }
        do {
            let p = try await APIClient.shared.barcode(clean)
            product = p
            grams = p.servingG.map { String(Int($0.rounded())) } ?? "100"
        } catch { self.error = t("Product not found — try a photo or a text description.", "لم نجد هذا المنتج — جرّب التصوير أو الوصف النصي.") }
    }

    private func add(_ p: BarcodeProduct, _ g: Double) async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let created = try await APIClient.shared.createMeal(from: p, grams: g)
            let full = try await APIClient.shared.meal(id: created.id)
            product = nil; code = ""
            result = full
        } catch { self.error = error.localizedDescription }
    }
}

struct BarcodeScanner: UIViewControllerRepresentable {
    var onFound: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.ean13, .ean8, .upce, .code128])],
            qualityLevel: .balanced, isHighlightingEnabled: true)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }
    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onFound: onFound) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onFound: (String) -> Void
        private var done = false
        init(onFound: @escaping (String) -> Void) { self.onFound = onFound }
        func dataScanner(_ scanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for item in addedItems {
                if case let .barcode(b) = item, let v = b.payloadStringValue {
                    done = true
                    scanner.stopScanning()
                    onFound(v)
                    return
                }
            }
        }
    }
}

// MARK: Favourites

struct FavoritesPanel: View {
    @Environment(AppStore.self) private var store
    var onLogged: () -> Void
    @State private var list: [Favorite]?
    @State private var busyKey: String?
    @State private var message: String?

    var body: some View {
        Card(title: t("Your usual meals", "وجباتك المعتادة"), icon: "star.fill") {
            Text(t("One-tap logging — no new analysis.", "تسجيل بضغطة — بدون تحليل جديد.")).font(.caption).foregroundStyle(Theme.muted)
            if let list {
                if list.isEmpty { Text(t("Confirm a few meals first and they'll show up here.", "أكّد بعض الوجبات أولاً لتظهر هنا.")).font(.footnote).foregroundStyle(Theme.muted) }
                ForEach(list) { f in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                                Text([f.restaurant, f.timesLogged.map { "\($0)×" }].compactMap { $0 }.joined(separator: " • "))
                                    .font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            VStack(alignment: .trailing) {
                                Text(t("\(fmt(f.calories)) kcal", "\(fmt(f.calories)) سعرة")).font(.subheadline.bold()).monospacedDigit()
                                if let p = f.proteinG { Text(t("\(fmt(p)) g protein", "\(fmt(p)) غ بروتين")).font(.caption2).foregroundStyle(Theme.protein) }
                            }
                        }
                        HStack(spacing: 6) {
                            ForEach([0.5, 1.0, 1.5], id: \.self) { pf in
                                Button { Task { await log(f, pf) } } label: {
                                    Text(pf == 1 ? t("Full serving", "حصة كاملة") : pf == 0.5 ? t("Half", "نصف") : t("One and a half", "ونصف")).font(.caption.weight(.semibold))
                                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                                        .foregroundStyle(pf == 1 ? .white : Theme.brand2)
                                        .background(pf == 1 ? Theme.brand2 : Theme.brandSoft, in: Capsule())
                                }
                                .buttonStyle(.plain).disabled(busyKey != nil)
                            }
                        }
                    }
                    .padding(12)
                    .background(Theme.card2, in: RoundedRectangle(cornerRadius: 14))
                    .opacity(busyKey == f.key ? 0.5 : 1)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
            if let message { Text(message).font(.caption).foregroundStyle(Theme.bad) }
        }
        .task { list = try? await APIClient.shared.favorites() }
    }

    private func log(_ f: Favorite, _ pf: Double) async {
        busyKey = f.key; message = nil
        defer { busyKey = nil }
        do {
            try await APIClient.shared.logFavorite(key: f.key, portion: pf)
            await store.refresh()
            onLogged()
        } catch { message = error.localizedDescription }
    }
}

// MARK: Shared

struct InputField: View {
    let title: String
    @Binding var text: String
    var body: some View {
        TextField(title, text: $text)
            .padding(11)
            .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct CameraPicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ p: CameraPicker) { parent = p }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            parent.image = info[.originalImage] as? UIImage
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
