import { stripVTControlCharacters } from "node:util";

export function stripTerminalControls(value: string): string {
  // Node's ANSI stripper leaves text behind for private CSI parameters,
  // including the modifyOtherKeys sequences emitted by the prompt input.
  return stripVTControlCharacters(value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ""));
}
