import { cn } from "@/webview/lib/utils";

interface BubbleDotProps {
  variant?: "default" | "success" | "error";
  connectToPrev?: boolean;
  className?: string;
}

/**
 * BubbleDot component
 * @param param0
 * @param param0.variant
 * @param param0.connectToPrev
 * @param param0.className
 * @constructor
 */
export default function BubbleDot({ variant = "default", connectToPrev = false, className }: BubbleDotProps) {
  return (
    <span
      className={cn(
        "bubble-dot inline-block w-2 h-2 rounded-full shrink-0 mt-1.5",
        variant === "success" && "bg-success",
        variant === "error" && "bg-destructive",
        variant === "default" && "bg-muted-foreground",
        connectToPrev && "connect-to-prev",
        className
      )}
    />
  );
}
