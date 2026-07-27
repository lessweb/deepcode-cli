import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/webview/lib/utils";
import { useNetworkStatus } from "@/webview/hooks/useNetworkStatus";

export function NetworkStatusIndicator({ className }: { className?: string }) {
  const { isOnline } = useNetworkStatus();

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        isOnline
          ? "bg-green-500/15 text-green-700 dark:text-green-400"
          : "bg-red-500/15 text-red-700 dark:text-red-400",
        className
      )}
    >
      {isOnline ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
      <span>{isOnline ? "Online" : "Offline"}</span>
    </div>
  );
}
