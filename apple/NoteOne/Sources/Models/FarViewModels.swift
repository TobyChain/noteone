import Foundation

struct FarViewRepresentative: Decodable, Hashable, Identifiable {
    var id: String { "\(sourceType):\(sourceId)" }
    let sourceType: String
    let sourceId: String
    let title: String
    let url: String?
    let observedDate: String
}

struct FarViewTopic: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let currentCount: Int
    let sourceDiversity: Int
    let normalizedHeat: Double
    let score: Double
    let sourceCounts: [String: Int]
    let representatives: [FarViewRepresentative]
    let relevance: String?
}

struct FarViewSnapshot: Decodable, Hashable {
    let periodDays: Int
    let periodStart: String
    let periodEnd: String
    let sourceThrough: String
    let totalItems: Int
    let sourceCounts: [String: Int]
    let topics: [FarViewTopic]
}

struct FarViewOverviewResponse: Decodable {
    let state: String
    let snapshot: FarViewSnapshot?
}

struct FarViewStatusResponse: Decodable {
    let isRunning: Bool
    let lastGeneratedAt: String?
    let periodStart: String?
    let error: String?
}

struct FarViewRefreshResponse: Decodable {
    let started: Bool
}
