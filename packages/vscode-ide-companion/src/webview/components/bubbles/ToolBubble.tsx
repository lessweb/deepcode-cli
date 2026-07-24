import { useState, useEffect, useRef } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/webview/components/ui/collapsible";
import BubbleDot from "@/webview/components/bubbles/BubbleDot";
import DiffPreview from "@/webview/components/DiffPreview";
import PlanRenderer from "@/webview/components/PlanRenderer";
import { ChevronDown } from "lucide-react";
import { Button } from "@/webview/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/webview/components/ui/tooltip";
import ProgressShimmer from "@/webview/components/ProgressShimmer";
import { capitalize } from "@/webview/utils";
export interface ToolBubbleProps {
  content: string;
  meta?: {
    function?: {
      name?: string;
      arguments?: string[] | string;
    };
    paramsMd?: string;
    resultMd?: string;
  };
  shouldConnect?: boolean;
  isLastMessage?: boolean;
  onAskUserQuestions?: (questions: AskUserQuestionMetadata["questions"]) => void;
  onScrollToBottom?: () => void;
}

// ============================================================================
// Tool Result Metadata Types
// ============================================================================

/** Bash tool result metadata */
export interface BashToolMetadata {
  cwd?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  shellPath?: string;
  startCwd?: string;
  timedOut?: boolean;
  timeoutMs?: number;
  deadlineAt?: string;
  truncated?: boolean;
}

/** Edit/Write tool result file metadata */
export interface FileToolMetadata {
  type?: string;
  file_path?: string;
  bytes?: number;
  encoding?: string;
  line_endings?: "LF" | "CRLF";
  cache_refreshed?: boolean;
  diff_preview?: string;
  /** Additional file info */
  [key: string]: unknown;
}

/** Read tool result metadata */
export interface ReadToolMetadata extends FileToolMetadata {
  content?: string;
  output?: string;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  isPartialView?: boolean;
  timestamp?: number;
}

/** AskUserQuestion tool result metadata */
export interface AskUserQuestionMetadata {
  kind: "ask_user_question";
  questions: Array<{
    question: string;
    multiSelect: boolean;
    options: Array<{
      label: string;
      description?: string;
    }>;
  }>;
}

/** UpdatePlan tool result metadata */
export interface UpdatePlanMetadata {
  plan: string;
  explanation?: string;
}

/** WebSearch tool result metadata */
export interface WebSearchMetadata {
  results?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    [key: string]: unknown;
  }>;
  query?: string;
  totalResults?: number;
  [key: string]: unknown;
}

/** Plan metadata (for UpdatePlan tool) */
export interface PlanMeta {
  plan: string;
}

/** Union type for all tool metadata */
export type ToolMetadata =
  | BashToolMetadata
  | FileToolMetadata
  | ReadToolMetadata
  | AskUserQuestionMetadata
  | UpdatePlanMetadata
  | WebSearchMetadata
  | PlanMeta;

// ============================================================================
// Tool Data (parsed from JSON content)
// ============================================================================

/** Tool names enum */
export type ToolName = "bash" | "edit" | "read" | "write" | "AskUserQuestion" | "UpdatePlan" | "WebSearch" | "unknown";

/** Tool execution result data */
export interface ToolData {
  ok: boolean;
  name: ToolName;
  output?: string;
  error?: string;
  metadata?: ToolMetadata;
  awaitUserResponse?: boolean;
  followUpMessages?: Array<{
    role: "system";
    content: string;
    contentParams?: unknown;
  }>;
}

// ============================================================================
// Utility Types
// ============================================================================

/** Type guard for AskUserQuestion metadata */
export function isAskUserQuestionMetadata(metadata: unknown): metadata is AskUserQuestionMetadata {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    "kind" in metadata &&
    (metadata as { kind: unknown }).kind === "ask_user_question"
  );
}

/** Type guard for UpdatePlan metadata */
export function isUpdatePlanMetadata(metadata: unknown): metadata is UpdatePlanMetadata {
  return typeof metadata === "object" && metadata !== null && "plan" in metadata;
}

/** Type guard for FileTool metadata */
export function isFileToolMetadata(metadata: unknown): metadata is FileToolMetadata {
  return typeof metadata === "object" && metadata !== null && "file_path" in metadata;
}

/** Type guard for ReadTool metadata */
export function isReadToolMetadata(metadata: unknown): metadata is ReadToolMetadata {
  return typeof metadata === "object" && metadata !== null && "totalLines" in metadata;
}

/** Type guard for AskUserQuestion tool */
export function isAskUserQuestionTool(name: string): boolean {
  return name === "AskUserQuestion";
}

/** Type guard for UpdatePlan tool */
export function isUpdatePlanTool(name: string): boolean {
  return name === "UpdatePlan";
}

/** Type guard for file mutation tools (edit/write) */
export function isFileMutationTool(name: string): boolean {
  return name === "edit" || name === "write";
}

/**
 * Parse tool content JSON safely
 */
function parseToolData(content: string): ToolData {
  try {
    const parsed = JSON.parse(content || "{}");
    return {
      ok: Boolean(parsed.ok),
      name: parsed.name || "unknown",
      output: parsed.output,
      error: parsed.error,
      metadata: parsed.metadata,
      awaitUserResponse: parsed.awaitUserResponse,
      followUpMessages: parsed.followUpMessages,
    } as ToolData;
  } catch {
    return { ok: false, name: "unknown" };
  }
}

/**
 * Render tool content based on tool type
 */
function renderToolContent(toolData: ToolData, resultMd: string, content: string): React.ReactNode {
  const { name, ok, metadata, output } = toolData;
  const toolNameLower = name.toLowerCase();

  // UpdatePlan: render plan
  if (isUpdatePlanTool(name) && isUpdatePlanMetadata(metadata) && ok && metadata.plan) {
    return <PlanRenderer plan={metadata.plan} />;
  }

  // Edit/Write: render diff preview
  if (isFileMutationTool(toolNameLower) && isFileToolMetadata(metadata) && ok) {
    return <DiffPreview metadata={metadata} output={output || ""} />;
  }

  // Default: render output or raw content
  return (
    <pre className="text-xs text-chart-2 whitespace-pre-wrap wrap-break-word p-2">{resultMd || output || content}</pre>
  );
}

/**
 * Tool Bubble Component
 * Renders tool execution results with appropriate UI based on tool type.
 */
export default function ToolBubble({
  content,
  meta,
  shouldConnect = false,
  isLastMessage = false,
  onAskUserQuestions,
  onScrollToBottom,
}: ToolBubbleProps) {
  const [open, setOpen] = useState<boolean>(false);
  const toolData = parseToolData(content);
  const { ok, name, metadata } = toolData;

  // Track if we've dispatched for AskUserQuestion to prevent re-dispatch
  const hasDispatchedRef = useRef(false);

  const paramsMd = (meta?.paramsMd as string | undefined)?.trim() ?? "";
  const resultMd = (meta?.resultMd as string | undefined)?.trim() ?? "";

  // AskUserQuestion: notify parent to show AskQuestionCarousel (only once and only if last message)
  const isAskUserQuestion = isAskUserQuestionMetadata(metadata);
  useEffect(() => {
    if (isAskUserQuestion && isLastMessage && !hasDispatchedRef.current && onAskUserQuestions) {
      hasDispatchedRef.current = true;
      onAskUserQuestions((metadata as AskUserQuestionMetadata).questions);
      onScrollToBottom?.();
    }
  }, [isAskUserQuestion, isLastMessage, onAskUserQuestions, metadata, onScrollToBottom]);

  if (isAskUserQuestion) {
    if (isLastMessage)
      return (
        <ProgressShimmer>{(metadata as AskUserQuestionMetadata).questions.length} confirmation pending</ProgressShimmer>
      );
    return <div className="h-2">&nbsp;</div>;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="relative flex w-full gap-2 mb-3">
      <BubbleDot variant={ok ? "success" : "error"} className="mt-3.5" />
      {shouldConnect && <div className="absolute left-0.75 h-full w-px bg-muted-foreground top-6"></div>}
      <div className="flex-1 min-w-0">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="group w-full flex data-[state=open]:rounded-b-none data-[state=open]:border-muted"
          >
            <span className="font-medium">{capitalize(name)}</span>
            {paramsMd && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex-1 min-w-0 text-left text-xs text-muted-foreground cursor-pointer">
                    <span className="text-wrap line-clamp-1">{paramsMd}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{paramsMd}</p>
                </TooltipContent>
              </Tooltip>
            )}
            <ChevronDown className="ml-auto group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="w-auto data-[state=open]:bg-muted data-[state=open]:rounded-t-none data-[state=open]:rounded-b-sm">
          <div className="text-sm">{renderToolContent(toolData, resultMd, content)}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
