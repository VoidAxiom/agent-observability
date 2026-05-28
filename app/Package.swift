// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "AgentObservability",
    platforms: [.macOS(.v14)],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "AgentObservability",
            path: "Sources/AgentObservability"
        )
    ]
)
