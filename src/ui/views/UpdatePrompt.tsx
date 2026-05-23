import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { t } from "../common/i18n";

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

export function UpdatePrompt({ currentVersion, latestVersion, installCommand, onSelect }: Props): React.ReactElement {
  const { exit } = useApp();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options: UpdatePromptOption[] = [
    {
      value: "install",
      label: t("ui.updatePrompt.installLabel", { installCommand }),
    },
    {
      value: "ignore-once",
      label: t("ui.updatePrompt.ignoreOnce"),
    },
    {
      value: "ignore-version",
      label: t("ui.updatePrompt.ignoreVersion", { latestVersion }),
    },
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
      <Text bold>{t("ui.updatePrompt.title", { currentVersion, latestVersion })}</Text>
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
        <Text dimColor>{t("ui.updatePrompt.footerHelp")}</Text>
      </Box>
    </Box>
  );
}
