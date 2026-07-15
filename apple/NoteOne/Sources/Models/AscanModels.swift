import Foundation

struct AscanReportMeta: Identifiable, Decodable, Hashable {
    var id: String { date }
    let date: String
    let filename: String
    let size: Int
    let hasMarkdown: Bool

    var formattedDate: String {
        guard date.count == 8 else { return date }
        let y = date.prefix(4)
        let m = date.dropFirst(4).prefix(2)
        let d = date.dropFirst(6).prefix(2)
        return "\(y)-\(m)-\(d)"
    }

    var formattedSize: String {
        if size < 1024 { return "\(size) B" }
        if size < 1_048_576 { return String(format: "%.1f KB", Double(size) / 1024) }
        return String(format: "%.1f MB", Double(size) / 1_048_576)
    }
}

struct AscanConfig: Codable, Hashable {
    var idealabApiKey: String = ""
    var idealabBaseUrl: String = ""
    var llmModel: String = ""
    var llmMaxConcurrency: Int = 5

    var githubToken: String = ""
    var githubTopics: [String] = []
    var githubMaxReposPerTopic: Int = 8
    var githubMinStars: Int = 500
    var githubTopAnalyze: Int = 20

    var arxivSubjects: [String] = []
    var arxivDateOffsetDays: Int = 1
    var maxPapersPerSubject: Int = 200
    var maxTotalPapers: Int = 500

    var semanticScholarApiKey: String = ""
    var conferenceLookbackDays: Int = 30
    var conferenceRankFilter: [String] = []
    var conferenceCategories: [String] = []

    var blogMaxPerSource: Int = 2
    var wechatRssBaseUrl: String = ""
    var wechatLimitPerMp: Int = 20

    var outputDir: String = "./docs"
    var logLevel: String = "INFO"
}

struct AscanRunStatus: Decodable {
    let isRunning: Bool
    let lastLockTime: String?
    let lockAge: String?
    let recentLog: String?
}

struct AscanTriggerResponse: Decodable {
    let pid: Int
    let message: String
}

struct AscanReportResponse: Decodable {
    let date: String
    let html: String
}

struct AscanReportsResponse: Decodable {
    let reports: [AscanReportMeta]
}
