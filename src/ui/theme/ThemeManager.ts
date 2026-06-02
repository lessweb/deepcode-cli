import { resolveCurrentSettings, readSettings, readProjectSettings, writeSettings } from "../../settings";
import type { ThemeTokens, ThemePreset, ThemeSettings } from "./types";
import { detectSystemTheme, detectTerminalThemeAsync } from "./detect-system-theme";
import { resolveTheme } from "./resolver";
import { setCurrentTheme } from "./current-theme";

/** 主题变更回调 */
type ThemeChangeListener = (theme: ThemeTokens, preset: ThemePreset) => void;

/**
 * 主题管理器。
 * 统一管理终端背景检测、主题解析、预览/切换/回退、运行时轮询。
 */
export class ThemeManager {
  private projectRoot: string;
  private terminalBg: "light" | "dark" | null = null;
  private currentTheme: ThemeTokens;
  private currentPreset: ThemePreset;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<ThemeChangeListener>();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const settings = resolveCurrentSettings(projectRoot);
    this.currentTheme = settings.theme;
    this.currentPreset = this.loadPresetFromSettings();
  }

  // ——— 生命周期 ———

  /**
   * 异步初始化（含 OSC 11 终端背景查询）。
   * 应在 App 启动时调用一次。
   */
  async init(): Promise<void> {
    this.terminalBg = await detectTerminalThemeAsync();
    this.refreshFromSettings();
  }

  /**
   * 启动运行时终端背景轮询。
   * 检测到变化时自动刷新主题。
   */
  startPolling(intervalMs = 3000): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      const detected = detectSystemTheme();
      if (this.terminalBg !== null && detected !== this.terminalBg) {
        this.terminalBg = detected;
        this.refreshFromSettings();
      }
    }, intervalMs);
  }

  /** 停止轮询 */
  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** 注销所有资源 */
  dispose(): void {
    this.stopPolling();
    this.listeners.clear();
  }

  // ——— 查询 ———

  /** 获取当前主题 */
  getTheme(): ThemeTokens {
    return this.currentTheme;
  }

  /** 获取当前预设名称 */
  getPreset(): ThemePreset {
    return this.currentPreset;
  }

  /** 获取终端背景色 */
  getTerminalBackground(): "light" | "dark" | null {
    return this.terminalBg;
  }

  // ——— 操作 ———

  /**
   * 预览主题：仅切换 UI，不保存到 settings，不更新 currentPreset。
   * 用于 /theme 选择器中上下键浏览。
   */
  previewTheme(presetOrTokens: string | Partial<ThemeTokens>): void {
    const themeSettings = this.buildThemeSettings(presetOrTokens);
    const newTheme = this.resolveWithContrast(themeSettings);
    this.applyTheme(newTheme, this.currentPreset);
  }

  /**
   * 切换主题并持久化到 settings.json。
   * 用于 /theme 选择器中确认选择。
   */
  switchTheme(presetOrTokens: string | Partial<ThemeTokens>): void {
    const preset: ThemePreset = typeof presetOrTokens === "string" ? (presetOrTokens as ThemePreset) : "custom";
    const themeSettings = this.buildThemeSettings(presetOrTokens);
    const newTheme = this.resolveWithContrast(themeSettings);

    this.currentPreset = preset;
    this.applyTheme(newTheme, preset);
    this.persistToSettings(preset, presetOrTokens);
  }

  /**
   * 回退到 settings 中已保存的主题。
   * 用于 /theme 选择器中按 Esc 取消。
   */
  revertTheme(): void {
    this.currentPreset = this.loadPresetFromSettings();
    const themeSettings = this.loadThemeSettings();
    const newTheme = this.resolveWithContrast(themeSettings);
    this.applyTheme(newTheme, this.currentPreset);
  }

  /**
   * 从 settings 重新解析主题（终端背景变化时调用）。
   */
  refreshFromSettings(): void {
    const themeSettings = this.loadThemeSettings();
    const newTheme = this.resolveWithContrast(themeSettings);
    this.currentPreset = this.loadPresetFromSettings();
    this.applyTheme(newTheme, this.currentPreset);
  }

  // ——— 监听 ———

  /** 注册主题变更回调 */
  onChange(listener: ThemeChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ——— 内部方法 ———

  private applyTheme(theme: ThemeTokens, preset: ThemePreset): void {
    this.currentTheme = theme;
    setCurrentTheme(theme);
    for (const listener of this.listeners) {
      listener(theme, preset);
    }
  }

  private resolveWithContrast(themeSettings?: ThemeSettings): ThemeTokens {
    // 先用缓存的终端背景解析，如果还没有缓存则同步检测
    if (this.terminalBg === null) {
      this.terminalBg = detectSystemTheme();
    }
    return resolveTheme(themeSettings, this.terminalBg);
  }

  private buildThemeSettings(presetOrTokens: string | Partial<ThemeTokens>): ThemeSettings {
    if (typeof presetOrTokens === "string") {
      return { preset: presetOrTokens as ThemePreset };
    }
    return { preset: "custom", overrides: presetOrTokens };
  }

  private loadThemeSettings(): ThemeSettings | undefined {
    const userSettings = readSettings();
    const projectSettings = readProjectSettings(this.projectRoot);
    return userSettings?.theme ?? projectSettings?.theme;
  }

  private loadPresetFromSettings(): ThemePreset {
    const userSettings = readSettings();
    const projectSettings = readProjectSettings(this.projectRoot);
    return (userSettings?.theme?.preset ?? projectSettings?.theme?.preset ?? "light") as ThemePreset;
  }

  private persistToSettings(preset: ThemePreset, presetOrTokens: string | Partial<ThemeTokens>): void {
    const currentSettings = readSettings() ?? {};
    const newThemeSettings: ThemeSettings = {
      preset,
      ...(typeof presetOrTokens !== "string" ? { overrides: presetOrTokens } : {}),
    };
    writeSettings({ ...currentSettings, theme: newThemeSettings });
  }
}
