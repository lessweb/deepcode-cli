import { useEffect, useState, useRef } from "react";
import { Spinner } from "@/webview/components/ui/spinner";
import type { LlmStreamProgressData } from "@/webview/types";
import ProgressShimmer from "@/webview/components/ProgressShimmer";

interface ThinkingLiveBubbleProps {
  llmStreamProgress: LlmStreamProgressData | null;
  processes: Record<string, { startTime: string; command: string }> | null;
}

function formatElapsed(startTime: string): string {
  const elapsed = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

function getStatusText(
  progress: LlmStreamProgressData | null,
  processes: Record<string, { startTime: string; command: string }> | null
): string {
  if (processes && Object.keys(processes).length > 0) {
    const first = Object.values(processes)[0];
    return `(${formatElapsed(first.startTime)}) ${first.command}`;
  }
  if (progress?.startedAt) {
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(progress.startedAt).getTime()) / 1000));
    const tokens = progress.formattedTokens || "0";
    if (elapsed >= 3) return `(${elapsed}s) · ↓ ${tokens} tokens`;
  }
  return "Processing...";
}

export default function ThinkingLiveBubble({ llmStreamProgress, processes }: ThinkingLiveBubbleProps) {
  const [statusText, setStatusText] = useState(() => getStatusText(llmStreamProgress, processes));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setStatusText(getStatusText(llmStreamProgress, processes));
    intervalRef.current = setInterval(() => {
      setStatusText(getStatusText(llmStreamProgress, processes));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [llmStreamProgress, processes]);

  return (
    <div className="flex gap-2 mb-3 px-4 w-full max-w-237.5 mx-auto min-w-sm">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        <ProgressShimmer className="font-medium">Thinking</ProgressShimmer>
        <span className="text-xs">{statusText}</span>
      </div>
    </div>
  );
}
