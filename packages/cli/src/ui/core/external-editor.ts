import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Edit a prompt with vim. An unchanged file preserves the original text exactly. */
export async function editInExternalEditor(
  initialText: string,
  cwd: string,
  withTerminal: (run: () => Promise<void>) => Promise<void> = (run) => run()
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deepcode-edit-"));
  try {
    const file = join(directory, "prompt.md");
    await writeFile(file, initialText, { encoding: "utf8", mode: 0o600 });
    await withTerminal(
      () =>
        new Promise<void>((resolve, reject) => {
          const child = spawn("vim", [file], { cwd, stdio: "inherit", shell: false });
          child.once("error", reject);
          child.once("exit", (code, signal) => {
            if (code === 0 && !signal) resolve();
            else reject(new Error("vim exited unsuccessfully"));
          });
        })
    );
    const text = await readFile(file, "utf8");
    return text === initialText ? initialText : text.replaceAll("\r\n", "\n").replace(/\n$/, "");
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
