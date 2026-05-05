import SwiftUI

struct ChatPopover: View {
    @ObservedObject var viewModel: ChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            HeaderBar(viewModel: viewModel)
            Divider()
            if let error = viewModel.startupError {
                ErrorBanner(message: error)
            } else if let hint = viewModel.settingsHint {
                ErrorBanner(message: hint)
            } else {
                MessageList(messages: viewModel.messages)
            }
            Divider()
            InputBar(viewModel: viewModel)
        }
    }
}

private struct HeaderBar: View {
    @ObservedObject var viewModel: ChatViewModel

    var body: some View {
        HStack {
            Image(systemName: "sparkles")
            Text("DeepCode")
                .font(.headline)
            Spacer()
            if !viewModel.modelLabel.isEmpty {
                Text(viewModel.modelLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text("·")
                .foregroundStyle(.secondary)
            Text(viewModel.statusText)
                .font(.caption2)
                .foregroundStyle(.secondary)
            if viewModel.isStreaming, !viewModel.streamProgress.isEmpty {
                Text("\(viewModel.streamProgress) tok")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

private struct ErrorBanner: View {
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message)
                .font(.callout)
                .foregroundStyle(.orange)
                .padding()
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
