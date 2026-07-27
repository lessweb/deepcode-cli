import * as vscode from "vscode";

type OutputChannel = {
  appendLine: (message: string) => void;
};

interface LoggerContext {
  extensionMode: vscode.ExtensionMode;
}

export function createLogger(context: LoggerContext, logger: OutputChannel) {
  const isDevelopment = context.extensionMode === vscode.ExtensionMode.Development;

  return (message: string) => {
    // Always log in Development mode, or when explicitly needed
    // In Production, you can conditionally enable debug logging via settings
    if (isDevelopment) {
      logger.appendLine(message);
    }

    // Also log important startup messages in all modes
    if (message.includes("activated") || message.includes("CheckForUpdates")) {
      logger.appendLine(message);
    }
  };
}
