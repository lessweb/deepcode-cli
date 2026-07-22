import { Button } from "@/webview/components/ui/button";
import { X } from "lucide-react";

export interface ContinuePromptProps {
  onContinue: () => void;
  onDismiss: () => void;
}

export default function ContinuePrompt({ onContinue, onDismiss }: ContinuePromptProps) {
  return (
    <div className="px-4 py-2 w-full max-w-237.5 mx-auto min-w-sm">
      <div className="rounded-md border border-primary bg-background p-3 text-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium">Session interrupted</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="cursor-pointer border-none bg-transparent p-0 text-muted-foreground hover:text-foreground"
            onClick={onDismiss}
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          The previous operation was interrupted. Do you want to continue the conversation?
        </p>

        <div className="flex gap-2">
          <Button size="xs" variant="default" onClick={onContinue}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
