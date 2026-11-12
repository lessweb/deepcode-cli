import { execFile, spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type ClipboardImage = {
  dataUrl: string;
  mimeType: string;
};

function writeClipboardCommand(command: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
      let settled = false;
      const timer = setTimeout(() => finish(false), 3000);
      function finish(success: boolean): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!success) child.kill("SIGKILL");
        resolve(success);
      }
      child.once("error", () => finish(false));
      child.once("exit", (code) => finish(code === 0));
      child.stdin!.once("error", () => finish(false));
      child.stdin!.end(text, "utf8");
    } catch {
      resolve(false);
    }
  });
}

function writeClipboardOsc52(text: string): Promise<boolean> {
  const output = process.stdout;
  if (!output.isTTY) return Promise.resolve(false);
  const sequence = `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`;
  return new Promise((resolve) => {
    const onError = () => finish(false);
    function finish(success: boolean): void {
      // A failed write may emit an error after invoking its callback.
      setImmediate(() => output.removeListener("error", onError));
      resolve(success);
    }
    output.once("error", onError);
    try {
      // The callback also waits for writes accepted under backpressure.
      output.write(sequence, (error) => finish(!error));
    } catch {
      finish(false);
    }
  });
}

export async function writeClipboardTextAsync(text: string): Promise<boolean> {
  if (text.length === 0) return false;

  if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
    return writeClipboardOsc52(text);
  }

  if (process.platform === "darwin") {
    return writeClipboardCommand("pbcopy", [], text);
  }
  if (process.platform === "linux") {
    if (await writeClipboardCommand("wl-copy", ["--type", "text/plain;charset=utf-8"], text)) return true;
    return writeClipboardCommand("xclip", ["-selection", "clipboard", "-in"], text);
  }
  if (process.platform === "win32") {
    const script =
      "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false);" +
      "$ErrorActionPreference = 'Stop';" +
      "Set-Clipboard -Value ([Console]::In.ReadToEnd())";
    return writeClipboardCommand("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], text);
  }
  return false;
}

function readClipboardHtmlCommand(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        command,
        args,
        { encoding: "utf8", timeout: 3000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
        (error, stdout) => resolve(error || !stdout.trim() ? null : stdout)
      );
    } catch {
      resolve(null);
    }
  });
}

function extractWindowsClipboardHtml(value: string): string | null {
  // CF_HTML offsets count UTF-8 bytes, not JavaScript string characters.
  const bytes = Buffer.from(value, "utf8");
  const header = value.match(/^(?:[A-Za-z]+:[^\r\n]*(?:\r\n|\n|\r|$))+/)?.[0] ?? "";
  const headerLength = Buffer.byteLength(header, "utf8");
  function readRange(name: "Fragment" | "HTML"): string | null {
    const start = value.match(new RegExp(`^Start${name}:[ \\t]*(\\d+)[ \\t]*\\r?$`, "m"));
    const end = value.match(new RegExp(`^End${name}:[ \\t]*(\\d+)[ \\t]*\\r?$`, "m"));
    if (!start || !end) return null;
    const from = Number(start[1]);
    const to = Number(end[1]);
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < headerLength ||
      from > to ||
      to > bytes.length
    ) {
      return null;
    }
    return bytes.subarray(from, to).toString("utf8");
  }

  const fragment = readRange("Fragment");
  if (fragment !== null) return fragment;
  const marked = value.match(/<!--\s*StartFragment\s*-->([\s\S]*?)<!--\s*EndFragment\s*-->/i);
  if (marked) return marked[1];
  const html = readRange("HTML");
  if (html !== null) return html;
  // Some producers omit offsets or use -1. Never paste the transport header.
  const htmlStart = value.search(/<(?:!doctype\b|html\b|body\b)/i);
  if (htmlStart >= 0) return value.slice(htmlStart);
  return /^Version:/i.test(value) ? null : value;
}

export async function readClipboardHtmlAsync(): Promise<string | null> {
  let html: string | null = null;
  if (process.platform === "darwin") {
    const script =
      'ObjC.import("AppKit");' +
      'var html = $.NSPasteboard.generalPasteboard.stringForType("public.html");' +
      'html.isNil() ? "" : ObjC.unwrap(html);';
    html = await readClipboardHtmlCommand("osascript", ["-l", "JavaScript", "-e", script]);
  } else if (process.platform === "win32") {
    const script =
      "$ErrorActionPreference = 'Stop';" +
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);" +
      "Add-Type -AssemblyName System.Windows.Forms;" +
      "$html = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Html);" +
      "[Console]::Write($html)";
    const value = await readClipboardHtmlCommand("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-Command",
      script,
    ]);
    html = value === null ? null : extractWindowsClipboardHtml(value);
  } else if (process.platform === "linux") {
    html =
      (await readClipboardHtmlCommand("xclip", ["-selection", "clipboard", "-t", "text/html", "-o"])) ??
      (await readClipboardHtmlCommand("wl-paste", ["--type", "text/html", "--no-newline"]));
  }
  html = html?.replace(/\0+$/, "") ?? null;
  return html?.trim() ? html : null;
}

const PNG_MIME = "image/png";
const IMAGE_MIME_BY_EXT = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function isImageFilePath(value: string): boolean {
  return IMAGE_MIME_BY_EXT.has(path.extname(value.trim()).toLowerCase());
}

function mimeTypeForPath(value: string): string {
  return IMAGE_MIME_BY_EXT.get(path.extname(value.trim()).toLowerCase()) ?? PNG_MIME;
}

function tryRun(command: string, args: string[]): Buffer | null {
  try {
    const result = spawnSync(command, args, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    if (result.status !== 0 || !result.stdout || result.stdout.length === 0) {
      return null;
    }
    return result.stdout;
  } catch {
    return null;
  }
}

function tryRunStatus(command: string, args: string[]): boolean {
  try {
    const result = spawnSync(command, args, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    return result.status === 0;
  } catch {
    return false;
  }
}

function readImageFile(filePath: string): ClipboardImage | null {
  try {
    if (!isImageFilePath(filePath)) {
      return null;
    }
    const buffer = fs.readFileSync(filePath);
    if (buffer.length === 0) {
      return null;
    }
    const mimeType = mimeTypeForPath(filePath);
    return { dataUrl: bufferToDataUrl(buffer, mimeType), mimeType };
  } catch {
    return null;
  }
}

function readMacClipboardImage(): ClipboardImage | null {
  const pngpaste = tryRun("pngpaste", ["-"]);
  if (pngpaste && pngpaste.length > 0) {
    return { dataUrl: bufferToDataUrl(pngpaste, PNG_MIME), mimeType: PNG_MIME };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-clipboard-"));
  const screenshotPath = path.join(tempDir, "clipboard.png");
  try {
    const saved = tryRunStatus("osascript", [
      "-e",
      "set png_data to (the clipboard as «class PNGf»)",
      "-e",
      `set fp to open for access POSIX file "${screenshotPath}" with write permission`,
      "-e",
      "write png_data to fp",
      "-e",
      "close access fp",
    ]);

    if (saved) {
      const image = readImageFile(screenshotPath);
      if (image) {
        return image;
      }
    }

    const fileUrl = tryRun("osascript", ["-e", "get POSIX path of (the clipboard as «class furl»)"]);
    const filePath = fileUrl?.toString("utf8").trim();
    if (filePath) {
      return readImageFile(filePath);
    }

    return null;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

export function readClipboardImage(): ClipboardImage | null {
  if (process.platform === "darwin") {
    return readMacClipboardImage();
  }

  if (process.platform === "linux") {
    const xclip = tryRun("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
    if (xclip && xclip.length > 0) {
      return { dataUrl: bufferToDataUrl(xclip, PNG_MIME), mimeType: PNG_MIME };
    }
    const wlPaste = tryRun("wl-paste", ["--type", "image/png"]);
    if (wlPaste && wlPaste.length > 0) {
      return { dataUrl: bufferToDataUrl(wlPaste, PNG_MIME), mimeType: PNG_MIME };
    }
    return null;
  }

  if (process.platform === "win32") {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms;" +
      "$img = [System.Windows.Forms.Clipboard]::GetImage();" +
      "if ($img) { $ms = New-Object System.IO.MemoryStream;" +
      "$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);" +
      "[Console]::OpenStandardOutput().Write($ms.ToArray(), 0, $ms.Length); }";
    const out = tryRun("powershell", ["-NoProfile", "-Command", script]);
    if (out && out.length > 0) {
      return { dataUrl: bufferToDataUrl(out, PNG_MIME), mimeType: PNG_MIME };
    }
    return null;
  }

  return null;
}

export async function readClipboardImageAsync(): Promise<ClipboardImage | null> {
  return new Promise((resolve, reject) => {
    // Use setImmediate to avoid blocking the event loop
    setImmediate(() => {
      try {
        const result = readClipboardImage();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
