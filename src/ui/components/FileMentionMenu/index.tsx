import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import DropdownMenu from "../DropdownMenu";
import type { FileMentionItem, FileMentionToken } from "../../core/file-mentions";
import { t } from "../../../common/i18n";

type Props = {
  open: boolean;
  width: number;
  token: FileMentionToken | null;
  items: FileMentionItem[];
  onClose: () => void;
  onSelect: (item: FileMentionItem) => void;
};

const FileMentionMenu: React.FC<Props> = ({ open, width, token, items, onClose, onSelect }) => {
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
      title={t("ui.fileMentionMenu.title")}
      helpText={t("ui.fileMentionMenu.helpText")}
      emptyText={token?.query ? t("ui.fileMentionMenu.noMatching") : t("ui.fileMentionMenu.typeHint")}
      items={items.map((item) => ({
        key: item.path,
        label: item.path,
        description: item.type === "directory" ? t("ui.fileMentionMenu.directory") : t("ui.fileMentionMenu.file"),
      }))}
      activeIndex={activeIndex}
      activeColor="#229ac3"
      maxVisible={8}
      renderItem={(item, isActive) => (
        <Box flexDirection="row" paddingX={1} gap={1}>
          <Text color={isActive ? "#229ac3" : undefined}>{isActive ? "> " : "  "}</Text>
          <Box flexGrow={1}>
            <Text color={isActive ? "#229ac3" : undefined} wrap="truncate-end" bold={isActive}>
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
