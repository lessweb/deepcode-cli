import React from "react";
import { Box, Text, useInput } from "ink";

export type UsageData = {
  is_available: boolean;
  balance_infos: Array<{
    currency: string;
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
  }>;
};

type Props = {
  data: UsageData;
  onCancel: () => void;
};

export function UsageView({ data, onCancel }: Props): React.ReactElement {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" marginLeft={1} paddingX={1} gap={1} borderStyle="round" borderDimColor>
      <Box flexDirection="column">
        <Text color="#229ac3" bold>
          /usage{" "}
          <Text color={data.is_available ? "green" : "red"}>
            {data.is_available ? "🟢 Available" : "🔴 Not available"}
          </Text>
        </Text>
      </Box>
      {data.balance_infos.length > 0 ? (
        <Box flexDirection="column">
          {data.balance_infos.map((info, i) => (
            <Text key={i}>
              <Text bold>{info.currency}</Text>
              {"  total "}
              <Text bold>{info.total_balance}</Text>
              {"  (granted "}
              {info.granted_balance}
              {", topped up "}
              {info.topped_up_balance}
              {")"}
            </Text>
          ))}
        </Box>
      ) : (
        <Box>
          <Text dimColor>No balance info returned.</Text>
        </Box>
      )}
      <Text dimColor>Esc to close</Text>
    </Box>
  );
}
