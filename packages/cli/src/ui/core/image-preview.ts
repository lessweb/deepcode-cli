import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ImagePreviewCache } from "./image-preview-cache";

export type CellSize = { width: number; height: number };
export type ImagePreview = {
  width?: number;
  height?: number;
  columns: number;
  rows: number;
  png?: Buffer;
};
export const DEFAULT_CELL_SIZE: CellSize = { width: 9, height: 18 };
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

export function thumbnailLayout(width: number, height: number, cell: CellSize) {
  const scale = Math.min(1, (40 * cell.width) / width, (10 * cell.height) / height);
  const pixelsWide = Math.max(1, Math.floor(width * scale));
  const pixelsHigh = Math.max(1, Math.floor(height * scale));
  return {
    pixelsWide,
    pixelsHigh,
    columns: Math.min(40, Math.ceil(pixelsWide / cell.width)),
    rows: Math.min(10, Math.ceil(pixelsHigh / cell.height)),
  };
}

export function imagePlaceholder(index: number, image?: ImagePreview): string {
  const dimensions = image?.width && image.height ? ` (${image.width}×${image.height})` : "";
  return `[image #${index + 1}${dimensions}]`;
}

const previews = new ImagePreviewCache();

export async function prepareImagePreview(
  url: string,
  cell: CellSize,
  graphics: boolean,
  signal?: AbortSignal
): Promise<ImagePreview> {
  if (signal?.aborted) return { columns: 0, rows: 1 };
  let sourceVersion = "";
  if (url.startsWith("file:")) {
    try {
      const info = await stat(fileURLToPath(url));
      if (!info.isFile() || info.size > MAX_SOURCE_BYTES) return { columns: 0, rows: 1 };
      sourceVersion = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    } catch {
      return { columns: 0, rows: 1 };
    }
  }
  if (signal?.aborted) return { columns: 0, rows: 1 };
  const key = createHash("sha256")
    .update(url)
    .update(`:${sourceVersion}:${cell.width}:${cell.height}:${graphics}`)
    .digest("hex");
  return previews.get(key, (decodeSignal) => decodePreview(url, cell, graphics, decodeSignal), signal);
}

/** Submit a batch incrementally so a long transcript cannot monopolize the decode queue. */
export async function prepareImagePreviews(
  urls: string[],
  cell: CellSize,
  graphics: boolean,
  signal: AbortSignal
): Promise<ImagePreview[]> {
  const images: ImagePreview[] = [];
  for (const url of urls) {
    if (signal.aborted) break;
    images.push(await prepareImagePreview(url, cell, graphics, signal));
  }
  return images;
}

async function decodePreview(
  url: string,
  cell: CellSize,
  graphics: boolean,
  signal: AbortSignal
): Promise<ImagePreview> {
  const result: ImagePreview = { columns: 0, rows: 1 };
  try {
    const bytes = await readPreviewSource(url, signal);
    signal.throwIfAborted();
    if (!bytes) return result;
    const source = sharp(bytes, { limitInputPixels: 32 * 1024 * 1024 });
    const metadata = await source.metadata();
    signal.throwIfAborted();
    if (!metadata.width || !metadata.height) return result;
    const rotated = (metadata.orientation ?? 1) >= 5;
    result.width = rotated ? metadata.height : metadata.width;
    result.height = rotated ? metadata.width : metadata.height;
    const layout = thumbnailLayout(result.width, result.height, cell);
    result.columns = layout.columns;
    result.rows = layout.rows;
    if (graphics) {
      // Pad to whole cells so Kitty's explicit c/r placement cannot stretch the pixels.
      const boxWidth = result.columns * cell.width;
      const boxHeight = result.rows * cell.height;
      const scale = Math.min(1, 2048 / boxWidth, 2048 / boxHeight);
      const canvasWidth = Math.max(1, Math.round(boxWidth * scale));
      const canvasHeight = Math.max(1, Math.round(boxHeight * scale));
      const resized = await source
        .timeout({ seconds: 5 })
        .autoOrient()
        .resize({
          width: Math.max(1, Math.floor(layout.pixelsWide * scale)),
          height: Math.max(1, Math.floor(layout.pixelsHigh * scale)),
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer({ resolveWithObject: true });
      signal.throwIfAborted();
      result.png = await sharp(resized.data)
        .extend({
          top: 0,
          left: 0,
          right: Math.max(0, canvasWidth - resized.info.width),
          bottom: Math.max(0, canvasHeight - resized.info.height),
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      signal.throwIfAborted();
    }
  } catch {
    if (signal.aborted) return { columns: 0, rows: 1 };
    // A preview must never prevent sending the original attachment.
  }
  return result;
}

async function readPreviewSource(url: string, signal: AbortSignal): Promise<Buffer | undefined> {
  signal.throwIfAborted();
  // Submitted attachments are persisted as file URLs; clipboard drafts use data URLs.
  // Only explicit attachment references are read. Remote URLs are never fetched.
  if (url.startsWith("file:")) {
    const file = await open(fileURLToPath(url), "r");
    try {
      signal.throwIfAborted();
      const info = await file.stat();
      signal.throwIfAborted();
      if (!info.isFile() || info.size === 0 || info.size > MAX_SOURCE_BYTES) return;
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        signal.throwIfAborted();
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      return bytes.subarray(0, offset);
    } finally {
      await file.close();
    }
  }
  const match = /^data:image\/[\w.+-]+;base64,([\s\S]+)$/.exec(url);
  if (!match || match[1].length > 44 * 1024 * 1024) return;
  const bytes = Buffer.from(match[1], "base64");
  return bytes.length <= MAX_SOURCE_BYTES ? bytes : undefined;
}
