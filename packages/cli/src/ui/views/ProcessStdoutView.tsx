import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import { BASH_TIMEOUT_DECREMENT_MS, BASH_TIMEOUT_INCREMENT_MS } from "@vegamo/deepcode-core";
import type { BashTimeoutAdjustment } from "@vegamo/deepcode-core";
import { useTerminalInput } from "../hooks";
import { writeClipboardTextAsync } from "../core/clipboard";

import {
  wrapProcessOutputTitle,
  moveProcessOutputSelection,
  wrapProcessOutputLines,
  type ProcessOutputItem,
} from "../core/process-output";

type ProcessStdoutViewProps = {
  processStdoutRef: React.RefObject<Map<number, string>>;
  items: ProcessOutputItem[];
  onDismiss: () => void;
  onAdjustTimeout: (deltaMs: number, processId: string) => BashTimeoutAdjustment | null;
  screenWidth: number;
  screenHeight: number;
};

const REFRESH_INTERVAL_MS = 150;
const MAX_PANEL_HEIGHT = 30;
const MIN_PANEL_HEIGHT = 5;

export const ProcessStdoutView = React.memo(function ProcessStdoutView({
  processStdoutRef,
  items,
  onDismiss,
  onAdjustTimeout,
  screenWidth,
  screenHeight,
}: ProcessStdoutViewProps): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(() => items.at(-1)?.id ?? null);
  const selected = items.find((item) => item.id === selectedId) ?? items.at(-1);
  const [liveOutput, setLiveOutput] = useState({ id: "", text: "" });
  const stdoutText = selected?.running
    ? (liveOutput.id === selected.id ? liveOutput.text : "") || "(no output yet)"
    : selected?.output || "(no output)";
  const [scrollOffset, setScrollOffset] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyRequestRef = useRef(0);

  const panelHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(screenHeight - 1, MAX_PANEL_HEIGHT));
  const titleLines = useMemo(
    () => (selected ? wrapProcessOutputTitle(selected, screenWidth - 2) : ["(no process output)"]),
    [selected, screenWidth]
  );
  const contentRows = Math.max(1, panelHeight - (statusMessage ? 3 : 2));
  // Keep ordinary commands visible; include very long commands in the scrollable content.
  const pinTitle = titleLines.length <= contentRows - 2;
  const visibleLineLimit = contentRows - (pinTitle ? titleLines.length : 0);

  const currentId = selected?.id;
  useEffect(() => {
    if (currentId) setSelectedId(currentId);
  }, [currentId]);

  useEffect(() => {
    setScrollOffset(0);
    setStatusMessage("");
    return () => {
      copyRequestRef.current += 1;
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [selected?.id]);

  useEffect(() => {
    if (!selected?.running || !selected.pid) return;
    const updateStdout = () =>
      setLiveOutput({
        id: selected.id,
        text: processStdoutRef.current.get(Number(selected.pid)) ?? "",
      });
    updateStdout();
    const interval = setInterval(updateStdout, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [processStdoutRef, selected?.id, selected?.running, selected?.pid]);

  const lines = useMemo(
    () => [...(pinTitle ? [] : titleLines), ...(selected ? wrapProcessOutputLines(stdoutText, screenWidth - 2) : [])],
    [pinTitle, titleLines, selected, stdoutText, screenWidth]
  );
  const canAdjustTimeout = selected?.running && !selected.background && typeof selected.timeoutMs === "number";
  const showScrollHint = lines.length > visibleLineLimit && visibleLineLimit > 1;
  const outputLineLimit = visibleLineLimit - (showScrollHint ? 1 : 0);
  const maxScrollOffset = Math.max(0, lines.length - outputLineLimit);

  const visibleLines = useMemo(() => {
    const start = Math.max(0, maxScrollOffset - scrollOffset);
    const slice = lines.slice(start, start + outputLineLimit);
    if (showScrollHint) {
      slice.unshift(`... (${start} lines above · ↑/↓ to scroll · ${lines.length} total lines) ...`);
    }
    return slice;
  }, [lines, scrollOffset, outputLineLimit, maxScrollOffset, showScrollHint]);

  const setTemporaryStatus = (message: string) => {
    setStatusMessage(message);
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = setTimeout(() => setStatusMessage(""), 2000);
  };

  useTerminalInput(
    (input, key) => {
      if ((key.ctrl && (input === "o" || input === "O")) || key.escape) {
        copyRequestRef.current++;
        onDismiss();
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        const nextId = moveProcessOutputSelection(items, selected?.id ?? null, key.leftArrow ? -1 : 1);
        if (nextId !== selected?.id) copyRequestRef.current++;
        setSelectedId(nextId);
        return;
      }
      if (input === "y" && !key.ctrl && !key.meta && !key.paste) {
        if (!selected?.command) return;
        const request = ++copyRequestRef.current;
        const reportCopy = (success: boolean) => {
          if (request === copyRequestRef.current) {
            setTemporaryStatus(success ? "Copied to clipboard" : "Failed to copy");
          }
        };
        void writeClipboardTextAsync(selected.command)
          .then(reportCopy)
          .catch(() => reportCopy(false));
        return;
      }
      if (input === "+" && canAdjustTimeout && selected?.pid) {
        const adjustment = onAdjustTimeout(BASH_TIMEOUT_INCREMENT_MS, selected.pid);
        setTemporaryStatus(formatAdjustmentStatus(adjustment));
        return;
      }
      if (input === "-" && canAdjustTimeout && selected?.pid) {
        const adjustment = onAdjustTimeout(-BASH_TIMEOUT_DECREMENT_MS, selected.pid);
        setTemporaryStatus(formatAdjustmentStatus(adjustment));
        return;
      }
      if (key.upArrow) {
        setScrollOffset((s) => Math.min(s + Math.min(10, outputLineLimit), maxScrollOffset));
        return;
      }
      if (key.downArrow) {
        setScrollOffset((s) => Math.max(s - Math.min(10, outputLineLimit), 0));
        return;
      }
      if (key.pageUp) {
        setScrollOffset((s) => Math.min(s + outputLineLimit, maxScrollOffset));
        return;
      }
      if (key.pageDown) {
        setScrollOffset((s) => Math.max(s - outputLineLimit, 0));
        return;
      }
    },
    { isActive: true }
  );

  return (
    <Box flexDirection="column" width={screenWidth} height={panelHeight} overflow="hidden">
      <Box
        flexShrink={0}
        borderStyle="single"
        borderBottom={true}
        borderLeft={false}
        borderRight={false}
        borderTop={false}
      >
        <Box flexShrink={0}>
          <Text bold>📟 Process Output</Text>
        </Box>
        <Text
          dimColor
          wrap="truncate-end"
        >{` (${canAdjustTimeout ? `timeout ${formatDuration(selected.timeoutMs!)} · +/- adjust · ` : ""}←→ history · Ctrl+O or Esc close · ↑↓ PgUp/PgDn scroll · y copy command)`}</Text>
      </Box>
      <Box flexDirection="column" flexShrink={0} paddingX={1} overflow="hidden">
        {pinTitle && <Text wrap="hard">{titleLines.join("\n")}</Text>}
        {visibleLines.map((line, index) => (
          <Text key={`${index}`} wrap="truncate-end">
            {line || " "}
          </Text>
        ))}
      </Box>
      {statusMessage ? (
        <Box paddingX={1}>
          <Text dimColor>{statusMessage}</Text>
        </Box>
      ) : null}
    </Box>
  );
});

function formatAdjustmentStatus(adjustment: BashTimeoutAdjustment | null): string {
  if (!adjustment) {
    return "No adjustable Bash timeout";
  }
  return `Timeout set to ${formatDuration(adjustment.timeoutMs)}`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  return `${totalMinutes}m`;
}
