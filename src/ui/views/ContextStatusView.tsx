import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { ContextStatus, ContextCategoryUsage, ModelUsage } from "../../session";

const BRAND_COLOR = "#229ac3";
const CONTAINER_WIDTH = 96;
const CONTENT_WIDTH = CONTAINER_WIDTH - 4;
const OVERHEAD_KEYS = new Set<ContextCategoryUsage["key"]>([
  "system_prompt",
  "tool_definitions",
  "mcp_tools",
  "agent_instructions",
  "default_skills",
]);

// ── 格式化 ────────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  const pct = (value / total) * 100;
  if (pct < 0.1) return "<0.1%";
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

function progressColor(ratio: number): string {
  if (ratio >= 0.9) return "red";
  if (ratio >= 0.75) return "#ff9900";
  if (ratio >= 0.5) return "yellow";
  return "green";
}

// ── 进度条 ─────────────────────────────────────────────────────────────────────

function Bar({ value, total, width, color }: { value: number; total: number; width: number; color: string }) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const filled = Math.round(ratio * width);
  return (
    <Text>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(width - filled)}</Text>
    </Text>
  );
}

// ── 主组件 ─────────────────────────────────────────────────────────────────────

export function ContextStatusView({
  status,
  onCancel,
}: {
  status: ContextStatus;
  onCancel: () => void;
}): React.ReactElement {
  useInput((input, key) => {
    if (key.escape || key.return || (key.ctrl && (input === "c" || input === "C"))) {
      onCancel();
    }
  });

  const effectiveTokens = Math.max(status.estimatedTotal, status.activeTokens);
  const ratio = effectiveTokens / Math.max(1, status.compactThreshold);
  const remaining = Math.max(0, status.compactThreshold - effectiveTokens);
  const color = progressColor(ratio);

  const sortedCategories = useMemo(
    () =>
      [...status.categories].sort((a, b) =>
        (a.tokens === 0) === (b.tokens === 0) ? b.tokens - a.tokens : a.tokens === 0 ? 1 : -1
      ),
    [status.categories]
  );

  const usageRows = useMemo(() => buildUsageRows(status.usagePerModel), [status.usagePerModel]);

  // 列宽
  const labelCol = 32;
  const tokensCol = 10;
  const percentCol = 7;
  const barCol = CONTENT_WIDTH - labelCol - tokensCol - percentCol - 3;

  return (
    <Box flexDirection="column" width={CONTAINER_WIDTH} paddingX={1} marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} paddingY={1}>
        {/* 头部 */}
        <Box gap={2}>
          <Text bold color={BRAND_COLOR}>
            Context usage
          </Text>
          <Text dimColor>
            {status.model} · {status.messageCount} messages
          </Text>
        </Box>

        {/* 进度 */}
        <Box marginTop={1}>
          <Bar value={effectiveTokens} total={status.compactThreshold} width={CONTENT_WIDTH - 10} color={color} />
          <Text> </Text>
          <Text bold color={color}>
            {(ratio * 100).toFixed(1)}%
          </Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <StatLine
            label="Used"
            value={effectiveTokens}
            suffix={`tokens (${status.activeTokens > 0 ? "API-reported" : "estimated"})`}
          />
          <StatLine
            label="Auto-compact"
            value={status.compactThreshold}
            suffix={`tokens · ${remaining.toLocaleString("en-US")} free (${formatPercent(remaining, status.compactThreshold)})`}
          />
          <StatLine
            label="Window"
            value={status.contextWindow}
            suffix={`tokens · using ${formatPercent(effectiveTokens, status.contextWindow)} of window`}
          />
        </Box>

        {/* 分类表 */}
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Header width={labelCol}>Category</Header>
            <Header width={tokensCol} right>
              Tokens
            </Header>
            <Header width={percentCol} right>
              Share
            </Header>
            <Header width={barCol + 3} paddingLeft={3}>
              Distribution
            </Header>
          </Box>
          {sortedCategories.map((category) => {
            const isZero = category.tokens === 0;
            const isOverhead = OVERHEAD_KEYS.has(category.key);
            const labelColor = isZero ? undefined : isOverhead ? "magenta" : BRAND_COLOR;
            return (
              <Box key={category.key}>
                <Box width={labelCol}>
                  <Text dimColor={isZero} color={labelColor} wrap="truncate-end">
                    {isOverhead ? "○ " : "● "}
                    {category.label}
                  </Text>
                </Box>
                <Box width={tokensCol} justifyContent="flex-end">
                  <Text dimColor={isZero}>{formatTokens(category.tokens)}</Text>
                </Box>
                <Box width={percentCol} justifyContent="flex-end">
                  <Text dimColor={isZero}>{formatPercent(category.tokens, effectiveTokens)}</Text>
                </Box>
                <Box width={barCol + 3} paddingLeft={3}>
                  <Bar value={category.tokens} total={effectiveTokens} width={barCol} color={BRAND_COLOR} />
                </Box>
              </Box>
            );
          })}
        </Box>

        {/* 各模型累计用量（紧凑单行） */}
        {usageRows.length > 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text bold dimColor>
              Cumulative API usage
            </Text>
            {usageRows.map((row) => (
              <Text key={row.modelName} dimColor>
                {row.modelName}: {row.reqs} reqs · {formatTokens(row.input)} in · {formatTokens(row.output)} out
                {row.cached > 0 ? ` · ${formatTokens(row.cached)} cached` : ""}
              </Text>
            ))}
          </Box>
        ) : null}

        <Box marginTop={1}>
          <Text dimColor>Esc / Enter to close</Text>
        </Box>
      </Box>
    </Box>
  );
}

// ── 子工具 ─────────────────────────────────────────────────────────────────────

function StatLine({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <Box>
      <Box width={16}>
        <Text dimColor>{label}:</Text>
      </Box>
      <Text bold>{value.toLocaleString("en-US")}</Text>
      <Text dimColor> {suffix}</Text>
    </Box>
  );
}

function Header({
  width,
  right,
  paddingLeft,
  children,
}: {
  width: number;
  right?: boolean;
  paddingLeft?: number;
  children: React.ReactNode;
}) {
  return (
    <Box width={width} justifyContent={right ? "flex-end" : undefined} paddingLeft={paddingLeft}>
      <Text bold dimColor>
        {children}
      </Text>
    </Box>
  );
}

// ── usage 行构造 ──────────────────────────────────────────────────────────────

type UsageRow = { modelName: string; reqs: number; input: number; output: number; cached: number };

function buildUsageRows(usagePerModel: Record<string, ModelUsage> | null): UsageRow[] {
  if (!usagePerModel) return [];
  const rows: UsageRow[] = [];
  for (const [modelName, usage] of Object.entries(usagePerModel)) {
    const reqs = numberOrZero(usage.total_reqs);
    const input = numberOrZero(usage.prompt_tokens);
    const output = numberOrZero(usage.completion_tokens);
    const cached =
      numberOrZero((usage.prompt_tokens_details as { cached_tokens?: unknown } | null)?.cached_tokens) ||
      numberOrZero(usage.prompt_cache_hit_tokens);
    if (reqs || input || output || cached) rows.push({ modelName, reqs, input, output, cached });
  }
  rows.sort((a, b) => b.reqs - a.reqs || a.modelName.localeCompare(b.modelName));
  return rows;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
