// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "BranchDesktopProbe",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "BranchDesktopProbe", targets: ["BranchDesktopProbe"])],
    targets: [
        .executableTarget(name: "BranchDesktopProbe", resources: [.process("Resources")]),
        .testTarget(name: "BranchDesktopProbeTests", dependencies: ["BranchDesktopProbe"]),
    ]
)
