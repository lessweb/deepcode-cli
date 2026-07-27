/**
 * Unit tests for extension.ts
 *
 * NOTE: This file is excluded from vitest because vscode module is only
 * available as types at compile time. For VS Code extension testing,
 * use VS Code's extension test runner instead.
 *
 * Tests in this file are for type checking only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";

// Mock vscode module
vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
  },
  window: {
    activeTextEditor: undefined,
    showErrorMessage: vi.fn(),
    showTextDocument: vi.fn().mockResolvedValue({ lineCount: 10 }),
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
  env: {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    machineId: "test-machine-id",
  },
  Uri: {
    file: vi.fn((path: string) => ({ fsPath: path })),
  },
  Position: vi.fn(),
  Selection: vi.fn(),
  Range: vi.fn(),
  TextEditorRevealType: {
    InCenter: 1,
  },
  WebviewViewProvider: class {},
  ExtensionContext: class {},
}));

vi.mock("@vegamo/deepcode-core", () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    initMcpServers: vi.fn().mockResolvedValue(undefined),
  })),
  getCompactPromptTokenThreshold: vi.fn(() => 100000),
  resolveSettingsSources: vi.fn(() => ({
    model: "deepseek-v4-pro",
    baseURL: "https://api.deepseek.com",
    thinkingEnabled: false,
    reasoningEffort: "low" as const,
    debugLogEnabled: false,
  })),
  setShellIfWindows: vi.fn(),
  DEFAULT_MODEL: "deepseek-v4-pro",
  DEFAULT_BASE_URL: "https://api.deepseek.com",
}));

vi.mock("markdown-it", () => {
  return vi.fn().mockImplementation(() => ({
    render: vi.fn((text: string) => `<p>${text}</p>`),
  }));
});

vi.mock("@webview-rpc/host", () => ({
  attachRouterToPanel: vi.fn(),
}));

vi.mock("./getWebviewContent.js", () => ({
  getWebviewContent: vi.fn().mockResolvedValue("<html>test</html>"),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Import after mocks
import { DeepCodeViewProvider, activate, deactivate } from "./extension";

describe("DeepCodeViewProvider", () => {
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      extensionPath: "/test/extension",
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
  });

  it("creates provider instance", () => {
    const provider = new DeepCodeViewProvider(mockContext);
    expect(provider).toBeDefined();
    provider.dispose();
  });

  it("postMessageToWebview handles null webviewView", () => {
    const provider = new DeepCodeViewProvider(mockContext);
    expect(() => provider.postMessageToWebview({ type: "test" })).not.toThrow();
    provider.dispose();
  });

  it("dispose does not throw", () => {
    const provider = new DeepCodeViewProvider(mockContext);
    expect(() => provider.dispose()).not.toThrow();
  });
});

describe("activate", () => {
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      extensionPath: "/test/extension",
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
  });

  it("registers webview view provider", () => {
    activate(mockContext);
    const vscode = require("vscode");
    expect(vscode.commands.registerCommand).toHaveBeenCalled();
  });

  it("creates subscriptions", () => {
    activate(mockContext);
    expect(mockContext.subscriptions.length).toBeGreaterThan(0);
  });
});

describe("deactivate", () => {
  it("does nothing and does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
