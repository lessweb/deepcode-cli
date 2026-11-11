import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_CELL_SIZE, imagePlaceholder, prepareImagePreview, thumbnailLayout } from "../ui/core/image-preview";
import { detectImageProtocol, encodeImage, TerminalImages } from "../ui/core/terminal-images";
import { createImageInput, ImageSizeResponseFilter } from "../ui/core/terminal-image-input";
import { PassThrough, Writable } from "node:stream";

export async function makeImageUrl(width = 800, height = 600) {
  const png = await sharp({ create: { width, height, channels: 4, background: "red" } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function outputStream() {
  const writes: string[] = [];
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        writes.push(String(chunk));
        done();
      },
    }),
    { isTTY: true, columns: 80, rows: 24 }
  );
  return { stdout: stdout as unknown as NodeJS.WriteStream, writes };
}

test("thumbnail layout preserves proportions within 40 columns and 10 rows", () => {
  assert.deepEqual(thumbnailLayout(800, 600, DEFAULT_CELL_SIZE), {
    pixelsWide: 240,
    pixelsHigh: 180,
    columns: 27,
    rows: 10,
  });
  assert.deepEqual(thumbnailLayout(800, 600, { width: 10, height: 10 }), {
    pixelsWide: 133,
    pixelsHigh: 100,
    columns: 14,
    rows: 10,
  });
  for (const [width, height] of [
    [1, 10000],
    [10000, 1],
    [8, 8],
    [300, 900],
    [900, 300],
  ]) {
    const layout = thumbnailLayout(width, height, DEFAULT_CELL_SIZE);
    assert.ok(layout.columns > 0 && layout.columns <= 40);
    assert.ok(layout.rows > 0 && layout.rows <= 10);
    assert.ok(layout.pixelsWide <= width && layout.pixelsHigh <= height);
  }
});

test("preview preparation stays in memory, preserves dimensions, and pads whole cells", async () => {
  const url = await makeImageUrl();
  const preview = await prepareImagePreview(url, DEFAULT_CELL_SIZE, true);
  assert.equal(imagePlaceholder(0, preview), "[image #1 (800×600)]");
  const png = await sharp(preview.png!).metadata();
  assert.equal(png.width, preview.columns * DEFAULT_CELL_SIZE.width);
  assert.equal(png.height, preview.rows * DEFAULT_CELL_SIZE.height);
  assert.equal(await prepareImagePreview(url, DEFAULT_CELL_SIZE, true), preview);
  const text = await prepareImagePreview(url, DEFAULT_CELL_SIZE, false);
  assert.equal(text.png, undefined);
  assert.equal(imagePlaceholder(1, text), "[image #2 (800×600)]");
});

test("preview honors EXIF orientation, handles small images, and falls back on invalid sources", async () => {
  const jpeg = await sharp({ create: { width: 120, height: 80, channels: 3, background: "blue" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const image = await prepareImagePreview(`data:image/jpeg;base64,${jpeg.toString("base64")}`, DEFAULT_CELL_SIZE, true);
  assert.equal(imagePlaceholder(0, image), "[image #1 (80×120)]");
  const small = await prepareImagePreview(await makeImageUrl(8, 8), DEFAULT_CELL_SIZE, true);
  assert.equal(small.columns, 1);
  assert.equal(small.rows, 1);
  for (const url of ["data:image/png;base64,bad", "https://example.com/image.png", "/private/image.png"]) {
    const fallback = await prepareImagePreview(url, DEFAULT_CELL_SIZE, true);
    assert.equal(fallback.png, undefined);
    assert.equal(imagePlaceholder(0, fallback), "[image #1]");
  }
});

test("capability detection falls back for multiplexers, pipes and unknown terminals", () => {
  for (const env of [{ TERM_PROGRAM: "kitty" }, { TERM_PROGRAM: "ghostty" }, { WEZTERM_PANE: "1" }])
    assert.equal(detectImageProtocol(env, true), "kitty");
  assert.equal(detectImageProtocol({ TERM_PROGRAM: "iTerm.app" }, true), "iterm2");
  for (const env of [
    {},
    { TERM_PROGRAM: "vscode" },
    { TMUX: "/tmp/tmux", KITTY_WINDOW_ID: "1" },
    { TERM: "screen-256color", ITERM_SESSION_ID: "1" },
  ])
    assert.equal(detectImageProtocol(env, true), null);
  assert.equal(detectImageProtocol({ TERM_PROGRAM: "kitty" }, false), null);
});

test("native protocols use inline bytes, bounded chunks and quiet Kitty responses", () => {
  const image = { columns: 40, rows: 10, png: Buffer.alloc(10000) };
  const kitty = encodeImage(image, "kitty", 123);
  assert.match(kitty, /a=T,f=100,t=d,i=123,c=40,r=10,C=1,q=2,m=1/);
  const chunks = [...kitty.matchAll(/\x1b_G[^;]+;([^\x1b]*)\x1b\\/g)].map((m) => m[1]);
  assert.ok(chunks.every((chunk) => chunk.length <= 4096));
  assert.equal(chunks.join(""), image.png.toString("base64"));
  assert.match(kitty, /m=0;/);
  assert.match(
    encodeImage(image, "iterm2", 123),
    /1337;File=inline=1;size=10000;width=40;height=10;preserveAspectRatio=1/
  );
});

test("output adapter replaces markers, restores cursor and deletes only dynamic images on redraw", () => {
  const { stdout } = outputStream();
  const terminal = new TerminalImages(stdout, { TERM_PROGRAM: "kitty" });
  const image = { columns: 10, rows: 3, png: Buffer.from("png") };
  const draft = terminal.register(image, false);
  const sent = terminal.register(image, true);
  const frame = terminal.transform(`${draft}\n${sent}`);
  assert.ok(!frame.includes(draft) && !frame.includes(sent));
  assert.match(frame, /\x1b7.*\x1b\[2A.*\x1b8/);
  const ids = [...frame.matchAll(/a=T,f=100,t=d,i=(\d+)/g)].map((m) => m[1]);
  const redraw = terminal.transform(`\x1b[2K${draft}`);
  assert.ok(redraw.includes(`a=d,d=I,i=${ids[0]}`));
  assert.ok(!redraw.includes(`a=d,d=I,i=${ids[1]}`));
  const clear = terminal.transform("\x1b[2J");
  assert.ok(clear.includes(`a=d,d=I,i=${ids[1]}`));
  terminal.unregister(draft);
  assert.equal(terminal.transform(draft), " ".repeat(draft.length));
  terminal.unregister(sent);
  assert.match(terminal.transform(sent), /a=T/);
  terminal.dispose();
});

test("history release frees retained previews even after clearing, while preserving current and draft images", () => {
  const { stdout, writes } = outputStream();
  const terminal = new TerminalImages(stdout, { TERM_PROGRAM: "kitty" });
  const image = { columns: 10, rows: 3, png: Buffer.from("png") };
  const current = Symbol("current");
  const sent = terminal.register(image, true, current);
  const draft = terminal.register(image, false);
  const placements = Reflect.get(terminal, "placements") as Map<string, unknown>;
  for (let i = 0; i < 100; i++) {
    const history = Symbol("old");
    const marker = terminal.register({ ...image, png: Buffer.alloc(1024) }, true, history);
    terminal.transform(marker);
    terminal.unregister(marker);
    if (i % 2 === 0) terminal.transform("\x1b[2J");
    assert.match(terminal.transform(marker), /a=T/, "ordinary clear or child unmount must allow history replay");
    if (i % 2 === 0) terminal.transform("\x1b[2J");
    terminal.releaseHistory(history);
    assert.equal(terminal.transform(marker), " ".repeat(marker.length));
    assert.equal(placements.size, 2, "expired histories must release their PNG references");
  }
  assert.match(writes.join(""), /a=d,d=I/);
  assert.match(terminal.transform(sent), /a=T/);
  assert.match(terminal.transform(draft), /a=T/);
  terminal.releaseHistory(current);
  assert.equal(placements.size, 1);
  assert.match(terminal.transform(draft), /a=T/);
  terminal.dispose();
  assert.equal(placements.size, 0);
});

test("exit releases history buffers while leaving static images in terminal scrollback", () => {
  const { stdout, writes } = outputStream();
  const terminal = new TerminalImages(stdout, { TERM_PROGRAM: "kitty" });
  const history = Symbol("exiting");
  const marker = terminal.register({ columns: 10, rows: 3, png: Buffer.from("png") }, true, history);
  terminal.transform(marker);
  terminal.releaseHistory(history, true);
  assert.equal((Reflect.get(terminal, "placements") as Map<string, unknown>).size, 0);
  terminal.dispose();
  assert.doesNotMatch(writes.join(""), /a=d,d=I/);
});

test("size response filter handles every split, preserves keys and leaves paste data untouched", () => {
  const response = "\x1b[6;18;9t";
  for (let split = 1; split < response.length; split++) {
    const sizes: number[][] = [];
    const filter = new ImageSizeResponseFilter((...size) => sizes.push(size));
    assert.equal(filter.feed(`a${response.slice(0, split)}`) + filter.feed(`${response.slice(split)}b`), "ab");
    assert.deepEqual(sizes, [[6, 18, 9]]);
  }
  const filter = new ImageSizeResponseFilter(() => assert.fail("paste is not a response"));
  const pasted = `\x1b[200~${response}中文\x1b[201~`;
  assert.equal([...pasted].map((c) => filter.feed(c)).join(""), pasted);
  assert.equal(filter.feed("\x1b[A"), "\x1b[A");
  assert.equal(filter.feed("\x1b"), "");
  assert.equal(filter.flush(), "\x1b");
  filter.feed("\x1b[6;18;");
  assert.equal(filter.flush(), "");
});

test("input adapter filters replies before data/readable consumers and resumes after suspension", async () => {
  const { stdout } = outputStream();
  const images = new TerminalImages(stdout, { TERM_PROGRAM: "kitty" });
  const source = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const adapter = createImageInput(source as unknown as NodeJS.ReadStream, images);
  let received = "";
  adapter.stdin.on("data", (chunk) => {
    received += String(chunk);
  });
  source.write("\x1b[6;20;10thello");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received, "hello");
  assert.deepEqual(images.cell, { width: 10, height: 20 });
  adapter.stdin.pause();
  adapter.stdin.setRawMode(true);
  adapter.stdin.resume();
  source.write(" world");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received, "hello world");
  adapter.dispose();
  images.dispose();
});

test("persisted file attachments render without creating thumbnails on disk and refresh after changes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "deepcode-preview-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "图片 #1.png");
  const url = pathToFileURL(file).href;
  const dataUrl = await makeImageUrl();
  await writeFile(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  const image = await prepareImagePreview(url, DEFAULT_CELL_SIZE, true);
  assert.ok(image.png);
  assert.equal(imagePlaceholder(0, image), "[image #1 (800×600)]");
  assert.deepEqual(await readdir(root), ["图片 #1.png"]);
  const text = await prepareImagePreview(url, DEFAULT_CELL_SIZE, false);
  assert.equal(imagePlaceholder(0, text), "[image #1 (800×600)]");
  assert.equal(text.png, undefined);
  await writeFile(file, Buffer.from((await makeImageUrl(100, 200)).split(",")[1], "base64"));
  const changed = await prepareImagePreview(url, DEFAULT_CELL_SIZE, true);
  assert.equal(imagePlaceholder(0, changed), "[image #1 (100×200)]");
  await writeFile(file, "broken image");
  assert.equal((await prepareImagePreview(url, DEFAULT_CELL_SIZE, true)).png, undefined);
  await rm(file);
  assert.equal(imagePlaceholder(0, await prepareImagePreview(url, DEFAULT_CELL_SIZE, true)), "[image #1]");
  assert.equal((await prepareImagePreview(pathToFileURL(root).href, DEFAULT_CELL_SIZE, true)).png, undefined);
});

test("image rows reserve full width so incremental line erases cannot cut into the image", () => {
  const { stdout, writes } = outputStream();
  const terminal = new TerminalImages(stdout, { TERM_PROGRAM: "kitty" });
  const marker = terminal.register({ columns: 40, rows: 3, png: Buffer.from("png") }, false);
  const rows = [0, 1, 2].map((row) => terminal.imageRow(marker, row));
  assert.equal(new Set(rows).size, 3);
  assert.ok(rows.every((row) => row.length === 40));
  assert.equal(terminal.transform(rows[0]), " ".repeat(40));
  const lastRow = terminal.transform(rows[2] + "\x1b[K");
  assert.match(lastRow, /\x1b7\x1b\[40D\x1b\[2A/);
  assert.ok(lastRow.endsWith("\x1b8\x1b[K"), "erase must run after restoring the cursor to column 40");
  assert.equal(terminal.transform("\x1b[2K"), "\x1b[2K", "erasing unrelated footer rows must not delete images");
  terminal.unregister(marker);
  assert.match(writes.join(""), /a=d,d=I/);
  assert.equal(terminal.transform(rows[2]), " ".repeat(40));
  terminal.dispose();
});
