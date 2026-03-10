// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BarkbookApp",
    platforms: [.iOS(.v16)],
    targets: [
        .executableTarget(
            name: "BarkbookApp",
            path: "Sources/BarkbookApp"
        )
    ]
)
