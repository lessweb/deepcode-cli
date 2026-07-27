import { Button } from "@/webview/components/ui/button";
import type { FileToolMetadata } from "@/webview/components/bubbles/ToolBubble";
import { wrpc } from "@/webview/wrpc";

interface DiffPreviewProps {
  output: string;
  metadata: FileToolMetadata;
}

function formatDisplayPath(filePath: string): string {
  if (!filePath) return "";
  return filePath;
}

export default function DiffPreview({ metadata, output }: DiffPreviewProps) {
  const meta = metadata;
  if (!meta?.file_path) return null;

  const handleOpenFile = () => {
    void wrpc.openFile.mutate({ filePath: meta.file_path!, line: 1 });
  };

  const handleViewDiff = () => {
    if (meta.diff_preview) {
      void wrpc.showDiffEditor.mutate({ filePath: meta.file_path!, diffPreview: meta.diff_preview });
    }
  };

  const diffLines = (meta.diff_preview || "")
    .split("\n")
    .filter((l) => !l.startsWith("--- ") && !l.startsWith("+++ ") && !l.startsWith("@@ "));

  return (
    <div className="space-y-2">
      {output && <div className="text-xs text-muted-foreground pl-3">{output.trim()}</div>}

      <div className="flex items-center gap-2 text-xs pl-3">
        <span className="text-muted-foreground shrink-0">File</span>
        <Button
          variant="link"
          className="text-(--vscode-textLink-foreground) hover:underline cursor-pointer border-none bg-transparent p-0 text-xs truncate"
          title={meta.file_path}
          onClick={handleOpenFile}
        >
          {formatDisplayPath(meta.file_path)}
        </Button>

        <div className="flex items-center gap-1 ml-1 shrink-0">
          <Button
            variant="secondary"
            size="xs"
            className="h-5 px-1.5 text-[10px] cursor-pointer"
            title="Open file in editor"
            onClick={handleOpenFile}
          >
            Open
          </Button>
          {meta.diff_preview && (
            <Button
              variant="secondary"
              size="xs"
              className="h-5 px-1.5 text-[10px] cursor-pointer"
              title="View changes in diff editor"
              onClick={handleViewDiff}
            >
              View Diff
            </Button>
          )}
        </div>
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
                  <div className="w-auto text-wrap break-all flex-1">{line.slice(1)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
