import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/webview/components/ui/collapsible";
import BubbleDot from "@/webview/components/bubbles/BubbleDot";
import AskUserQuestion from "@/webview/components/AskUserQuestion";
import PlanRenderer from "@/webview/components/PlanRenderer";
import DiffPreview from "@/webview/components/DiffPreview";
import { ChevronDown } from "lucide-react";
import { Button } from "@/webview/components/ui/button";

interface ToolBubbleProps {
  content: string;
  meta?: Record<string, unknown>;
  shouldConnect?: boolean;
}

interface ToolData {
  ok: boolean;
  name: string;
  output: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool Bubble
 * @param param0
 * @param param0.content
 * @param param0.meta
 * @param param0.shouldConnect
 * @constructor
 */
export default function ToolBubble({ content, meta, shouldConnect = false }: ToolBubbleProps) {
  let toolData: ToolData = { ok: false, name: "unknown", output: "" };
  try {
    toolData = JSON.parse(content || "{}");
  } catch {
    // ignore parse errors
  }

  const isOk = Boolean(toolData.ok);
  const toolName = toolData.name || "unknown";
  const paramsMd = ((meta?.paramsMd as string) || "").trim();
  const resultMd = ((meta?.resultMd as string) || "").trim();
  const isAskUserQuestion = toolData.metadata?.kind === "ask_user_question";

  const [open, setOpen] = useState<boolean>(isAskUserQuestion);

  // Special rendering for AskUserQuestion
  if (isAskUserQuestion) {
    return (
      <div className="relative flex gap-2 mb-3">
        <BubbleDot variant={isOk ? "success" : "error"} connectToPrev={shouldConnect} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium mb-1">{toolName}</div>
          <AskUserQuestion toolData={toolData} />
        </div>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="relative flex gap-2 mb-3">
      <BubbleDot variant={isOk ? "success" : "error"} connectToPrev={shouldConnect} className="mt-4" />
      <div className="absolute left-0.75 h-full w-px bg-muted-foreground top-6"></div>
      <div className="flex-1 min-w-0">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="group w-full flex data-[state=open]:rounded-b-none data-[state=open]:border-muted"
          >
            <span className="font-medium">{toolName}</span>
            {paramsMd && (
              <div className="text-xs break-all w-auto text-left flex-1 text-muted-foreground truncate">{paramsMd}</div>
            )}
            <ChevronDown className={`ml-auto group-data-[state=open]:rotate-180`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="w-auto data-[state=open]:bg-muted data-[state=open]:rounded-t-none data-[state=open]:rounded-b-sm">
          <div className="text-sm">
            {/* Plan renderer */}
            {toolName.toLowerCase() === "updateplan" && toolData.ok && toolData.metadata?.plan ? (
              <PlanRenderer plan={String(toolData.metadata.plan)} />
            ) : /* Write/Edit with diff preview */
            (toolName.toLowerCase() === "edit" || toolName.toLowerCase() === "write") &&
              toolData.ok &&
              toolData.metadata ? (
              <DiffPreview toolData={toolData} />
            ) : (
              <pre className="text-xs text-chart-2 whitespace-pre-wrap wrap-break-word p-2">
                {resultMd || toolData.output || content}
              </pre>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
