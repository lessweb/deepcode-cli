import SwiftUI

struct InputBar: View {
    @ObservedObject var viewModel: ChatViewModel
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("发送消息给 DeepSeek…", text: $viewModel.inputText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...6)
                    .focused($focused)
                    .onSubmit { viewModel.submit() }
                    .disabled(viewModel.settingsHint != nil || viewModel.startupError != nil)
                if viewModel.isStreaming {
                    Button(action: { viewModel.interrupt() }) {
                        Image(systemName: "stop.circle.fill")
                            .imageScale(.large)
                    }
                    .buttonStyle(.borderless)
                    .help("中断当前回复")
                } else {
                    Button(action: { viewModel.submit() }) {
                        Image(systemName: "paperplane.fill")
                            .imageScale(.large)
                    }
                    .buttonStyle(.borderless)
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(8)
        }
        .onAppear { focused = true }
    }
}
