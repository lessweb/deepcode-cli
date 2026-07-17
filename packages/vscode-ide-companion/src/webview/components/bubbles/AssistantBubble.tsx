import { useState, useCallback } from "react";
import BubbleDot from "@/webview/components/bubbles/BubbleDot";
import { Button } from "@/webview/components/ui/button";
import Markdown from "@/webview/components/markdown";
import {
  Bug,
  Check,
  ClipboardCopy,
  Copy,
  FileCodeCorner,
  FilePenLine,
  MessageSquareWarning,
  MoreHorizontalIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/webview/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/webview/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/webview/components/ui/dropdown-menu";
import { toast } from "@/webview/components/ui/sonner";
import type { SessionMessage } from "@/webview/types";
import { chatService } from "@/webview/services/chatService";

const FEEDBACK_URL = "https://github.com/lessweb/deepcode-cli/issues";

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
    chatService.openExternal(FEEDBACK_URL);
  }, []);

  return (
    <AlertDialog>
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
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon-xs" className="cursor-pointer" title="Feedback">
                    <MessageSquareWarning className="size-3.5 text-muted-foreground" />
                  </Button>
                </AlertDialogTrigger>
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
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Open Feedback Page</AlertDialogTitle>
          <AlertDialogDescription>This will open the feedback page in your browser. Continue?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleOpenFeedback}>Open</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
