import { randomBytes, randomInt } from "node:crypto";
import { Writable } from "node:stream";
import { DEFAULT_CELL_SIZE, type CellSize, type ImagePreview } from "./image-preview";

export type ImageProtocol = "kitty" | "iterm2" | null;

export function detectImageProtocol(env: NodeJS.ProcessEnv, tty: boolean): ImageProtocol {
  const term = env["TERM"]?.toLowerCase() ?? "";
  const program = env["TERM_PROGRAM"]?.toLowerCase() ?? "";
  if (
    !tty ||
    env["CI"] ||
    env["INK_SCREEN_READER"] === "true" ||
    env["TMUX"] ||
    term.startsWith("tmux") ||
    term.startsWith("screen") ||
    term === "dumb"
  )
    return null;
  if (env["ITERM_SESSION_ID"] || program === "iterm.app") return "iterm2";
  if (
    env["KITTY_WINDOW_ID"] ||
    env["WEZTERM_PANE"] ||
    env["GHOSTTY_RESOURCES_DIR"] ||
    ["kitty", "ghostty", "wezterm"].includes(program) ||
    /kitty|ghostty/.test(term)
  )
    return "kitty";
  return null;
}

export function kittyDelete(id: number): string {
  return `\x1b_Ga=d,d=I,i=${id},q=2;\x1b\\`;
}

export function encodeImage(image: ImagePreview, protocol: Exclude<ImageProtocol, null>, id: number): string {
  const base64 = image.png!.toString("base64");
  if (protocol === "iterm2") {
    return `\x1b]1337;File=inline=1;size=${image.png!.length};width=${image.columns};height=${image.rows};preserveAspectRatio=1;doNotMoveCursor=1:${base64}\x07`;
  }
  let output = "";
  for (let offset = 0; offset < base64.length; offset += 4096) {
    const more = offset + 4096 < base64.length ? 1 : 0;
    const header = offset === 0 ? `a=T,f=100,t=d,i=${id},c=${image.columns},r=${image.rows},C=1,q=2,` : "";
    output += `\x1b_G${header}m=${more};${base64.slice(offset, offset + 4096)}\x1b\\`;
  }
  return output;
}

type Placement = { image: ImagePreview; id: number; permanent: boolean };
const runtimes = new WeakMap<NodeJS.WriteStream, TerminalImages>();

export function terminalImagesFor(stdout: NodeJS.WriteStream): TerminalImages | undefined {
  return runtimes.get(stdout);
}

/** Only this stream sees Ink's private markers; the terminal receives pixels in their place. */
export class TerminalImages {
  readonly stdout: NodeJS.WriteStream;
  readonly protocol: ImageProtocol;
  cell: CellSize = DEFAULT_CELL_SIZE;
  private readonly prefix = `DC${randomBytes(5).toString("hex")}`;
  private readonly placements = new Map<string, Placement>();
  private readonly dynamicIds = new Set<number>();
  private readonly staticIds = new Set<number>();
  private counter = 0;
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly output: NodeJS.WriteStream,
    env = process.env
  ) {
    this.protocol = detectImageProtocol(env, Boolean(output.isTTY));
    const stream = new Writable({
      write: (chunk, _encoding, done) => {
        output.write(this.transform(String(chunk)), done);
      },
    });
    // Ink relies on live dimensions and the original stream's resize events.
    Object.defineProperties(stream, {
      isTTY: { get: () => output.isTTY },
      columns: { get: () => output.columns },
      rows: { get: () => output.rows },
    });
    this.stdout = stream as NodeJS.WriteStream;
    output.on("resize", this.onResize);
    runtimes.set(this.stdout, this);
  }

  private onResize = () => {
    this.stdout.emit("resize");
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;

  setCellSize(cell: CellSize): void {
    if (![cell.width, cell.height].every((n) => Number.isFinite(n) && n > 0 && n <= 512)) return;
    if (this.cell.width === cell.width && this.cell.height === cell.height) return;
    this.cell = cell;
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  register(image: ImagePreview, permanent: boolean): string {
    const marker = `${this.prefix}${(++this.counter).toString(36)}X`;
    this.placements.set(marker, { image, permanent, id: randomInt(1, 0xffffffff) });
    return marker;
  }

  imageRow(marker: string, row: number): string {
    // Distinct, full-width rows let Ink diff image placements like text. Padding
    // keeps its erase-to-end-of-line sequence to the right of the rendered pixels.
    return `${marker}R${row}E`.padEnd(40, "Q");
  }

  unregister(marker: string): void {
    // Static markers also live in Ink's fullStaticOutput for screen redraws.
    const placement = this.placements.get(marker);
    if (!placement || placement.permanent) return;
    this.placements.delete(marker);
    if (this.dynamicIds.delete(placement.id) && this.protocol === "kitty") {
      this.output.write(kittyDelete(placement.id));
    }
  }

  transform(chunk: string): string {
    const clearsScreen = /\x1b\[(?:2|3)J/.test(chunk);
    let cleanup = "";
    if (clearsScreen) {
      if (this.protocol === "kitty") {
        for (const id of this.dynamicIds) cleanup += kittyDelete(id);
        for (const id of this.staticIds) cleanup += kittyDelete(id);
      }
      this.dynamicIds.clear();
      this.staticIds.clear();
    }
    const pattern = new RegExp(`(${this.prefix}[0-9a-z]+X)(?:R([0-9])EQ*)?`, "g");
    return (
      cleanup +
      chunk.replace(pattern, (token: string, marker: string, row: string | undefined) => {
        const placement = this.placements.get(marker);
        const spaces = " ".repeat(token.length);
        if (!placement || !this.protocol) return spaces;
        const { image, id, permanent } = placement;
        if (row !== undefined && Number(row) !== image.rows - 1) return spaces;
        const ids = permanent ? this.staticIds : this.dynamicIds;
        const replace = ids.has(id) && this.protocol === "kitty" ? kittyDelete(id) : "";
        ids.add(id);
        // Anchor on the last reserved row: later line erases cannot wipe out the image.
        // Print spaces first so Ink's expected cursor column is preserved after restoring.
        return (
          spaces +
          "\x1b7" +
          `\x1b[${token.length}D` +
          (image.rows > 1 ? `\x1b[${image.rows - 1}A` : "") +
          replace +
          encodeImage(image, this.protocol, id) +
          "\x1b8"
        );
      })
    );
  }

  dispose(): void {
    if (this.protocol === "kitty") {
      for (const id of this.dynamicIds) this.output.write(kittyDelete(id));
    }
    this.output.off("resize", this.onResize);
    runtimes.delete(this.stdout);
    this.placements.clear();
    this.listeners.clear();
  }
}
