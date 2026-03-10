// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BarkbookApp",
    platforms: [.iOS(.v16)],
    dependencies: [
        .package(url: "https://github.com/auth0/Auth0.swift", from: "2.0.0")
    ],
    targets: [
        .executableTarget(
            name: "BarkbookApp",
            dependencies: ["Auth0"],
            path: "Sources/BarkbookApp"
        )
    ]
)
