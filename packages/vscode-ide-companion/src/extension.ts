import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import OpenAI from "openai";
import type { SessionMessage } from "@vegamo/deepcode-core";
import {
  SessionManager,
  getCompactPromptTokenThreshold,
  type LlmStreamProgress,
  type SessionEntry,
  resolveSettingsSources,
  type DeepcodingSettings,
  type ReasoningEffort,
  type ResolvedDeepcodingSettings,
  setShellIfWindows,
} from "@vegamo/deepcode-core";
import { getWebviewContent } from "./getWebviewContent.js";
import { appRouter, type RouterContext } from "./router.js";
import { attachRouterToPanel } from "@webview-rpc/host";

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

type ReasoningMessageParams = {
  reasoning_content?: string;
};

export class DeepCodeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "deepcode.chatView";

  private readonly context: vscode.ExtensionContext;
  private webviewView: vscode.WebviewView | undefined;
  private readonly sessionManager: SessionManager;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.sessionManager = new SessionManager({
      projectRoot: this.getWorkspaceRoot(),
      createOpenAIClient: () => this.createOpenAIClient(),
      getResolvedSettings: () => this.resolveCurrentSettings(),
      renderMarkdown: (text) => text,
      onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => {
        if (!this.webviewView) return;
        if (!message.visible) return;
        if (message.role !== "tool") {
          const reasoningContent = (message.messageParams as ReasoningMessageParams | null)?.reasoning_content;
          message.content = message.content || reasoningContent || "";
        }
        this.webviewView.webview.postMessage({ type: "appendMessage", message, shouldConnect });
      },
      onSessionEntryUpdated: (entry) => {
        if (!this.webviewView) return;
        this.webviewView.webview.postMessage({
          type: "sessionStatus",
          sessionId: entry.id,
          status: entry.status,
          askPermissions: entry.askPermissions,
          processes: this.serializeProcesses(entry.processes),
          tokenTelemetry: this.buildTokenTelemetry(entry),
        });
      },
      onLlmStreamProgress: (progress: LlmStreamProgress) => {
        if (!this.webviewView) return;
        this.webviewView.webview.postMessage({
          type: "llmStreamProgress",
          progress,
        });
      },
    });
    void this.initializeMcpServers();
  }

  dispose(): void {
    this.sessionManager.dispose();
  }

  postMessageToWebview(message: unknown): void {
    if (this.webviewView) {
      this.webviewView.webview.postMessage(message);
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview"))],
    };

    // Build RPC context
    const rpcContext: RouterContext = {
      sessionManager: this.sessionManager,
      postMessage: (message) => this.webviewView?.webview.postMessage(message),
      copyToClipboard: (text) => void vscode.env.clipboard.writeText(text),
      openFileInEditor: (filePath, line) => this.openFileInEditor(filePath, line),
      getWorkspaceRoot: () => this.getWorkspaceRoot(),
      openSettings: async () => {
        // Open project-level settings if exists, otherwise user-level
        const projectRoot = this.getWorkspaceRoot();
        const projectSettingsPath = path.join(projectRoot, ".deepcode", "settings.json");
        const userSettingsPath = path.join(os.homedir(), ".deepcode", "settings.json");

        if (fs.existsSync(projectSettingsPath)) {
          await this.openFileInEditor(projectSettingsPath, 1);
        } else {
          // Ensure user settings directory exists
          const userSettingsDir = path.dirname(userSettingsPath);
          if (!fs.existsSync(userSettingsDir)) {
            fs.mkdirSync(userSettingsDir, { recursive: true });
          }
          if (!fs.existsSync(userSettingsPath)) {
            fs.writeFileSync(userSettingsPath, JSON.stringify({}, null, 2), "utf8");
          }
          await this.openFileInEditor(userSettingsPath, 1);
        }
      },
      getActiveEditor: () => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document) {
          return {
            fileName: editor.document.fileName,
            languageId: editor.document.languageId,
            lineCount: editor.document.lineCount,
          };
        }
        return null;
      },
    };

    // Attach RPC router
    attachRouterToPanel(appRouter, webviewView as unknown as vscode.WebviewPanel, rpcContext);

    // Set HTML content
    getWebviewContent(this.context, webviewView.webview).then((html) => {
      webviewView.webview.html = html;
    });
  }

  private buildTokenTelemetry(session: SessionEntry | null): {
    model: string;
    thinkingEnabled: boolean;
    reasoningEffort: ReasoningEffort;
    activeTokens: number;
    compactPromptTokenThreshold: number;
    usage: unknown | null;
  } {
    const settings = this.resolveCurrentSettings();
    return {
      model: settings.model,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      activeTokens: session?.activeTokens ?? 0,
      compactPromptTokenThreshold: getCompactPromptTokenThreshold(settings.model),
      usage: session?.usage ?? null,
    };
  }

  private async initializeMcpServers(): Promise<void> {
    try {
      await this.sessionManager.initMcpServers(this.resolveCurrentSettings().mcpServers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to initialize MCP servers: ${message}`);
    }
  }

  private resolveCurrentSettings(): ResolvedDeepcodingSettings {
    return resolveSettingsSources(
      this.readUserSettings(),
      this.readProjectSettings(),
      {
        model: DEFAULT_MODEL,
        baseURL: DEFAULT_BASE_URL,
      },
      process.env as Record<string, string>
    );
  }

  private readUserSettings(): DeepcodingSettings | null {
    try {
      const settingsPath = path.join(os.homedir(), ".deepcode", "settings.json");
      if (!fs.existsSync(settingsPath)) return null;
      const raw = fs.readFileSync(settingsPath, "utf8");
      return JSON.parse(raw) as DeepcodingSettings;
    } catch {
      return null;
    }
  }

  private readProjectSettings(): DeepcodingSettings | null {
    const workspaceRoot = this.getWorkspaceRoot();
    try {
      const settingsPath = path.join(workspaceRoot, ".deepcode", "settings.json");
      if (!fs.existsSync(settingsPath)) return null;
      const raw = fs.readFileSync(settingsPath, "utf8");
      return JSON.parse(raw) as DeepcodingSettings;
    } catch {
      return null;
    }
  }

  private getWorkspaceRoot(): string {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (workspace) return workspace.uri.fsPath;
    return process.cwd();
  }

  private createOpenAIClient(): {
    client: OpenAI | null;
    model: string;
    baseURL: string;
    thinkingEnabled: boolean;
    reasoningEffort: ReasoningEffort;
    debugLogEnabled: boolean;
    notify?: string;
    webSearchTool?: string;
    env?: Record<string, string>;
    machineId?: string;
  } {
    const settings = this.resolveCurrentSettings();
    const { apiKey, baseURL, model, thinkingEnabled, reasoningEffort, debugLogEnabled, notify, webSearchTool, env } =
      settings;
    const machineId = vscode.env.machineId;

    if (!apiKey) {
      return {
        client: null,
        model,
        baseURL,
        thinkingEnabled,
        reasoningEffort,
        debugLogEnabled,
        notify,
        webSearchTool,
        env,
        machineId,
      };
    }

    const client = new OpenAI({ apiKey, baseURL: baseURL || undefined });
    return {
      client,
      model,
      baseURL,
      thinkingEnabled,
      reasoningEffort,
      debugLogEnabled,
      notify,
      webSearchTool,
      env,
      machineId,
    };
  }

  private serializeProcesses(
    processes: Map<string, { startTime: string; command: string }> | null
  ): Record<string, { startTime: string; command: string }> | null {
    if (!processes || processes.size === 0) return null;
    const serialized: Record<string, { startTime: string; command: string }> = {};
    for (const [pid, entry] of processes.entries()) {
      serialized[pid] = entry;
    }
    return serialized;
  }

  private async openFileInEditor(filePath: string, line: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
    const targetLine = Number.isFinite(line) && line > 0 ? Math.floor(line) - 1 : 0;
    const safeLine = Math.min(Math.max(0, targetLine), Math.max(0, document.lineCount - 1));
    const position = new vscode.Position(safeLine, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  process.env.NoDefaultCurrentDirectoryInExePath = "1";
  try {
    setShellIfWindows();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(message);
  }

  const provider = new DeepCodeViewProvider(context);
  context.subscriptions.push(provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DeepCodeViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Listen for active editor changes and send to webview
  const sendActiveEditorInfo = () => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document) {
      const doc = editor.document;
      provider.postMessageToWebview({
        type: "activeEditor",
        fileName: doc.fileName,
        languageId: doc.languageId,
        lineCount: doc.lineCount,
      });
    }
  };

  // Send initial active editor
  sendActiveEditorInfo();

  // Listen for editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      sendActiveEditorInfo();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("deepcode.openView", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.deepcode");
      await vscode.commands.executeCommand("deepcode.chatView.focus");
    })
  );
}

export function deactivate(): void {
  // no-op
}
