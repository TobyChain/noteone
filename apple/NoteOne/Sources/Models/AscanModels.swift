import Foundation

struct AscanReportMeta: Identifiable, Decodable, Hashable {
    var id: String { date }
    let date: String
    let filename: String
    let size: Int
    let hasMarkdown: Bool
    let summary: String

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
    var llmApiKey: String = ""
    var llmBaseUrl: String = ""
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
    var conferenceDaysRecent: Int = 90

    var blogMaxPerSource: Int = 2

    var wechatServiceUrl: String = ""
    var wechatAuthKey: String = ""
    var wechatMpIds: [WechatMpId] = []
    var wechatLimitPerMp: Int = 20
    var wechatDaysRecent: Int = 30

    var outputDir: String = "./docs"
    var logLevel: String = "INFO"
}

struct WechatMpId: Codable, Hashable {
    var id: String
    var name: String
}

struct WechatHealthResponse: Decodable {
    let status: String  // unconfigured | ready | auth_expired | unreachable
    let mpCount: Int?
    let nickname: String?
    let expiresAt: String?
    let message: String?
}

struct AscanModuleProgress: Decodable, Hashable {
    let name: String
    let label: String
    let status: String  // pending | running | done | failed
    let chars: Int
    let error: String?
}

struct AscanSupplementProgress: Decodable, Hashable {
    let isRunning: Bool
    let date: String
    let startedAt: String?
    let phase: String  // running | merging | done | failed
    let modules: [AscanModuleProgress]
    let currentModule: String?
    let error: String?

    var doneCount: Int {
        modules.filter { $0.status == "done" || $0.status == "failed" }.count
    }

    var currentLabel: String {
        if currentModule == "merge" { return "合并日报" }
        return modules.first { $0.name == currentModule }?.label ?? "准备中"
    }

    var failedModules: [AscanModuleProgress] {
        modules.filter { $0.status == "failed" }
    }
}

struct AscanRunStatus: Decodable {
    let isRunning: Bool
    let pid: Int?
    let lastLockTime: String?
    let lockAge: String?
    let recentLog: String?
    let recentLogs: [String]
    let supplement: AscanSupplementProgress?
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
