import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

export type UpdatePromptChoice = "install" | "ignore-once" | "ignore-version";

type UpdatePromptOption = {
  value: UpdatePromptChoice;
  label: string;
};

type Props = {
  currentVersion: string;
  latestVersion: string;
  installCommand: string;
  onSelect: (choice: UpdatePromptChoice) => void;
};

export function UpdatePrompt({
  currentVersion,
  latestVersion,
  installCommand,
  onSelect
}: Props): React.ReactElement {
  const { exit } = useApp();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options: UpdatePromptOption[] = [
    {
      value: "install",
      label: `Install the latest version with \`${installCommand}\``
    },
    {
      value: "ignore-once",
      label: "Ignore once"
    },
    {
      value: "ignore-version",
      label: `Ignore this version (${latestVersion})`
    }
  ];

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((index) => (index - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow || key.tab) {
      setSelectedIndex((index) => (index + 1) % options.length);
      return;
    }
    if (key.return) {
      onSelect(options[selectedIndex]?.value ?? "ignore-once");
      exit();
      return;
    }
    if (key.escape || (key.ctrl && (input === "c" || input === "C"))) {
      onSelect("ignore-once");
      exit();
      return;
    }
    if (/^[1-3]$/.test(input)) {
      onSelect(options[Number(input) - 1]?.value ?? "ignore-once");
      exit();
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>
        Deep Code latest version has been released: {currentVersion} -&gt; {latestVersion}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, index) => {
          const selected = index === selectedIndex;
          return (
            <Text key={option.value} color={selected ? "green" : undefined}>
              {selected ? "> " : "  "}
              {index + 1}. {option.label}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Use Up/Down to choose, Enter to confirm, Esc to ignore once.</Text>
      </Box>
    </Box>
  );
}
