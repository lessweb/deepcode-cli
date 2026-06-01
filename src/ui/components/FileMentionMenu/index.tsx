import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import DropdownMenu from "../DropdownMenu";
import { useTheme } from "../../theme";
import type { FileMentionItem, FileMentionToken } from "../../core/file-mentions";

type Props = {
  open: boolean;
  width: number;
  token: FileMentionToken | null;
  items: FileMentionItem[];
  onClose: () => void;
  onSelect: (item: FileMentionItem) => void;
};

const FileMentionMenu: React.FC<Props> = ({ open, width, token, items, onClose, onSelect }) => {
  const theme = useTheme();
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset index when opened
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
    }
  }, [open]);

  // Validate activeIndex bounds
  useEffect(() => {
    if (!open) {
      return;
    }
    if (items.length === 0) {
      setActiveIndex(0);
      return;
    }
    if (activeIndex >= items.length) {
      setActiveIndex(Math.max(0, items.length - 1));
    }
  }, [activeIndex, items.length, open]);

  useInput(
    (input, key) => {
      if (!open) {
        return;
      }

      if (key.escape) {
        onClose();
        return;
      }

      if (key.upArrow) {
        if (items.length > 0) {
          setActiveIndex((idx) => (idx - 1 + items.length) % items.length);
        }
        return;
      }

      if (key.downArrow) {
        if (items.length > 0) {
          setActiveIndex((idx) => (idx + 1) % items.length);
        }
        return;
      }

      if (key.tab || (key.return && !key.shift && !key.meta)) {
        const selected = items[activeIndex];
        if (selected) {
          onSelect(selected);
          return;
        }
        if (key.tab) {
          onClose();
        }
        return;
      }
    },
    { isActive: open }
  );

  if (!open) {
    return null;
  }

  return (
    <DropdownMenu
      width={width}
      title="Mention File"
      helpText="Enter/Tab insert · Esc close"
      emptyText={token?.query ? "No matching files" : "Type after @ to search files"}
      items={items.map((item) => ({
        key: item.path,
        label: item.path,
        description: item.type === "directory" ? "directory" : "file",
      }))}
      activeIndex={activeIndex}
      maxVisible={8}
      renderItem={(item, isActive) => (
        <Box flexDirection="row" paddingX={1} gap={1}>
          <Text color={isActive ? theme.brand.accent : undefined}>{isActive ? "> " : "  "}</Text>
          <Box flexGrow={1}>
            <Text color={isActive ? theme.brand.accent : undefined} wrap="truncate-end" bold={isActive}>
              {item.label}
            </Text>
          </Box>
          {item.description ? (
            <Box width={10} flexShrink={0}>
              <Text dimColor>{item.description}</Text>
            </Box>
          ) : null}
        </Box>
      )}
    />
  );
};

export default FileMentionMenu;
