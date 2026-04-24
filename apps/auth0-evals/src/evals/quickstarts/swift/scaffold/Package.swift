// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BarkbookApp",
    platforms: [
        .iOS(.v14)
    ],
    products: [
        .library(
            name: "BarkbookApp",
            targets: ["BarkbookApp"]),
    ],
    dependencies: [
    ],
    targets: [
        .target(
            name: "BarkbookApp",
            dependencies: []),
    ]
)
