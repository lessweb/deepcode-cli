import React, { useMemo } from "react";
import { Box, Text } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextUsage = {
  activeTokens: number;
  totalTokens: number;
  maxContextTokens: number;
  percentage: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BAR_WIDTH = 20;

/** Context usage >= this % triggers a yellow warning. */
const YELLOW_THRESHOLD = 70;

/** Context usage >= this % triggers a red alert. */
const RED_THRESHOLD = 90;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${Math.round(n / 1000)}k`;
  }
  return String(n);
}

function buildBar(filled: number, empty: number): string {
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

// ---------------------------------------------------------------------------
// ContextBar
// ---------------------------------------------------------------------------

/**
 * Renders a context-usage status bar showing token consumption as a
 * progress bar with percentage, and triggers visual warnings when usage
 * exceeds configurable thresholds.
 *
 * - < 70%: dimmed, no warning
 * - >= 70%: yellow with ⚠️ "Try /compact to compress context."
 * - >= 90%: red    with 🚨 "Context nearly full. Consider /clear or /compact."
 */
export const ContextBar = React.memo(function ContextBar({
  usage,
}: {
  usage: ContextUsage | null;
}): React.ReactElement | null {
  const rendered = useMemo(() => {
    if (!usage || usage.maxContextTokens <= 0) {
      return null;
    }

    const { percentage, totalTokens, maxContextTokens } = usage;
    const clamped = Math.min(100, Math.max(0, percentage));
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((clamped / 100) * BAR_WIDTH)));
    const empty = BAR_WIDTH - filled;
    const bar = buildBar(filled, empty);

    const tokensText = formatTokens(totalTokens);
    const maxText = formatTokens(maxContextTokens);

    let color: string | undefined;
    let icon: string | null = null;
    let hint: string | null = null;

    if (clamped >= RED_THRESHOLD) {
      color = "red";
      icon = "\uD83D\uDEA8"; // 🚨
      hint = " Context nearly full. Consider /clear or /compact.";
    } else if (clamped >= YELLOW_THRESHOLD) {
      color = "yellow";
      icon = "\u26A0\uFE0F"; // ⚠️
      hint = " Try /compact to compress context.";
    }

    return {
      bar,
      tokensText,
      maxText,
      clamped,
      color,
      icon,
      hint,
    };
  }, [usage]);

  if (!rendered) {
    return null;
  }

  const { bar, tokensText, maxText, clamped, color, icon, hint } = rendered;

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor={!color} color={color}>
          [{bar}] {clamped}% Tokens: {tokensText}/{maxText}
        </Text>
        {icon && hint && (
          <Text color={color}>
            {" "}
            {icon}
            {hint}
          </Text>
        )}
      </Box>
    </Box>
  );
});
