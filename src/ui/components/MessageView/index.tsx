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
import { useTheme } from "../../theme";

export function MessageView({ message, collapsed, width = 80 }: MessageViewProps): React.ReactElement | null {
  const { mode } = useRawModeContext();
  const theme = useTheme();
  if (!message.visible) {
    return null;
  }

  if (message.role === "user") {
    const text = message.content || "(no content)";
    return (
      <Box marginLeft={1} marginBottom={1} flexDirection="row" marginY={0} flexGrow={1} gap={1}>
        <Box>
          <Text color={theme.brand.accent}>{`>`}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text color={theme.brand.accent}>{text}</Text>
          {Array.isArray(message.contentParams) && message.contentParams.length > 0 ? (
            <Text color={theme.status.info}>{`  📎 ${message.contentParams.length} image attachment(s)`}</Text>
          ) : null}
        </Box>
      </Box>
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
            <StatusLine width={width} bulletColor={theme.text.muted} name="Thinking" params={summary} />
          </Box>
        );
      }
      return (
        <Box marginLeft={1} flexDirection="column" marginBottom={1} marginY={0}>
          <StatusLine width={width} bulletColor={theme.text.muted} name="Thinking" params={content ? "" : summary} />
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
          <Text color={theme.brand.accent}>✦</Text>
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
          bulletColor={summary.ok ? theme.status.success : theme.status.danger}
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
      return (
        <Box marginY={0} marginLeft={1} marginBottom={1} flexGrow={1} flexDirection="row" gap={1}>
          <Box>
            <Text color={theme.brand.accent}>{`>`}</Text>
          </Box>
          <Box flexGrow={1} flexDirection="column">
            <Text color={theme.brand.accent}>{message.content}</Text>
          </Box>
        </Box>
      );
    }

    if (message.meta?.skill) {
      return (
        <Box marginY={0} marginLeft={1} marginBottom={1}>
          <Text color={theme.status.info}>⚡ Loaded skill: {message.meta.skill.name}</Text>
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

function StatusLine({
  bulletColor,
  name,
  params,
  width,
}: {
  bulletColor: string;
  name: string;
  params: string;
  width: number;
}): React.ReactElement {
  const { mode } = useRawModeContext();
  const theme = useTheme();
  const containerWidth = Math.max(1, width - 2);
  const contentWidth = Math.max(1, width - 4);

  return (
    <Box gap={1} width={containerWidth}>
      <Box alignSelf="stretch">
        <Text key="bullet" color={bulletColor}>
          ✦
        </Text>
      </Box>
      <Box flexGrow={1} width={contentWidth} gap={1}>
        <Text wrap={mode === RawMode.Lite ? "truncate-end" : "wrap"}>
          <Text key="name" bold>
            {name}
          </Text>
          {params ? (
            <Text key="params" color={theme.text.primary}>
              {` ${params}`}
            </Text>
          ) : null}
        </Text>
      </Box>
    </Box>
  );
}

function DiffPreview({ lines }: { lines: DiffPreviewLine[] }): React.ReactElement {
  const theme = useTheme();
  const getBackgroundColor = (kind: string) => {
    switch (kind) {
      case "added":
        return theme.diff.addedBackground;
      case "removed":
        return theme.diff.removedBackground;
      case "modified":
        return theme.diff.modifiedBackground;
      default:
        return undefined;
    }
  };
  const getColor = (kind: string) => {
    switch (kind) {
      case "added":
        return theme.diff.added;
      case "removed":
        return theme.diff.removed;
      case "modified":
        return theme.diff.modified;
      default:
        return undefined;
    }
  };
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>└ Changes</Text>
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Box
            key={`${index}-${line.marker}-${line.content}`}
            gap={1}
            paddingLeft={2}
            backgroundColor={getBackgroundColor(line.kind)}
          >
            <Text color={getColor(line.kind)}>{line.marker}</Text>
            <Text color={getColor(line.kind)}>{line.content}</Text>
          </Box>
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
