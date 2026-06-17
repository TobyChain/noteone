import Foundation

extension Notification.Name {
    static let unauthorized = Notification.Name("unauthorized")
}

extension JSONDecoder.DateDecodingStrategy {
    /// Parses server ISO8601 timestamps that may or may not carry fractional seconds
    /// (e.g. "2026-06-12T03:14:00.000Z" or "2026-06-12T03:14:00Z"). The built-in
    /// `.iso8601` strategy rejects fractional seconds, so we try both formatters.
    static let iso8601WithOptionalFractional: JSONDecoder.DateDecodingStrategy = {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]

        return .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = withFraction.date(from: raw) ?? plain.date(from: raw) {
                return date
            }
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Unrecognized ISO8601 date: \(raw)"
            ))
        }
    }()
}

enum APIError: Error, LocalizedError {
    case invalidURL
    case unauthorized
    case notFound
    case serverError(Int)
    case decodingError(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .unauthorized: return "Unauthorized"
        case .notFound: return "Not found"
        case .serverError(let code): return "Server error: \(code)"
        case .decodingError(let err): return "Decoding error: \(err.localizedDescription)"
        case .networkError(let err): return "Network error: \(err.localizedDescription)"
        }
    }
}

actor APIClient {
    static let shared = APIClient()

    // DEBUG builds talk to a local dev server; release builds default to the production host.
    // Self-hosters can still override via the SettingsView "服务器" field (calls `configure`).
    #if DEBUG
    private var baseURL = "http://localhost:3000"
    #else
    private var baseURL = "https://api.noteone.app"
    #endif
    private var token: String?
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config)
    }

    func configure(baseURL: String, token: String) {
        self.baseURL = baseURL
        self.token = token
    }

    func setToken(_ token: String) {
        self.token = token
    }

    // MARK: - Auth

    func signInWithApple(identityToken: String, email: String?, name: String?) async throws -> AuthResponse {
        struct Body: Encodable {
            let identityToken: String
            let email: String?
            let name: String?
        }
        return try await post("/auth/apple", body: Body(identityToken: identityToken, email: email, name: name))
    }

    func devLogin(name: String) async throws -> AuthResponse {
        struct Body: Encodable {
            let name: String
        }
        return try await post("/auth/dev-token", body: Body(name: name))
    }

    // MARK: - Notes

    func createNote(_ request: CreateNoteRequest) async throws -> Note {
        let response: NoteWrapper = try await post("/api/notes", body: request)
        return response.note
    }

    func listNotes(limit: Int = 50, offset: Int = 0) async throws -> [Note] {
        let response: NotesWrapper = try await get("/api/notes?limit=\(limit)&offset=\(offset)")
        return response.notes
    }

    func getNote(id: String) async throws -> Note {
        let response: NoteWrapper = try await get("/api/notes/\(id)")
        return response.note
    }

    func updateNote(id: String, title: String? = nil, content: String? = nil) async throws -> Note {
        struct Body: Encodable {
            let title: String?
            let content: String?
        }
        let response: NoteWrapper = try await patch("/api/notes/\(id)", body: Body(title: title, content: content))
        return response.note
    }

    func deleteNote(id: String) async throws {
        let _: DeleteWrapper = try await delete("/api/notes/\(id)")
    }

    func restoreNote(id: String) async throws -> Note {
        let response: NoteWrapper = try await post("/api/notes/\(id)/restore", body: EmptyBody())
        return response.note
    }

    func retryNote(id: String) async throws -> Note {
        let response: NoteWrapper = try await post("/api/notes/\(id)/retry", body: EmptyBody())
        return response.note
    }

    func listTrash() async throws -> [Note] {
        let response: NotesWrapper = try await get("/api/notes/trash")
        return response.notes
    }

    func permanentDeleteNote(id: String) async throws {
        let _: DeleteWrapper = try await delete("/api/notes/\(id)/permanent")
    }

    // MARK: - Uploads

    /// Uploads image data as multipart/form-data and returns an absolute URL to the stored image.
    func uploadImage(data: Data, mimeType: String = "image/png", fileName: String = "image.png") async throws -> String {
        guard let url = URL(string: "\(baseURL)/api/uploads/image") else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if let token = token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let boundary = "Boundary-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body

        let (respData, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.networkError(URLError(.badServerResponse))
        }
        switch http.statusCode {
        case 200...299:
            struct UploadResponse: Decodable { let url: String }
            let decoded = try JSONDecoder().decode(UploadResponse.self, from: respData)
            return decoded.url.hasPrefix("http") ? decoded.url : "\(baseURL)\(decoded.url)"
        case 401:
            NotificationCenter.default.post(name: .unauthorized, object: nil)
            throw APIError.unauthorized
        default:
            throw APIError.serverError(http.statusCode)
        }
    }

    // MARK: - Search

    func searchNotes(query: String, contentType: String? = nil, limit: Int = 20) async throws -> [SearchResult] {
        struct Body: Encodable {
            let query: String
            let contentType: String?
            let limit: Int
        }
        let response: SearchWrapper = try await post("/api/search", body: Body(query: query, contentType: contentType, limit: limit))
        return response.results
    }

    // MARK: - Tags

    func listTags(dimension: String? = nil) async throws -> [Tag] {
        let query = dimension.map { "?dimension=\($0)" } ?? ""
        let response: TagsWrapper = try await get("/api/tags\(query)")
        return response.tags
    }

    // MARK: - Stats

    func getStats() async throws -> StatsResponse {
        return try await get("/api/stats")
    }

    // MARK: - Settings

    func getSettings() async throws -> SettingsResponse {
        return try await get("/api/settings")
    }

    func updateLLMSettings(apiKey: String?, baseUrl: String?, model: String?) async throws -> SettingsResponse {
        struct LLMBody: Encodable {
            let apiKey: String?
            let baseUrl: String?
            let model: String?
        }
        struct Body: Encodable { let llm: LLMBody }
        return try await patch("/api/settings", body: Body(llm: LLMBody(apiKey: apiKey, baseUrl: baseUrl, model: model)))
    }

    // MARK: - Account

    /// Permanently delete the authenticated user and all their data. Returns once the
    /// server replies 204; the caller is expected to clear local credentials.
    func deleteAccount() async throws {
        guard let url = URL(string: "\(baseURL)/api/account") else { throw APIError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        if let token = token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (_, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.networkError(URLError(.badServerResponse))
        }
        switch http.statusCode {
        case 200...299: return
        case 401:
            NotificationCenter.default.post(name: .unauthorized, object: nil)
            throw APIError.unauthorized
        default:
            throw APIError.serverError(http.statusCode)
        }
    }

    /// Download the user's full data export as a zip into a temporary file. Caller can
    /// hand the resulting URL to a share sheet / file viewer.
    func exportData() async throws -> URL {
        guard let url = URL(string: "\(baseURL)/api/export") else { throw APIError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        if let token = token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (tempUrl, response) = try await session.download(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.networkError(URLError(.badServerResponse))
        }
        switch http.statusCode {
        case 200...299:
            // Move out of URLSession's auto-cleanup directory and into our own temp file
            // with a stable name, so the share sheet shows a friendly filename.
            let stamp = ISO8601DateFormatter().string(from: Date()).prefix(10).replacingOccurrences(of: "-", with: "")
            let dest = FileManager.default.temporaryDirectory
                .appendingPathComponent("noteone-export-\(stamp).zip")
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: tempUrl, to: dest)
            return dest
        case 401:
            NotificationCenter.default.post(name: .unauthorized, object: nil)
            throw APIError.unauthorized
        default:
            throw APIError.serverError(http.statusCode)
        }
    }

    // MARK: - Chat

    func sendChat(messages: [ChatMessage], noteIds: [String]? = nil) async throws -> ChatResponseMessage {
        let payload = ChatRequest(
            messages: messages.map { ChatMessagePayload(role: $0.role, content: $0.content) },
            noteIds: noteIds
        )
        let response: ChatResponse = try await post("/api/chat", body: payload)
        return response.message
    }

    // MARK: - Chat Sessions

    func createChatSession(title: String? = nil) async throws -> ChatSession {
        struct Body: Encodable { let title: String? }
        return try await post("/api/chat-sessions", body: Body(title: title))
    }

    func listChatSessions() async throws -> [ChatSession] {
        return try await get("/api/chat-sessions")
    }

    func getChatSession(id: String) async throws -> ChatSessionDetail {
        return try await get("/api/chat-sessions/\(id)")
    }

    func deleteChatSession(id: String) async throws {
        let _: DeleteWrapper = try await delete("/api/chat-sessions/\(id)")
    }

    func sendSessionMessage(sessionId: String, message: String) async throws -> ChatResponseMessage {
        struct Body: Encodable { let message: String }
        struct Resp: Decodable { let message: ChatResponseMessage }
        let response: Resp = try await post("/api/chat-sessions/\(sessionId)/messages", body: Body(message: message))
        return response.message
    }

    // MARK: - HTTP Methods

    private func get<T: Decodable>(_ path: String) async throws -> T {
        return try await request(path, method: "GET")
    }

    private func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        return try await request(path, method: "POST", body: body)
    }

    private func patch<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        return try await request(path, method: "PATCH", body: body)
    }

    private func delete<T: Decodable>(_ path: String) async throws -> T {
        return try await request(path, method: "DELETE")
    }

    private func request<T: Decodable>(_ path: String, method: String, body: (any Encodable)? = nil) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body = body {
            req.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError(URLError(.badServerResponse))
        }

        switch httpResponse.statusCode {
        case 200...299:
            do {
                let decoder = JSONDecoder()
                decoder.keyDecodingStrategy = .convertFromSnakeCase
                decoder.dateDecodingStrategy = .iso8601WithOptionalFractional
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decodingError(error)
            }
        case 401:
            NotificationCenter.default.post(name: .unauthorized, object: nil)
            throw APIError.unauthorized
        case 404:
            throw APIError.notFound
        default:
            throw APIError.serverError(httpResponse.statusCode)
        }
    }
}

// MARK: - Response Wrappers

private struct NoteWrapper: Decodable { let note: Note }
private struct NotesWrapper: Decodable { let notes: [Note] }
private struct TagsWrapper: Decodable { let tags: [Tag] }
private struct DeleteWrapper: Decodable { let deleted: Bool }
private struct SearchWrapper: Decodable { let results: [SearchResult] }
private struct EmptyBody: Encodable {}

struct SearchResult: Codable, Identifiable, Sendable {
    let id: String
    var title: String?
    var content: String
    var contentType: String
    var sourceUrl: String?
    var sourceApp: String?
    var author: String?
    var authorOrg: String?
    var aiSummary: String?
    var similarity: Double?
    var createdAt: Date
    var updatedAt: Date
}

struct StatsResponse: Codable, Sendable {
    let totalNotes: Int
    let byContentType: [ContentTypeCount]
    let topTags: [TagCount]
}

struct ContentTypeCount: Codable, Sendable {
    let contentType: String
    let count: Int
}

struct TagCount: Codable, Sendable {
    let name: String
    let dimension: String
    let count: Int
}

struct SettingsResponse: Codable, Sendable {
    let llm: LLMSettingsInfo
}

struct LLMSettingsInfo: Codable, Sendable {
    let baseUrl: String?
    let model: String?
    let hasApiKey: Bool
}
