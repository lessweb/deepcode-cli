import * as fs from "fs";
import * as path from "path";
import type { SharpLoader } from "../common/tool-types";
import { MAX_IMAGE_BYTES, normalizeImage, type ImageMediaType, type NormalizedImage } from "./image-normalizer";

const MIME_TYPE_BY_EXTENSION = new Map<string, ImageMediaType>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

export type LoadedImageFile = {
  image: NormalizedImage;
  stat: fs.Stats;
};

export async function loadImageFile(filePath: string, loadSharp?: SharpLoader): Promise<LoadedImageFile> {
  const declaredMediaType = MIME_TYPE_BY_EXTENSION.get(path.extname(filePath).toLowerCase());
  if (!declaredMediaType) {
    throw new Error("Unsupported image format. Only PNG, JPEG, WebP, and GIF are supported.");
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to stat image: ${message}`, { cause: error });
  }
  if (!stat.isFile()) {
    throw new Error('"file_path" must point to a regular file.');
  }
  if (stat.size === 0) {
    throw new Error("Image file must not be empty.");
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error("Image file exceeds the 20 MiB source limit.");
  }

  const source = await fs.promises.readFile(filePath);
  const sharp = loadSharp ? await loadSharp() : (await import("sharp")).default;
  return { image: await normalizeImage(source, declaredMediaType, sharp), stat };
}
