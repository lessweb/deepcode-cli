/**
 * Prompt image normalization helpers.
 *
 * Summary:
 * Converts image payload inputs into data URLs or remote image URLs for user
 * prompt content. This service owns image path validation, local file loading,
 * and MIME inference.
 *
 * Exports:
 * - normalizeImageList(projectRoot: string, value: unknown): { ok: true; data: string[] } | { ok: false; error: string }
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProjectFilePath } from "./open-file";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function normalizeImageList(
  projectRoot: string,
  value: unknown
): { ok: true; data: string[] } | { ok: false; error: string } {
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const imageUrls: string[] = [];
  for (const item of items) {
    const normalized = normalizeImageItem(projectRoot, item);
    if (!normalized.ok) {
      return normalized;
    }
    if (normalized.data) {
      imageUrls.push(normalized.data);
    }
  }
  return { ok: true, data: imageUrls };
}

function normalizeImageItem(
  projectRoot: string,
  item: unknown
): { ok: true; data: string | null } | { ok: false; error: string } {
  if (typeof item === "string") {
    return normalizeImageString(projectRoot, item);
  }
  if (!isRecord(item)) {
    return { ok: false, error: "Image item must be a string or object" };
  }
  if (typeof item.dataUrl === "string") {
    return normalizeImageString(projectRoot, item.dataUrl);
  }
  if (typeof item.url === "string") {
    return normalizeImageString(projectRoot, item.url);
  }
  if (typeof item.filePath === "string") {
    return readImageFileAsDataUrl(projectRoot, item.filePath);
  }
  if (typeof item.path === "string") {
    return readImageFileAsDataUrl(projectRoot, item.path);
  }
  return { ok: false, error: "Image object requires dataUrl, url, filePath, or path" };
}

function normalizeImageString(
  projectRoot: string,
  value: string
): { ok: true; data: string | null } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, data: null };
  }
  if (trimmed.startsWith("data:image/")) {
    return { ok: true, data: trimmed };
  }
  if (trimmed.startsWith("blob:")) {
    return { ok: false, error: "blob image URLs must be converted before sending to the server" };
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return { ok: true, data: trimmed };
  }
  if (trimmed.startsWith("file://")) {
    try {
      return readImageFileAsDataUrl(projectRoot, fileURLToPath(trimmed));
    } catch {
      return { ok: false, error: "Invalid file URL image" };
    }
  }
  return readImageFileAsDataUrl(projectRoot, trimmed);
}

function readImageFileAsDataUrl(
  projectRoot: string,
  filePath: string
): { ok: true; data: string } | { ok: false; error: string } {
  const request = normalizeProjectFilePath(projectRoot, filePath);
  if (!request.ok) {
    return request;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(request.data.absolutePath);
  } catch {
    return { ok: false, error: `Image file not found: ${request.data.relativePath}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `Image path is not a file: ${request.data.relativePath}` };
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `Image file is too large: ${request.data.relativePath}` };
  }
  const mime = getImageMimeType(request.data.absolutePath);
  if (!mime) {
    return { ok: false, error: `Unsupported image type: ${request.data.relativePath}` };
  }
  return { ok: true, data: `data:${mime};base64,${fs.readFileSync(request.data.absolutePath).toString("base64")}` };
}

function getImageMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
