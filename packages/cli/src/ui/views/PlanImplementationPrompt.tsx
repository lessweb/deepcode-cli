import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useTerminalInput } from "../hooks";
import type { InputKey } from "../hooks";
import { PLAN_IMPLEMENTATION_CHOICES as CHOICES } from "@vegamo/deepcode-core/common/plan-implementation";
import type { PlanImplementationChoice } from "@vegamo/deepcode-core/common/plan-implementation";

export {
  extractProposedPlan,
  getImplementationPrompt,
  getClearContextImplementationPrompt,
} from "@vegamo/deepcode-core/common/plan-implementation";
export type { PlanImplementationChoice } from "@vegamo/deepcode-core/common/plan-implementation";

type Props = {
  onSelect: (choice: PlanImplementationChoice) => void;
};

export function getPlanImplementationChoice(
  input: string,
  key: Pick<InputKey, "escape" | "return">,
  cursor: number
): PlanImplementationChoice | null {
  if (key.escape) {
    return "stay";
  }
  if (input && /^[1-4]$/.test(input)) {
    return CHOICES[Number(input) - 1]!.value;
  }
  return key.return ? CHOICES[cursor]!.value : null;
}

export function PlanImplementationPrompt({ onSelect }: Props): React.ReactElement {
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    setCursor(0);
  }, []);

  useTerminalInput((input, key) => {
    const choice = getPlanImplementationChoice(input, key, cursor);
    if (choice) {
      onSelect(choice);
      return;
    }
    if (key.upArrow) {
      setCursor((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((value) => Math.min(CHOICES.length - 1, value + 1));
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Text color="yellow" bold>
        Plan ready
      </Text>
      <Text dimColor>Choose what to do next:</Text>
      <Box flexDirection="column" marginTop={1}>
        {CHOICES.map((choice, index) => (
          <Text key={choice.value} color={index === cursor ? "cyanBright" : undefined}>
            {index === cursor ? "> " : "  "}
            {index + 1}. {choice.label}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>1-4 select · ↑/↓ move · Enter select</Text>
      </Box>
    </Box>
  );
}
