import { createContext, useContext } from "react";
import type { ThemeTokens, ThemePreset } from "../theme";

export interface AppState {
  version: string;
  hasCustomThemeConfig: boolean;
  themeVersion: number;
  currentPreset: ThemePreset;
  switchTheme?: (presetOrTokens: string | Partial<ThemeTokens>) => void;
  previewTheme?: (presetOrTokens: string | Partial<ThemeTokens>) => void;
  revertTheme?: () => void;
}

export const AppContext = createContext<AppState | null>(null);

export const useAppContext = (): AppState => {
  const context = useContext(AppContext);
  if (!context) {
    // Safe fallback when App is rendered without AppContainer (e.g., in tests).
    return { version: "unknown", hasCustomThemeConfig: false, themeVersion: 0, currentPreset: "light" };
  }
  return context;
};
