import Foundation

// MARK: - Inbound (App → CLI)

enum ClientCommand: Encodable {
    case submit(id: String, text: String)
    case interrupt(id: String?)
    case listSessions(id: String)
    case loadSession(id: String, sessionId: String)
    case newSession(id: String)

    private enum CodingKeys: String, CodingKey {
        case type, id, text, sessionId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .submit(id, text):
            try container.encode("submit", forKey: .type)
            try container.encode(id, forKey: .id)
            try container.encode(text, forKey: .text)
        case let .interrupt(id):
            try container.encode("interrupt", forKey: .type)
            if let id = id { try container.encode(id, forKey: .id) }
        case let .listSessions(id):
            try container.encode("list_sessions", forKey: .type)
            try container.encode(id, forKey: .id)
        case let .loadSession(id, sessionId):
            try container.encode("load_session", forKey: .type)
            try container.encode(id, forKey: .id)
            try container.encode(sessionId, forKey: .sessionId)
        case let .newSession(id):
            try container.encode("new_session", forKey: .type)
            try container.encode(id, forKey: .id)
        }
    }
}

// MARK: - Outbound (CLI → App)

struct ServerSessionEntry: Decodable {
    let id: String
    let summary: String?
    let assistantReply: String?
    let assistantThinking: String?
    let assistantRefusal: String?
    let status: String
    let failReason: String?
    let activeTokens: Int?
    let createTime: String
    let updateTime: String
}

struct ServerMessage: Decodable {
    let id: String
    let sessionId: String
    let role: String
    let content: String?
    let visible: Bool?
    let createTime: String?
    let meta: ServerMessageMeta?
}

struct ServerMessageMeta: Decodable {
    let asThinking: Bool?
    let isSummary: Bool?
    let paramsMd: String?
    let resultMd: String?
    let function: ServerFunctionRef?
}

struct ServerFunctionRef: Decodable {
    let name: String?
    let arguments: String?
}

enum ServerEvent: Decodable {
    case ready(version: String, machineId: String?, projectRoot: String)
    case session(entry: ServerSessionEntry)
    case stream(phase: String, estimatedTokens: Int, formattedTokens: String, sessionId: String?)
    case message(ServerMessage)
    case sessionsList(id: String, sessions: [ServerSessionEntry])
    case sessionLoaded(id: String, sessionId: String, messages: [ServerMessage])
    case error(id: String?, message: String)
    case done(id: String, status: String)
    case ack(id: String)
    case unknown(rawType: String)

    private enum CodingKeys: String, CodingKey {
        case type
        case version, machineId, projectRoot
        case entry
        case phase, estimatedTokens, formattedTokens, sessionId
        case message
        case id, sessions, messages
        case error
        case status
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "ready":
            let version = try container.decode(String.self, forKey: .version)
            let machineId = try container.decodeIfPresent(String.self, forKey: .machineId)
            let projectRoot = try container.decode(String.self, forKey: .projectRoot)
            self = .ready(version: version, machineId: machineId, projectRoot: projectRoot)
        case "session":
            let entry = try container.decode(ServerSessionEntry.self, forKey: .entry)
            self = .session(entry: entry)
        case "stream":
            let phase = try container.decode(String.self, forKey: .phase)
            let est = (try? container.decode(Int.self, forKey: .estimatedTokens)) ?? 0
            let formatted = (try? container.decode(String.self, forKey: .formattedTokens)) ?? "0"
            let sid = try container.decodeIfPresent(String.self, forKey: .sessionId)
            self = .stream(phase: phase, estimatedTokens: est, formattedTokens: formatted, sessionId: sid)
        case "message":
            let msg = try container.decode(ServerMessage.self, forKey: .message)
            self = .message(msg)
        case "sessions_list":
            let id = try container.decode(String.self, forKey: .id)
            let sessions = try container.decode([ServerSessionEntry].self, forKey: .sessions)
            self = .sessionsList(id: id, sessions: sessions)
        case "session_loaded":
            let id = try container.decode(String.self, forKey: .id)
            let sid = try container.decode(String.self, forKey: .sessionId)
            let messages = try container.decode([ServerMessage].self, forKey: .messages)
            self = .sessionLoaded(id: id, sessionId: sid, messages: messages)
        case "error":
            let id = try container.decodeIfPresent(String.self, forKey: .id)
            let message = try container.decode(String.self, forKey: .error)
            self = .error(id: id, message: message)
        case "done":
            let id = try container.decode(String.self, forKey: .id)
            let status = try container.decode(String.self, forKey: .status)
            self = .done(id: id, status: status)
        case "ack":
            let id = try container.decode(String.self, forKey: .id)
            self = .ack(id: id)
        default:
            self = .unknown(rawType: type)
        }
    }
}
