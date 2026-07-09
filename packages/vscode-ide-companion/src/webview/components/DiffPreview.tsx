import { Button } from "@/webview/components/ui/button";

interface ToolData {
  ok: boolean;
  name: string;
  output: string;
  metadata?: {
    file_path?: string;
    scope?: { start_line?: number };
    diff_preview?: string;
  };
}

interface DiffPreviewProps {
  toolData: ToolData;
}

function formatDisplayPath(filePath: string): string {
  if (!filePath) return "";
  return filePath;
}

export default function DiffPreview({ toolData }: DiffPreviewProps) {
  const meta = toolData.metadata;
  if (!meta?.file_path) return null;

  const diffLines = (meta.diff_preview || "")
    .split("\n")
    .filter((l) => !l.startsWith("--- ") && !l.startsWith("+++ ") && !l.startsWith("@@ "));

  return (
    <div className="space-y-2">
      {toolData.output && <div className="text-xs text-muted-foreground">{toolData.output.trim()}</div>}

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">File</span>
        <Button
          type="button"
          className="text-(--vscode-textLink-foreground) hover:underline cursor-pointer border-none bg-transparent p-0 text-xs truncate"
          title={meta.file_path}
        >
          {formatDisplayPath(meta.file_path)}
        </Button>
      </div>

      {diffLines.length > 0 && (
        <div className="rounded border border-border overflow-hidden">
          <div className="text-[11px] text-muted-foreground px-2 py-1 bg-muted/50">Changes</div>
          <div className="font-mono text-xs">
            {diffLines.map((line, i) => {
              if (!line) return null;
              const cls = line.startsWith("+")
                ? "bg-success/10 text-success"
                : line.startsWith("-")
                  ? "bg-destructive/10 text-destructive"
                  : "text-muted-foreground";
              const prefix = line[0] === "+" || line[0] === "-" ? line[0] : " ";
              return (
                <div key={i} className={`flex px-2 py-0.5 ${cls}`}>
                  <span className="w-4 shrink-0 select-none">{prefix}</span>
                  <span className="truncate">{line.slice(1)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
