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
        .package(url: "https://github.com/auth0/Auth0.swift.git", from: "3.0.0"),
    ],
    targets: [
        .target(
            name: "BarkbookApp",
            dependencies: [
                .product(name: "Auth0", package: "Auth0.swift"),
            ]),
    ]
)
