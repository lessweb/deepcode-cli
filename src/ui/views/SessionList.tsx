import React, { useState, useMemo, useCallback } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { SessionEntry, SessionStatus } from "../../session";
import { truncate } from "../components/MessageView/utils";
import { t } from "../../common/i18n";
import { truncateDisplay } from "../../common/display-width";

type Props = {
  sessions: SessionEntry[];
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
  onDelete?: (sessionId: string) => void;
};

/**
 * Filter sessions by a search query.
 * Matches against summary, status, and failReason fields (case-insensitive).
 * Returns all sessions when query is empty.
 */
export function filterSessions(sessions: SessionEntry[], query: string): SessionEntry[] {
  if (!query.trim()) {
    return sessions;
  }

  const lowerQuery = query.toLowerCase().trim();
  return sessions.filter((session) => {
    if (session.summary && session.summary.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    if (session.status.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    if (session.failReason && session.failReason.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    if (session.assistantReply && session.assistantReply.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    return false;
  });
}

export function SessionList({ sessions, onSelect, onCancel, onDelete }: Props): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null);
  const { columns, rows } = useWindowSize();

  // Filter sessions by search query
  const filteredSessions = useMemo(() => filterSessions(sessions, searchQuery), [sessions, searchQuery]);

  // Reset index when filtered list changes (e.g., query changes)
  const safeIndex = useMemo(() => {
    if (filteredSessions.length === 0) return 0;
    return Math.max(0, Math.min(index, filteredSessions.length - 1));
  }, [index, filteredSessions.length]);

  // Dynamically calculate the number of visible sessions based on terminal height
  const maxVisibleSessions = useMemo(() => {
    // Subtract space used by borders, header (2 lines with search bar), footer, scroll indicator, etc.
    // Outer container height=rows-1, outer border 2 + header 2 + search bar 1 + inner border 2 + footer 1 + scroll indicator 1 = 9
    const reservedLines = searchQuery ? 12 : 9;
    const linesPerSession = 3; // height=2 + marginBottom=1
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    return Math.max(1, Math.floor(availableLines / linesPerSession));
  }, [rows, searchQuery]);

  // Calculate scroll offset to keep the selected item visible
  const scrollOffset = useMemo(() => {
    if (safeIndex < maxVisibleSessions) return 0;
    return safeIndex - maxVisibleSessions + 1;
  }, [safeIndex, maxVisibleSessions]);

  // Get the currently visible session list
  const visibleSessions = useMemo(() => {
    return filteredSessions.slice(scrollOffset, scrollOffset + maxVisibleSessions);
  }, [filteredSessions, scrollOffset, maxVisibleSessions]);

  // Handle backspace for search query
  const handleBackspace = useCallback(() => {
    setSearchQuery((prev) => prev.slice(0, -1));
    setIndex(0);
  }, []);

  const selectedSession = filteredSessions[safeIndex];

  useInput((input, key) => {
    // If in delete confirmation mode, handle confirm/cancel
    if (confirmDeleteSessionId) {
      if (key.return) {
        onDelete?.(confirmDeleteSessionId);
        setConfirmDeleteSessionId(null);
        return;
      }
      if (key.escape) {
        setConfirmDeleteSessionId(null);
        return;
      }
      return;
    }

    // ESC: clear search first, then cancel
    if (key.escape) {
      if (searchQuery) {
        setSearchQuery("");
        setIndex(0);
        return;
      }
      onCancel();
      return;
    }

    // Ctrl+C also cancels
    if (key.ctrl && (input === "c" || input === "C")) {
      onCancel();
      return;
    }

    // Delete key: remove search character, or start delete confirmation
    if (key.delete || key.backspace) {
      if (searchQuery) {
        // remove last search character
        handleBackspace();
        return;
      }
      // No search query: start delete confirmation if session is selected
      if (selectedSession && onDelete) {
        setConfirmDeleteSessionId(selectedSession.id);
        return;
      }
    }

    // Printable character: append to search query
    if (input && input.length > 0 && !key.meta && !key.ctrl && !key.tab && !key.return) {
      // Ignore if it's a named key that happens to have input (safety check)
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        return;
      }
      setSearchQuery((prev) => prev + input);
      setIndex(0);
      return;
    }

    if (filteredSessions.length === 0) {
      return;
    }

    if (key.upArrow) {
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setIndex((i) => Math.min(filteredSessions.length - 1, i + 1));
      return;
    }
    if (key.pageUp) {
      setIndex((i) => Math.max(0, i - maxVisibleSessions));
      return;
    }
    if (key.pageDown) {
      setIndex((i) => Math.min(filteredSessions.length - 1, i + maxVisibleSessions));
      return;
    }
    if (key.home) {
      setIndex(0);
      return;
    }
    if (key.end) {
      setIndex(filteredSessions.length - 1);
      return;
    }
    if (key.return) {
      const session = filteredSessions[safeIndex];
      if (session) {
        onSelect(session.id);
      }
    }
  });

  const hasActiveSearch = searchQuery.trim().length > 0;

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">{t("ui.sessionList.empty")}</Text>
        <Text dimColor>{t("ui.sessionList.escBack")}</Text>
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
        {/* Header row */}
        <Box paddingX={1} flexDirection="column">
          <Box>
            <Text bold color="cyanBright">
              {t("ui.sessionList.title")}
            </Text>
            <Text bold color="#229ac3">
              {" "}
              ({sessions.length} {t("ui.sessionList.total")}
              {hasActiveSearch ? t("ui.sessionList.matched", { n: filteredSessions.length }) : ""})
            </Text>
          </Box>
          {/* Search bar */}
          <Box marginTop={hasActiveSearch || searchQuery ? 0 : 0}>
            <Text dimColor>
              {searchQuery ? t("ui.sessionList.searchQuery", { query: searchQuery }) : t("ui.sessionList.searchHint")}
            </Text>
            {searchQuery ? <Text bold>|</Text> : null}
          </Box>
        </Box>

        {/* Session list */}
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
          {filteredSessions.length === 0 ? (
            <Box paddingY={1}>
              <Text color="yellow">{t("ui.sessionList.noMatch", { query: searchQuery })}</Text>
            </Box>
          ) : (
            visibleSessions.map((session, i) => {
              const actualIndex = scrollOffset + i;
              const isSelected = actualIndex === safeIndex;
              const isConfirming = confirmDeleteSessionId === session.id;
              return (
                <Box key={session.id} height={2} marginBottom={1}>
                  <Box>
                    <Text color="#229ac3">{isSelected ? "> " : "  "}</Text>
                  </Box>
                  <Box flexDirection="column" flexGrow={1}>
                    <Box width={"100%"}>
                      <Text {...(isSelected ? { bold: true } : {})} color={isSelected ? "#229ac3" : undefined}>
                        {formatSessionTitle(session.summary || t("ui.sessionList.untitled"))}
                      </Text>
                      {isConfirming ? (
                        <Text color="yellow">{t("ui.sessionList.deleteConfirmHint")}</Text>
                      ) : (
                        <Text dimColor> ({formatSessionStatus(session.status)})</Text>
                      )}
                    </Box>
                    <Box width="100%">
                      <Text dimColor>{formatTimestamp(session.updateTime)} </Text>
                    </Box>
                  </Box>
                </Box>
              );
            })
          )}
          {scrollOffset > 0 || scrollOffset + maxVisibleSessions < filteredSessions.length ? (
            <Box marginTop={1}>
              {scrollOffset > 0 ? <Text dimColor>{t("ui.sessionList.above", { n: scrollOffset })} </Text> : null}
              {scrollOffset + maxVisibleSessions < filteredSessions.length ? (
                <Text dimColor>
                  {t("ui.sessionList.below", { n: filteredSessions.length - scrollOffset - maxVisibleSessions })}
                </Text>
              ) : null}
            </Box>
          ) : null}
        </Box>
        {/* Footer */}
        <Box flexDirection="column">
          {confirmDeleteSessionId ? (
            <Box>
              <Text color="yellow">{t("ui.sessionList.deleteTitle")}</Text>
              <Text bold color="green">
                Enter
              </Text>
              <Text dimColor>{t("ui.sessionList.confirmAction")}</Text>
              <Text bold color="red">
                Esc
              </Text>
              <Text dimColor>{t("ui.sessionList.cancelAction")}</Text>
            </Box>
          ) : hasActiveSearch ? (
            <Box>
              <Text dimColor>{t("ui.sessionList.footerSearch")}</Text>
            </Box>
          ) : (
            <Box>
              <Text dimColor>{t("ui.sessionList.footerHelp")}</Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function formatTimestamp(value: string): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return value;
    }
    return date.toLocaleString();
  } catch {
    return value;
  }
}

export function formatSessionTitle(value: string, max = 70): string {
  return truncateDisplay(value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim(), max);
}

export function formatSessionStatus(status: SessionStatus): string {
  switch (status) {
    case "completed":
      return t("ui.sessionList.statusDone");
    case "processing":
      return t("ui.sessionList.statusRunning");
    case "pending":
      return t("ui.sessionList.statusPending");
    case "waiting_for_user":
      return t("ui.sessionList.statusWaiting");
    case "failed":
      return t("ui.sessionList.statusFailed");
    case "interrupted":
      return t("ui.sessionList.statusStopped");
    case "ask_permission":
      return t("ui.sessionList.statusPermission");
    case "permission_denied":
      return t("ui.sessionList.statusDenied");
    default:
      return status;
  }
}
