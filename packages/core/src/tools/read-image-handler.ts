import * as path from "path";
import type { ToolExecutionContext, ToolExecutionFollowUpMessage, ToolExecutionResult } from "./executor";
import { markFileRead } from "../common/state";
import type { NormalizedImage } from "./image-normalizer";
import { loadImageFile } from "./image-file";
import { resolveReadFilePath } from "./read-handler";

export async function handleReadImageTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const resolved = resolveReadFilePath(args.file_path, context.projectRoot);
  if (!resolved.ok) {
    return toolError(resolved.error);
  }
  const filePath = resolved.filePath;

  try {
    const { image, stat } = await loadImageFile(filePath, context.loadSharp);
    markFileRead(context.sessionId, filePath, {
      content: "",
      timestamp: Math.floor(stat.mtimeMs),
      isPartialView: true,
    });
    return {
      ok: true,
      name: "ReadImage",
      output: formatImageOutput(filePath, image),
      metadata: {
        imagePath: filePath,
        mime: image.mediaType,
        bytes: image.data.length,
        width: image.width,
        height: image.height,
        ...(image.originalDimensions ? { originalDimensions: image.originalDimensions } : {}),
      },
      followUpMessages: [buildImageFollowUpMessage(filePath, image)],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolError(`Unable to read image: ${message}`);
  }
}

function formatImageOutput(filePath: string, image: NormalizedImage): string {
  let scaled = "";
  if (image.originalDimensions) {
    const x = (image.originalDimensions.width / image.width).toFixed(2);
    const y = (image.originalDimensions.height / image.height).toFixed(2);
    const advice =
      x === y ? `multiply coordinates by ${x}` : `multiply x coordinates by ${x} and y coordinates by ${y}`;
    scaled =
      ` (downscaled from ${image.originalDimensions.width}x${image.originalDimensions.height} px; ` +
      `${advice} to locate features in the original file)`;
  }
  return `<path>${filePath}</path>
<type>image</type>
<content>
${image.mediaType} image, ${image.width}x${image.height} px, ${image.data.length} bytes${scaled}
</content>`;
}

function buildImageFollowUpMessage(filePath: string, image: NormalizedImage): ToolExecutionFollowUpMessage {
  return {
    role: "user",
    content:
      `The ReadImage tool has loaded \`${path.basename(filePath)}\`. ` +
      "Use the attached image content to answer the original request.",
    contentParams: [
      {
        type: "image_url",
        image_url: {
          url: `data:${image.mediaType};base64,${image.data.toString("base64")}`,
        },
      },
    ],
    visible: false,
  };
}

function toolError(error: string): ToolExecutionResult {
  return { ok: false, name: "ReadImage", error };
}
