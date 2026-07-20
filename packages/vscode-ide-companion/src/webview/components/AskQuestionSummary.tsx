import BubbleDot from "@/webview/components/bubbles/BubbleDot";
import type { MessageMeta } from "@vegamo/deepcode-core";
import { cn } from "@/webview/lib/utils";

const AskQuestionSummary = ({ content }: { content: string; meta?: MessageMeta }) => {
  return (
    <div className="relative flex w-full gap-2 mb-3">
      <BubbleDot variant={"success"} />
      <div className="flex flex-col flex-1 gap-1">
        <div className="flex flex-col gap-1 border border-gray-200 rounded-md p-2">
          {content.split("\n").map((line) => (
            <div key={line} className={cn("font-bold", { "font-normal text-muted-foreground": line.startsWith("Q:") })}>
              {line}
            </div>
          ))}
        </div>
        <div>明白了，请稍等...</div>
      </div>
    </div>
  );
};
export default AskQuestionSummary;
