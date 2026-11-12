import type { SessionEntry, SessionMessage } from "@vegamo/deepcode-core";
import wrapAnsi from "wrap-ansi";

export type ProcessOutputItem = {
  id: string;
  command: string;
  pid?: string;
  background: boolean;
  running: boolean;
  output: string;
  exitCode: number | null;
  timeoutMs?: number;
};

export function buildProcessOutputItems(
  messages: SessionMessage[],
  runningProcesses: SessionEntry["processes"]
): ProcessOutputItem[] {
  const items = new Map<string, ProcessOutputItem>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    const fn = message.meta?.function as { name?: string; arguments?: string } | undefined;
    if (fn?.name !== "bash" && fn?.name !== "Bash") continue;
    try {
      const args = JSON.parse(fn.arguments ?? "{}");
      const result = JSON.parse(message.content ?? "{}");
      if (typeof args.command !== "string") continue;
      const id = (message.messageParams as { tool_call_id?: string })?.tool_call_id ?? message.id;
      items.set(id, {
        id,
        command: args.command,
        pid: result.metadata?.processId == null ? undefined : String(result.metadata.processId),
        background: args.run_in_background === true || args.run_in_background === "true",
        running: false,
        output: result.output || result.error || "",
        exitCode: result.metadata?.exitCode ?? null,
      });
    } catch {
      // Older or incomplete tool messages may not have a readable result.
    }
  }
  for (const [pid, process] of runningProcesses ?? []) {
    const id = process.toolCallId ?? [...items.values()].find((item) => item.pid === pid)?.id ?? `process:${pid}`;
    items.set(id, {
      id,
      command: process.command,
      pid,
      background: process.runInBackground ?? items.get(id)?.background ?? false,
      running: true,
      output: "",
      exitCode: null,
      timeoutMs: process.timeoutMs,
    });
  }
  return [...items.values()];
}

export function formatProcessOutputTitle(item: ProcessOutputItem): string {
  const command = item.command.replace(/\r\n?/g, "\n");
  return item.running
    ? `── Process ${item.pid} ${item.background ? "(background) " : ""}[${command}] ──`
    : `── (return ${item.exitCode ?? "unknown"}) [${command}] ──`;
}

/** Wrap into physical rows, expanding tabs and preserving ANSI styles across rows. */
export function wrapProcessOutputLines(text: string, width: number): string[] {
  return wrapAnsi(text, Math.max(1, width), { hard: true, wordWrap: false, trim: false }).split("\n");
}

export function wrapProcessOutputTitle(item: ProcessOutputItem, width: number): string[] {
  return wrapProcessOutputLines(formatProcessOutputTitle(item), width);
}

export function moveProcessOutputSelection(
  items: ProcessOutputItem[],
  id: string | null,
  direction: -1 | 1
): string | null {
  const index = items.findIndex((item) => item.id === id);
  return items[Math.max(0, Math.min(items.length - 1, (index < 0 ? items.length - 1 : index) + direction))]?.id ?? null;
}
