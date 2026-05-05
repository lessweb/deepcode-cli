import SwiftUI

@main
struct DeepCodeApp: App {
    @StateObject private var viewModel = ChatViewModel()

    var body: some Scene {
        MenuBarExtra("DeepCode", systemImage: "sparkles") {
            ChatPopover(viewModel: viewModel)
                .frame(width: 480, height: 640)
                .onAppear {
                    Task { await viewModel.start() }
                }
        }
        .menuBarExtraStyle(.window)
    }
}
