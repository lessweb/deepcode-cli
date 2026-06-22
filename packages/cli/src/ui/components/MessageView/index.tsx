import React from "react";
import { Box, Text } from "ink";
import { renderMarkdown, renderMarkdownSegments } from "./markdown";
import {
  buildThinkingSummary,
  buildToolSummary,
  formatStatusName,
  formatToolStatusParams,
  getToolDiffPreviewLines,
  getUpdatePlanPreviewLines,
} from "./utils";
import type { DiffPreviewLine, MessageViewProps } from "./types";
import { RawMode, useRawModeContext } from "../../contexts";

const PROMPT_ECHO_PREFIX_WIDTH = 2;

export function MessageView({ message, collapsed, width = 80 }: MessageViewProps): React.ReactElement | null {
  const { mode } = useRawModeContext();
  if (!message.visible) {
    return null;
  }

  if (message.role === "user") {
    const text = message.content || "(no content)";
    return (
      <PromptEchoLine
        text={text}
        width={width}
        attachmentCount={Array.isArray(message.contentParams) ? message.contentParams.length : 0}
      />
    );
  }

  if (message.role === "assistant") {
    const isThinking = Boolean(message.meta?.asThinking);
    const content = (message.content || "").trim();

    if (isThinking) {
      const summary = buildThinkingSummary(content, message.messageParams, mode);
      if (collapsed !== false) {
        return (
          <Box marginLeft={1} marginBottom={1} marginY={0}>
            <StatusLine width={width} bulletColor="gray" name="Thinking" params={summary} />
          </Box>
        );
      }
      return (
        <Box marginLeft={1} flexDirection="column" marginBottom={1} marginY={0}>
          <StatusLine width={width} bulletColor="gray" name="Thinking" params={content ? "" : summary} />
          <Box flexDirection="column" marginLeft={2}>
            {content ? <Text dimColor>{renderMarkdown(content)}</Text> : null}
          </Box>
        </Box>
      );
    }

    const containerWidth = Math.max(1, width - 2);
    const contentWidth = Math.max(1, width - 4);

    return (
      <Box marginLeft={1} marginBottom={1} width={containerWidth} gap={1} marginY={0} flexDirection="row">
        <Box alignSelf="stretch">
          <Text color="#229ac3">✦</Text>
        </Box>
        <Box flexGrow={1} width={contentWidth} flexDirection="column">
          {content
            ? renderMarkdownSegments(content, Math.max(20, contentWidth - 4)).map((seg, i) => {
                if (seg.kind === "table") {
                  return (
                    <Box key={i} flexDirection="column">
                      {seg.body.split("\n").map((line, lineIndex) => (
                        <Text key={lineIndex} wrap="truncate-end">
                          {line}
                        </Text>
                      ))}
                    </Box>
                  );
                }
                return <Text key={i}>{seg.body}</Text>;
              })
            : null}
        </Box>
      </Box>
    );
  }

  if (message.role === "tool") {
    const summary = buildToolSummary(message);
    const diffLines = getToolDiffPreviewLines(summary);
    const planLines = getUpdatePlanPreviewLines(summary);
    return (
      <Box flexDirection="column" marginLeft={1} marginBottom={1} marginY={0}>
        <StatusLine
          width={width}
          bulletColor={summary.ok ? "green" : "red"}
          name={formatStatusName(summary.name)}
          params={formatToolStatusParams(summary)}
        />
        {diffLines.length > 0 ? <DiffPreview lines={diffLines} /> : null}
        {planLines.length > 0 ? <PlanPreview lines={planLines} /> : null}
      </Box>
    );
  }

  if (message.role === "system") {
    // Render model change messages in the same style as user commands.
    if (message.meta?.isModelChange) {
      return <PromptEchoLine text={message.content || ""} width={width} />;
    }

    if (message.meta?.skill) {
      return (
        <Box marginY={0} marginLeft={1} marginBottom={1}>
          <Text color="magenta">⚡ Loaded skill: {message.meta.skill.name}</Text>
        </Box>
      );
    }
    if (message.meta?.isSummary) {
      return (
        <Box marginY={0} marginLeft={1} marginBottom={1}>
          <Text dimColor italic>
            (conversation summary inserted)
          </Text>
        </Box>
      );
    }
    return null;
  }

  return null;
}

export function getPromptEchoContentWidth(width: number): number {
  return Math.max(1, width - PROMPT_ECHO_PREFIX_WIDTH);
}

function PromptEchoLine({
  text,
  width,
  attachmentCount = 0,
}: {
  text: string;
  width: number;
  attachmentCount?: number;
}): React.ReactElement {
  const contentWidth = getPromptEchoContentWidth(width);
  return (
    <Box marginBottom={1} marginY={0} width={Math.max(1, width)} flexDirection="row">
      <Box width={PROMPT_ECHO_PREFIX_WIDTH}>
        <Text color="#229ac3">{"> "}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} width={contentWidth}>
        <Text color="#229ac3" wrap="hard">
          {text}
        </Text>
        {attachmentCount > 0 ? <Text color="#229ac3">{`  📎 ${attachmentCount} image attachment(s)`}</Text> : null}
      </Box>
    </Box>
  );
}

function StatusLine({
  bulletColor,
  name,
  params,
  width,
}: {
  bulletColor: "gray" | "green" | "red";
  name: string;
  params: string;
  width: number;
}): React.ReactElement {
  const { mode } = useRawModeContext();
  const containerWidth = Math.max(1, width - 2);
  const contentWidth = Math.max(1, width - 4);
  return (
    <Box gap={1} width={containerWidth}>
      <Box alignSelf="stretch">
        <Text key="bullet" color={bulletColor}>
          ✧
        </Text>
      </Box>
      <Box flexGrow={1} width={contentWidth} gap={1}>
        <Text wrap={mode === RawMode.Lite ? "truncate-end" : "wrap"}>
          <Text key="name" bold>
            {name}
          </Text>
          {params ? (
            <Text key="params" color="white">
              {` ${params}`}
            </Text>
          ) : null}
        </Text>
      </Box>
    </Box>
  );
}

function DiffPreview({ lines }: { lines: DiffPreviewLine[] }): React.ReactElement {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>└ Changes</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, index) => (
          <Text key={`${index}-${line.marker}-${line.content}`} wrap="truncate-end">
            <Text color={line.kind === "added" ? "green" : line.kind === "removed" ? "red" : "gray"}>
              {line.marker}
            </Text>
            <Text color={line.kind === "added" ? "green" : line.kind === "removed" ? "red" : undefined}>
              {line.content}
            </Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function PlanPreview({ lines }: { lines: string[] }): React.ReactElement {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>└ Plan</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, index) => (
          <Text key={`${index}-${line}`} wrap="wrap">
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
