import { stripVTControlCharacters } from "node:util";
import type { SessionStatus } from "@vegamo/deepcode-core";

type TitleOutput = { isTTY?: boolean; write: (text: string) => unknown };
type TerminalTitleState = "idle" | "busy" | "attention";

const BUSY_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ATTENTION_FRAMES = ["[ ! ]", "[ . ]"];

export function terminalTitleState(status: SessionStatus | null | undefined): TerminalTitleState {
  switch (status) {
    case "pending":
    case "processing":
      return "busy";
    case "waiting_for_user":
    case "ask_permission":
      return "attention";
    default:
      return "idle";
  }
}

export function createTerminalTitle(output: TitleOutput) {
  let lastTitle: string | undefined;
  let baseTitle = "";
  let state: TerminalTitleState = "idle";
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function stopAnimation(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }

  function render(): void {
    const prefix = state === "busy" ? BUSY_FRAMES[frame] : state === "attention" ? ATTENTION_FRAMES[frame] : "";
    const title = prefix ? `${prefix} ${baseTitle}` : baseTitle;
    if (title === lastTitle) return;
    output.write(`\u001b]0;${title}\u0007`);
    lastTitle = title;
  }

  return {
    set(title: string, nextState: TerminalTitleState = "idle"): void {
      if (!output.isTTY) return;
      baseTitle = Array.from(stripVTControlCharacters(title))
        .filter((char) => {
          const code = char.codePointAt(0)!;
          return code >= 0x20 && !(code >= 0x7f && code <= 0x9f) && code !== 0x2028 && code !== 0x2029;
        })
        .join("");
      if (nextState !== state) {
        stopAnimation();
        state = nextState;
        frame = 0;
        if (state !== "idle") {
          const frames = state === "busy" ? BUSY_FRAMES : ATTENTION_FRAMES;
          timer = setInterval(
            () => {
              frame = (frame + 1) % frames.length;
              render();
            },
            state === "busy" ? 100 : 1000
          );
          timer.unref();
        }
      }
      render();
    },
    clear(): void {
      stopAnimation();
      state = "idle";
      frame = 0;
      baseTitle = "";
      if (lastTitle === undefined) return;
      render();
      lastTitle = undefined;
    },
  };
}
