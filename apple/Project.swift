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
                // ATS: enforce HTTPS in release; allow plaintext localhost / Bonjour for
                // dev only. Self-hosters who terminate TLS in front of the API see no impact.
                "NSAppTransportSecurity": [
                    "NSAllowsLocalNetworking": true,
                    "NSExceptionDomains": [
                        "localhost": [
                            "NSExceptionAllowsInsecureHTTPLoads": true,
                            "NSIncludesSubdomains": true,
                        ],
                    ],
                ],
                // Advertise that NoteOne can accept text / URL / image / movie items via
                // Drag & Drop on iPadOS (Slide Over / Dock drop) and iOS share-sheet drop.
                // Receiving the actual data still happens via the SwiftUI `.onDrop` modifier
                // on the root view; these declarations make NoteOne a legal drop target.
                "CFBundleDocumentTypes": [
                    [
                        "CFBundleTypeName": "Text",
                        "LSHandlerRank": "Alternate",
                        "LSItemContentTypes": ["public.text", "public.plain-text"],
                    ],
                    [
                        "CFBundleTypeName": "URL",
                        "LSHandlerRank": "Alternate",
                        "LSItemContentTypes": ["public.url"],
                    ],
                    [
                        "CFBundleTypeName": "Image",
                        "LSHandlerRank": "Alternate",
                        "LSItemContentTypes": ["public.image"],
                    ],
                    [
                        "CFBundleTypeName": "Movie",
                        "LSHandlerRank": "Alternate",
                        "LSItemContentTypes": ["public.movie"],
                    ],
                ],
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
