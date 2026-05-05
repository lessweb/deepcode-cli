import Foundation
import SwiftUI

struct DisplayMessage: Identifiable, Equatable {
    let id: String
    let role: String
    let content: String
    let isThinking: Bool
    let isTool: Bool
    let toolName: String?
    let toolParams: String?
    let toolResult: String?
}

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [DisplayMessage] = []
    @Published var isStreaming: Bool = false
    @Published var streamProgress: String = ""
    @Published var statusText: String = "starting…"
    @Published var inputText: String = ""
    @Published var startupError: String?
    @Published var settingsHint: String?
    @Published var modelLabel: String = ""

    private let sidecar = SidecarProcess()
    private var pendingSubmitId: String?
    private var pumpTask: Task<Void, Never>?

    func start() async {
        // Read settings (sync, fast).
        let settings = SettingsLoader.load()
        modelLabel = settings.model
        if !settings.hasApiKey {
            settingsHint = "请先编辑 ~/.deepcode/settings.json 配置 env.API_KEY"
        }

        do {
            try sidecar.launch(projectRoot: SettingsLoader.defaultProjectRoot())
            statusText = "ready"
        } catch {
            startupError = error.localizedDescription
            statusText = "sidecar failed"
            return
        }

        sidecar.onStderrLine = { [weak self] line in
            Task { @MainActor in
                self?.appendSystem("stderr: \(line)")
            }
        }

        pumpTask = Task { [weak self] in
            guard let self = self else { return }
            for await event in self.sidecar.bridge.events {
                await self.handle(event)
            }
        }
    }

    func submit() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, settingsHint == nil else { return }
        let id = UUID().uuidString
        pendingSubmitId = id
        appendUser(text)
        inputText = ""
        isStreaming = true
        statusText = "processing"
        sidecar.send(.submit(id: id, text: text))
    }

    func interrupt() {
        sidecar.send(.interrupt(id: UUID().uuidString))
    }

    private func handle(_ event: ServerEvent) async {
        switch event {
        case let .ready(version, _, _):
            statusText = "ready · v\(version)"
        case .session:
            break
        case let .stream(phase, _, formatted, _):
            switch phase {
            case "start":
                streamProgress = "0"
            case "update":
                streamProgress = formatted
            case "end":
                streamProgress = ""
            default:
                break
            }
        case let .message(message):
            apply(message: message)
        case .sessionsList:
            break
        case .sessionLoaded:
            break
        case let .error(_, message):
            appendSystem("Error: \(message)")
        case let .done(_, status):
            isStreaming = false
            statusText = "done · \(status)"
            pendingSubmitId = nil
        case .ack:
            break
        case let .unknown(rawType):
            appendSystem("Unknown event: \(rawType)")
        }
    }

    private func apply(message: ServerMessage) {
        guard message.visible ?? true else { return }
        let role = message.role
        let rawContent = message.content ?? ""
        // Thinking-only models (e.g. deepseek-v3.2) return the full reply in
        // messageParams.reasoning_content with content="". Fall back to it.
        let reasoning = message.messageParams?.reasoningContent ?? ""
        let content = rawContent.isEmpty ? reasoning : rawContent
        if role == "user" {
            // The CLI echoes user messages but we already appended locally on submit;
            // skip duplicates by checking the latest entry.
            if messages.last?.role == "user", messages.last?.content == content { return }
            messages.append(.init(id: message.id, role: "user", content: content, isThinking: false, isTool: false, toolName: nil, toolParams: nil, toolResult: nil))
        } else if role == "assistant" {
            // Empty assistant message with no reasoning fallback → skip (avoid blank bubble).
            if content.isEmpty { return }
            // Only treat as a "Thinking" summary bubble when the sidecar explicitly tags it.
            // For thinking-only models like deepseek-v3.2 where reasoning_content IS the
            // primary reply (content==""), render it as a normal assistant bubble.
            let isThinking = message.meta?.asThinking ?? false
            messages.append(.init(id: message.id, role: "assistant", content: content, isThinking: isThinking, isTool: false, toolName: nil, toolParams: nil, toolResult: nil))
        } else if role == "tool" {
            let name = message.meta?.function?.name ?? "tool"
            let params = message.meta?.paramsMd ?? ""
            let result = message.meta?.resultMd ?? content
            messages.append(.init(id: message.id, role: "tool", content: "", isThinking: false, isTool: true, toolName: name, toolParams: params, toolResult: result))
        } else if role == "system" {
            // Skip implicit system messages (skill loads, agent instructions, summaries).
            // Only show if visible == true and content is non-empty.
            if (message.visible ?? false), !content.isEmpty {
                messages.append(.init(id: message.id, role: "system", content: content, isThinking: false, isTool: false, toolName: nil, toolParams: nil, toolResult: nil))
            }
        }
    }

    private func appendUser(_ text: String) {
        messages.append(.init(id: UUID().uuidString, role: "user", content: text, isThinking: false, isTool: false, toolName: nil, toolParams: nil, toolResult: nil))
    }

    private func appendSystem(_ text: String) {
        messages.append(.init(id: UUID().uuidString, role: "system", content: text, isThinking: false, isTool: false, toolName: nil, toolParams: nil, toolResult: nil))
    }

    deinit {
        pumpTask?.cancel()
        sidecar.terminate()
    }
}
