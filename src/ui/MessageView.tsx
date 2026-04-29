import React from "react";
import { Box, Text } from "ink";
import { renderMarkdown } from "./markdown";
import type { SessionMessage } from "../session";

type Props = {
  message: SessionMessage;
  collapsed?: boolean;
};

export function MessageView({ message }: Props): React.ReactElement | null {
  if (!message.visible) {
    return null;
  }

  if (message.role === "user") {
    const text = message.content || "(no content)";
    return (
      <Box flexDirection="column" marginY={0}>
        <Text color="green">{`❯ ${text}`}</Text>
        {Array.isArray(message.contentParams) && message.contentParams.length > 0 ? (
          <Text color="green">{`  📎 ${message.contentParams.length} image attachment(s)`}</Text>
        ) : null}
      </Box>
    );
  }

  if (message.role === "assistant") {
    const isThinking = Boolean(message.meta?.asThinking);
    const content = (message.content || "").trim();

    if (isThinking) {
      const summary = firstNonEmptyLine(content) || "(thinking...)";
      return (
        <Box marginY={0}>
          <StatusLine bulletColor="gray" name="Thinking" params={truncate(summary, 100)} />
        </Box>
      );
    }

    return (
      <Box flexDirection="column" marginY={0}>
        <Text color="cyan" bold>Assistant</Text>
        <Box marginLeft={2} flexDirection="column">
          {content ? <Text>{renderMarkdown(content)}</Text> : null}
        </Box>
      </Box>
    );
  }

  if (message.role === "tool") {
    const summary = buildToolSummary(message);
    return (
      <Box marginY={0}>
        <StatusLine
          bulletColor={summary.ok ? "green" : "red"}
          name={formatStatusName(summary.name)}
          params={truncate(firstNonEmptyLine(summary.params), 120)}
        />
      </Box>
    );
  }

  if (message.role === "system") {
    if (message.meta?.skill) {
      return (
        <Box marginY={0}>
          <Text color="magenta">⚡ Loaded skill: {message.meta.skill.name}</Text>
        </Box>
      );
    }
    if (message.meta?.isSummary) {
      return (
        <Box marginY={0}>
          <Text dimColor italic>(conversation summary inserted)</Text>
        </Box>
      );
    }
    return null;
  }

  return null;
}

function StatusLine({
  bulletColor,
  name,
  params
}: {
  bulletColor: "gray" | "green" | "red";
  name: string;
  params: string;
}): React.ReactElement {
  return (
    <Text wrap="truncate-end">
      {[
        <Text key="bullet" color={bulletColor}>•</Text>,
        " ",
        <Text key="name" bold>{name}</Text>,
        params ? <Text key="params" color="white">{`  ${params}`}</Text> : null
      ]}
    </Text>
  );
}

function buildToolSummary(message: SessionMessage): { name: string; params: string; ok: boolean } {
  const payload = parseToolPayload(message.content);
  const metaFunctionName =
    message.meta?.function && typeof (message.meta.function as { name?: unknown }).name === "string"
      ? (message.meta.function as { name: string }).name
      : null;
  const name = payload.name || metaFunctionName || "tool";
  const params = name === "AskUserQuestion"
    ? extractAskUserQuestionParams(message) || getMetaParams(message)
    : getMetaParams(message);

  return {
    name,
    params,
    ok: payload.ok !== false
  };
}

function getMetaParams(message: SessionMessage): string {
  return typeof message.meta?.paramsMd === "string" ? message.meta.paramsMd.trim() : "";
}

function extractAskUserQuestionParams(message: SessionMessage): string {
  const fromFunction = extractQuestionsFromToolFunction(message.meta?.function);
  if (fromFunction) {
    return fromFunction;
  }

  const params = getMetaParams(message);
  if (!params) {
    return "";
  }

  try {
    const parsed = JSON.parse(params);
    return extractQuestionsFromValue(parsed);
  } catch {
    return "";
  }
}

function extractQuestionsFromToolFunction(toolFunction: unknown): string {
  if (!toolFunction || typeof toolFunction !== "object") {
    return "";
  }
  const args = (toolFunction as { arguments?: unknown }).arguments;
  if (typeof args !== "string" || !args.trim()) {
    return "";
  }
  try {
    const parsed = JSON.parse(args);
    return extractQuestionsFromValue((parsed as { questions?: unknown })?.questions);
  } catch {
    return "";
  }
}

function extractQuestionsFromValue(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return "";
      }
      return typeof (item as { question?: unknown }).question === "string"
        ? (item as { question: string }).question.trim()
        : "";
    })
    .filter(Boolean)
    .join(" / ");
}

function parseToolPayload(content: string | null): { name: string | null; ok: boolean } {
  if (!content) {
    return { name: null, ok: true };
  }

  try {
    const parsed = JSON.parse(content) as { name?: unknown; ok?: unknown };
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null,
      ok: parsed.ok !== false
    };
  } catch {
    return { name: null, ok: true };
  }
}

function formatStatusName(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Tool";
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

function firstNonEmptyLine(value: string): string {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/\s+/g, " ");
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}
