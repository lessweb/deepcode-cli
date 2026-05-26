import React, { useMemo, useState } from "react";
import { Box, Text } from "ink";
import * as os from "node:os";
import path from "node:path";
import type { SkillInfo } from "../../session";
import type { ResolvedDeepcodingSettings } from "../../settings";
import { buildSlashCommands, BUILTIN_SLASH_COMMANDS, formatSlashCommandDescription } from "../core/slash-commands";
import { ThemedGradient } from "./ThemedGradient";
import { AsciiLogo } from "../ascii-art";
import { useAppContext } from "../contexts";
import { t } from "../../common/i18n";

type WelcomeScreenProps = {
  projectRoot: string;
  settings: ResolvedDeepcodingSettings;
  skills: SkillInfo[];
  width: number;
};

const TITLE_PANEL_WIDTH = 70;
const PANEL_CONTENT_HEIGHT = 8;

function getShortcutTips(): Array<{ label: string; description: string }> {
  return [
    { label: "Enter", description: t("ui.welcome.sendPrompt") },
    { label: "Shift+Enter", description: t("ui.welcome.insertNewline") },
    { label: "Ctrl+V", description: t("ui.welcome.pasteImage") },
    { label: "Esc", description: t("ui.welcome.interrupt") },
    { label: "/", description: t("ui.welcome.openMenu") },
    { label: "Ctrl+D twice", description: t("ui.welcome.quit") },
  ];
}

export function WelcomeScreen({ projectRoot, settings, skills, width }: WelcomeScreenProps): React.ReactElement {
  const { version } = useAppContext();
  const tips = useMemo(() => buildWelcomeTips(skills), [skills]);
  const [tipIndex] = useState(() => randomTipIndex(tips.length));
  const compact = width < TITLE_PANEL_WIDTH + 42;
  const cwd = formatHomeRelativePath(projectRoot);
  const tip = tips[Math.min(tipIndex, Math.max(0, tips.length - 1))] ?? tips[0];
  const panelWidth = compact ? undefined : Math.min(width, 72);

  return (
    <Box flexDirection="column" marginY={1}>
      <Box flexDirection="column" width={panelWidth}>
        <Box flexDirection="column" paddingX={1}>
          <Box flexDirection="column" justifyContent="center" paddingX={1}>
            <Box justifyContent="center" width={compact ? undefined : TITLE_PANEL_WIDTH}>
              <ThemedGradient>{AsciiLogo}</ThemedGradient>
            </Box>
          </Box>

          <Box
            borderStyle={"round"}
            borderColor={"#229ac3e6"}
            flexDirection="column"
            flexGrow={1}
            height={compact ? undefined : PANEL_CONTENT_HEIGHT}
            marginTop={compact ? 1 : 0}
            paddingX={1}
          >
            <Box flexGrow={1} marginBottom={compact ? 1 : 0}>
              <Text color={"#229ac3e6"}>{">"}_ Deep Code </Text>
              <Text color="gray"> (v{version || "unknown"})</Text>
            </Box>
            {!compact ? <Text> </Text> : null}
            <SettingRow label={t("ui.welcome.model")} value={settings.model} />
            <SettingRow label={t("ui.welcome.thinkingEnabled")} value={String(settings.thinkingEnabled)} />
            <SettingRow
              label={t("ui.welcome.reasoningEffort")}
              value={settings.thinkingEnabled ? settings.reasoningEffort : "-"}
            />
            <SettingRow label={t("ui.welcome.cwd")} value={cwd} />
          </Box>
        </Box>
      </Box>

      <Box flexDirection="column" width={panelWidth} paddingX={1}>
        {tip ? (
          <Box marginTop={1}>
            <Text dimColor>
              {t("ui.welcome.tipsPrefix")}
              {tip.label} - {tip.description}
            </Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function SettingRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <Box flexDirection="row">
      <Box width={20}>
        <Text>{label}</Text>
      </Box>
      <Box flexGrow={1} justifyContent="flex-end">
        <Text>{value}</Text>
      </Box>
    </Box>
  );
}

export function formatHomeRelativePath(value: string, home = os.homedir()): string {
  const normalizedValue = path.resolve(value);
  const normalizedHome = path.resolve(home);
  const relative = path.relative(normalizedHome, normalizedValue);

  if (relative === "") {
    return "~";
  }
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `~${path.sep}${relative}`;
  }
  return normalizedValue;
}

export function buildWelcomeTips(skills: SkillInfo[]): Array<{ label: string; description: string }> {
  const slashTips = buildSlashCommands(skills)
    .filter((item) => item.kind !== "skill" || item.skill?.isLoaded)
    .map((item) => ({
      label: item.label,
      description: formatSlashCommandDescription(item.description),
    }));

  return [
    ...slashTips,
    ...getShortcutTips().filter((tip) => !BUILTIN_SLASH_COMMANDS.some((command) => command.label === tip.label)),
  ];
}

function randomTipIndex(length: number): number {
  return length > 0 ? Math.floor(Math.random() * length) : 0;
}
