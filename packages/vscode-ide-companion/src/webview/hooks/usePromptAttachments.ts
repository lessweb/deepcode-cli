import * as React from "react";
import type { Attachment } from "@/webview/components/PromptAttachments";

const ATTACHMENT_LABEL = "Pasted Image";

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
export function usePromptAttachments() {
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const nextIdRef = React.useRef(0);

  const handlePaste = React.useCallback(async (event: React.ClipboardEvent) => {
    const items = Array.from(event.clipboardData?.items || []);
    for (const item of items) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && isImageFile(file)) {
        event.preventDefault();
        try {
          const dataUrl = await readFileAsDataUrl(file);
          nextIdRef.current += 1;
          setAttachments((prev) => [
            ...prev,
            {
              id: nextIdRef.current,
              name: file.name || ATTACHMENT_LABEL,
              mimeType: file.type || "image/png",
              dataUrl,
              label: ATTACHMENT_LABEL,
            },
          ]);
        } catch (error) {
          console.error("Failed to attach pasted image.", error);
        }
        return;
      }
    }
  }, []);

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
