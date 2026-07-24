/**
 * Vitest mock for the `vscode` module.
 *
 * VS Code is only available at runtime in the actual VS Code extension host.
 * This mock allows extension utility tests to resolve the import.
 */

const vscodeMock = {
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
    })),
  },
  commands: {
    executeCommand: vi.fn(),
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  ExtensionMode: {
    Development: 1,
    Production: 2,
    Test: 3,
  },
  Uri: {
    file: vi.fn((path: string) => ({ fsPath: path })),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
  },
  env: {
    clipboard: { writeText: vi.fn() },
    machineId: "test-machine-id",
  },
  Position: vi.fn(),
  Selection: vi.fn(),
  Range: vi.fn(),
  TextEditorRevealType: {
    InCenter: 1,
  },
  WebviewViewProvider: class {},
  ExtensionContext: class {},
};

(globalThis as any).vi = vi;

export default vscodeMock;
export const window = vscodeMock.window;
export const commands = vscodeMock.commands;
export const ExtensionMode = vscodeMock.ExtensionMode;
export const Uri = vscodeMock.Uri;
export const workspace = vscodeMock.workspace;
export const env = vscodeMock.env;
export const Position = vscodeMock.Position;
export const Selection = vscodeMock.Selection;
export const Range = vscodeMock.Range;
export const TextEditorRevealType = vscodeMock.TextEditorRevealType;
export const WebviewViewProvider = vscodeMock.WebviewViewProvider;
export const ExtensionContext = vscodeMock.ExtensionContext;
