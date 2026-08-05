import React from "react";
import { AppContext } from "../contexts";
import App from "./App";
import { RawModeProvider } from "../contexts";

const AppContainer: React.FC<{
  projectRoot: string;
  version: string;
  initialPrompt: string | undefined;
  resumeSessionId: string | true | undefined;
  forkSessionId: string | undefined;
  onRestart: () => void;
}> = ({ version, projectRoot, initialPrompt, resumeSessionId, forkSessionId, onRestart }) => {
  return (
    <AppContext.Provider value={{ version: version }}>
      <RawModeProvider>
        <App
          initialPrompt={initialPrompt}
          resumeSessionId={resumeSessionId}
          forkSessionId={forkSessionId}
          projectRoot={projectRoot}
          onRestart={onRestart}
        />
      </RawModeProvider>
    </AppContext.Provider>
  );
};

export default AppContainer;
