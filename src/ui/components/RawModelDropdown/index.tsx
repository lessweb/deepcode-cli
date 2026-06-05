import React, { useState } from "react";
import { useInput } from "ink";
import DropdownMenu from "../DropdownMenu";
import type { RawMode } from "../../contexts";
import { RAW_COMMAND_MODELS, useRawModeContext } from "../../contexts";

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
      title="Select mode"
      items={RAW_COMMAND_MODELS.map((model) => ({ ...model, selected: model.key === mode }))}
      helpText="Space/Enter select mode · Esc to close"
      // onSelect={onSelect}
      maxVisible={6}
      activeIndex={index}
      width={screenWidth}
    />
  );
};

export default RawModelDropdown;
