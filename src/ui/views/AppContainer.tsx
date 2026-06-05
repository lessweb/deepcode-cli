import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppContext, RawModeProvider } from "../contexts";
import App from "./App";
import type { ThemePreset, ThemeTokens } from "../theme";
import { ThemeManager, ThemeProvider } from "../theme";
import { readProjectSettings, readSettings, resolveCurrentSettings } from "../../settings";

const AppContainer: React.FC<{
  projectRoot: string;
  version: string;
  initialPrompt: string | undefined;
  onRestart: () => void;
}> = ({ version, projectRoot, initialPrompt, onRestart }) => {
  const settings = resolveCurrentSettings(projectRoot);
  const [theme, setTheme] = useState<ThemeTokens>(settings.theme);
  const [currentPreset, setCurrentPreset] = useState<ThemePreset>(() => {
    const userSettings = readSettings();
    const projectSettings = readProjectSettings(projectRoot);
    return (userSettings?.theme?.preset ?? projectSettings?.theme?.preset ?? "light") as ThemePreset;
  });
  const [themeVersion, setThemeVersion] = useState(0);

  // ThemeManager 实例（随 projectRoot 变化重建）
  const managerRef = useRef<ThemeManager | null>(null);
  const getManager = useCallback(() => {
    if (!managerRef.current) {
      managerRef.current = new ThemeManager(projectRoot);
    }
    return managerRef.current;
  }, [projectRoot]);

  // 监听主题变更，同步到 React 状态
  useEffect(() => {
    const manager = getManager();
    return manager.onChange((newTheme, preset) => {
      setTheme(newTheme);
      setCurrentPreset(preset);
      setThemeVersion((v) => v + 1);
    });
  }, [getManager]);

  // 同步全局 chalk 主题
  useEffect(() => {
    const manager = getManager();
    setTheme(manager.getTheme());
  }, [getManager]);

  // 启动：异步检测终端背景 → 刷新主题 → 开始轮询
  useEffect(() => {
    const manager = getManager();
    void manager.init().then(() => {
      manager.startPolling();
    });
    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [projectRoot, getManager]);

  // 检查是否有 custom 主题配置
  const hasCustomThemeConfig = useMemo(() => {
    const userSettings = readSettings();
    const projectSettings = readProjectSettings(projectRoot);
    const themeSettings = userSettings?.theme ?? projectSettings?.theme;
    return themeSettings?.preset === "custom" && !!(themeSettings?.overrides || themeSettings?.tokens);
  }, [projectRoot]);

  const previewTheme = useCallback(
    (presetOrTokens: string | Partial<ThemeTokens>) => {
      getManager().previewTheme(presetOrTokens);
    },
    [getManager]
  );

  const switchTheme = useCallback(
    (presetOrTokens: string | Partial<ThemeTokens>) => {
      getManager().switchTheme(presetOrTokens);
    },
    [getManager]
  );

  const revertTheme = useCallback(() => {
    getManager().revertTheme();
  }, [getManager]);

  return (
    <AppContext.Provider
      value={{ version, hasCustomThemeConfig, themeVersion, currentPreset, switchTheme, previewTheme, revertTheme }}
    >
      <ThemeProvider value={theme}>
        <RawModeProvider>
          <App initialPrompt={initialPrompt} projectRoot={projectRoot} onRestart={onRestart} />
        </RawModeProvider>
      </ThemeProvider>
    </AppContext.Provider>
  );
};

export default AppContainer;
