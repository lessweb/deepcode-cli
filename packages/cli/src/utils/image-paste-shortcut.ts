import type { InputKey } from "../ui/hooks/useTerminalInput";

export function getImagePasteShortcutLabel(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "Alt+V" : "Ctrl+V";
}

export function isImagePasteShortcut(
  input: string,
  key: Pick<InputKey, "ctrl" | "meta" | "paste">,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (key.paste || (input !== "v" && input !== "V")) return false;
  return platform === "win32" ? key.meta && !key.ctrl : key.ctrl && !key.meta;
}
