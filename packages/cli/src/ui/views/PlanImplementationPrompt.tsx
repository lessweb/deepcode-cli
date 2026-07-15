import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useTerminalInput } from "../hooks";
import type { InputKey } from "../hooks";

type PlanImplementationChoice = "implement" | "stay" | "default";

type Props = {
  onSelect: (choice: PlanImplementationChoice) => void;
};

const CHOICES: Array<{ value: PlanImplementationChoice; label: string }> = [
  { value: "implement", label: "implement this plan" },
  { value: "stay", label: "stay in Plan mode" },
  { value: "default", label: "switch to Default mode" },
];

/** Return only a complete proposed plan, so historical or partial tags cannot trigger the chooser. */
export function extractProposedPlan(reply: string | null): string | null {
  if (!reply) {
    return null;
  }
  const match = reply.match(/<proposed_plan>\s*([\s\S]*?\S[\s\S]*?)\s*<\/proposed_plan>/);
  return match?.[1] ?? null;
}

export function getImplementationPrompt(plan: string): string {
  const fullWidthPunctuationCount = (plan.match(/[，、；。]/g) ?? []).length;
  return fullWidthPunctuationCount > 5 ? "实现此方案。" : "Implement the plan.";
}

export function getPlanImplementationChoice(
  input: string,
  key: Pick<InputKey, "escape" | "return">,
  cursor: number
): PlanImplementationChoice | null {
  if (key.escape) {
    return "stay";
  }
  if (input && /^[1-3]$/.test(input)) {
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
        <Text dimColor>1-3 select · ↑/↓ move · Enter select</Text>
      </Box>
    </Box>
  );
}
