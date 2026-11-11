import React, { useMemo, useState } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { UndoTarget, QueuedMessage } from "@vegamo/deepcode-core";

export type UndoRestoreMode = "code-and-conversation" | "conversation" | "remove" | "edit";
export type QueueUndoTarget = UndoTarget & { queued?: QueuedMessage };

type Props = {
  targets: QueueUndoTarget[];
  busy?: boolean;
  onSelect: (target: QueueUndoTarget, mode: UndoRestoreMode) => void;
  onCancel: () => void;
};

type Phase = "message" | "mode";

const MAX_VISIBLE_TARGETS = 7;

export function UndoSelector({ targets, busy = false, onSelect, onCancel }: Props): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("message");
  const [targetIndex, setTargetIndex] = useState(Math.max(0, targets.length - 1));
  const [modeIndex, setModeIndex] = useState(0);
  const [selected, setSelected] = useState<QueueUndoTarget | null>(null);
  const { columns, rows } = useWindowSize();

  const safeTargetIndex = useMemo(() => {
    if (targets.length === 0) {
      return 0;
    }
    return Math.max(0, Math.min(targetIndex, targets.length - 1));
  }, [targetIndex, targets.length]);

  const selectedTarget =
    phase === "mode"
      ? (targets.find(
          (target) => target.message.id === selected?.message.id && Boolean(target.queued) === Boolean(selected?.queued)
        ) ?? null)
      : (targets[safeTargetIndex] ?? null);
  const selectionDisabled = busy && !selectedTarget?.queued;
  const maxVisible = Math.max(1, Math.min(MAX_VISIBLE_TARGETS, rows - 8));
  const scrollOffset = Math.max(0, Math.min(safeTargetIndex - Math.floor(maxVisible / 2), targets.length - maxVisible));
  const visibleTargets = targets.slice(scrollOffset, scrollOffset + maxVisible);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === "c" || input === "C"))) {
      if (phase === "mode") {
        setPhase("message");
        return;
      }
      onCancel();
      return;
    }

    if (targets.length === 0) {
      return;
    }

    if (phase === "message") {
      if (key.upArrow) {
        setTargetIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (key.downArrow) {
        setTargetIndex((index) => Math.min(targets.length - 1, index + 1));
        return;
      }
      if (key.home) {
        setTargetIndex(0);
        return;
      }
      if (key.end) {
        setTargetIndex(targets.length - 1);
        return;
      }
      if (key.return && selectedTarget && !selectionDisabled) {
        setSelected(selectedTarget);
        setModeIndex(selectedTarget?.queued || selectedTarget?.canRestoreCode ? 0 : 1);
        setPhase("mode");
      }
      return;
    }

    if (key.upArrow || key.downArrow) {
      setModeIndex((index) => (index === 0 ? 1 : 0));
      return;
    }
    if (key.return && selectedTarget && !selectionDisabled) {
      onSelect(
        selectedTarget,
        selectedTarget.queued
          ? modeIndex === 0
            ? "remove"
            : "edit"
          : modeIndex === 0
            ? "code-and-conversation"
            : "conversation"
      );
    }
  });

  if (targets.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow">{busy ? "No pending messages." : "Nothing to undo yet."}</Text>
        <Text dimColor>Press Esc to go back.</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      width={Math.max(20, columns - 6)}
      height={Math.max(5, Math.min(rows - 1, 30))}
      overflow="hidden"
      paddingX={1}
      marginTop={1}
    >
      <Box flexDirection="column" borderStyle="round" borderDimColor flexGrow={1} overflow="hidden">
        <Box paddingX={1}>
          <Text bold color="#229ac3">
            Undo
          </Text>
          <Text dimColor> select a prompt</Text>
        </Box>
        {phase === "message" ? (
          <Box
            borderTop={true}
            borderBottom={true}
            borderLeft={false}
            borderRight={false}
            borderStyle="round"
            borderDimColor
            flexDirection="column"
            flexGrow={1}
            paddingX={1}
            overflow="hidden"
          >
            {visibleTargets.map((target, visibleIndex) => {
              const actualIndex = scrollOffset + visibleIndex;
              const isActive = actualIndex === safeTargetIndex;
              const disabled = busy && !target.queued;
              return (
                <Box key={target.message.id} height={2} marginBottom={1}>
                  <Text color={disabled ? "gray" : "#229ac3"}>{isActive ? "> " : "  "}</Text>
                  <Box flexDirection="column" flexGrow={1}>
                    <Text color={isActive && !disabled ? "#229ac3" : undefined} bold={isActive} dimColor={disabled}>
                      {formatUndoMessage(target.message.content)}
                    </Text>
                    <Text dimColor>
                      {formatTimestamp(target.message.createTime)}
                      {target.queued
                        ? " · pending"
                        : disabled
                          ? " · unavailable while running"
                          : target.canRestoreCode
                            ? " · code checkpoint available"
                            : " · conversation only"}
                    </Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box
            borderTop={true}
            borderBottom={true}
            borderLeft={false}
            borderRight={false}
            borderStyle="round"
            borderDimColor
            flexDirection="column"
            flexGrow={1}
            paddingX={1}
            overflow="hidden"
          >
            <Text dimColor>Selected message:</Text>
            <Text>{formatUndoMessage(selectedTarget?.message.content ?? "")}</Text>
            {!selectedTarget ? (
              <Text>This message is no longer available.</Text>
            ) : selectionDisabled ? (
              <Text>This prompt cannot be changed while running.</Text>
            ) : selectedTarget.queued ? (
              <Box marginTop={1} flexDirection="column">
                <Text color={modeIndex === 0 ? "cyanBright" : undefined}>{modeIndex === 0 ? "> " : "  "}Remove</Text>
                <Text dimColor>{"  "}↩️ Remove this message from the queue.</Text>
                <Box marginTop={1} flexDirection="column">
                  <Text color={modeIndex === 1 ? "cyanBright" : undefined}>{modeIndex === 1 ? "> " : "  "}Edit</Text>
                  <Text dimColor>{"  "}✏️ Edit this message before it is sent.</Text>
                </Box>
              </Box>
            ) : (
              <Box marginTop={1} flexDirection="column">
                <Text color={modeIndex === 0 ? "cyanBright" : undefined}>
                  {modeIndex === 0 ? "> " : "  "}Restore files and conversation
                </Text>
                <Text dimColor>
                  {"  "}
                  {selectedTarget?.canRestoreCode
                    ? "Also restore files with saved history to their recorded state."
                    : "No code checkpoint is recorded for this prompt."}
                </Text>
                <Box marginTop={1} flexDirection="column">
                  <Text color={modeIndex === 1 ? "cyanBright" : undefined}>
                    {modeIndex === 1 ? "> " : "  "}Restore conversation only
                  </Text>
                  <Text dimColor>{"  "}Leave files unchanged.</Text>
                </Box>
              </Box>
            )}
          </Box>
        )}
        <Box>
          <Text dimColor>
            {phase === "message" ? "↑/↓ navigate · Enter choose · Esc cancel" : "↑/↓ choose · Enter confirm · Esc back"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function formatUndoMessage(content: unknown): string {
  const text = typeof content === "string" && content.trim() ? content.trim() : "(empty message)";
  const singleLine = text.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
  return singleLine.length > 90 ? `${singleLine.slice(0, 89)}…` : singleLine;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleString();
}
