"use client";

import * as React from "react";
import { InputGroupAddon } from "@/webview/components/ui/input-group";
import { Button } from "@/webview/components/ui/button";
import { X } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

export interface Attachment {
  id: number;
  name: string;
  mimeType: string;
  dataUrl: string;
  label: string;
}

export interface PromptAttachmentsProps {
  attachments: Attachment[];
  onRemove: (id: number) => void;
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
              className="relative group flex items-center gap-1 rounded cursor-pointer border border-border bg-accent/50 text-xs text-muted-foreground hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-1 py-0.5 px-1.5">
                <img src={attachment.dataUrl} alt={attachment.label} className="size-3 rounded-xs object-cover" />
                <span className="max-w-20 truncate text-primary">{attachment.label}</span>
              </div>
              <Button
                variant="ghost"
                className="py-2.5 size-3 inline-flex cursor-pointer rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
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
