import React, { useState } from "react";
import { useInput } from "ink";
import DropdownMenu from "../DropdownMenu";
import { RAW_COMMAND_MODELS, useRawModeContext, RawMode } from "../../contexts";
import { t } from "../../../common/i18n";

function getRawModeLabel(key: string): string {
  switch (key) {
    case RawMode.Lite:
      return t("ui.rawModelDropdown.liteMode");
    case RawMode.None:
      return t("ui.rawModelDropdown.normalMode");
    case RawMode.Raw:
      return t("ui.rawModelDropdown.rawScrollbackMode");
    default:
      return key;
  }
}

function getRawModeDescription(key: string): string {
  switch (key) {
    case RawMode.Lite:
      return t("ui.rawModelDropdown.liteDesc");
    case RawMode.None:
      return t("ui.rawModelDropdown.normalDesc");
    case RawMode.Raw:
      return t("ui.rawModelDropdown.rawDesc");
    default:
      return "";
  }
}

const RawModelDropdown: React.FC<{
  open: boolean;
  screenWidth: number;
  onClose?: (value: boolean) => void;
  onSelect?: (model: string) => void;
}> = ({ open = false, screenWidth, onSelect, onClose }) => {
  const { mode, setMode } = useRawModeContext();
  const [index, setIndex] = useState(0);
  useInput(
    (input, key) => {
      if (key.upArrow) {
        setIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setIndex((i) => Math.min(RAW_COMMAND_MODELS.length - 1, i + 1));
        return;
      }
      if ((input === " " && !key.ctrl && !key.meta) || (key.return && !key.shift && !key.meta)) {
        setMode(RAW_COMMAND_MODELS[index].key as RawMode);
        onClose?.(false);
        onSelect?.(RAW_COMMAND_MODELS[index].key);
        return;
      }
      if (key.escape) {
        onClose?.(false);
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
      title={t("ui.rawModelDropdown.title")}
      items={RAW_COMMAND_MODELS.map((model) => ({
        ...model,
        label: getRawModeLabel(model.key),
        description: getRawModeDescription(model.key),
        selected: model.key === mode,
      }))}
      helpText={t("ui.rawModelDropdown.helpText")}
      // onSelect={onSelect}
      activeColor="#229ac3"
      maxVisible={6}
      activeIndex={index}
      width={screenWidth}
    />
  );
};

export default RawModelDropdown;
