import Foundation

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

    private var baseURL = "http://localhost:3000"
    private var token: String?

    func configure(baseURL: String, token: String) {
        self.baseURL = baseURL
        self.token = token
    }

    func setToken(_ token: String) {
        self.token = token
    }

    // MARK: - Auth

    func signInWithApple(appleId: String, email: String?, name: String?) async throws -> AuthResponse {
        struct Body: Encodable {
            let appleId: String
            let email: String?
            let name: String?
        }
        return try await post("/auth/apple", body: Body(appleId: appleId, email: email, name: name))
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

    // MARK: - Search

    func searchNotes(query: String, limit: Int = 20) async throws -> [SearchResult] {
        struct Body: Encodable {
            let query: String
            let limit: Int
        }
        let response: SearchWrapper = try await post("/api/search", body: Body(query: query, limit: limit))
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

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError(URLError(.badServerResponse))
        }

        switch httpResponse.statusCode {
        case 200...299:
            do {
                let decoder = JSONDecoder()
                decoder.keyDecodingStrategy = .convertFromSnakeCase
                decoder.dateDecodingStrategy = .iso8601
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decodingError(error)
            }
        case 401:
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
