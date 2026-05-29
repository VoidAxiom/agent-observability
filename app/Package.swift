// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AgentObservability",
    platforms: [.macOS(.v14)],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "AgentObservability",
            path: "Sources/AgentObservability"
        ),
        .testTarget(
            name: "AgentObservabilityTests",
            dependencies: ["AgentObservability"],
            path: "Tests/AgentObservabilityTests"
        )
    ]
)
