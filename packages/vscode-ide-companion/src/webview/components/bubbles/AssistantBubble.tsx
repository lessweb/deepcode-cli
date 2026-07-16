import { useState, useCallback } from "react";
import BubbleDot from "@/webview/components/bubbles/BubbleDot";
import { Button } from "@/webview/components/ui/button";
import Markdown from "@/webview/components/markdown";
import { ArchiveIcon, Check, Copy, MailCheckIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/webview/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/webview/components/ui/dropdown-menu";

interface AssistantBubbleProps {
  content?: string;
  shouldConnect?: boolean;
}

/**
 * AssistantBubble component
 * @param param0
 * @param param0.content
 * @param param0.shouldConnect
 * @constructor
 */
export default function AssistantBubble({ content, shouldConnect = false }: AssistantBubbleProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = content || "";
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <div className="flex gap-2 mb-3 group">
      <BubbleDot />
      <div className="flex-1 min-w-0">
        <Markdown>{content}</Markdown>
        <div className="text-sm mt-1">
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More Options">
                <MoreHorizontalIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuGroup>
                <DropdownMenuItem className="text-xs">
                  <MailCheckIcon />
                  Feedback
                </DropdownMenuItem>
                <DropdownMenuItem className="text-xs">
                  <ArchiveIcon />
                  Copy Request ID
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
