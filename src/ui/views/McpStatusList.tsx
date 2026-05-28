import React, { useState, useMemo, useCallback } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { McpServerStatus } from "../../mcp/mcp-manager";
import { useTheme } from "../theme";

type Props = {
  statuses: McpServerStatus[];
  onCancel: () => void;
  onReconnect: (name: string) => void;
};

export function McpStatusList({ statuses, onCancel, onReconnect }: Props): React.ReactElement {
  const { columns, rows } = useWindowSize();
  const theme = useTheme();

  // 视图模式：server-list（服务器列表） 或 server-detail（服务器详情）
  const [viewMode, setViewMode] = useState<"server-list" | "server-detail">("server-list");
  // 选中的服务器索引
  const [selectedServerIndex, setSelectedServerIndex] = useState(0);

  // 返回服务器列表
  const goBack = useCallback(() => {
    setViewMode("server-list");
  }, []);

  // 进入服务器详情（允许 ready、failed、reconnecting 状态）
  const enterDetail = useCallback(() => {
    const server = statuses[selectedServerIndex];
    if (server && (server.status === "ready" || server.status === "failed" || server.status === "reconnecting")) {
      setViewMode("server-detail");
    }
  }, [statuses, selectedServerIndex]);

  // 当没有服务器时，监听 Esc 键退出
  useInput((input, key) => {
    if (statuses.length === 0 && (key.escape || (key.ctrl && (input === "c" || input === "C")))) {
      onCancel();
    }
  });

  if (statuses.length === 0) {
    return (
      <Box flexDirection="column" marginLeft={1} paddingX={1} gap={1} borderStyle="round" borderColor={theme.border}>
        <Box flexDirection="column">
          <Text color={theme.primary} bold>
            Manage MCP servers
          </Text>
          <Text dimColor>0 servers</Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>No MCP servers configured.</Text>
          <Text dimColor>Add MCP servers to your settings to get started.</Text>
        </Box>
        <Text dimColor>Esc to close</Text>
      </Box>
    );
  }

  if (viewMode === "server-detail") {
    return (
      <ServerDetailView
        server={statuses[selectedServerIndex]}
        onBack={goBack}
        onCancel={onCancel}
        onReconnect={onReconnect}
        rows={rows}
        columns={columns}
      />
    );
  }

  return (
    <ServerListView
      statuses={statuses}
      selectedIndex={selectedServerIndex}
      onSelect={setSelectedServerIndex}
      onEnter={enterDetail}
      onCancel={onCancel}
      rows={rows}
      columns={columns}
    />
  );
}

// ==================== 服务器列表视图 ====================
function ServerListView({
  statuses,
  selectedIndex,
  onSelect,
  onEnter,
  onCancel,
  rows,
  columns,
}: {
  statuses: McpServerStatus[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onEnter: () => void;
  onCancel: () => void;
  rows: number;
  columns: number;
}): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const serverCount = statuses.length;
  const theme = useTheme();

  const maxVisible = useMemo(() => {
    const reservedLines = 8; // header + footer + borders
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    // 每个服务器占用 1 行（标题）+ 1 行（错误信息或统计）+ 1 行（间隔）
    return Math.max(1, Math.floor(availableLines / 3));
  }, [rows]);

  // 计算标签列宽度：找到最长的服务器名称，加上前缀和图标
  const labelColumnWidth = useMemo(() => {
    if (serverCount === 0) return 0;
    const longestName = Math.max(...statuses.map((s) => s.name.length));
    const contentWidth = longestName + 5; // +2 for prefix "> " or "  ", +3 for icon "✓ "
    const maxAllowed = Math.max(15, Math.floor((columns - 6) * 0.4)); // 容器40%宽度，至少15列
    return Math.min(contentWidth, maxAllowed);
  }, [statuses, serverCount, columns]);

  const safeIndex = useMemo(() => {
    if (serverCount === 0) return 0;
    return Math.max(0, Math.min(selectedIndex, serverCount - 1));
  }, [selectedIndex, serverCount]);

  // 自动滚动确保选中项可见
  React.useEffect(() => {
    if (safeIndex < scrollOffset) {
      setScrollOffset(safeIndex);
    } else if (safeIndex >= scrollOffset + maxVisible) {
      setScrollOffset(safeIndex - maxVisible + 1);
    }
  }, [safeIndex, scrollOffset, maxVisible]);

  const visibleServers = useMemo(() => {
    return statuses.slice(scrollOffset, scrollOffset + maxVisible);
  }, [statuses, scrollOffset, maxVisible]);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === "c" || input === "C"))) {
      onCancel();
      return;
    }
    if (serverCount === 0) {
      return;
    }
    if (key.upArrow) {
      onSelect(Math.max(0, selectedIndex - 1));
      return;
    }
    if (key.downArrow) {
      onSelect(Math.min(serverCount - 1, selectedIndex + 1));
      return;
    }
    if (key.pageUp) {
      onSelect(Math.max(0, selectedIndex - maxVisible));
      return;
    }
    if (key.pageDown) {
      onSelect(Math.min(serverCount - 1, selectedIndex + maxVisible));
      return;
    }
    if (key.home) {
      onSelect(0);
      return;
    }
    if (key.end) {
      onSelect(serverCount - 1);
    }
    // Enter 键进入详情
    if (key.return) {
      onEnter();
      return;
    }
  });

  const readyCount = statuses.filter((s) => s.status === "ready").length;
  const startingCount = statuses.filter((s) => s.status === "starting").length;
  const reconnectingCount = statuses.filter((s) => s.status === "reconnecting").length;
  const failedCount = statuses.filter((s) => s.status === "failed").length;

  return (
    <Box
      flexDirection="column"
      width={Math.max(20, columns - 6)}
      height={Math.max(5, Math.min(rows - 1, 30))}
      overflow="hidden"
      paddingX={1}
      marginTop={1}
    >
      <Box flexDirection="column" borderStyle="round" borderColor={theme.border} flexGrow={1} overflow="hidden">
        {/* Header row */}
        <Box paddingX={1} gap={1}>
          <Text bold color={theme.primary}>
            Manage MCP servers
          </Text>
          <Box gap={1}>
            <Text dimColor>(</Text>
            <Text color={theme.success}>{readyCount} ready,</Text>
            <Text color={theme.warning}>{startingCount} starting,</Text>
            {reconnectingCount > 0 && <Text color={theme.warning}>{reconnectingCount} reconnecting,</Text>}
            <Text color={theme.error}>{failedCount} failed</Text>
            <Text dimColor>)</Text>
          </Box>
        </Box>
        {/* Items list */}
        <Box
          borderTop={true}
          borderBottom={true}
          borderLeft={false}
          borderRight={false}
          borderStyle="round"
          borderColor={theme.border}
          flexDirection="column"
          flexGrow={1}
          paddingX={1}
          overflow="hidden"
        >
          {visibleServers.map((status, i) => {
            const actualIndex = scrollOffset + i;
            const isSelected = actualIndex === safeIndex;

            return (
              <ServerRow
                key={`server-${status.name}`}
                status={status}
                selected={isSelected}
                labelColumnWidth={labelColumnWidth}
              />
            );
          })}
          {scrollOffset > 0 || scrollOffset + maxVisible < serverCount ? (
            <Box marginTop={1}>
              {scrollOffset > 0 ? <Text dimColor>… {scrollOffset} servers above. </Text> : null}
              {scrollOffset + maxVisible < serverCount ? (
                <Text dimColor>… {serverCount - scrollOffset - maxVisible} servers below.</Text>
              ) : null}
            </Box>
          ) : null}
        </Box>
        {/* Footer */}
        <Box paddingX={1}>
          <Text dimColor>↑/↓ navigate · Enter view details · Esc close</Text>
        </Box>
      </Box>
    </Box>
  );
}

function ServerRow({
  status,
  selected,
  labelColumnWidth,
}: {
  status: McpServerStatus;
  selected: boolean;
  labelColumnWidth: number;
}): React.ReactElement {
  const theme = useTheme();
  const icon =
    status.status === "ready" ? "✓" : status.status === "failed" ? "✗" : status.status === "reconnecting" ? "↻" : "●";
  const color =
    status.status === "ready"
      ? theme.success
      : status.status === "failed"
        ? theme.error
        : status.status === "reconnecting"
          ? theme.warning
          : theme.warning;

  // 加载动画：循环显示 (空) → . → .. → ... → (空) → ...
  const [dots, setDots] = React.useState(0);
  React.useEffect(() => {
    if (status.status !== "starting" && status.status !== "reconnecting") return;
    const interval = setInterval(() => {
      setDots((d) => (d + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, [status.status]);

  const detail =
    status.status === "ready"
      ? `Ready (${status.toolCount} tools, ${status.promptCount} prompts, ${status.resourceCount} resources)`
      : status.status === "failed"
        ? `Failed`
        : status.status === "reconnecting"
          ? `Reconnecting${dots > 0 ? ".".repeat(dots) : "   "}`
          : "Starting" + (dots > 0 ? ".".repeat(dots) : "   ");

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Server row */}
      <Box gap={2}>
        <Box width={labelColumnWidth} flexShrink={0}>
          <Text color={selected ? theme.primary : undefined}>
            {selected ? "> " : "  "}
            <Text color={color}>{icon} </Text>
            <Text bold>{status.name}</Text>
          </Text>
        </Box>
        <Box flexGrow={1}>
          <Text dimColor>{detail}</Text>
        </Box>
      </Box>

      {/* Error message for failed or reconnecting servers */}
      {(status.status === "failed" || status.status === "reconnecting") && status.error ? (
        <ErrorRow error={status.error} />
      ) : null}
    </Box>
  );
}

// ==================== 服务器详情视图 ====================
function ServerDetailView({
  server,
  onBack,
  onCancel,
  onReconnect,
  rows,
  columns,
}: {
  server: McpServerStatus;
  onBack: () => void;
  onCancel: () => void;
  onReconnect: (name: string) => void;
  rows: number;
  columns: number;
}): React.ReactElement {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const hasReconnect = server.status === "failed";
  const canScroll = server.status === "ready";
  const theme = useTheme();

  // 合并所有 items（tools, prompts, resources）+ Reconnect 选项
  const allItems = useMemo(() => {
    const items: { type: string; name: string }[] = [];
    if (hasReconnect) {
      items.push({ type: "action", name: "Reconnect" });
    }
    server.tools.forEach((tool) => items.push({ type: "tool", name: tool }));
    server.prompts.forEach((prompt) => items.push({ type: "prompt", name: prompt }));
    server.resources.forEach((resource) => items.push({ type: "resource", name: resource }));
    return items;
  }, [server, hasReconnect]);

  const totalItems = allItems.length;

  const maxVisible = useMemo(() => {
    const reservedLines = 12; // header + title + stats + error + footer + borders
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    return Math.max(1, availableLines);
  }, [rows]);

  const visibleStartRef = React.useRef(0);

  const visibleStart = useMemo(() => {
    if (totalItems === 0) return 0;
    const currentStart = visibleStartRef.current;
    let newStart = currentStart;
    if (activeIndex < currentStart) {
      newStart = activeIndex;
    } else if (activeIndex >= currentStart + maxVisible) {
      newStart = activeIndex - maxVisible + 1;
    }
    newStart = Math.max(0, Math.min(newStart, Math.max(0, totalItems - maxVisible)));
    visibleStartRef.current = newStart;
    return newStart;
  }, [activeIndex, maxVisible, totalItems]);

  const visibleItems = allItems.slice(visibleStart, visibleStart + maxVisible);

  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "C")) {
      onCancel();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return || input === " ") {
      if (activeIndex === 0 && hasReconnect) {
        onReconnect(server.name);
        onBack();
        return;
      }
      onBack();
      return;
    }
    if (!canScroll && !hasReconnect) return;
    if (key.upArrow) {
      setActiveIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setActiveIndex((prev) => Math.min(totalItems - 1, prev + 1));
      return;
    }
    if (key.pageUp && canScroll) {
      setActiveIndex((prev) => Math.max(0, prev - maxVisible));
      return;
    }
    if (key.pageDown && canScroll) {
      setActiveIndex((prev) => Math.min(totalItems - 1, prev + maxVisible));
      return;
    }
    if (key.home && canScroll) {
      setActiveIndex(0);
      return;
    }
    if (key.end && canScroll) {
      setActiveIndex(totalItems - 1);
    }
  });

  const statusIcon =
    server.status === "ready" ? "✓" : server.status === "failed" ? "✗" : server.status === "reconnecting" ? "↻" : "●";
  const statusColor =
    server.status === "ready"
      ? theme.success
      : server.status === "failed"
        ? theme.error
        : server.status === "reconnecting"
          ? theme.warning
          : theme.warning;

  return (
    <Box
      flexDirection="column"
      width={Math.max(20, columns - 6)}
      height={Math.max(5, Math.min(rows - 1, 30))}
      overflow="hidden"
      paddingX={1}
      marginTop={1}
    >
      <Box flexDirection="column" borderStyle="round" borderColor={theme.border} flexGrow={1} overflow="hidden">
        {/* Header row */}
        <Box paddingX={1} gap={1}>
          <Text color={statusColor}>{statusIcon} </Text>
          <Text bold color={theme.primary} wrap="truncate-end">
            {server.name}
          </Text>
          <Text dimColor>— {server.status === "ready" ? "Details" : "Status"}</Text>
        </Box>
        {/* Server info */}
        <Box paddingX={1} marginLeft={3}>
          <Text wrap="truncate-end">
            {server.status === "ready"
              ? `${server.toolCount} tools, ${server.promptCount} prompts, ${server.resourceCount} resources`
              : `Status: ${server.status}`}
          </Text>
        </Box>
        {/* Error for failed/reconnecting */}
        {server.error && (server.status === "failed" || server.status === "reconnecting") ? (
          <Box paddingX={1} marginLeft={3}>
            <ErrorRow error={server.error} />
          </Box>
        ) : null}
        {/* Items list */}
        <Box
          borderTop={true}
          borderBottom={true}
          borderLeft={false}
          borderRight={false}
          borderStyle="round"
          borderColor={theme.border}
          flexDirection="column"
          flexGrow={1}
          paddingX={1}
          overflow="hidden"
        >
          {visibleStart > 0 ? (
            <Box>
              <Text dimColor>▲</Text>
            </Box>
          ) : (
            <Text> </Text>
          )}
          <Box paddingX={1} flexDirection="column">
            {visibleItems.length === 0 ? (
              <Box paddingY={1}>
                <Text dimColor>No items available</Text>
              </Box>
            ) : (
              visibleItems.map((item, idx) => {
                const actualIndex = visibleStart + idx;
                const isSelected = actualIndex === activeIndex;
                return <ItemRow key={`${item.type}-${item.name}-${actualIndex}`} item={item} selected={isSelected} />;
              })
            )}
          </Box>
          {visibleStart > 0 || visibleStart + maxVisible < totalItems ? (
            <Box marginTop={1} gap={1}>
              {totalItems - visibleStart - maxVisible > 0 ? <Text dimColor>▼</Text> : <Text> </Text>}
              {visibleStart > 0 ? <Text dimColor>… {visibleStart} items above. </Text> : null}
              {totalItems - visibleStart - maxVisible > 0 ? (
                <Text dimColor>… {totalItems - visibleStart - maxVisible} items below.</Text>
              ) : null}
            </Box>
          ) : null}
        </Box>
        {/* Footer */}
        <Box paddingX={1}>
          <Text dimColor>
            {hasReconnect
              ? "Enter to reconnect · Esc back · Ctrl+C close"
              : canScroll
                ? "↑/↓ scroll · Space/Enter back · Esc back · Ctrl+C close"
                : "Space/Enter back · Esc back · Ctrl+C close"}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function ItemRow({ item, selected }: { item: { type: string; name: string }; selected: boolean }): React.ReactElement {
  const isAction = item.type === "action";
  const icon = isAction ? "↻" : item.type === "tool" ? "🔧" : item.type === "prompt" ? "📝" : "📦";
  const theme = useTheme();
  const color = isAction && selected ? theme.warning : selected ? theme.primary : undefined;

  return (
    <Box height={1} flexDirection="row">
      <Text color={selected ? theme.primary : undefined}>{selected ? "> " : "  "}</Text>
      <Text dimColor>{icon} </Text>
      <Text color={color} dimColor={!selected} bold={isAction} wrap="truncate-end">
        {isAction ? `[${item.name}]` : item.name}
      </Text>
    </Box>
  );
}

function ErrorRow({ error }: { error: string }): React.ReactElement {
  const lines = error.split("\n").filter((line) => line.trim().length > 0);
  const theme = useTheme();

  return (
    <Box
      flexDirection="column"
      marginLeft={4}
      marginTop={0}
      marginBottom={0}
      borderStyle="round"
      borderColor={theme.error}
    >
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color={theme.error} dimColor>
            {line}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
