import React, { useEffect, useState } from "react";
import { useInput } from "ink";
import DropdownMenu from "../DropdownMenu";
import { RAW_COMMAND_MODELS, useRawModeContext } from "../../contexts";

const RawModelDropdown: React.FC<{
  open: boolean;
  screenWidth: number;
  onClose?: (value: boolean) => void;
  onSelect?: (model: string) => void;
}> = ({ open = false, screenWidth, onSelect, onClose }) => {
  const { mode } = useRawModeContext();
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (open) {
      setIndex(
        Math.max(
          0,
          RAW_COMMAND_MODELS.findIndex((model) => model.key === mode)
        )
      );
      setReady(true);
    } else {
      setReady(false);
    }
  }, [open, mode]);

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
        onClose?.(false);
        onSelect?.(RAW_COMMAND_MODELS[index].key);
        return;
      }
      if (key.escape) {
        onClose?.(false);
        return;
      }
    },
    { isActive: open && ready }
  );
  if (!open || !ready) {
    return null;
  }
  return (
    <DropdownMenu
      title="Select mode"
      items={RAW_COMMAND_MODELS.map((model) => ({ ...model, selected: model.key === mode }))}
      helpText="Space/Enter select mode · Esc to close"
      // onSelect={onSelect}
      activeColor="#229ac3"
      maxVisible={6}
      activeIndex={index}
      width={screenWidth}
    />
  );
};

export default RawModelDropdown;
