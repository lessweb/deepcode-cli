import {formatSlashCommandDescription, formatSlashCommandLabel, SlashCommandItem} from "./slashCommands";
import React from "react";
import {Box, Text} from "ink";

type SlashCommandMenuProps = {
  items: SlashCommandItem[];
  activeIndex: number;
  width: number;
  maxVisible?: number;
};

const SlashCommandMenu = React.memo(function SlashCommandMenu({
                                                                items,
                                                                activeIndex,
                                                                maxVisible = 6,
                                                                width
                                                              }: SlashCommandMenuProps): React.ReactElement | null {
  if (items.length === 0) {
    return null;
  }

  // 计算可见窗口起始位置，确保 activeIndex 始终在可见区域内
  const visibleStart = Math.min(
    Math.max(0, activeIndex - Math.floor((maxVisible - 1) / 2)),
    Math.max(0, items.length - maxVisible)
  );
  const visibleItems = items.slice(visibleStart, visibleStart + maxVisible);

  // 计算标签列最佳宽度：包含前缀"› "或"  "（2字符），不超过容器一半（扣除gap）
  const labelColumnWidth = React.useMemo(() => {
    const longestLabel = Math.max(...items.map((s) => s.label.length));
    const contentWidth = longestLabel + 2; // +2 for prefix "› " or "  "
    const maxAllowed = Math.max(10, (width - 2) >> 1); // 容器50%宽度（减去gap），至少保留10列
    return Math.min(contentWidth, maxAllowed);
  }, [items, width]);

  return (
    <Box flexDirection="column" marginBottom={1} width={width}>
      {visibleStart > 0 ? (
        <Box marginLeft={2}><Text dimColor>▲</Text></Box>
      ) : null}
      {visibleItems.map((item, idx) => {
        const actualIndex = visibleStart + idx;
        return (
          <Box key={item.label} gap={2} flexDirection="row" flexGrow={1}>
            <Box width={labelColumnWidth} flexShrink={0}>
              <Text color={actualIndex === activeIndex ? "cyanBright" : undefined} wrap="truncate-end">
                {actualIndex === activeIndex ? "› " : "  "}
                <Text bold>{formatSlashCommandLabel(item)}</Text>
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={actualIndex === activeIndex ? "cyanBright" : undefined} wrap="truncate-end">
                <Text dimColor>{formatSlashCommandDescription(item.description)}</Text>
              </Text>
            </Box>
          </Box>
        );
      })}
      <Box marginLeft={2} flexDirection='column'>
        {visibleStart + visibleItems.length < items.length ? (
          <Text dimColor>▼</Text>
        ) : null}
        <Text dimColor>({activeIndex + 1}/{items.length})  ↑↓ to navigate · Enter to select</Text>
      </Box>
    </Box>
  );
});

export default SlashCommandMenu;