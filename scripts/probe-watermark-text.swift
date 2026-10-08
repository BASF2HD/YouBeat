// Read-only macOS OCR diagnostic. This never edits a cover or renders a video.
// swift -module-cache-path /tmp/youbeat-swift-cache scripts/probe-watermark-text.swift <cover.jpg> ...
import Foundation
import Vision
import CoreImage

let allowlist = ["samperals", "samperials", "desinapster"]
let context = CIContext(options: [.cacheIntermediates: false])
func normalise(_ text: String) -> String {
    return text.lowercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(String.init).joined()
}
func exactWatermark(_ text: String) -> String? {
    let value = normalise(text)
    return allowlist.first { value == $0 || value == $0 + "net" || value == "www" + $0 + "net" || value == $0 + "com" }
}
var reports: [[String: Any]] = []
for file in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: file)
    guard let source = CIImage(contentsOf: url) else { throw NSError(domain: "CoverOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot open \(url.lastPathComponent)"]) }
    var matches: [[String: Any]] = []
    var rejected: [[String: Any]] = []
    // Deskew the diagonal text in memory only. Translate reported corners back
    // to the original image; these coarse OCR boxes are NOT removal masks.
    for angle in [0.0, Double.pi / 4, -Double.pi / 4] {
        let transform = CGAffineTransform(rotationAngle: angle)
        let rotated = source.transformed(by: transform)
        guard let raster = context.createCGImage(rotated, from: rotated.extent) else {
            throw NSError(domain: "CoverOCR", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not rasterise the OCR input; this is not a no-watermark result."])
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        request.minimumTextHeight = 0.008
        try VNImageRequestHandler(cgImage: raster, options: [:]).perform([request])
        for observation in request.results ?? [] {
            guard let best = observation.topCandidates(3).first else { continue }
            let candidates = observation.topCandidates(3)
            guard let candidate = candidates.first(where: { exactWatermark($0.string) != nil }) else {
                if angle == 0 { rejected.append(["text": best.string, "confidence": best.confidence]) }
                continue
            }
            let box = observation.boundingBox
            let corners = [CGPoint(x: box.minX, y: box.minY), CGPoint(x: box.maxX, y: box.minY), CGPoint(x: box.maxX, y: box.maxY), CGPoint(x: box.minX, y: box.maxY)].map { point -> [Double] in
                let rotatedPoint = CGPoint(x: point.x * CGFloat(raster.width) + rotated.extent.minX,
                                           y: point.y * CGFloat(raster.height) + rotated.extent.minY)
                let originalPoint = rotatedPoint.applying(transform.inverted())
                return [Double(originalPoint.x), Double(source.extent.height - originalPoint.y)]
            }
            matches.append(["text": candidate.string, "target": exactWatermark(candidate.string)!,
                            "confidence": candidate.confidence, "deskewDegrees": angle * 180 / Double.pi,
                            "cornersOriginalTopLeftPx": corners, "requiresReview": true])
        }
    }
    reports.append(["albumFolder": url.deletingLastPathComponent().lastPathComponent, "file": url.lastPathComponent,
                    "width": source.extent.width, "height": source.extent.height, "allowlist": allowlist,
                    "matches": matches, "untargetedText": rejected,
                    "note": "OCR boxes require review and glyph-level masking; no covers were modified."])
}
let data = try JSONSerialization.data(withJSONObject: reports, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
