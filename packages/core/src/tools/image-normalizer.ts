import type sharp from "sharp";
import type { Metadata, Sharp } from "sharp";

type SharpModule = typeof sharp;

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 64_000_000;
export const MAX_IMAGE_DIMENSION = 8192;
export const NORMALIZED_IMAGE_MAX_DIMENSION = 2048;
export const NORMALIZED_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export type NormalizedImage = {
  data: Buffer;
  mediaType: Exclude<ImageMediaType, "image/gif">;
  width: number;
  height: number;
  originalDimensions?: { width: number; height: number };
};

type DetectedImage = {
  mediaType: ImageMediaType;
  width: number;
  height: number;
  animated: boolean;
  carriesMetadata: boolean;
  depth: string;
  space: string;
  hasAlpha: boolean;
};

type EncodingAttempt = () => Promise<Omit<NormalizedImage, "originalDimensions">>;

const MIME_TYPE_BY_FORMAT = new Map<string, ImageMediaType>([
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
]);
const NORMALIZATION_QUALITIES = [85, 80, 75] as const;
const LOW_COLOR_SAMPLE_EDGE = 128;
const LOW_COLOR_LIMIT = 256;

export async function normalizeImage(
  data: Buffer,
  declaredMediaType: ImageMediaType,
  sharp: SharpModule
): Promise<NormalizedImage> {
  const detected = await detectImage(data, sharp);
  if (detected.mediaType !== declaredMediaType) {
    throw new Error("The file extension does not match the image data.");
  }

  if (canPassThrough(data, detected)) {
    return {
      data,
      mediaType: detected.mediaType as Exclude<ImageMediaType, "image/gif">,
      width: detected.width,
      height: detected.height,
    };
  }

  const initialScale = Math.min(1, NORMALIZED_IMAGE_MAX_DIMENSION / Math.max(detected.width, detected.height));
  let width = Math.max(1, Math.round(detected.width * initialScale));
  let height = Math.max(1, Math.round(detected.height * initialScale));
  const sample = sharp(data, { failOn: "error", limitInputPixels: false }).rotate().toColourspace("srgb");
  const lowColor = await hasLowColorCount(sample, sharp);

  for (;;) {
    const attempts = encodingAttempts(data, width, height, detected.hasAlpha, lowColor, sharp);
    let smallest: Omit<NormalizedImage, "originalDimensions"> | null = null;
    for (const attempt of attempts) {
      const image = await attempt();
      if (!smallest || image.data.length < smallest.data.length) {
        smallest = image;
      }
      if (image.data.length <= NORMALIZED_IMAGE_MAX_BYTES) {
        return withOriginalDimensions(image, detected);
      }
    }

    if (!smallest || (width === 1 && height === 1)) {
      throw new Error("Image cannot be encoded within the 4 MiB normalized-image limit.");
    }
    const scale = Math.min(0.9, Math.sqrt(NORMALIZED_IMAGE_MAX_BYTES / smallest.data.length) * 0.95);
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
}

async function detectImage(data: Buffer, sharp: SharpModule): Promise<DetectedImage> {
  try {
    const image = sharp(data, { failOn: "error", limitInputPixels: false });
    const metadata = await image.metadata();
    const mediaType = MIME_TYPE_BY_FORMAT.get(metadata.format ?? "");
    if (!mediaType || !metadata.width || !metadata.height) {
      throw new Error("Unsupported or malformed image data.");
    }
    const transposed = metadata.orientation !== undefined && metadata.orientation >= 5;
    const detected = {
      mediaType,
      width: transposed ? metadata.height : metadata.width,
      height: transposed ? metadata.width : metadata.height,
      animated: (metadata.pages ?? 1) > 1,
      carriesMetadata: carriesMetadata(metadata),
      depth: metadata.depth ?? "unknown",
      space: metadata.space ?? "unknown",
      hasAlpha: metadata.hasAlpha ?? false,
    };
    if (detected.width * detected.height > MAX_IMAGE_PIXELS) {
      throw new Error(`Image exceeds the ${MAX_IMAGE_PIXELS.toLocaleString("en-US")}-pixel limit.`);
    }
    if (Math.max(detected.width, detected.height) > MAX_IMAGE_DIMENSION) {
      throw new Error(`Image exceeds the ${MAX_IMAGE_DIMENSION}px per-side limit.`);
    }
    await image.raw().toBuffer();
    return detected;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Unsupported or malformed image data." || error.message.startsWith("Image exceeds the "))
    ) {
      throw error;
    }
    throw new Error("Unsupported or malformed image data.", { cause: error });
  }
}

function carriesMetadata(metadata: Metadata): boolean {
  return (
    metadata.exif !== undefined ||
    metadata.xmp !== undefined ||
    metadata.iptc !== undefined ||
    metadata.icc !== undefined ||
    metadata.hasProfile === true ||
    metadata.tifftagPhotoshop !== undefined ||
    metadata.comments !== undefined ||
    metadata.orientation !== undefined
  );
}

function canPassThrough(data: Buffer, detected: DetectedImage): boolean {
  return (
    detected.mediaType !== "image/gif" &&
    !detected.animated &&
    !detected.carriesMetadata &&
    detected.depth === "uchar" &&
    detected.space === "srgb" &&
    data.length <= NORMALIZED_IMAGE_MAX_BYTES &&
    Math.max(detected.width, detected.height) <= NORMALIZED_IMAGE_MAX_DIMENSION
  );
}

async function hasLowColorCount(pipeline: Sharp, sharp: SharpModule): Promise<boolean> {
  const { data, info } = await pipeline
    .clone()
    .resize({
      width: LOW_COLOR_SAMPLE_EDGE,
      height: LOW_COLOR_SAMPLE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
      kernel: sharp.kernel.nearest,
      fastShrinkOnLoad: false,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = new Set<number>();
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data.readUInt8(offset);
    const green = data.readUInt8(offset + 1);
    const blue = data.readUInt8(offset + 2);
    const alpha = info.channels === 4 ? data.readUInt8(offset + 3) : 255;
    colors.add(((red >> 3) << 15) | ((green >> 3) << 10) | ((blue >> 3) << 5) | (alpha >> 3));
    if (colors.size > LOW_COLOR_LIMIT) {
      return false;
    }
  }
  return true;
}

function encodingAttempts(
  data: Buffer,
  width: number,
  height: number,
  hasAlpha: boolean,
  lowColor: boolean,
  sharp: SharpModule
): EncodingAttempt[] {
  const prepared = sharp(data, { failOn: "error", limitInputPixels: false })
    .rotate()
    .toColourspace("srgb")
    .resize({ width, height, fit: "inside", withoutEnlargement: true });
  const webp = NORMALIZATION_QUALITIES.map((quality) => () => encode(prepared.clone(), "image/webp", quality));
  if (lowColor) {
    return [() => encode(prepared.clone(), "image/png", undefined, !hasAlpha), ...webp];
  }
  if (hasAlpha) {
    return webp;
  }
  return NORMALIZATION_QUALITIES.map((quality) => () => encode(prepared.clone(), "image/jpeg", quality));
}

async function encode(
  pipeline: Sharp,
  mediaType: Exclude<ImageMediaType, "image/gif">,
  quality?: number,
  palette = true
): Promise<Omit<NormalizedImage, "originalDimensions">> {
  const encoded =
    mediaType === "image/png"
      ? pipeline.png({ compressionLevel: 9, palette })
      : mediaType === "image/webp"
        ? pipeline.webp({ quality })
        : pipeline.jpeg({ quality });
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  return { data, mediaType, width: info.width, height: info.height };
}

function withOriginalDimensions(
  image: Omit<NormalizedImage, "originalDimensions">,
  detected: DetectedImage
): NormalizedImage {
  if (image.width === detected.width && image.height === detected.height) {
    return image;
  }
  return {
    ...image,
    originalDimensions: { width: detected.width, height: detected.height },
  };
}
