import React, { useEffect, useState } from "react";
import { useInput } from "ink";
import { getDefaultSettingsTarget, type ReasoningSummaryMode, type SettingsTarget } from "@vegamo/deepcode-core";
import DropdownMenu from "../DropdownMenu";
import SaveScopeSelector from "../SaveScopeSelector";

type Props = {
  open: boolean;
  projectRoot: string;
  reasoningSummary: ReasoningSummaryMode;
  width: number;
  onClose: () => void;
  onSave: (selection: ReasoningSummaryMode, target: SettingsTarget) => string | Promise<string>;
  onStatusMessage?: (message: string | null) => void;
};

const OPTIONS: ReasoningSummaryMode[] = ["on", "off"];

export default function ExperimentalDropdown({
  open,
  projectRoot,
  reasoningSummary,
  width,
  onClose,
  onSave,
  onStatusMessage,
}: Props): React.ReactElement | null {
  const [step, setStep] = useState<"feature" | "value" | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [target, setTarget] = useState<SettingsTarget>("user");

  useEffect(() => {
    setStep(open ? "feature" : null);
    setActiveIndex(0);
    if (open) setTarget(getDefaultSettingsTarget(projectRoot));
  }, [open, projectRoot]);

  useInput(
    (input, key) => {
      if (!step) return;
      if (step === "value" && !key.ctrl && !key.meta && !key.shift && (key.leftArrow || key.rightArrow)) {
        setTarget(key.leftArrow ? "user" : "project");
        return;
      }
      if (key.upArrow || key.downArrow) {
        if (step === "value") setActiveIndex((index) => (index + 1) % OPTIONS.length);
        return;
      }
      if ((input === " " && !key.ctrl && !key.meta) || (key.return && !key.shift && !key.meta)) {
        if (step === "feature") {
          setStep("value");
          setActiveIndex(OPTIONS.indexOf(reasoningSummary));
          return;
        }
        const selection = OPTIONS[activeIndex]!;
        onClose();
        Promise.resolve()
          .then(() => onSave(selection, target))
          .then((message) => {
            if (message) onStatusMessage?.(message);
          })
          .catch((error) => {
            onStatusMessage?.(
              `Failed to update experimental settings: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        return;
      }
      if (key.escape || key.tab) onClose();
    },
    { isActive: open }
  );

  if (!open || !step) return null;
  return (
    <DropdownMenu
      width={width}
      title={step === "feature" ? "Experimental Features" : "Reasoning summary"}
      items={
        step === "feature"
          ? [
              {
                key: "reasoningSummary",
                label: "Reasoning summary",
                description: "Summarize the lengthy reasoning_content returned by the LLM.",
              },
            ]
          : OPTIONS.map((value) => ({ key: value, label: value, selected: value === reasoningSummary }))
      }
      activeIndex={activeIndex}
      activeColor="#229ac3"
      helpText={step === "feature" ? "Space/Enter select · Esc to cancel" : "Space/Enter apply · Esc to cancel"}
      footer={step === "value" ? <SaveScopeSelector target={target} /> : undefined}
    />
  );
}
