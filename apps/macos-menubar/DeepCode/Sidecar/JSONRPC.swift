import Foundation

/// Wraps an NSPipe + line buffer producing decoded ServerEvents asynchronously.
final class JSONRPCBridge {
    private let inputPipe: Pipe
    private let outputPipe: Pipe
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private var stdoutBuffer = Data()

    let events: AsyncStream<ServerEvent>
    private let eventsContinuation: AsyncStream<ServerEvent>.Continuation

    init(inputPipe: Pipe, outputPipe: Pipe) {
        self.inputPipe = inputPipe
        self.outputPipe = outputPipe
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
        var continuation: AsyncStream<ServerEvent>.Continuation!
        self.events = AsyncStream { c in continuation = c }
        self.eventsContinuation = continuation
        installReader()
    }

    private func installReader() {
        outputPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let self = self else { return }
            let data = handle.availableData
            if data.isEmpty {
                self.eventsContinuation.finish()
                handle.readabilityHandler = nil
                return
            }
            self.stdoutBuffer.append(data)
            self.drainLines()
        }
    }

    private func drainLines() {
        while let nlIndex = stdoutBuffer.firstIndex(of: 0x0A) {
            let lineData = stdoutBuffer.subdata(in: stdoutBuffer.startIndex..<nlIndex)
            stdoutBuffer.removeSubrange(stdoutBuffer.startIndex...nlIndex)
            guard !lineData.isEmpty else { continue }
            do {
                let event = try decoder.decode(ServerEvent.self, from: lineData)
                eventsContinuation.yield(event)
            } catch {
                let raw = String(data: lineData, encoding: .utf8) ?? "<non-utf8>"
                eventsContinuation.yield(.error(id: nil, message: "Decode failed: \(error). Line: \(raw)"))
            }
        }
    }

    func send(_ command: ClientCommand) {
        do {
            var data = try encoder.encode(command)
            data.append(0x0A) // newline
            try inputPipe.fileHandleForWriting.write(contentsOf: data)
        } catch {
            eventsContinuation.yield(.error(id: nil, message: "Send failed: \(error)"))
        }
    }

    func close() {
        try? inputPipe.fileHandleForWriting.close()
    }
}
