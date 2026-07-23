import * as React from "react";
import type { Attachment } from "@/webview/components/PromptAttachments";
import { ATTACHMENT_LABEL, ATTACHMENT_PASTE_MAX } from "@/webview/constants";

function isImageFile(file: File): boolean {
  return Boolean(file && typeof file.type === "string" && file.type.startsWith("image/"));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}
export function usePromptAttachments(options?: {
  /** Maximum number of pasted images allowed. Defaults to ATTACHMENT_PASTE_MAX. */
  maxImageCount?: number;
  /** Called when the pasted images would exceed maxImageCount. */
  onMaxExceeded?: () => void;
}) {
  const maxImageCount = options?.maxImageCount ?? ATTACHMENT_PASTE_MAX;
  const onMaxExceeded = options?.onMaxExceeded;

  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const nextIdRef = React.useRef(0);

  // Ref to access the latest attachment count in the stale closure of handlePaste
  const attachmentsRef = React.useRef(attachments);
  attachmentsRef.current = attachments;

  const handlePaste = React.useCallback(
    async (event: React.ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items || []);

      // Collect all valid image files from the clipboard first
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file && isImageFile(file)) {
          event.preventDefault();
          imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) return;

      const currentCount = attachmentsRef.current.length;
      const remaining = maxImageCount - currentCount;

      // Already at or above the limit
      if (remaining <= 0) {
        onMaxExceeded?.();
        return;
      }

      // Only accept up to the remaining slots
      const filesToAdd = imageFiles.slice(0, remaining);
      if (imageFiles.length > remaining) {
        onMaxExceeded?.();
      }

      // Read all files in parallel
      const results = await Promise.allSettled(filesToAdd.map(readFileAsDataUrl));

      setAttachments((prev) => {
        const newAttachments: Attachment[] = [];
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status === "fulfilled") {
            nextIdRef.current += 1;
            const file = filesToAdd[i];
            newAttachments.push({
              id: nextIdRef.current,
              name: file.name || ATTACHMENT_LABEL,
              mimeType: file.type || "image/png",
              dataUrl: result.value,
              label: ATTACHMENT_LABEL,
            });
          } else {
            console.error("Failed to attach pasted image.", result.reason);
          }
        }
        return [...prev, ...newAttachments];
      });
    },
    [maxImageCount, onMaxExceeded]
  );

  const removeAttachment = React.useCallback((id: number) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = React.useCallback(() => {
    setAttachments([]);
  }, []);

  const getImageUrls = React.useCallback(() => {
    return attachments.map((a) => a.dataUrl);
  }, [attachments]);

  // Restore image attachments from a list of data URLs (used when editing a message).
  const loadImages = React.useCallback((imageUrls: string[]) => {
    if (!imageUrls || imageUrls.length === 0) return;
    setAttachments((prev) => {
      const existing = new Set(prev.map((a) => a.dataUrl));
      const restored = imageUrls
        .filter((url) => !existing.has(url))
        .map((url) => {
          nextIdRef.current += 1;
          return {
            id: nextIdRef.current,
            name: ATTACHMENT_LABEL,
            mimeType: url.startsWith("data:") ? url.slice(5, url.indexOf(";")) || "image/png" : "image/png",
            dataUrl: url,
            label: ATTACHMENT_LABEL,
          };
        });
      return [...prev, ...restored];
    });
  }, []);

  return {
    attachments,
    handlePaste,
    removeAttachment,
    clearAttachments,
    getImageUrls,
    loadImages,
  };
}
