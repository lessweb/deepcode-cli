import { useMemo, useCallback, useState, useEffect } from "react";
import { Button } from "@/webview/components/ui/button";
import type { AppAction, AskPermissionRequest, PermissionPromptState, SkillInfo } from "@/webview/types";
import { ShieldAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/webview/components/ui/alert";

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
  const normalized = useMemo(() => normalizeRequests(askPermissions), [askPermissions]);
  const isAskPermission = sessionStatus === "ask_permission" && normalized.length > 0;
  const isDenied = (pendingPermissionReply && sessionStatus === "permission_denied") as boolean;

  // Build prompts from requests
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

  // Use internal state for decisions
  const [localState, setLocalState] = useState<{
    index: number;
    decisions: Record<string, "allow" | "deny">;
    alwaysAllows: string[];
    submitting: boolean;
  }>({ index: 0, decisions: {}, alwaysAllows: [], submitting: false });

  // Reset when prompts change
  useEffect(() => {
    setLocalState({ index: 0, decisions: {}, alwaysAllows: [], submitting: false });
  }, [askPermissions]);

  const findNextIdx = useCallback(
    (fromIdx: number, alwaysAllows: string[]) => {
      let idx = fromIdx;
      while (idx < prompts.length) {
        const scope = prompts[idx].scope;
        if (VALID_SCOPES.includes(scope) && alwaysAllows.includes(scope)) {
          idx++;
          continue;
        }
        return idx;
      }
      return prompts.length;
    },
    [prompts]
  );

  const effectiveIndex = findNextIdx(localState.index, localState.alwaysAllows);

  const commitDecision = useCallback(
    (kind: "allow" | "deny" | "always") => {
      if (localState.submitting || effectiveIndex >= prompts.length) return;

      setLocalState((prev) => {
        const prompt = prompts[effectiveIndex];
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

        const nextIdx = effectiveIndex + 1;
        const nextEffective = findNextIdx(nextIdx, newAlwaysAllows);

        if (nextEffective >= prompts.length) {
          // Submit
          const permissions = normalized.map((req): { toolCallId: string; permission: "allow" | "deny" } => {
            const decision = newDecisions[req.toolCallId];
            return {
              toolCallId: req.toolCallId,
              permission: decision === "deny" ? "deny" : "allow",
            };
          });
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

          return { ...prev, index: nextIdx, decisions: newDecisions, alwaysAllows: newAlwaysAllows, submitting: true };
        }

        return { ...prev, index: nextIdx, decisions: newDecisions, alwaysAllows: newAlwaysAllows };
      });
    },
    [
      localState,
      effectiveIndex,
      prompts,
      normalized,
      findNextIdx,
      dispatch,
      onDenyPermission,
      onSendPrompt,
      activeSessionId,
    ]
  );

  const handleCancel = useCallback(() => {
    dispatch({ type: "SET_PENDING_PERMISSION_REPLY", reply: null });
    onInterrupt();
    setLocalState({ index: 0, decisions: {}, alwaysAllows: [], submitting: false });
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

  const prompt = prompts[effectiveIndex];
  if (!prompt) return null;

  const canAlwaysAllow = VALID_SCOPES.includes(prompt.scope);

  return (
    <div className="px-4 py-2 w-full max-w-237.5 mx-auto min-w-sm">
      <div className="rounded-md border border-(--vscode-focusBorder) bg-(--vscode-editor-background) p-3 text-sm">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="font-medium">Permission required</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {effectiveIndex + 1}/{prompts.length}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="cursor-pointer border-none bg-transparent p-0 text-muted-foreground hover:text-foreground"
            onClick={handleCancel}
            title="Interrupt"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="font-semibold mb-1">{prompt.request.name}</div>
        <div className="text-xs text-muted-foreground mb-1 break-all">{prompt.request.command || "(no command)"}</div>
        {prompt.request.description && (
          <div className="text-xs text-muted-foreground mb-2">{prompt.request.description}</div>
        )}

        <div className={`inline-block rounded px-2 py-0.5 text-xs font-medium mb-2 ${getRiskClass(prompt.scope)}`}>
          {describeScope(prompt.scope)}
        </div>

        <div className="text-xs mb-2">Do you want to proceed?</div>

        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="default" onClick={() => commitDecision("allow")}>
            Yes
          </Button>
          {canAlwaysAllow && (
            <Button size="sm" variant="secondary" onClick={() => commitDecision("always")}>
              Yes, and always allow this scope
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => commitDecision("deny")}>
            No
          </Button>
        </div>
      </div>
    </div>
  );
}
