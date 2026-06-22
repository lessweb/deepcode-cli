import type React from "react";
import { Text, type TextProps } from "ink";
import Gradient from "ink-gradient";

export const ThemedGradient: React.FC<TextProps> = ({ children, ...props }) => {
  const gradient = ["#229ac3e6", "#229ac3e6"]; // Use solid color for now

  if (gradient && gradient.length >= 2) {
    return (
      <Gradient colors={gradient}>
        <Text {...props}>{children}</Text>
      </Gradient>
    );
  }

  if (gradient && gradient.length === 1) {
    return (
      <Text color={gradient[0]} {...props}>
        {children}
      </Text>
    );
  }

  // Fallback to accent color if no gradient
  return (
    <Text color="yellow" {...props}>
      {children}
    </Text>
  );
};
