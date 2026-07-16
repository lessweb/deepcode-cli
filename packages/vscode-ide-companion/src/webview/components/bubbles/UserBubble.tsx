import { Check, Copy, PenLine } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useCallback, useMemo, useState } from "react";
import Markdown from "@/webview/components/markdown";
import { Card } from "@/webview/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/webview/components/ui/hover-card";
import type { MessageMeta } from "@vegamo/deepcode-core";

interface UserBubbleProps {
  content: string;
  meta?: MessageMeta;
  onEdit?: () => void;
}

export default function UserBubble({ content, meta, onEdit }: UserBubbleProps) {
  const [copied, setCopied] = useState(false);

  const images = useMemo(() => {
    if (meta && meta.userPrompt && meta?.userPrompt?.imageUrls && meta?.userPrompt?.imageUrls?.length > 0) {
      return (meta.userPrompt?.imageUrls ?? []) as string[];
    }
    return [];
  }, [meta]);

  const handleCopy = useCallback(() => {
    const text = content || "";
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleEdit = useCallback(() => {
    onEdit?.();
  }, [onEdit]);
  return (
    <div className="group flex flex-col items-end justify-end mb-3">
      {(images || []).length > 0 && (
        <div className="max-w-[85%] mb-2 flex flex-wrap gap-2">
          {images.map((image, index) => (
            <HoverCard openDelay={100} closeDelay={200}>
              <HoverCardTrigger asChild>
                <Card size="sm" className="py-0 rounded-lg" key={`image_item_${index}`}>
                  <div className="size-20 cursor-pointer">
                    <img src={image} alt="User image" key={image} className="size-20 object-contain rounded-lg" />
                  </div>
                </Card>
              </HoverCardTrigger>
              <HoverCardContent side="top" align="end" className="w-96">
                <img src={image} alt="User image" key={image} className="w-full object-contain rounded-md" />
              </HoverCardContent>
            </HoverCard>
          ))}
        </div>
      )}
      <div className="max-w-[85%] bg-primary/25 rounded-lg px-3 py-2">
        <Markdown className="user-bubble">{content}</Markdown>
      </div>
      <div className="invisible group-hover:visible text-sm mt-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="cursor-pointer"
              onClick={handleCopy}
              title={copied ? "Copied!" : "Copy"}
            >
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Copy</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="cursor-pointer" onClick={handleEdit}>
              <PenLine className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Edit</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
