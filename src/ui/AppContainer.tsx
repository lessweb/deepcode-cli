import React from "react";
import { AppContext } from "./contexts";
import App from "./App";
import { RawModeProvider } from "./contexts/RawModeContext";

const AppContainer: React.FC<{
  projectRoot: string;
  version: string;
  initialPrompt: string | undefined;
  onRestart: () => void;
}> = ({ version, projectRoot, initialPrompt, onRestart }) => {
  return (
    <AppContext.Provider value={{ version: version }}>
      <RawModeProvider>
        <App initialPrompt={initialPrompt} projectRoot={projectRoot} onRestart={onRestart} />
      </RawModeProvider>
    </AppContext.Provider>
  );
};

export default AppContainer;
