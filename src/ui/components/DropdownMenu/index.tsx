import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme";

/**
 * Generic dropdown menu item structure
 */
export type DropdownMenuItem = {
  /** Unique key for React list rendering */
  key: string;
  /** Main label text (can include status indicators) */
  label: string;
  /** Custom color for the label text */
  labelColor?: string;
  /** Secondary description text (dimmed) */
  description?: string;
  /** Whether this item is currently selected */
  selected?: boolean;
  /** Whether this item is disabled (cannot be selected) */
  disabled?: boolean;
  /** Whether to show a special status indicator (e.g., loaded checkmark) */
  statusIndicator?: {
    symbol: string;
    color: string;
  };
};

/**
 * Props for the DropdownMenu component
 */
type DropdownMenuProps = {
  /** List of items to display */
  items: DropdownMenuItem[];
  /** Index of the currently active/highlighted item */
  activeIndex: number;
  /** Maximum number of visible items before scrolling */
  maxVisible?: number;
  /** Container width in columns */
  width: number;
  /** Optional title displayed at the top */
  title?: string;
  /** Color for the title (default: "magenta") */
  titleColor?: string;
  /** Color for the active item indicator (default: "cyanBright") */
  activeColor?: string;
  /** Help text displayed at the bottom */
  helpText?: string;
  /** Text to display when items list is empty */
  emptyText?: string;
  /** Custom item renderer (overrides default rendering) */
  renderItem?: (item: DropdownMenuItem, isActive: boolean) => React.ReactNode;
};

/**
 * Calculate the visible window start position for scrolling
 * Ensures the activeIndex is always visible within the window
 */
export function calculateVisibleStart(activeIndex: number, totalItems: number, maxVisible: number): number {
  return Math.min(Math.max(0, activeIndex - Math.floor((maxVisible - 1) / 2)), Math.max(0, totalItems - maxVisible));
}

/**
 * Generic dropdown menu component with scrolling support
 * Used by Skills Dropdown, Model Dropdown, and other selection menus
 */
const DropdownMenu = React.memo(function DropdownMenu({
  items,
  activeIndex,
  maxVisible = 8,
  width,
  title,
  titleColor,
  activeColor,
  helpText,
  emptyText = "No items found",
  renderItem,
}: DropdownMenuProps): React.ReactElement | null {
  const theme = useTheme();
  const effectiveTitleColor = titleColor ?? theme.brand.accent;
  const effectiveActiveColor = activeColor ?? theme.brand.accent;
  // Calculate visible window
  const visibleStart = calculateVisibleStart(activeIndex, items?.length, maxVisible);
  const visibleItems = items?.slice(visibleStart, visibleStart + maxVisible);

  // 计算标签列最佳宽度：包含所有可能的前缀和后缀
  const labelColumnWidth = useMemo(() => {
    if (visibleItems.length === 0) {
      return 0;
    }
    // 计算每个 item 实际需要的最大宽度
    const maxContentWidth = Math.max(
      ...visibleItems.map((item) => {
        let width = 2; // prefix "> " or "  "
        if (item.selected !== undefined) {
          width += 2; // "● " or "○ "
        }
        width += item.label.length;
        if (item.statusIndicator) {
          width += 2; // " ✓" or similar
        }
        return width;
      })
    );
    const maxAllowed = Math.max(10, (width - 2) >> 1); // 容器50%宽度（减去gap），至少保留10列
    return Math.min(maxContentWidth, maxAllowed);
  }, [visibleItems, width]);

  // Early return if no items
  if (items?.length === 0) {
    return (
      <Box flexDirection="column" marginBottom={1} width={width}>
        {title ? (
          <Text color={effectiveTitleColor} bold>
            {title}
          </Text>
        ) : null}
        <Text dimColor>{emptyText}</Text>
        {helpText ? <Text dimColor>{helpText}</Text> : null}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderStyle={"round"}
      borderBottom={false}
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderColor={theme.border.default}
      width={width}
    >
      {/* Title */}
      {title ? (
        <Box paddingX={1} marginBottom={1}>
          <Text color={effectiveTitleColor} bold>
            {title}
          </Text>
        </Box>
      ) : null}

      {/* Scroll indicator - top */}
      {visibleStart > 0 ? (
        <Box marginLeft={2}>
          <Text dimColor>… {visibleStart} above</Text>
        </Box>
      ) : null}

      {/* Visible items */}
      <Box flexDirection="column">
        {visibleItems.map((item, idx) => {
          const actualIndex = visibleStart + idx;
          const isActive = actualIndex === activeIndex;

          // Use custom renderer if provided
          if (renderItem) {
            return <React.Fragment key={item.key}>{renderItem(item, isActive)}</React.Fragment>;
          }

          // Default rendering with selection indicator and optional features
          const labelColor = item.disabled ? undefined : isActive ? effectiveActiveColor : item.labelColor;

          return (
            <Box key={item.key} flexGrow={1} flexDirection="row" gap={2} paddingX={1}>
              <Box width={labelColumnWidth} flexShrink={0}>
                <Text color={labelColor} dimColor={item.disabled} wrap="truncate-end">
                  {isActive && !item.disabled ? "> " : "  "}
                  {item.selected !== undefined ? (item.selected ? "●" : "○") : null}{" "}
                  <Text color={item.disabled ? undefined : item.labelColor}>{item.label}</Text>
                  {item.statusIndicator ? (
                    <Text color={item.statusIndicator.color}> {item.statusIndicator.symbol}</Text>
                  ) : null}
                </Text>
              </Box>
              <Box flexGrow={1}>
                {item.description ? (
                  <Text
                    dimColor={!item.disabled}
                    color={item.disabled ? "gray" : undefined}
                  >{`${item.description}`}</Text>
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Scroll indicator - bottom */}
      {visibleStart + visibleItems.length < items.length ? (
        <Box marginLeft={2}>
          <Text dimColor>… {items.length - visibleStart - visibleItems.length} more</Text>
        </Box>
      ) : null}

      {/* Help text */}
      {helpText ? (
        <Box
          paddingX={1}
          paddingLeft={2}
          marginTop={1}
          borderStyle={"classic"}
          borderBottom={false}
          borderTop={true}
          borderLeft={false}
          borderRight={false}
          borderColor={theme.border.default}
        >
          <Text dimColor>{helpText}</Text>
        </Box>
      ) : null}
    </Box>
  );
});

export default DropdownMenu;
