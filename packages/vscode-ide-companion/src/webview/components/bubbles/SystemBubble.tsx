import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/webview/components/ui/collapsible";
import BubbleDot from "@/webview/components/bubbles/BubbleDot";
import { ChevronDown } from "lucide-react";
import { Button } from "../ui/button";
import Markdown from "@/webview/components/markdown";

interface SystemBubbleProps {
  content: string;
  meta?: Record<string, unknown>;
  shouldConnect?: boolean;
}

export default function SystemBubble({ content, meta, shouldConnect = false }: SystemBubbleProps) {
  const [open, setOpen] = useState(false);
  const skillName = (meta?.skill as { name?: string } | undefined)?.name || "Unknown Skill";
  const skillDescription = (meta?.skill as { description?: string } | undefined)?.description || content;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="relative w-full flex gap-2 mb-3">
      <BubbleDot className="mt-3.5" />
      {shouldConnect && <div className="absolute left-0.75 h-full w-px bg-muted-foreground top-6"></div>}
      <div className="flex-1 min-w-0">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="group w-full cursor-pointer">
            <span className="font-bold">Skills</span>
            <span className="text-muted-foreground">{skillName}</span>
            <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${open ? "" : "-rotate-90"}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="w-auto">
          <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap p-2">
            <Markdown>{skillDescription}</Markdown>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
