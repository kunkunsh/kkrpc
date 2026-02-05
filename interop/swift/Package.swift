// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "kkrpc",
    platforms: [
        .macOS(.v10_15),
        .iOS(.v13),
        .tvOS(.v13),
        .watchOS(.v6)
    ],
    products: [
        .library(
            name: "kkrpc",
            targets: ["kkrpc"]
        ),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "kkrpc",
            dependencies: []
        ),
        .testTarget(
            name: "kkrpcTests",
            dependencies: ["kkrpc"]
        ),
    ]
)