import { useCallback, useState } from "react";
import BubbleDot from "@/webview/components/bubbles/BubbleDot";
import { Button } from "@/webview/components/ui/button";
import Markdown from "@/webview/components/markdown";
import { Check, ClipboardCopy, Copy, MessageSquareWarning } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/webview/components/ui/tooltip";
import { toast } from "@/webview/components/ui/sonner";
import type { SessionMessage } from "@/webview/types";
import { chatService } from "@/webview/services/chatService";
import { FEEDBACK_URL } from "@/webview/constants";

interface AssistantBubbleProps {
  message: SessionMessage;
}

export default function AssistantBubble({ message }: AssistantBubbleProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = message?.content || "";
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message]);

  const handleOpenFeedback = useCallback(() => {
    void chatService.openExternal(FEEDBACK_URL);
  }, []);

  return (
    <div className="flex gap-2 mb-3 group">
      <BubbleDot />
      <div className="flex-1 min-w-0">
        <Markdown>{message?.content || ""}</Markdown>
        <div className="flex items-center gap-0.5 text-sm mt-1">
          {/* Copy */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="group cursor-pointer"
                onClick={handleCopy}
                title={copied ? "Copied!" : "Copy"}
              >
                {copied ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Copy className="size-3.5 text-muted-foreground" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Copy</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="cursor-pointer"
                title="Feedback"
                onClick={handleOpenFeedback}
              >
                <MessageSquareWarning className="size-3.5 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Feedback</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="cursor-pointer"
                title="Copy Request ID"
                onClick={() => {
                  navigator.clipboard
                    .writeText(JSON.stringify({ id: message?.id, sessionId: message?.sessionId }))
                    .catch(() => {});
                  toast.success("Copied to clipboard", { position: "top-center" });
                }}
              >
                <ClipboardCopy className="size-3.5 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Copy Request ID</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
