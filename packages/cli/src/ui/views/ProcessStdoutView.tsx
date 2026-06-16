import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import { BASH_TIMEOUT_DECREMENT_MS, BASH_TIMEOUT_INCREMENT_MS } from "@vegamo/deepcode-core";
import type { BashTimeoutAdjustment, SessionEntry, SessionProcessEntry } from "@vegamo/deepcode-core";
import { useTerminalInput } from "../hooks";

type RunningProcesses = SessionEntry["processes"];

type ProcessStdoutViewProps = {
  processStdoutRef: React.RefObject<Map<number, string>>;
  runningProcesses: RunningProcesses;
  onDismiss: () => void;
  onAdjustTimeout: (deltaMs: number) => BashTimeoutAdjustment | null;
  screenWidth: number;
  screenHeight: number;
};

const REFRESH_INTERVAL_MS = 150;
const MAX_PANEL_HEIGHT = 30;
const MIN_PANEL_HEIGHT = 5;

export const ProcessStdoutView = React.memo(function ProcessStdoutView({
  processStdoutRef,
  runningProcesses,
  onDismiss,
  onAdjustTimeout,
  screenWidth,
  screenHeight,
}: ProcessStdoutViewProps): React.ReactElement {
  const [stdoutText, setStdoutText] = useState("");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const panelHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(screenHeight - 1, MAX_PANEL_HEIGHT));
  const reservedRows = statusMessage ? 2 : 1;
  const visibleLineLimit = Math.max(1, panelHeight - reservedRows);

  useEffect(() => {
    const updateStdout = () => {
      let text = "";
      if (runningProcesses && runningProcesses.size > 0) {
        for (const [pid, proc] of runningProcesses.entries()) {
          const pidNum = Number(pid);
          const stdout = processStdoutRef.current.get(pidNum) ?? "";
          if (text) {
            text += "\n";
          }
          if (runningProcesses.size > 1) {
            text += `── Process ${pid} [${proc.command}] ──\n`;
          }
          text += stdout || "(no output yet)";
        }
      } else {
        text = "(no running processes)";
      }
      setStdoutText(text);
    };

    updateStdout();
    const interval = setInterval(updateStdout, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [processStdoutRef, runningProcesses]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const lines = useMemo(() => stdoutText.split("\n"), [stdoutText]);
  const timeoutProcess = useMemo(() => getLatestTimeoutProcess(runningProcesses), [runningProcesses]);

  const visibleLines = useMemo(() => {
    if (lines.length <= visibleLineLimit) {
      return lines;
    }
    const outputLineLimit = Math.max(1, visibleLineLimit - 1);
    const start = Math.max(0, lines.length - outputLineLimit - scrollOffset);
    const slice = lines.slice(start, start + outputLineLimit);
    if (lines.length > visibleLineLimit) {
      slice.unshift(`... (${start} lines above · ↑/↓ to scroll · ${lines.length} total lines) ...`);
    }
    return slice;
  }, [lines, scrollOffset, visibleLineLimit]);

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
        onDismiss();
        return;
      }
      if (input === "+") {
        const adjustment = onAdjustTimeout(BASH_TIMEOUT_INCREMENT_MS);
        setTemporaryStatus(formatAdjustmentStatus(adjustment));
        return;
      }
      if (input === "-") {
        const adjustment = onAdjustTimeout(-BASH_TIMEOUT_DECREMENT_MS);
        setTemporaryStatus(formatAdjustmentStatus(adjustment));
        return;
      }
      if (key.upArrow) {
        setScrollOffset((s) => Math.min(s + 10, Math.max(0, lines.length - visibleLineLimit)));
        return;
      }
      if (key.downArrow) {
        setScrollOffset((s) => Math.max(s - 10, 0));
        return;
      }
      if (key.pageUp) {
        setScrollOffset((s) => Math.min(s + visibleLineLimit, Math.max(0, lines.length - visibleLineLimit)));
        return;
      }
      if (key.pageDown) {
        setScrollOffset((s) => Math.max(s - visibleLineLimit, 0));
        return;
      }
    },
    { isActive: true }
  );

  return (
    <Box flexDirection="column" width={screenWidth} minWidth={80} height={panelHeight} overflow="hidden">
      <Box borderStyle="single" borderBottom={true} borderLeft={false} borderRight={false} borderTop={false}>
        <Text bold>📟 Process Output</Text>
        <Text dimColor>{` (${formatTimeoutHint(
          timeoutProcess?.entry
        )} · +/- adjust · Ctrl+O or Esc to close · ↑↓ PageUp/PageDown to scroll)`}</Text>
      </Box>
      <Box flexDirection="column" paddingX={1} overflow="hidden">
        {visibleLines.map((line, index) => (
          <Text key={`${index}`}>{line}</Text>
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

function getLatestTimeoutProcess(
  runningProcesses: RunningProcesses
): { pid: string; entry: SessionProcessEntry } | null {
  if (!runningProcesses) {
    return null;
  }
  let latest: { pid: string; entry: SessionProcessEntry } | null = null;
  for (const [pid, entry] of runningProcesses.entries()) {
    if (typeof entry.timeoutMs !== "number") {
      continue;
    }
    latest = { pid, entry };
  }
  return latest;
}

function formatTimeoutHint(entry?: SessionProcessEntry): string {
  if (!entry || typeof entry.timeoutMs !== "number") {
    return "timeout unavailable";
  }
  return `timeout ${formatDuration(entry.timeoutMs)}`;
}

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
