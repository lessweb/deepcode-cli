import React from "react";
import { cn } from "@/webview/lib/utils";

interface ProgressShimmerProps extends React.PropsWithChildren {
  className?: string;
}

const ProgressShimmer = ({ className, children }: ProgressShimmerProps) => {
  return <div className={cn("chat-progress-shimmer-text mb-3 mt-3", className)}>{children}</div>;
};
export default ProgressShimmer;
