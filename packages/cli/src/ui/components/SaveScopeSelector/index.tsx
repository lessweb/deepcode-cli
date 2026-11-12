import React from "react";
import { Box, Text } from "ink";
import type { SettingsTarget } from "@vegamo/deepcode-core";

export default function SaveScopeSelector({ target }: { target: SettingsTarget }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1} marginY={1}>
      <Text color="gray">{"Remember this choice for  (←→ to switch)"}</Text>
      <Box paddingLeft={2} columnGap={1} flexWrap="wrap">
        <Text color={target === "user" ? "#229ac3" : undefined}>
          {target === "user" ? "[All Projects]" : " All Projects "}
        </Text>
        <Text color={target === "project" ? "#229ac3" : undefined}>
          {target === "project" ? "[This Project]" : " This Project "}
        </Text>
      </Box>
    </Box>
  );
}
