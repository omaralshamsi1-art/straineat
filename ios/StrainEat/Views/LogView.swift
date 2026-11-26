import PhotosUI
import SwiftUI
import VisionKit

struct LogView: View {
    @Environment(AppStore.self) private var store
    var onLogged: () -> Void = {}

    enum Mode: String, CaseIterable, Identifiable {
        case photo, text, barcode, favorites
        var id: String { rawValue }
        var title: String { ["photo": t("Photo", "صورة"), "text": t("Text/voice", "نص/صوت"), "barcode": t("Barcode", "باركود"), "favorites": t("Favourites", "المفضلة")][rawValue]! }
        var icon: String { ["photo": "camera.fill", "text": "text.bubble.fill", "barcode": "barcode.viewfinder", "favorites": "star.fill"][rawValue]! }
    }

    @State private var mode: Mode = .photo
    @State private var result: Meal?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    HStack(spacing: 8) {
                        ForEach(Mode.allCases) { m in
                            Button { withAnimation(.snappy) { mode = m } } label: {
                                VStack(spacing: 5) {
                                    Image(systemName: m.icon).font(.title3)
                                    Text(m.title).font(.caption.weight(.semibold))
                                }
                                .frame(maxWidth: .infinity).padding(.vertical, 11)
                                .foregroundStyle(mode == m ? Theme.onPastel : Theme.ink)
                                .background(mode == m ? Theme.yellow : Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    switch mode {
                    case .photo: PhotoLogPanel(result: $result)
                    case .text: TextLogPanel(result: $result)
                    case .barcode: BarcodeLogPanel(result: $result)
                    case .favorites: FavoritesPanel(onLogged: onLogged)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .screenBackground()
            .navigationTitle(t("Log meal", "سجّل وجبة"))
            .onAppear {
                if let m = UserDefaults.standard.string(forKey: "logMode"), let v = Mode(rawValue: m) { mode = v; UserDefaults.standard.removeObject(forKey: "logMode") }
            }
            .navigationDestination(item: $result) { MealReviewView(meal: $0, onDone: { result = nil; onLogged() }) }
        }
    }
}

// MARK: Photo

struct PhotoLogPanel: View {
    @Binding var result: Meal?
    @State private var image: UIImage?
    @State private var showCamera = false
    @State private var pickerItem: PhotosPickerItem?
    @State private var mealName = ""
    @State private var restaurant = ""
    @State private var portion = ""
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Card {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
                    .frame(maxWidth: .infinity).frame(height: 230)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(alignment: .topLeading) {
                        Button { self.image = nil; pickerItem = nil } label: {
                            Image(systemName: "xmark.circle.fill").font(.title2).symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.5))
                        }.padding(8)
                    }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "camera.viewfinder").font(.system(size: 44)).foregroundStyle(Theme.brand2)
                    Text(t("Photograph the whole meal from above", "صوّر الوجبة كاملة من الأعلى")).font(.subheadline).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity).frame(height: 150)
                .background(Theme.brandSoft.opacity(0.5), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            HStack(spacing: 10) {
                Button { showCamera = true } label: { Label(t("Camera", "الكاميرا"), systemImage: "camera.fill") }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                PhotosPicker(selection: $pickerItem, matching: .images) { Label(t("Photos", "من الصور"), systemImage: "photo.on.rectangle") }
                    .buttonStyle(SoftButtonStyle())
            }
        }
        Card(title: t("Info that helps the analyser", "معلومات تساعد المحلّل"), icon: "info.circle") {
            InputField(title: t("Meal name (optional)", "اسم الوجبة (اختياري)"), text: $mealName)
            InputField(title: t("Restaurant (optional)", "المطعم (اختياري)"), text: $restaurant)
            InputField(title: t("Portion — e.g. half, large", "الكمية — مثلاً: نصف، حجم كبير"), text: $portion)
            InputField(title: t("Note — e.g. no sauce", "ملاحظة — مثلاً: بدون صوص"), text: $note)
            Text(t("Naming the restaurant and meal lets us look up published values instead of estimating.", "ذكر المطعم واسم الوجبة يتيح البحث عن القيم المعلنة بدل التقدير.")).font(.caption).foregroundStyle(Theme.muted)
        }
        if let error { Notice(text: error, level: "danger") }
        Button { Task { await analyze() } } label: {
            if busy { HStack { ProgressView().tint(.white); Text(t("Analysing and searching…", "يحلل ويبحث…")) } } else { Text(t("Calculate nutrition", "احسب القيمة الغذائية")) }
        }
        .buttonStyle(PrimaryButtonStyle(color: image == nil ? Theme.muted : Theme.brand))
        .disabled(image == nil || busy)
        .sheet(isPresented: $showCamera) { CameraPicker(image: $image).ignoresSafeArea() }
        .onChange(of: pickerItem) { _, item in
            Task { if let data = try? await item?.loadTransferable(type: Data.self) { image = UIImage(data: data) } }
        }
    }

    private func analyze() async {
        guard let image else { return }
        guard await AIConsent.shared.ensure() else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let r = try await APIClient.shared.analyze(image: image, mealName: mealName, restaurant: restaurant, portion: portion, note: note)
            self.image = nil; pickerItem = nil; mealName = ""; restaurant = ""; portion = ""; note = ""
            result = r.meal
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: Text & voice

struct TextLogPanel: View {
    @Binding var result: Meal?
    @State private var text = ""
    @State private var restaurant = ""
    @State private var busy = false
    @State private var error: String?
    @State private var speech = SpeechInput()

    var body: some View {
        Card(title: t("Type or say what you ate", "اكتب أو قل ما أكلت"), icon: "text.bubble") {
            ZStack(alignment: .topLeading) {
                TextEditor(text: $text)
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
            if busy { HStack { ProgressView().tint(.white); Text(t("Analysing…", "يحلل…")) } } else { Text(t("Calculate nutrition", "احسب القيمة الغذائية")) }
        }
        .buttonStyle(PrimaryButtonStyle(color: text.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 ? Theme.muted : Theme.brand))
        .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
        .onDisappear { speech.stop() }
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
