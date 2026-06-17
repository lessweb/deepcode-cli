import React, { useEffect, useRef, useState, useCallback } from "react";
import { useInput } from "ink";
import DropdownMenu from "../DropdownMenu";
import { PRESETS } from "../../theme";
import type { ThemePreset } from "../../theme";

const THEME_PRESETS: ThemePreset[] = [
  "light",
  "dark",
  "github-light",
  "github-dark",
  "monokai",
  "dracula",
  "ansi-light",
  "ansi-dark",
  "custom",
];

type Props = {
  open: boolean;
  width: number;
  hasCustomConfig: boolean;
  currentPreset: ThemePreset;
  onClose: () => void;
  onThemeChange: (preset: ThemePreset) => void;
  onThemePreview?: (preset: ThemePreset) => void;
  onThemeRevert?: () => void;
  onStatusMessage?: (message: string | null) => void;
};

const ThemeDropdown: React.FC<Props> = ({
  open,
  width,
  hasCustomConfig,
  currentPreset,
  onClose,
  onThemeChange,
  onThemePreview,
  onThemeRevert,
  onStatusMessage,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  // 记录打开时的主题，用于取消时回退
  const originalPresetRef = useRef<ThemePreset | null>(null);

  // 检查项是否禁用
  const isItemDisabled = useCallback(
    (preset: ThemePreset): boolean => {
      return preset === "custom" && !hasCustomConfig;
    },
    [hasCustomConfig]
  );

  // 获取下一个可用的索引
  const getNextEnabledIndex = useCallback(
    (currentIndex: number, direction: 1 | -1): number => {
      const length = THEME_PRESETS.length;
      let nextIndex = currentIndex;
      for (let i = 0; i < length; i++) {
        nextIndex = (nextIndex + direction + length) % length;
        if (!isItemDisabled(THEME_PRESETS[nextIndex])) {
          return nextIndex;
        }
      }
      return currentIndex; // 如果没有可用项，返回当前索引
    },
    [isItemDisabled]
  );

  // Initialize state when opened
  useEffect(() => {
    if (open) {
      originalPresetRef.current = currentPreset;
      const currentIndex = THEME_PRESETS.findIndex((p) => p === currentPreset);
      const initialIndex = currentIndex >= 0 ? currentIndex : 0;
      // 如果初始索引是禁用项，找下一个可用项
      if (isItemDisabled(THEME_PRESETS[initialIndex])) {
        setActiveIndex(getNextEnabledIndex(initialIndex, 1));
      } else {
        setActiveIndex(initialIndex);
      }
    }
  }, [open, currentPreset, isItemDisabled, getNextEnabledIndex]);

  function selectItem(): void {
    const preset = THEME_PRESETS[activeIndex];
    if (preset && !isItemDisabled(preset)) {
      onThemeChange(preset);
      onStatusMessage?.(`Theme changed to ${preset}`);
      onClose();
    }
  }

  function cancelSelection(): void {
    // 回退到打开时的主题
    if (originalPresetRef.current && onThemeRevert) {
      onThemeRevert();
    }
    onClose();
  }

  useInput(
    (input, key) => {
      if (!open) {
        return;
      }

      if (key.upArrow) {
        const nextIndex = getNextEnabledIndex(activeIndex, -1);
        setActiveIndex(nextIndex);
        // 预览主题
        const preset = THEME_PRESETS[nextIndex];
        if (preset && !isItemDisabled(preset)) {
          onThemePreview?.(preset);
        }
        return;
      }
      if (key.downArrow) {
        const nextIndex = getNextEnabledIndex(activeIndex, 1);
        setActiveIndex(nextIndex);
        // 预览主题
        const preset = THEME_PRESETS[nextIndex];
        if (preset && !isItemDisabled(preset)) {
          onThemePreview?.(preset);
        }
        return;
      }
      if ((input === " " && !key.ctrl && !key.meta) || (key.return && !key.shift && !key.meta)) {
        selectItem();
        return;
      }
      if (key.tab || key.escape) {
        cancelSelection();
        return;
      }
    },
    { isActive: open }
  );

  if (!open) {
    return null;
  }

  const items = THEME_PRESETS.map((preset) => {
    const presetTheme = PRESETS[preset];
    return {
      key: preset,
      label: presetTheme?.name ?? preset,
      labelColor: presetTheme?.brand.primary,
      description:
        preset === currentPreset
          ? "current theme"
          : preset === "custom"
            ? hasCustomConfig
              ? "use custom config"
              : "not configured"
            : "",
      selected: preset === currentPreset,
      disabled: isItemDisabled(preset),
    };
  });

  return (
    <DropdownMenu
      width={width}
      title="Select Theme"
      helpText="Space/Enter select theme · Esc to cancel"
      items={items}
      activeIndex={activeIndex}
      maxVisible={9}
    />
  );
};

export default ThemeDropdown;
