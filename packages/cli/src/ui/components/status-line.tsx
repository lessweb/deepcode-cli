import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";

const STATUS_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const StatusLine = React.memo(function StatusLine({
  busy,
  text,
  width,
}: {
  busy: boolean;
  text?: string;
  width: number;
}): React.ReactElement {
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  useEffect(() => {
    if (!busy) {
      setSpinnerIndex(0);
      return;
    }

    const timer = setInterval(() => {
      setSpinnerIndex((index) => (index + 1) % STATUS_SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, [busy]);

  return (
    <Box width={width} height={1} overflow="hidden">
      {busy ? (
        <Box marginRight={1} flexShrink={0}>
          <Text color="yellow">{STATUS_SPINNER_FRAMES[spinnerIndex]}</Text>
        </Box>
      ) : null}
      {text ? (
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text dimColor wrap="truncate-end">
            {text}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
