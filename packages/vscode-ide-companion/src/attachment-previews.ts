import { createHash } from "node:crypto";
import { extname } from "node:path";
import * as vscode from "vscode";
import { collectPromptImageUrls } from "./utils.js";

/** Serve only referenced attachments, without changing the options of an open webview. */
export class AttachmentPreviews implements vscode.Disposable {
  readonly root = vscode.Uri.from({ scheme: "deepcode-attachment", path: "/images" });
  private readonly files = new Map<string, vscode.Uri>();
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly registration: vscode.Disposable;

  constructor() {
    const source = (uri: vscode.Uri) => {
      const file = this.files.get(uri.path);
      if (!file) throw vscode.FileSystemError.FileNotFound(uri);
      return file;
    };
    const readOnly = () => {
      throw vscode.FileSystemError.NoPermissions();
    };
    this.registration = vscode.workspace.registerFileSystemProvider(
      this.root.scheme,
      {
        onDidChangeFile: this.changes.event,
        watch: () => new vscode.Disposable(() => {}),
        stat: (uri) => vscode.workspace.fs.stat(source(uri)),
        readFile: (uri) => vscode.workspace.fs.readFile(source(uri)),
        readDirectory: () => [],
        createDirectory: readOnly,
        writeFile: readOnly,
        delete: readOnly,
        rename: readOnly,
      },
      { isReadonly: true }
    );
  }

  forMessage(webview: vscode.Webview, message: unknown): Record<string, string> {
    const previews: Record<string, string> = {};
    for (const url of collectPromptImageUrls(message)) {
      try {
        const file = vscode.Uri.parse(url);
        if (file.scheme !== "file") continue;
        const id = createHash("sha256").update(url).digest("hex");
        const uri = vscode.Uri.joinPath(this.root, id + extname(file.path));
        this.files.set(uri.path, file);
        previews[url] = webview.asWebviewUri(uri).toString();
      } catch {
        /* Ignore malformed legacy attachment URLs. */
      }
    }
    return previews;
  }

  dispose(): void {
    this.registration.dispose();
    this.changes.dispose();
    this.files.clear();
  }
}
