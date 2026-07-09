import type { JSX } from "react";

interface PlanRendererProps {
  plan: string;
}

function toInlineHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export default function PlanRenderer({ plan }: PlanRendererProps) {
  const lines = String(plan || "").split(/\r?\n/);

  return (
    <div className="update-plan-markdown text-sm space-y-0.5">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) {
          return <div key={i} className="h-1" />;
        }

        // Heading
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          const level = Math.min(6, headingMatch[1].length);
          const Tag = `h${level}` as keyof JSX.IntrinsicElements;
          return (
            <Tag key={i} className={`font-semibold ${level <= 2 ? "text-base" : "text-sm"} mt-1 mb-0.5`}>
              <span dangerouslySetInnerHTML={{ __html: toInlineHtml(headingMatch[2].trim()) }} />
            </Tag>
          );
        }

        // Task item: - [ ] / - [x] / - [>] / - [!]
        const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX!>])\]\s*(.*)$/);
        if (taskMatch) {
          const indent = Math.floor((taskMatch[1] || "").replace(/\t/g, "  ").length / 2);
          const statusRaw = taskMatch[2];
          let status: "todo" | "done" | "active" | "attention" = "todo";
          if (statusRaw === "x" || statusRaw === "X") status = "done";
          else if (statusRaw === ">") status = "active";
          else if (statusRaw === "!") status = "attention";

          const label = status === "done" ? "✓" : status === "active" ? ">" : status === "attention" ? "!" : "";
          const colorClass =
            status === "done"
              ? "text-success"
              : status === "active"
                ? "text-[var(--vscode-focusBorder)]"
                : status === "attention"
                  ? "text-warning"
                  : "text-muted-foreground";

          return (
            <div key={i} className="flex items-start gap-2 py-0.5" style={{ paddingLeft: `${indent * 16}px` }}>
              <span className={`shrink-0 font-mono text-xs ${colorClass}`}>{label || " "}</span>
              <span dangerouslySetInnerHTML={{ __html: toInlineHtml(taskMatch[3].trim()) }} />
            </div>
          );
        }

        // Bullet
        const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
        if (bulletMatch) {
          const indent = Math.floor((bulletMatch[1] || "").replace(/\t/g, "  ").length / 2);
          return (
            <div key={i} className="flex items-start gap-2 py-0.5" style={{ paddingLeft: `${indent * 16}px` }}>
              <span className="shrink-0 text-muted-foreground">•</span>
              <span dangerouslySetInnerHTML={{ __html: toInlineHtml(bulletMatch[2].trim()) }} />
            </div>
          );
        }

        return (
          <p key={i} className="my-0.5">
            <span dangerouslySetInnerHTML={{ __html: toInlineHtml(line.trim()) }} />
          </p>
        );
      })}
    </div>
  );
}
