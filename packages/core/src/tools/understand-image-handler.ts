import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";

const DEFAULT_UNDERSTAND_IMAGE_API_URL = "https://deepcode.vegamo.cn/api/plugin/understand-image";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MIME_TYPE_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

export async function handleUnderstandImageTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const imagePath = typeof args.image_path === "string" ? args.image_path.trim() : "";

  if (!prompt) {
    return toolError('Missing required "prompt" string.');
  }
  if (!imagePath) {
    return toolError('Missing required "image_path" string.');
  }
  if (!path.isAbsolute(imagePath)) {
    return toolError('"image_path" must be an absolute path.');
  }

  const mimeType = MIME_TYPE_BY_EXTENSION.get(path.extname(imagePath).toLowerCase());
  if (!mimeType) {
    return toolError("Unsupported image format. Only JPEG, PNG, and WebP are supported.");
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(imagePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolError(`Unable to access image: ${message}`);
  }
  if (!stat.isFile()) {
    return toolError('"image_path" must point to a regular file.');
  }
  if (stat.size === 0) {
    return toolError("Image file must not be empty.");
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    return toolError("Image file exceeds the 10 MiB limit.");
  }

  const activityId = `understand-image-${randomUUID()}`;
  context.onProcessStart?.(activityId, `UnderstandImage: ${path.basename(imagePath)}`);
  try {
    const image = await fs.promises.readFile(imagePath);
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("image", new Blob([new Uint8Array(image)], { type: mimeType }), path.basename(imagePath));

    const machineId = context.createOpenAIClient?.().machineId;
    const response = await fetch(DEFAULT_UNDERSTAND_IMAGE_API_URL, {
      method: "POST",
      headers: machineId ? { Token: machineId } : undefined,
      body: form,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return toolError(`UnderstandImage API request failed with status ${response.status}${body ? `: ${body}` : ""}`);
    }

    const payload = (await response.json()) as { success?: unknown; result?: unknown; reason?: unknown };
    if (payload.success !== true) {
      const reason =
        typeof payload.reason === "string" && payload.reason.trim() ? payload.reason.trim() : "Unknown error";
      return toolError(`UnderstandImage API failed: ${reason}`);
    }
    if (typeof payload.result !== "string" || !payload.result.trim()) {
      return toolError("The image understanding response was empty.");
    }

    return {
      ok: true,
      name: "UnderstandImage",
      output: payload.result.trim(),
      metadata: { imagePath },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolError(`UnderstandImage request failed: ${message}`);
  } finally {
    context.onProcessExit?.(activityId);
  }
}

function toolError(error: string): ToolExecutionResult {
  return { ok: false, name: "UnderstandImage", error };
}
