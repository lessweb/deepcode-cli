import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/webview/components/ui/collapsible";
import BubbleDot from "@/webview/components/bubbles/BubbleDot";
import { ChevronDown } from "lucide-react";
import { Button } from "@/webview/components/ui/button";
import Markdown from "@/webview/components/markdown";

interface ThinkingBubbleProps {
  content: string;
  shouldConnect?: boolean;
}

export default function ThinkingBubble({ content, shouldConnect = false }: ThinkingBubbleProps) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="relative flex gap-2 rounded-md mb-3">
      <BubbleDot connectToPrev={shouldConnect} className="mt-4" />
      <div className="absolute left-0.75 h-full w-px bg-muted-foreground top-6"></div>
      <div className="flex-1 min-w-0 data-[state=open]:bg-muted">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="group w-full">
            <span className="font-medium">Thinking</span>
            <ChevronDown className="ml-auto group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2">
            <Markdown>{content}</Markdown>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
