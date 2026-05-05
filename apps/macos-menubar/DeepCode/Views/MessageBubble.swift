import SwiftUI

struct MessageBubble: View {
    let message: DisplayMessage

    var body: some View {
        switch message.role {
        case "user":
            HStack(alignment: .top) {
                Spacer(minLength: 24)
                Text(message.content)
                    .padding(8)
                    .background(Color.accentColor.opacity(0.18))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        case "assistant":
            VStack(alignment: .leading, spacing: 4) {
                if message.isThinking {
                    Text(message.content.isEmpty ? "Thinking…" : "Thinking · \(truncated(message.content))")
                        .font(.caption)
                        .italic()
                        .foregroundStyle(.secondary)
                } else {
                    Text(message.content)
                        .textSelection(.enabled)
                }
            }
        case "tool":
            DisclosureGroup {
                if let params = message.toolParams, !params.isEmpty {
                    Text("params:").font(.caption2).foregroundStyle(.secondary)
                    Text(params).font(.system(.caption, design: .monospaced))
                        .padding(.bottom, 4)
                }
                if let result = message.toolResult, !result.isEmpty {
                    Text("result:").font(.caption2).foregroundStyle(.secondary)
                    Text(result).font(.system(.caption, design: .monospaced))
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "wrench.and.screwdriver")
                    Text(message.toolName ?? "tool")
                        .font(.caption)
                        .bold()
                    if let params = message.toolParams, !params.isEmpty {
                        Text(truncated(params, max: 60))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
        case "system":
            Text(message.content)
                .font(.caption)
                .foregroundStyle(.secondary)
        default:
            Text(message.content)
        }
    }

    private func truncated(_ s: String, max: Int = 80) -> String {
        if s.count <= max { return s }
        return String(s.prefix(max)) + "…"
    }
}
