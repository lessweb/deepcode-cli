import React from "react";
import { Box, Text } from "ink";
import gradientString from "gradient-string";
import type { SessionEntry } from "../../session";
import { useTheme } from "../theme";
import { buildExitSummaryData } from "../exit-summary";

type Props = {
  session: SessionEntry | null;
  width: number;
};

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

const COL_MODEL = 34;
const COL_REQS = 8;
const COL_INPUT = 16;
const COL_OUTPUT = 16;
const COL_CACHED = 18;

export default function ExitSummaryView({ session }: Props): React.ReactElement {
  const theme = useTheme();
  const data = buildExitSummaryData({ session });
  const gradient = gradientString(...theme.gradients.logo);

  return (
    <Box
      flexDirection="column"
      marginLeft={1}
      borderStyle="round"
      width={COL_MODEL + COL_REQS + COL_INPUT + COL_OUTPUT + COL_CACHED + 2}
      borderColor={theme.border.subtle}
      padding={1}
      marginBottom={4}
    >
      {/* Goodbye! header */}
      <Box marginBottom={1}>
        <Text bold>{gradient("Goodbye!")}</Text>
      </Box>

      {/* Usage table */}
      {data.hasUsage && (
        <>
          {/* Table header */}
          <Box
            borderStyle="classic"
            borderColor={theme.border.default}
            borderTop={false}
            borderRight={false}
            borderLeft={false}
            borderBottom={true}
            gap={1}
          >
            <Box width={COL_MODEL}>
              <Text bold>Model Usage</Text>
            </Box>
            <Box width={COL_REQS} justifyContent="flex-end">
              <Text bold>Reqs</Text>
            </Box>
            <Box width={COL_INPUT} justifyContent="flex-end">
              <Text bold>Input Tokens</Text>
            </Box>
            <Box width={COL_OUTPUT} justifyContent="flex-end">
              <Text bold>Output Tokens</Text>
            </Box>
            <Box width={COL_CACHED} justifyContent="flex-end">
              <Text bold>Cached Tokens</Text>
            </Box>
          </Box>
          {/* Data rows */}
          {data.rows.map((row) => (
            <Box key={row.modelName} gap={1}>
              <Box width={COL_MODEL}>
                <Text>{row.modelName}</Text>
              </Box>
              <Box width={COL_REQS} justifyContent="flex-end">
                <Text>{formatNumber(row.reqs)}</Text>
              </Box>
              <Box width={COL_INPUT} justifyContent="flex-end">
                <Text color={theme.status.warning}>{formatNumber(row.inputTokens)}</Text>
              </Box>
              <Box width={COL_OUTPUT} justifyContent="flex-end">
                <Text color={theme.status.warning}>{formatNumber(row.outputTokens)}</Text>
              </Box>
              <Box width={COL_CACHED} justifyContent="flex-end">
                <Text color={theme.status.warning}>{formatNumber(row.cachedTokens)}</Text>
              </Box>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
