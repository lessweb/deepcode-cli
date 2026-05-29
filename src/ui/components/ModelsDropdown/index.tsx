import React, { useEffect, useState } from "react";
import { useInput } from "ink";
import DropdownMenu from "../DropdownMenu";
import type { ModelConfigSelection, ReasoningEffort } from "../../../settings";

type ModelStep = "model" | "thinking";

type ThinkingModeOption = {
  label: string;
  thinkingEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
};

export const MODEL_COMMAND_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"] as const;

export const MODEL_COMMAND_THINKING_OPTIONS: ThinkingModeOption[] = [
  { label: "Thinking mode [max]", thinkingEnabled: true, reasoningEffort: "max" },
  { label: "Thinking mode [high]", thinkingEnabled: true, reasoningEffort: "high" },
  { label: "No thinking", thinkingEnabled: false },
];

function getThinkingOptionIndex(config: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">): number {
  const index = MODEL_COMMAND_THINKING_OPTIONS.findIndex((option) => {
    if (!config.thinkingEnabled) {
      return !option.thinkingEnabled;
    }
    return option.thinkingEnabled && option.reasoningEffort === config.reasoningEffort;
  });
  return index >= 0 ? index : 0;
}

type Props = {
  open: boolean;
  modelConfig: ModelConfigSelection;
  width: number;
  onClose: () => void;
  onModelConfigChange: (selection: ModelConfigSelection) => string | Promise<string>;
  onStatusMessage?: (message: string | null) => void;
};

const ModelsDropdown: React.FC<Props> = ({
  open,
  modelConfig,
  width,
  onClose,
  onModelConfigChange,
  onStatusMessage,
}) => {
  const [step, setStep] = useState<ModelStep | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingModel, setPendingModel] = useState<string | null>(null);

  // Initialize state when opened
  useEffect(() => {
    if (open) {
      const currentIndex = MODEL_COMMAND_MODELS.findIndex((m) => m === modelConfig.model);
      setPendingModel(null);
      setStep("model");
      setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
    } else {
      setStep(null);
    }
  }, [open, modelConfig.model]);

  // Validate activeIndex bounds
  useEffect(() => {
    if (!step) {
      return;
    }
    const optionCount = step === "model" ? MODEL_COMMAND_MODELS.length : MODEL_COMMAND_THINKING_OPTIONS.length;
    if (activeIndex >= optionCount) {
      setActiveIndex(Math.max(0, optionCount - 1));
    }
  }, [activeIndex, step]);

  function selectItem(): void {
    if (step === "model") {
      const model = MODEL_COMMAND_MODELS[activeIndex] ?? modelConfig.model;
      setPendingModel(model);
      setStep("thinking");
      setActiveIndex(getThinkingOptionIndex(modelConfig));
      return;
    }

    const option = MODEL_COMMAND_THINKING_OPTIONS[activeIndex] ?? MODEL_COMMAND_THINKING_OPTIONS[0]!;
    const selection: ModelConfigSelection = {
      model: pendingModel ?? modelConfig.model,
      thinkingEnabled: option.thinkingEnabled,
      reasoningEffort: option.reasoningEffort ?? modelConfig.reasoningEffort,
    };
    onClose();
    Promise.resolve(onModelConfigChange(selection))
      .then((message) => {
        if (message) {
          onStatusMessage?.(message);
        }
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        onStatusMessage?.(`Failed to update model settings: ${msg}`);
      });
  }

  useInput(
    (input, key) => {
      if (!step) {
        return;
      }

      const optionCount = step === "model" ? MODEL_COMMAND_MODELS.length : MODEL_COMMAND_THINKING_OPTIONS.length;

      if (key.upArrow) {
        setActiveIndex((idx) => (idx - 1 + optionCount) % optionCount);
        return;
      }
      if (key.downArrow) {
        setActiveIndex((idx) => (idx + 1) % optionCount);
        return;
      }
      if ((input === " " && !key.ctrl && !key.meta) || (key.return && !key.shift && !key.meta)) {
        selectItem();
        return;
      }
      if (key.tab || key.escape) {
        onClose();
        return;
      }
    },
    { isActive: open }
  );

  if (!open || !step) {
    return null;
  }

  const items =
    step === "model"
      ? MODEL_COMMAND_MODELS.map((model) => ({
          key: model,
          label: model,
          description: model === modelConfig.model ? "current model" : "",
          selected: model === (pendingModel ?? modelConfig.model),
        }))
      : MODEL_COMMAND_THINKING_OPTIONS.map((option, i) => ({
          key: option.label,
          label: option.label,
          description: option.thinkingEnabled ? `reasoningEffort: ${option.reasoningEffort}` : "thinking disabled",
          selected: getThinkingOptionIndex(modelConfig) === i,
        }));

  return (
    <DropdownMenu
      width={width}
      title={step === "model" ? "Select Model" : "Select Thinking Mode"}
      helpText={step === "model" ? "Space/Enter select model · Esc to cancel" : "Space/Enter apply · Esc to cancel"}
      items={items}
      activeIndex={activeIndex}
      activeColor="#229ac3"
      maxVisible={6}
    />
  );
};

export { getThinkingOptionIndex };
export default ModelsDropdown;
