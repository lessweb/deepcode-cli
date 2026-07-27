import type { TokenTelemetry } from "@/webview/types";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { InputGroupButton } from "./ui/input-group";
import { ProgressRing } from "./ui/progress-ring";
import { Field, FieldLabel } from "./ui/field";
import { Progress } from "./ui/progress";
import { flattenUsageFields, formatUsageFieldLabel, getTokenUsagePercent, toTitleCase } from "@/webview/utils";
import { Separator } from "@/webview/components/ui/separator";

interface ContextMeterProps {
  tokenTelemetry?: TokenTelemetry;
}

function formatTokenCount(value: unknown): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString();
}

export default function ContextIndicator({ tokenTelemetry }: ContextMeterProps) {
  const activeTokens = tokenTelemetry?.activeTokens || 0;
  const percent = getTokenUsagePercent(tokenTelemetry);
  const usedRows = flattenUsageFields(tokenTelemetry?.usage);

  return (
    <HoverCard openDelay={10} closeDelay={10}>
      <HoverCardTrigger asChild>
        <InputGroupButton className="cursor-pointer flex items-center justify-center" size="icon-xs">
          <ProgressRing size={14} stroke={2} value={percent} />
        </InputGroupButton>
      </HoverCardTrigger>
      <HoverCardContent className="flex w-xs flex-col gap-5">
        <div className="font-semibold text-[16px] text-center">Context Window</div>
        <Field className="w-full max-w-xs">
          <FieldLabel htmlFor="progress-upload" className="flex items-end">
            <span className="text-primary text-xl font-bold">{percent}%</span>
            <span className="text-xs text-muted-foreground">used</span>
          </FieldLabel>
          <Progress value={percent} id="progress-upload" />
        </Field>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-xs text-muted-foreground">Model</span>
            <span className="text-primary font-semibold">{tokenTelemetry?.model || "unknown"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-muted-foreground">Thinking</span>
            <span className="text-primary font-semibold">{tokenTelemetry?.thinkingEnabled ? "true" : "false"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-muted-foreground">Effort</span>
            <span className="text-primary font-semibold">{tokenTelemetry?.reasoningEffort || "max"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-muted-foreground">Active Tokens</span>
            <span className="text-primary font-semibold">{formatTokenCount(activeTokens)}</span>
          </div>
        </div>
        {usedRows?.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1">
              <div className="font-semibold text-muted-foreground">Session Usage</div>
              {(usedRows || []).map(([key, value]) => (
                <div className="flex justify-between" key={key}>
                  <span className="text-xs text-muted-foreground">{toTitleCase(formatUsageFieldLabel(key))}</span>
                  <span className="text-primary font-normal">{formatTokenCount(value)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
