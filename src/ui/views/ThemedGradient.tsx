import type React from "react";
import { Text, type TextProps } from "ink";
import Gradient from "ink-gradient";
import { useTheme } from "../theme";

export const ThemedGradient: React.FC<TextProps> = ({ children, ...props }) => {
  const theme = useTheme();
  const gradient = theme.gradients;

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
    <Text color={theme.accent} {...props}>
      {children}
    </Text>
  );
};
