import React, { useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import { useTerminalInput } from "../hooks";
import { DiffPreview } from "../components/MessageView";
import type { AskPermissionRequest, AskPermissionScope, PermissionScope } from "@vegamo/deepcode-core";
import {
  buildScopePrompts,
  resolvePermissionPrompt,
  type PermissionAnswers,
  type PermissionChoice,
  type PermissionPromptResult,
} from "../core/permission-prompt";

export type { PermissionPromptResult } from "../core/permission-prompt";

type Props = {
  requests: AskPermissionRequest[];
  planMode?: boolean;
  onSubmit: (result: PermissionPromptResult) => void;
  onCancel: () => void;
};

type PromptOption = {
  kind: PermissionChoice;
  label: string;
  scopeDescription?: string;
  scopeColor?: string;
};

export function PermissionPrompt(props: Props): React.ReactElement {
  const batchKey = JSON.stringify(props.requests.map(({ toolCallId, scopes }) => [toolCallId, scopes]));
  return <PermissionPromptForm key={batchKey} {...props} />;
}

function PermissionPromptForm({ requests, planMode = false, onSubmit, onCancel }: Props): React.ReactElement | null {
  const prompts = useMemo(() => buildScopePrompts(requests), [requests]);
  const [answers, setAnswers] = useState<PermissionAnswers>({});
  const [cursor, setCursor] = useState(0);
  const closed = useRef(false);
  const { index } = resolvePermissionPrompt(prompts, answers);
  const prompt = prompts[index];
  const options = prompt ? buildOptions(prompt.scope, planMode) : [];
  const activeIndex = Math.min(cursor, options.length - 1);

  function commit(choice: PermissionChoice): void {
    const nextAnswers = { ...answers, [index]: choice };
    const next = resolvePermissionPrompt(prompts, nextAnswers);
    setAnswers(nextAnswers);
    setCursor(0);
    if (next.index === -1) {
      closed.current = true;
      onSubmit(next.result);
    }
  }

  useTerminalInput((input, key) => {
    if (!prompt || closed.current) {
      return;
    }
    if (key.escape || (key.ctrl && (input === "c" || input === "C"))) {
      closed.current = true;
      onCancel();
      return;
    }
    if (key.upArrow) {
      setCursor(Math.max(0, activeIndex - 1));
      return;
    }
    if (key.downArrow) {
      setCursor(Math.min(options.length - 1, activeIndex + 1));
      return;
    }
    const selection = key.return ? activeIndex : /^[1-9]$/.test(input) ? Number(input) - 1 : -1;
    const option = options[selection];
    if (option) commit(option.kind);
  });

  if (!prompt) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          Permission required
        </Text>
        <Text dimColor>
          {" "}
          {index + 1}/{prompts.length}
        </Text>
      </Box>
      <Text bold>{prompt.request.name}</Text>
      <Text>{prompt.request.command}</Text>
      {prompt.request.description ? <Text color="cyanBright">{prompt.request.description}</Text> : null}
      {prompt.request.diff ? (
        <Box marginTop={1}>
          <DiffPreview
            filePath={prompt.request.diff.filePath}
            added={prompt.request.diff.details.added}
            removed={prompt.request.diff.details.removed}
            lines={prompt.request.diff.details.lines.map((line) => ({
              ...line,
              marker: line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ",
            }))}
          />
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text>Do you want to proceed?</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, optionIndex) => (
          <Text key={option.kind} color={optionIndex === activeIndex ? "cyanBright" : undefined}>
            {optionIndex === activeIndex ? "> " : "  "}
            {optionIndex + 1}. {renderOptionLabel(option)}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · Enter select · Esc interrupt</Text>
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

function buildOptions(scope: AskPermissionScope, planMode: boolean): PromptOption[] {
  const options: PromptOption[] = [{ kind: "allow", label: "Yes" }];
  if (scope !== "unknown") {
    options.push({
      kind: "session",
      label: "Yes, during this session allow ",
      scopeDescription: describeScope(scope),
      scopeColor: getScopeRiskColor(scope),
    });
  }
  if (!planMode && scope !== "unknown") {
    options.push({
      kind: "always",
      label: "Yes, and always allow ",
      scopeDescription: describeScope(scope),
      scopeColor: getScopeRiskColor(scope),
    });
  }
  options.push({ kind: "deny", label: "No" });
  return options;
}

export function getScopeRiskColor(scope: AskPermissionScope): string {
  switch (scope) {
    case "read-in-cwd":
    case "read-in-tmp":
    case "write-in-tmp":
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
      return "reads inside this workspace";
    case "read-in-tmp":
      return "reads inside system temporary directories";
    case "read-out-cwd":
      return "reads outside this workspace";
    case "write-in-cwd":
      return "writes inside this workspace";
    case "write-in-tmp":
      return "writes inside system temporary directories";
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
      return scope;
  }
}
