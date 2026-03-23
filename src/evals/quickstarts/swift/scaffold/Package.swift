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
        // TODO: Add Auth0.swift dependency
    ],
    targets: [
        .target(
            name: "BarkbookApp",
            dependencies: []),
    ]
)
