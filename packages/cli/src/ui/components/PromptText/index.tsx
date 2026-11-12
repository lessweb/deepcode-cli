import React from "react";
import { Text, Transform } from "ink";
import { wrapPromptText } from "../../core/prompt-wrap";

/** Apply the same wrapping to styled prompt text and its cursor measurement. */
export function PromptText({
  width,
  children,
  ...props
}: React.ComponentProps<typeof Text> & { width: number }): React.ReactElement {
  return (
    <Text {...props} wrap="wrap">
      <Transform transform={(text) => wrapPromptText(text, width)}>{children}</Transform>
    </Text>
  );
}
