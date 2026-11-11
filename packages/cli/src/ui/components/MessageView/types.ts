import type { SessionMessage } from "@vegamo/deepcode-core";
import type { ImagePreview } from "../../core/image-preview";

export type MessageViewProps = {
  message: SessionMessage;
  collapsed?: boolean;
  width?: number;
  projectRoot?: string;
  imagePreviews?: ImagePreview[];
  permanentImages?: boolean;
};
export type ToolSummary = {
  name: string;
  params: string;
  ok: boolean;
  metadata: Record<string, unknown> | null;
};

export type DiffPreviewLine = {
  marker: string;
  lineNumber: number | null;
  content: string;
  kind: "added" | "removed" | "context";
};
