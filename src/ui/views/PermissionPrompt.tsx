import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { useTerminalInput } from "../hooks";
import type { AskPermissionRequest, AskPermissionScope, UserToolPermission } from "../../common/permissions";
import type { PermissionScope } from "../../settings";
import { t } from "../../common/i18n";

export type PermissionPromptResult = {
  permissions: UserToolPermission[];
  alwaysAllows: PermissionScope[];
  hasDeny: boolean;
};

type Props = {
  requests: AskPermissionRequest[];
  onSubmit: (result: PermissionPromptResult) => void;
  onCancel: () => void;
};

type ScopePrompt = {
  request: AskPermissionRequest;
  scope: AskPermissionScope;
};

type PromptOption = {
  kind: "allow" | "always" | "deny";
  label: string;
  scopeDescription?: string;
  scopeColor?: string;
};

const ALWAYS_ALLOWED_SCOPES = new Set<AskPermissionScope>([
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
]);

export function PermissionPrompt({ requests, onSubmit, onCancel }: Props): React.ReactElement | null {
  const prompts = useMemo(() => buildScopePrompts(requests), [requests]);
  const [index, setIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, "allow" | "deny">>({});
  const [alwaysAllows, setAlwaysAllows] = useState<PermissionScope[]>([]);

  const effectiveIndex = findNextPromptIndex(prompts, index, alwaysAllows);
  const prompt = prompts[effectiveIndex] ?? null;
  const options = prompt ? buildOptions(prompt.scope) : [];

  useEffect(() => {
    setIndex(0);
    setCursor(0);
    setDecisions({});
    setAlwaysAllows([]);
  }, [requests]);

  useEffect(() => {
    if (!prompt) {
      onSubmit(buildResult(requests, decisions, alwaysAllows));
    }
  }, [alwaysAllows, decisions, onSubmit, prompt, requests]);

  useEffect(() => {
    if (cursor >= options.length) {
      setCursor(Math.max(0, options.length - 1));
    }
  }, [cursor, options.length]);

  useTerminalInput((input, key) => {
    if (!prompt) {
      return;
    }
    if (key.escape || (key.ctrl && (input === "c" || input === "C"))) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setCursor((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((value) => Math.min(options.length - 1, value + 1));
      return;
    }
    if (input && /^[1-3]$/.test(input)) {
      const nextCursor = Number(input) - 1;
      if (nextCursor >= 0 && nextCursor < options.length) {
        commit(options[nextCursor]!.kind);
      }
      return;
    }
    if (key.return) {
      commit(options[cursor]?.kind ?? "allow");
    }
  });

  if (!prompt) {
    return null;
  }

  function commit(kind: "allow" | "always" | "deny"): void {
    if (!prompt) {
      return;
    }
    if (kind === "always" && isAlwaysAllowedScope(prompt.scope)) {
      const scope = prompt.scope;
      setAlwaysAllows((prev) => (prev.includes(scope) ? prev : [...prev, scope]));
      setDecisions((prev) => ({
        ...prev,
        [prompt.request.toolCallId]: prev[prompt.request.toolCallId] === "deny" ? "deny" : "allow",
      }));
    } else {
      setDecisions((prev) => ({
        ...prev,
        [prompt.request.toolCallId]:
          kind === "deny" ? "deny" : prev[prompt.request.toolCallId] === "deny" ? "deny" : "allow",
      }));
    }
    setIndex(effectiveIndex + 1);
    setCursor(0);
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          {t("ui.permissionPrompt.title")}
        </Text>
        <Text dimColor>
          {" "}
          {Math.min(effectiveIndex + 1, prompts.length)}/{prompts.length}
        </Text>
      </Box>
      <Text bold>{prompt.request.name}</Text>
      <Text>{prompt.request.command}</Text>
      {prompt.request.description ? <Text dimColor>{prompt.request.description}</Text> : null}
      <Box marginTop={1}>
        <Text>{t("ui.permissionPrompt.proceedQuestion")}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, optionIndex) => (
          <Text key={option.kind} color={optionIndex === cursor ? "cyanBright" : undefined}>
            {optionIndex === cursor ? "> " : "  "}
            {optionIndex + 1}. {renderOptionLabel(option)}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{t("ui.permissionPrompt.footerHelp")}</Text>
      </Box>
    </Box>
  );
}

function renderOptionLabel(option: PromptOption): React.ReactNode {
  if (option.scopeDescription && option.scopeColor) {
    return (
      <>
        {option.label}
        <Text color={option.scopeColor}>{option.scopeDescription}</Text>
      </>
    );
  }
  return option.label;
}

function buildScopePrompts(requests: AskPermissionRequest[]): ScopePrompt[] {
  const prompts: ScopePrompt[] = [];
  for (const request of requests) {
    for (const scope of request.scopes.length > 0 ? request.scopes : ["unknown" as const]) {
      prompts.push({ request, scope });
    }
  }
  return prompts;
}

function buildOptions(scope: AskPermissionScope): PromptOption[] {
  const options: PromptOption[] = [{ kind: "allow", label: t("ui.permissionPrompt.allowLabel") }];
  if (isAlwaysAllowedScope(scope)) {
    options.push({
      kind: "always",
      label: t("ui.permissionPrompt.alwaysAllowLabel"),
      scopeDescription: describeScope(scope),
      scopeColor: getScopeRiskColor(scope),
    });
  }
  options.push({ kind: "deny", label: t("ui.permissionPrompt.denyLabel") });
  return options;
}

function findNextPromptIndex(prompts: ScopePrompt[], startIndex: number, alwaysAllows: PermissionScope[]): number {
  let index = startIndex;
  while (index < prompts.length) {
    const scope = prompts[index]!.scope;
    if (isAlwaysAllowedScope(scope) && alwaysAllows.includes(scope)) {
      index += 1;
      continue;
    }
    return index;
  }
  return prompts.length;
}

function buildResult(
  requests: AskPermissionRequest[],
  decisions: Record<string, "allow" | "deny">,
  alwaysAllows: PermissionScope[]
): PermissionPromptResult {
  const permissions = requests.map((request) => ({
    toolCallId: request.toolCallId,
    permission: decisions[request.toolCallId] === "deny" ? ("deny" as const) : ("allow" as const),
  }));
  return {
    permissions,
    alwaysAllows,
    hasDeny: permissions.some((permission) => permission.permission === "deny"),
  };
}

function isAlwaysAllowedScope(scope: AskPermissionScope): scope is PermissionScope {
  return ALWAYS_ALLOWED_SCOPES.has(scope);
}

export function getScopeRiskColor(scope: AskPermissionScope): string {
  switch (scope) {
    case "read-in-cwd":
    case "query-git-log":
      return "#22c55e";
    case "read-out-cwd":
    case "write-in-cwd":
    case "network":
    case "mcp":
      return "#f59e0b";
    case "write-out-cwd":
    case "delete-in-cwd":
    case "delete-out-cwd":
    case "mutate-git-log":
    case "unknown":
      return "#ef4444";
    default:
      return "#ef4444";
  }
}

function describeScope(scope: PermissionScope): string {
  switch (scope) {
    case "read-in-cwd":
      return t("ui.permissionPrompt.scopeReadInCwd");
    case "read-out-cwd":
      return t("ui.permissionPrompt.scopeReadOutCwd");
    case "write-in-cwd":
      return t("ui.permissionPrompt.scopeWriteInCwd");
    case "write-out-cwd":
      return t("ui.permissionPrompt.scopeWriteOutCwd");
    case "delete-in-cwd":
      return t("ui.permissionPrompt.scopeDeleteInCwd");
    case "delete-out-cwd":
      return t("ui.permissionPrompt.scopeDeleteOutCwd");
    case "query-git-log":
      return t("ui.permissionPrompt.scopeQueryGitLog");
    case "mutate-git-log":
      return t("ui.permissionPrompt.scopeMutateGitLog");
    case "network":
      return t("ui.permissionPrompt.scopeNetwork");
    case "mcp":
      return t("ui.permissionPrompt.scopeMcp");
    default:
      return scope;
  }
}
