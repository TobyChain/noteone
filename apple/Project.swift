import ProjectDescription

let project = Project(
    name: "NoteOne",
    organizationName: "NoteOne",
    targets: [
        .target(
            name: "NoteOne",
            destinations: [.iPhone, .iPad, .mac],
            product: .app,
            bundleId: "com.noteone.app",
            deploymentTargets: .multiplatform(iOS: "17.0", macOS: "14.0"),
            infoPlist: .extendingDefault(with: [
                "CFBundleDisplayName": "NoteOne",
                "CFBundleShortVersionString": "0.1.0",
                "NSAppTransportSecurity": ["NSAllowsArbitraryLoads": true],
            ]),
            sources: ["NoteOne/Sources/**"],
            resources: ["NoteOne/Resources/**"],
            entitlements: .dictionary([
                "com.apple.security.application-groups": .array([.string("group.com.noteone.app")]),
            ])
        ),
        .target(
            name: "NoteOneShareExtension",
            destinations: [.iPhone, .iPad],
            product: .appExtension,
            bundleId: "com.noteone.app.share",
            deploymentTargets: .iOS("17.0"),
            infoPlist: .extendingDefault(with: [
                "NSExtension": [
                    "NSExtensionPointIdentifier": "com.apple.share-services",
                    "NSExtensionPrincipalClass": "$(PRODUCT_MODULE_NAME).ShareViewController",
                ],
            ]),
            sources: ["NoteOneShareExtension/Sources/**"],
            entitlements: .dictionary([
                "com.apple.security.application-groups": .array([.string("group.com.noteone.app")]),
            ])
        ),
    ]
)
