import AVFoundation
import PhotosUI
import SwiftUI

/// Full-screen camera that opens on a single tap of Snap.
/// Shutter in the middle; Photos / Type it / Say it underneath; Barcode on top.
struct CameraScreen: View {
    var onPhoto: (UIImage) -> Void
    var onText: () -> Void
    var onVoice: () -> Void
    var onBarcode: () -> Void
    var onClose: () -> Void

    @State private var camera = CameraController()
    @State private var pickerItem: PhotosPickerItem?
    @State private var flash = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 0) {
                ZStack {
                    if camera.available {
                        CameraPreview(session: camera.session).ignoresSafeArea(edges: .top)
                    } else {
                        VStack(spacing: 12) {
                            Image(systemName: "camera.fill").font(.system(size: 34))
                            Text(camera.denied
                                 ? t("Allow camera access in Settings — or pick from Photos below", "اسمح بالكاميرا من الإعدادات — أو اختر من الصور تحت")
                                 : t("Camera isn't available — pick from Photos below", "الكاميرا غير متاحة — اختر من الصور تحت"))
                                .font(.subheadline).multilineTextAlignment(.center)
                            if camera.denied {
                                Button(t("Open Settings", "افتح الإعدادات")) { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
                                    .font(.subheadline.weight(.bold))
                            }
                        }
                        .foregroundStyle(.white.opacity(0.85)).padding(30)
                    }
                    FrameCorners().padding(.horizontal, 40).padding(.vertical, 90).allowsHitTesting(false)
                    VStack {
                        HStack {
                            Button(action: onClose) {
                                Image(systemName: "xmark").font(.title3.weight(.semibold)).foregroundStyle(.white)
                                    .frame(width: 44, height: 44).background(.black.opacity(0.45), in: Circle())
                            }
                            .accessibilityLabel(t("Close", "إغلاق"))
                            Spacer()
                            Button(action: { camera.stop(); onBarcode() }) {
                                Label(t("Barcode", "باركود"), systemImage: "barcode")
                                    .font(.subheadline.weight(.bold)).foregroundStyle(.white)
                                    .padding(.horizontal, 14).padding(.vertical, 10)
                                    .background(.black.opacity(0.45), in: Capsule())
                            }
                        }
                        .padding(.horizontal, 16).padding(.top, 8)
                        Spacer()
                        Text(t("Snap your meal", "صوّر وجبتك"))
                            .font(.headline).foregroundStyle(.white).shadow(radius: 6)
                            .padding(.bottom, 14)
                    }
                    if flash { Color.white.ignoresSafeArea().transition(.opacity) }
                }

                VStack(spacing: 18) {
                    Button { Task { await shoot() } } label: {
                        ZStack {
                            Circle().stroke(.white, lineWidth: 5).frame(width: 84, height: 84)
                            Circle().fill(.white).frame(width: 66, height: 66)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(!camera.available || camera.busy)
                    .opacity(camera.available ? 1 : 0.35)
                    .accessibilityLabel(t("Take photo", "التقاط صورة"))

                    HStack(spacing: 10) {
                        PhotosPicker(selection: $pickerItem, matching: .images) { option("photo.on.rectangle", t("Photos", "من الصور")) }
                        Button { camera.stop(); onText() } label: { option("pencil.line", t("Type it", "اكتبها")) }
                        Button { camera.stop(); onVoice() } label: { option("mic.fill", t("Say it", "قلها")) }
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 16)
                }
                .padding(.top, 20).padding(.bottom, 10)
                .frame(maxWidth: .infinity)
                .background(Color(UIColor(hex: 0x15171A)))
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .task { await camera.start() }
        .onDisappear { camera.stop() }
        .onChange(of: pickerItem) { _, item in
            Task {
                if let data = try? await item?.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                    camera.stop(); onPhoto(img)
                }
            }
        }
    }

    private func option(_ icon: String, _ title: String) -> some View {
        VStack(spacing: 5) {
            Image(systemName: icon).font(.title2)
            Text(title).font(.subheadline.weight(.bold))
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12)
        .foregroundStyle(.white)
        .background(Color(UIColor(hex: 0x202327)), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color(UIColor(hex: 0x2E3238))))
    }

    private func shoot() async {
        withAnimation(.easeOut(duration: 0.08)) { flash = true }
        let img = await camera.capture()
        withAnimation(.easeIn(duration: 0.15)) { flash = false }
        if let img { camera.stop(); onPhoto(img) }
    }
}

private struct FrameCorners: View {
    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height, l: CGFloat = 32
            Path { p in
                p.move(to: CGPoint(x: 0, y: l)); p.addLine(to: .zero); p.addLine(to: CGPoint(x: l, y: 0))
                p.move(to: CGPoint(x: w - l, y: 0)); p.addLine(to: CGPoint(x: w, y: 0)); p.addLine(to: CGPoint(x: w, y: l))
                p.move(to: CGPoint(x: 0, y: h - l)); p.addLine(to: CGPoint(x: 0, y: h)); p.addLine(to: CGPoint(x: l, y: h))
                p.move(to: CGPoint(x: w - l, y: h)); p.addLine(to: CGPoint(x: w, y: h)); p.addLine(to: CGPoint(x: w, y: h - l))
            }
            .stroke(.white, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
        }
    }
}

// MARK: AVFoundation

@Observable
final class CameraController: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    @ObservationIgnored let session = AVCaptureSession()
    var available = false
    var denied = false
    var busy = false

    @ObservationIgnored private let output = AVCapturePhotoOutput()
    @ObservationIgnored private let queue = DispatchQueue(label: "straineat.camera")
    @ObservationIgnored private var configured = false
    @ObservationIgnored private var pending: CheckedContinuation<UIImage?, Never>?

    @MainActor
    func start() async {
        var status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .notDetermined {
            status = await AVCaptureDevice.requestAccess(for: .video) ? .authorized : .denied
        }
        guard status == .authorized else { denied = status == .denied || status == .restricted; available = false; return }
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { available = false; return }
        let ok: Bool = await withCheckedContinuation { c in
            queue.async { [self] in
                if !configured {
                    session.beginConfiguration()
                    session.sessionPreset = .photo
                    guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input), session.canAddOutput(output) else {
                        session.commitConfiguration(); c.resume(returning: false); return
                    }
                    session.addInput(input); session.addOutput(output)
                    session.commitConfiguration()
                    configured = true
                }
                if !session.isRunning { session.startRunning() }
                c.resume(returning: true)
            }
        }
        available = ok
    }

    func stop() {
        queue.async { [self] in if session.isRunning { session.stopRunning() } }
    }

    @MainActor
    func capture() async -> UIImage? {
        guard available, !busy else { return nil }
        busy = true
        defer { busy = false }
        return await withCheckedContinuation { c in
            pending = c
            queue.async { [self] in output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self) }
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let img = photo.fileDataRepresentation().flatMap { UIImage(data: $0) }
        DispatchQueue.main.async { [self] in pending?.resume(returning: img); pending = nil }
    }
}

private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.preview.session = session
        v.preview.videoGravity = .resizeAspectFill
        return v
    }
    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
