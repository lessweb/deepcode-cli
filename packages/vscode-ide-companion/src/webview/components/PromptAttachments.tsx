"use client";

import * as React from "react";
import { InputGroupAddon } from "@/webview/components/ui/input-group";
import { Button } from "@/webview/components/ui/button";
import { X } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

interface Attachment {
  id: number;
  name: string;
  mimeType: string;
  dataUrl: string;
  label: string;
}

interface PromptAttachmentsProps {
  attachments: Attachment[];
  onRemove: (id: number) => void;
}

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

export function PromptAttachments({ attachments, onRemove }: PromptAttachmentsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <InputGroupAddon className="flex flex-wrap gap-1 px-2.5 pb-1.5" align="block-start">
      {attachments.map((attachment) => (
        <HoverCard openDelay={100} closeDelay={200} key={attachment.id}>
          <HoverCardTrigger asChild>
            <div
              key={attachment.id}
              className="relative group flex items-center gap-1 rounded-md cursor-pointer border border-border bg-accent/50 text-xs text-muted-foreground hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-1 py-0.5 px-1.5">
                <img src={attachment.dataUrl} alt={attachment.label} className="size-3 rounded-xs object-cover" />
                <span className="max-w-20 truncate">{attachment.label}</span>
              </div>
              <Button
                variant="ghost"
                className="py-2.5 size-3 inline-flex cursor-pointer text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                onClick={() => onRemove(attachment.id)}
                title="Remove"
              >
                <X className="size-2.5" />
              </Button>
            </div>
          </HoverCardTrigger>
          <HoverCardContent side="top" align="center">
            <img src={attachment.dataUrl} alt={attachment.label} className="w-full object-contain" />
          </HoverCardContent>
        </HoverCard>
      ))}
    </InputGroupAddon>
  );
}
