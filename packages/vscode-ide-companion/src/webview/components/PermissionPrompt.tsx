import React, { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { Button } from "@/webview/components/ui/button";
import type { AppAction, AskPermissionRequest, PermissionPromptState, SkillInfo } from "@/webview/types";
import { ShieldAlert, X, ChevronDownIcon, ChevronLeft, ChevronRight, Terminal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/webview/components/ui/alert";
import { capitalize } from "@/webview/utils";
import type { CarouselApi } from "@/webview/components/ui/carousel";
import { Carousel, CarouselContent, CarouselItem } from "@/webview/components/ui/carousel";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/webview/components/ui/collapsible";
import { Card, CardContent } from "@/webview/components/ui/card";

export interface PermissionPromptProps {
  askPermissions: AskPermissionRequest[];
  sessionStatus: string | null;
  pendingPermissionReply: unknown;
  permissionPromptState: PermissionPromptState | null;
  activeSessionId: string | null;
  dispatch: (action: AppAction) => void;
  onDenyPermission: (sessionId: string) => void;
  onSendPrompt: (
    prompt: string,
    skills?: SkillInfo[],
    images?: string[],
    options?: { permissions?: unknown[]; alwaysAllows?: string[] }
  ) => void;
  onInterrupt: () => void;
}

type PermissionScope = string;

const VALID_SCOPES: PermissionScope[] = [
  "read-in-cwd",
  "read-out-cwd",
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "mcp",
];

function describeScope(scope: string): string {
  switch (scope) {
    case "read-in-cwd":
      return "reads inside this workspace";
    case "read-out-cwd":
      return "reads outside this workspace";
    case "write-in-cwd":
      return "writes inside this workspace";
    case "write-out-cwd":
      return "writes outside this workspace";
    case "delete-in-cwd":
      return "deletes inside this workspace";
    case "delete-out-cwd":
      return "deletes outside this workspace";
    case "query-git-log":
      return "Git history queries";
    case "mutate-git-log":
      return "Git history changes";
    case "network":
      return "network access";
    case "mcp":
      return "MCP tool access";
    default:
      return "unknown access";
  }
}

function getRiskClass(scope: string): string {
  switch (scope) {
    case "read-in-cwd":
    case "query-git-log":
      return "bg-green-500/15 text-green-700 dark:text-green-400";
    case "read-out-cwd":
    case "write-in-cwd":
    case "network":
    case "mcp":
      return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
    default:
      return "bg-red-500/15 text-red-700 dark:text-red-400";
  }
}

function normalizeRequests(requests: unknown[]): AskPermissionRequest[] {
  return requests
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      return {
        toolCallId: String(r.toolCallId || ""),
        name: String(r.name || "Tool"),
        command: String(r.command || ""),
        description: String(r.description || ""),
        scopes: Array.isArray(r.scopes) ? r.scopes.filter((s) => typeof s === "string") : ["unknown"],
      };
    })
    .filter(Boolean) as AskPermissionRequest[];
}

export default function PermissionPrompt({
  askPermissions,
  sessionStatus,
  pendingPermissionReply,
  activeSessionId,
  dispatch,
  onDenyPermission,
  onSendPrompt,
  onInterrupt,
}: PermissionPromptProps) {
  const [api, setApi] = React.useState<CarouselApi>();
  const carouselApiRef = useRef<CarouselApi>(null);
  const pendingScrollRef = useRef<number | null>(null);
  const [open, setOpen] = React.useState(true);
  const [current, setCurrent] = React.useState(0);
  const [count, setCount] = React.useState(0);
  const normalized = useMemo(() => normalizeRequests(askPermissions), [askPermissions]);
  const isAskPermission = sessionStatus === "ask_permission" && normalized.length > 0;
  const isDenied = (pendingPermissionReply && sessionStatus === "permission_denied") as boolean;

  // Build prompts from requests — one per (request, scope) pair
  const prompts = useMemo(() => {
    const result: Array<{ request: AskPermissionRequest; scope: string }> = [];
    for (const req of normalized) {
      const scopes = req.scopes.length > 0 ? req.scopes : ["unknown"];
      for (const scope of scopes) {
        result.push({ request: req, scope });
      }
    }
    return result;
  }, [normalized]);

  // Internal state for decisions (no sequential index — carousel manages position)
  const [localState, setLocalState] = useState<{
    decisions: Record<string, "allow" | "deny">;
    alwaysAllows: string[];
    submitting: boolean;
  }>({ decisions: {}, alwaysAllows: [], submitting: false });

  // Reset when prompts change
  useEffect(() => {
    setLocalState({ decisions: {}, alwaysAllows: [], submitting: false });
  }, [askPermissions]);

  // Store carousel API in ref for stable access from callbacks (avoids stale closures)
  useEffect(() => {
    carouselApiRef.current = api || null;
  }, [api]);

  // Sync carousel slide counter
  useEffect(() => {
    if (!api) return;
    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap() + 1);
    api.on("select", () => {
      setCurrent(api.selectedScrollSnap() + 1);
    });
  }, [api]);

  // Execute pending auto-scroll after React commits the state update
  useEffect(() => {
    if (pendingScrollRef.current !== null && carouselApiRef.current) {
      const idx = pendingScrollRef.current;
      pendingScrollRef.current = null;
      carouselApiRef.current.scrollTo(idx);
    }
  });

  const commitDecision = useCallback(
    (kind: "allow" | "deny" | "always", slideIndex: number) => {
      if (localState.submitting) return;

      setLocalState((prev) => {
        const prompt = prompts[slideIndex];
        if (!prompt) return prev;

        const newDecisions = { ...prev.decisions };
        const newAlwaysAllows = [...prev.alwaysAllows];

        if (kind === "always" && VALID_SCOPES.includes(prompt.scope)) {
          if (!newAlwaysAllows.includes(prompt.scope)) {
            newAlwaysAllows.push(prompt.scope);
          }
          if (newDecisions[prompt.request.toolCallId] !== "deny") {
            newDecisions[prompt.request.toolCallId] = "allow";
          }
        } else if (kind === "deny") {
          newDecisions[prompt.request.toolCallId] = "deny";
        } else {
          if (newDecisions[prompt.request.toolCallId] !== "deny") {
            newDecisions[prompt.request.toolCallId] = "allow";
          }
        }

        // Find next undecided prompt after the current slide
        let nextIdx = slideIndex + 1;
        while (nextIdx < prompts.length) {
          const s = prompts[nextIdx].scope;
          const t = prompts[nextIdx].request.toolCallId;
          if (VALID_SCOPES.includes(s) && newAlwaysAllows.includes(s)) {
            nextIdx++;
            continue;
          }
          if (newDecisions[t] !== undefined) {
            nextIdx++;
            continue;
          }
          break;
        }

        if (nextIdx >= prompts.length) {
          // All prompts decided — submit
          const permissions = normalized.map((req) => ({
            toolCallId: req.toolCallId,
            permission: (newDecisions[req.toolCallId] === "deny" ? "deny" : "allow") as "allow" | "deny",
          }));
          const hasDeny = permissions.some((p) => p.permission === "deny");

          if (hasDeny) {
            dispatch({
              type: "SET_PENDING_PERMISSION_REPLY",
              reply: { permissions, alwaysAllows: newAlwaysAllows },
            });
            onDenyPermission(activeSessionId || "");
          } else {
            onSendPrompt("/continue", [], [], {
              permissions,
              alwaysAllows: newAlwaysAllows,
            });
          }

          return { ...prev, decisions: newDecisions, alwaysAllows: newAlwaysAllows, submitting: true };
        }

        // Schedule auto-scroll to the next undecided prompt (executed after render via useEffect)
        pendingScrollRef.current = nextIdx;

        return { ...prev, decisions: newDecisions, alwaysAllows: newAlwaysAllows };
      });
    },
    [localState, prompts, normalized, dispatch, onDenyPermission, onSendPrompt, activeSessionId]
  );

  const handleCancel = useCallback(() => {
    dispatch({ type: "SET_PENDING_PERMISSION_REPLY", reply: null });
    onInterrupt();
    setLocalState({ decisions: {}, alwaysAllows: [], submitting: false });
  }, [dispatch, onInterrupt]);

  if (!isAskPermission && !isDenied) return null;

  if (isDenied) {
    return (
      <div className="px-4 w-full max-w-237.5 mx-auto min-w-sm">
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Permission denied</AlertTitle>
          <AlertDescription>Add a reply, then press Enter to continue with the denial.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (prompts.length === 0) return null;

  // Header label — show the tool name from the first prompt
  const headerLabel = `Permission required — ${capitalize(prompts[0].request.name || "Tool")}`;

  return (
    <div className="w-full max-w-237.5 mx-auto min-w-sm px-4 py-2">
      <div className="border border-primary rounded-md w-full">
        <CardContent>
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <div className="group flex justify-between items-center cursor-pointer px-2 w-full">
                <span className="text-primary py-2 text-sm font-medium truncate">{headerLabel}</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancel();
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                  <ChevronDownIcon className="ml-auto size-4 group-data-[state=open]:rotate-180" />
                </div>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col items-start gap-2 text-sm">
              <Carousel setApi={setApi} className="w-full">
                <CarouselContent>
                  {prompts.map((p, idx) => (
                    <CarouselItem
                      key={`${p.request.toolCallId}-${p.scope}-${idx}`}
                      data-key={`${p.request.toolCallId}-${p.scope}-${idx}`}
                    >
                      <Card className="m-0 rounded-none py-0 bg-transparent" size="sm">
                        <CardContent className="py-0">
                          <div className="font-semibold text-[13px] flex items-center mb-1">
                            <Terminal className="size-3.5 mr-1" strokeWidth={1.5} />
                            {capitalize(p.request.name)}
                          </div>
                          <div className="text-xs text-muted-foreground mb-1 break-all">
                            {p.request.command || "(no command)"}
                          </div>
                          {p.request.description && (
                            <div className="text-xs text-muted-foreground mb-2">{p.request.description}</div>
                          )}
                          <div
                            className={`inline-block rounded px-2 py-0.5 text-xs font-medium mb-2 ${getRiskClass(p.scope)}`}
                          >
                            {describeScope(p.scope)}
                          </div>
                        </CardContent>
                      </Card>
                    </CarouselItem>
                  ))}
                </CarouselContent>
              </Carousel>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
        {/* Navigation footer — matches AskQuestionCarousel style */}
        <div className="flex flex-col text-sm px-2 py-2">
          <div className="text-xs mb-2">Do you want to proceed?</div>
          <div className="flex gap-2 items-center">
            <div className="flex gap-2 flex-wrap">
              <Button size="xs" variant="default" onClick={() => commitDecision("allow", current - 1)}>
                Yes
              </Button>
              {VALID_SCOPES.includes(prompts[current - 1]?.scope || "") && (
                <Button size="xs" variant="secondary" onClick={() => commitDecision("always", current - 1)}>
                  Yes, and always allow this scope
                </Button>
              )}
              <Button size="xs" variant="outline" onClick={() => commitDecision("deny", current - 1)}>
                No
              </Button>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {open && (
                <>
                  <Button
                    variant="ghost"
                    disabled={!api?.canScrollPrev()}
                    size="icon-xs"
                    onClick={() => api?.scrollPrev()}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!api?.canScrollNext()}
                    size="icon-xs"
                    onClick={() => api?.scrollNext()}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </>
              )}
              <span className="text-xs ml-1">
                {current}/{count}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
