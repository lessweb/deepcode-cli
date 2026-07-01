import React from "react";
import { Box, Text, useInput } from "ink";
import { readSettings, readProjectSettings } from "@vegamo/deepcode-core";
import type { KeybindMap, DeepcodingSettings } from "@vegamo/deepcode-core";

type Props = {
  keybinds: KeybindMap;
  projectRoot: string;
  onCancel: () => void;
};

function getKeybindLevel(
  shortcut: string,
  userSettings: DeepcodingSettings | null,
  projectSettings: DeepcodingSettings | null
): "local" | "global" {
  if (projectSettings?.keybinds?.[shortcut] !== undefined) return "local";
  if (userSettings?.keybinds?.[shortcut] !== undefined) return "global";
  return "global";
}

export function KeybindsView({ keybinds, projectRoot, onCancel }: Props): React.ReactElement {
  const entries = Object.entries(keybinds);
  const userSettings = readSettings();
  const projectSettings = readProjectSettings(projectRoot);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" marginLeft={1} paddingX={1} gap={1} borderStyle="round" borderDimColor>
      <Box>
        <Text color="#229ac3" bold>
          /keybind
        </Text>
      </Box>

      {entries.length === 0 ? (
        <Box>
          <Text dimColor>(no keybinds configured)</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {entries.map(([shortcut, action]) => {
            const level = getKeybindLevel(shortcut, userSettings, projectSettings);
            return (
              <Box key={shortcut} gap={1}>
                <Text>{shortcut}</Text>
                <Text dimColor>→ /{action}</Text>
                <Text color={level === "local" ? "yellow" : "blue"} dimColor>
                  [{level}]
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box flexDirection="column">
        <Text dimColor>/keybind add &lt;shortcut&gt; &lt;action&gt; to add</Text>
        <Text dimColor>/keybind --global add &lt;shortcut&gt; &lt;action&gt; (user-level)</Text>
        <Text dimColor>/keybind remove &lt;shortcut&gt; to remove</Text>
        <Text dimColor>/keybind --global remove &lt;shortcut&gt; (user-level)</Text>
      </Box>

      <Text dimColor>Esc to close</Text>
    </Box>
  );
}
