import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { TerminalImages } from "./terminal-images";

/** Filter terminal size replies before either Ink or custom input listeners see them. */
export class ImageSizeResponseFilter {
  private pending = "";
  private pasting = false;

  constructor(private readonly onSize: (kind: number, height: number, width: number) => void) {}

  feed(chunk: string): string {
    let input = this.pending + chunk;
    this.pending = "";
    let output = "";
    while (input) {
      const escape = input.indexOf("\x1b");
      if (escape === -1) return output + input;
      output += input.slice(0, escape);
      input = input.slice(escape);
      const pasteMarker = this.pasting ? "\x1b[201~" : "\x1b[200~";
      if (input.startsWith(pasteMarker)) {
        this.pasting = !this.pasting;
        output += pasteMarker;
        input = input.slice(pasteMarker.length);
        continue;
      }
      if (pasteMarker.startsWith(input)) {
        this.pending = input;
        return output;
      }
      if (!this.pasting) {
        const response = /^\x1b\[([46]);(\d+);(\d+)t/.exec(input);
        if (response) {
          this.onSize(Number(response[1]), Number(response[2]), Number(response[3]));
          input = input.slice(response[0].length);
          continue;
        }
        if (/^\x1b\[(?:[46](?:;\d*(?:;\d*)?)?)?$/.test(input)) {
          this.pending = input;
          return output;
        }
      }
      output += input[0];
      input = input.slice(1);
    }
    return output;
  }

  get waitMs(): number {
    return /^\x1b\[[46];/.test(this.pending) ? 250 : 20;
  }

  flush(): string {
    const pending = this.pending;
    this.pending = "";
    // Discard an incomplete reply, but preserve an ordinary Escape/Alt key.
    return !this.pasting && /^\x1b\[[46];/.test(pending) ? "" : pending;
  }
}

export function createImageInput(input: NodeJS.ReadStream, images: TerminalImages) {
  if (!images.protocol) return { stdin: input, query() {}, dispose() {} };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cellReported = false;
  const filter = new ImageSizeResponseFilter((kind, height, width) => {
    if (kind === 6 && height > 0 && width > 0) {
      cellReported = true;
      images.setCellSize({ width, height });
    } else if (kind === 4 && !cellReported && images.stdout.columns > 0 && images.stdout.rows > 0) {
      images.setCellSize({ width: width / images.stdout.columns, height: height / images.stdout.rows });
    }
  });
  const decoder = new StringDecoder("utf8");
  const stream = new Transform({
    transform(chunk, _encoding, done) {
      clearTimeout(timer);
      const text = filter.feed(typeof chunk === "string" ? chunk : decoder.write(chunk));
      if (text) this.push(text);
      timer = setTimeout(() => {
        const remaining = filter.flush();
        if (remaining) this.push(remaining);
      }, filter.waitMs);
      timer.unref();
      done();
    },
  });
  const pause = stream.pause.bind(stream);
  const resume = stream.resume.bind(stream);
  Object.assign(stream, {
    isTTY: input.isTTY,
    setRawMode: (mode: boolean) => {
      input.setRawMode(mode);
      if (mode) input.resume();
      else input.pause();
      return stream;
    },
    ref: () => {
      input.ref();
      return stream;
    },
    unref: () => {
      input.unref();
      return stream;
    },
    pause: () => {
      input.pause();
      return pause();
    },
    resume: () => {
      input.resume();
      return resume();
    },
  });
  input.pipe(stream);
  const query = () => {
    cellReported = false;
    if (images.protocol) images.stdout.write("\x1b[16t\x1b[14t");
  };
  images.stdout.on("resize", query);
  return {
    stdin: stream as unknown as NodeJS.ReadStream,
    query,
    dispose() {
      clearTimeout(timer);
      input.unpipe(stream);
      images.stdout.off("resize", query);
      stream.destroy();
    },
  };
}
