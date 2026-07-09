import { useState, useCallback } from "react";
import BubbleDot from "@/webview/components/bubbles/BubbleDot";
import { Button } from "@/webview/components/ui/button";
import Markdown from "@/webview/components/markdown";
import { Check, Copy } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/webview/components/ui/tooltip";

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
      <BubbleDot connectToPrev={shouldConnect} />
      <div className="flex-1 min-w-0">
        <Markdown>{content}</Markdown>
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
                {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Copy</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
