import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp, { type Sharp } from "sharp";
import type { ToolExecutionContext } from "../tools/executor";
import { handleReadImageTool } from "../tools/read-image-handler";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ReadImage returns supported image formats as hidden image messages", async () => {
  const workspace = createTempDir("deepcode-read-image-formats-");
  const fixtures = [
    { extension: ".png", mime: "image/png", encode: (image: Sharp) => image.png() },
    { extension: ".jpg", mime: "image/jpeg", encode: (image: Sharp) => image.jpeg() },
    { extension: ".webp", mime: "image/webp", encode: (image: Sharp) => image.webp() },
    { extension: ".gif", mime: "image/gif", encode: (image: Sharp) => image.gif() },
  ];

  for (const fixture of fixtures) {
    const filePath = path.join(workspace, `pixel${fixture.extension}`);
    await fixture.encode(sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })).toFile(filePath);

    const result = await handleReadImageTool({ file_path: filePath }, createContext(workspace));

    assert.equal(result.ok, true, result.error);
    assert.equal(result.name, "ReadImage");
    assert.match(result.output ?? "", /<type>image<\/type>/);
    assert.equal(result.followUpMessages?.length, 1);
    const followUp = result.followUpMessages?.[0];
    assert.equal(followUp?.role, "user");
    assert.equal(followUp?.visible, false);
    const content = Array.isArray(followUp?.contentParams) ? followUp.contentParams : [];
    assert.equal(content.length, 1);
    const dataUrl = String((content[0] as { image_url?: { url?: unknown } }).image_url?.url ?? "");
    assert.match(dataUrl, /^data:image\/(?:png|jpeg|webp);base64,/);
    if (fixture.mime !== "image/gif") {
      assert.equal(result.metadata?.mime, fixture.mime);
    }
  }
});

test("ReadImage downsizes large images and reports original dimensions", async () => {
  const workspace = createTempDir("deepcode-read-image-resize-");
  const filePath = path.join(workspace, "wide.png");
  await sharp({ create: { width: 3000, height: 300, channels: 3, background: "#336699" } })
    .png()
    .toFile(filePath);

  const result = await handleReadImageTool({ file_path: filePath }, createContext(workspace));

  assert.equal(result.ok, true, result.error);
  assert.equal(result.metadata?.width, 2048);
  assert.equal(result.metadata?.height, 205);
  assert.deepEqual(result.metadata?.originalDimensions, { width: 3000, height: 300 });
  assert.match(result.output ?? "", /downscaled from 3000x300 px/);
  assert.ok(Number(result.metadata?.bytes) <= 4 * 1024 * 1024);
});

test("ReadImage applies EXIF orientation and preserves transparency", async () => {
  const workspace = createTempDir("deepcode-read-image-orientation-");
  const orientedPath = path.join(workspace, "oriented.jpg");
  const transparentPath = path.join(workspace, "transparent.png");
  await sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(orientedPath);
  await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 0.5 } } })
    .png()
    .toFile(transparentPath);

  const oriented = await handleReadImageTool({ file_path: orientedPath }, createContext(workspace));
  const transparent = await handleReadImageTool({ file_path: transparentPath }, createContext(workspace));

  assert.equal(oriented.ok, true, oriented.error);
  assert.equal(oriented.metadata?.width, 20);
  assert.equal(oriented.metadata?.height, 40);
  assert.equal(transparent.ok, true, transparent.error);
  const content = transparent.followUpMessages?.[0]?.contentParams as Array<{ image_url?: { url?: string } }>;
  const encoded = content[0]?.image_url?.url?.split(",", 2)[1] ?? "";
  const metadata = await sharp(Buffer.from(encoded, "base64")).metadata();
  assert.equal(metadata.hasAlpha, true);
});

test("ReadImage rejects unsupported, mismatched, malformed, empty, and oversized sources", async () => {
  const workspace = createTempDir("deepcode-read-image-validation-");
  const unsupportedPath = path.join(workspace, "pixel.bmp");
  const mismatchPath = path.join(workspace, "pixel.png");
  const malformedPath = path.join(workspace, "broken.webp");
  const emptyPath = path.join(workspace, "empty.gif");
  const oversizedPath = path.join(workspace, "oversized.jpg");
  fs.writeFileSync(unsupportedPath, Buffer.from([1]));
  await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
    .jpeg()
    .toFile(mismatchPath);
  fs.writeFileSync(malformedPath, Buffer.from("not an image"));
  fs.writeFileSync(emptyPath, Buffer.alloc(0));
  fs.writeFileSync(oversizedPath, Buffer.alloc(1));
  fs.truncateSync(oversizedPath, 20 * 1024 * 1024 + 1);

  const unsupported = await handleReadImageTool({ file_path: unsupportedPath }, createContext(workspace));
  const mismatch = await handleReadImageTool({ file_path: mismatchPath }, createContext(workspace));
  const malformed = await handleReadImageTool({ file_path: malformedPath }, createContext(workspace));
  const empty = await handleReadImageTool({ file_path: emptyPath }, createContext(workspace));
  const oversized = await handleReadImageTool({ file_path: oversizedPath }, createContext(workspace));

  assert.match(unsupported.error ?? "", /Only PNG, JPEG, WebP, and GIF/);
  assert.match(mismatch.error ?? "", /extension does not match/);
  assert.match(malformed.error ?? "", /malformed image data/);
  assert.match(empty.error ?? "", /must not be empty/);
  assert.match(oversized.error ?? "", /20 MiB source limit/);
});

test("ReadImage enforces decoded dimension limits", async () => {
  const workspace = createTempDir("deepcode-read-image-dimensions-");
  const filePath = path.join(workspace, "too-wide.png");
  await sharp({ create: { width: 8193, height: 1, channels: 3, background: "red" } })
    .png()
    .toFile(filePath);

  const result = await handleReadImageTool({ file_path: filePath }, createContext(workspace));

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /8192px per-side limit/);
});

test("ReadImage loads Sharp only when image normalization starts", async () => {
  const workspace = createTempDir("deepcode-read-image-loader-");
  const filePath = path.join(workspace, "pixel.png");
  await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
    .png()
    .toFile(filePath);
  let loadCount = 0;
  const context = createContext(workspace);
  context.loadSharp = async () => {
    loadCount += 1;
    return sharp;
  };

  const unsupported = await handleReadImageTool({ file_path: path.join(workspace, "pixel.bmp") }, context);
  const result = await handleReadImageTool({ file_path: filePath }, context);

  assert.equal(unsupported.ok, false);
  assert.equal(loadCount, 1);
  assert.equal(result.ok, true, result.error);
});

function createContext(projectRoot: string): ToolExecutionContext {
  return {
    sessionId: "read-image-test",
    projectRoot,
    toolCall: {
      id: "tool-call-id",
      type: "function",
      function: { name: "ReadImage", arguments: "{}" },
    },
  };
}

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
