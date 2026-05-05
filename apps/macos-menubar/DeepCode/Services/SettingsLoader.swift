import Foundation

struct DeepcodeSettings {
    let model: String
    let baseURL: String
    let hasApiKey: Bool
}

enum SettingsLoader {
    static func load() -> DeepcodeSettings {
        let url = settingsURL()
        guard let data = try? Data(contentsOf: url),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return DeepcodeSettings(model: "deepseek-v4-pro", baseURL: "https://api.deepseek.com", hasApiKey: false)
        }
        let env = raw["env"] as? [String: Any] ?? [:]
        let model = (env["MODEL"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "deepseek-v4-pro"
        let baseURL = (env["BASE_URL"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "https://api.deepseek.com"
        let apiKey = env["API_KEY"] as? String ?? ""
        return DeepcodeSettings(model: model, baseURL: baseURL, hasApiKey: !apiKey.isEmpty)
    }

    static func settingsURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".deepcode/settings.json")
    }

    static func defaultProjectRoot() -> String {
        // For the menu bar MVP, use the user's home directory as the project root.
        // Users can change this in a future settings panel.
        FileManager.default.homeDirectoryForCurrentUser.path
    }
}
