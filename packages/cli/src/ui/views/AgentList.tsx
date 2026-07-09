import React, { useState, useMemo } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { AgentManifest } from "@vegamo/deepcode-core";

type Props = {
  agents: AgentManifest[];
  onCancel: () => void;
};

export function AgentList({ agents, onCancel }: Props): React.ReactElement {
  const { columns, rows } = useWindowSize();

  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === "c" || input === "C"))) {
      onCancel();
    }
  });

  if (agents.length === 0) {
    return (
      <Box flexDirection="column" marginLeft={1} paddingX={1} gap={1} borderStyle="round" borderDimColor>
        <Box flexDirection="column">
          <Text color="#229ac3" bold>
            Available Sub-Agents
          </Text>
          <Text dimColor>0 agents</Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>No sub-agents discovered.</Text>
          <Text dimColor>To add agents, create an AGENT.md file in:</Text>
          <Text dimColor> .deepcode/agents/{"<name>"}/AGENT.md</Text>
          <Text dimColor> .agents/{"<name>"}/AGENT.md</Text>
        </Box>
        <Text dimColor>Esc to close</Text>
      </Box>
    );
  }

  return <AgentListView agents={agents} onCancel={onCancel} rows={rows} columns={columns} />;
}

function AgentListView({
  agents,
  onCancel,
  rows,
  columns,
}: {
  agents: AgentManifest[];
  onCancel: () => void;
  rows: number;
  columns: number;
}): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const agentCount = agents.length;

  const maxVisible = useMemo(() => {
    const reservedLines = 8;
    const availableLines = Math.max(0, Math.min(rows, 30) - reservedLines);
    // Each agent entry takes up to 4 lines (name + description + model/source + gap)
    return Math.max(1, Math.floor(availableLines / 4));
  }, [rows]);

  const safeIndex = useMemo(() => {
    if (agentCount === 0) return 0;
    return Math.max(0, Math.min(selectedIndex, agentCount - 1));
  }, [selectedIndex, agentCount]);

  React.useEffect(() => {
    if (safeIndex < scrollOffset) {
      setScrollOffset(safeIndex);
    } else if (safeIndex >= scrollOffset + maxVisible) {
      setScrollOffset(safeIndex - maxVisible + 1);
    }
  }, [safeIndex, scrollOffset, maxVisible]);

  const visibleAgents = useMemo(() => {
    return agents.slice(scrollOffset, scrollOffset + maxVisible);
  }, [agents, scrollOffset, maxVisible]);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === "c" || input === "C"))) {
      onCancel();
      return;
    }
    if (agentCount === 0) return;
    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(Math.min(agentCount - 1, selectedIndex + 1));
      return;
    }
    if (key.pageUp) {
      setSelectedIndex(Math.max(0, selectedIndex - maxVisible));
      return;
    }
    if (key.pageDown) {
      setSelectedIndex(Math.min(agentCount - 1, selectedIndex + maxVisible));
      return;
    }
  });

  return (
    <Box
      flexDirection="column"
      width={Math.max(20, columns - 6)}
      height={Math.max(5, Math.min(rows - 1, 30))}
      overflow="hidden"
      paddingX={1}
      marginTop={1}
    >
      <Box flexDirection="column" borderStyle="round" borderDimColor flexGrow={1} overflow="hidden">
        {/* Header */}
        <Box paddingX={1} gap={1}>
          <Text bold color="#229ac3">
            Available Sub-Agents
          </Text>
          <Text dimColor>
            ({agentCount} agent{agentCount !== 1 ? "s" : ""})
          </Text>
        </Box>
        {/* Agent list */}
        <Box
          borderTop={true}
          borderBottom={true}
          borderLeft={false}
          borderRight={false}
          borderStyle="round"
          borderDimColor
          flexDirection="column"
          flexGrow={1}
          paddingX={1}
          overflow="hidden"
        >
          {visibleAgents.map((agent, i) => {
            const actualIndex = scrollOffset + i;
            const isSelected = actualIndex === safeIndex;
            return <AgentRow key={`agent-${agent.name}`} agent={agent} selected={isSelected} />;
          })}
          {scrollOffset > 0 || scrollOffset + maxVisible < agentCount ? (
            <Box marginTop={1}>
              {scrollOffset > 0 ? <Text dimColor>... {scrollOffset} agents above. </Text> : null}
              {scrollOffset + maxVisible < agentCount ? (
                <Text dimColor>... {agentCount - scrollOffset - maxVisible} agents below.</Text>
              ) : null}
            </Box>
          ) : null}
        </Box>
        {/* Footer */}
        <Box paddingX={1}>
          <Text dimColor>{agentCount > maxVisible ? "↑/↓ navigate · " : ""}Esc to close</Text>
        </Box>
      </Box>
    </Box>
  );
}

function AgentRow({ agent, selected }: { agent: AgentManifest; selected: boolean }): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={selected ? "#229ac3" : undefined}>
          {selected ? "> " : "  "}
          <Text bold>{agent.name}</Text>
        </Text>
      </Box>
      {agent.description ? (
        <Box marginLeft={4}>
          <Text dimColor wrap="truncate-end">
            {agent.description}
          </Text>
        </Box>
      ) : null}
      <Box marginLeft={4} gap={2}>
        <Text dimColor>
          model: <Text color={selected ? "#229ac3" : undefined}>{agent.model}</Text>
        </Text>
        <Text dimColor>source: {agent.sourceRoot}</Text>
        {agent.skills.length > 0 ? <Text dimColor>skills: {agent.skills.join(", ")}</Text> : null}
      </Box>
    </Box>
  );
}
