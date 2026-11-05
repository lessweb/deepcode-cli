import os from "node:os";
import type { InputKey } from "../ui/hooks/useTerminalInput";

function isWsl(platform: NodeJS.Platform): boolean {
  return (
    platform === "linux" &&
    (Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) || /microsoft/i.test(os.release()))
  );
}

export function getImagePasteShortcutLabel(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "Alt+V";
  return isWsl(platform) ? "Ctrl+V / Alt+V" : "Ctrl+V";
}

export function isImagePasteShortcut(
  input: string,
  key: Pick<InputKey, "ctrl" | "meta" | "paste">,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (key.paste || (input !== "v" && input !== "V")) return false;
  if (platform === "win32") return key.meta && !key.ctrl;
  return (key.ctrl && !key.meta) || (key.meta && !key.ctrl && isWsl(platform));
}
