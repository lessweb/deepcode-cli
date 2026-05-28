import React, { useEffect, useState } from "react";
import { AppContext } from "../contexts";
import App from "./App";
import { RawModeProvider } from "../contexts";
import { ThemeProvider, setCurrentTheme } from "../theme";
import { resolveCurrentSettings } from "../../settings";

const AppContainer: React.FC<{
  projectRoot: string;
  version: string;
  initialPrompt: string | undefined;
  onRestart: () => void;
}> = ({ version, projectRoot, initialPrompt, onRestart }) => {
  const settings = resolveCurrentSettings(projectRoot);
  const [theme] = useState(settings.theme);

  useEffect(() => {
    // 初始设置全局 chalk 主题
    setCurrentTheme(theme);
  }, [theme]);

  return (
    <AppContext.Provider value={{ version: version }}>
      <ThemeProvider value={theme}>
        <RawModeProvider>
          <App initialPrompt={initialPrompt} projectRoot={projectRoot} onRestart={onRestart} />
        </RawModeProvider>
      </ThemeProvider>
    </AppContext.Provider>
  );
};

export default AppContainer;
