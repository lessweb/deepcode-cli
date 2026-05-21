import React from "react";
import { AppContext } from "../contexts";
import App from "./App";
import { RawModeProvider, I18nProvider } from "../contexts";
import type { Locale } from "../../common/i18n";

const AppContainer: React.FC<{
  projectRoot: string;
  version: string;
  initialPrompt: string | undefined;
  onRestart: () => void;
  initialLocale?: Locale;
  initialThinkingLocale?: Locale;
  initialReplyLocale?: Locale;
}> = ({ version, projectRoot, initialPrompt, onRestart, initialLocale, initialThinkingLocale, initialReplyLocale }) => {
  return (
    <AppContext.Provider value={{ version: version }}>
      <RawModeProvider>
        <I18nProvider
          initialLocale={initialLocale ?? "en"}
          initialThinkingLocale={initialThinkingLocale}
          initialReplyLocale={initialReplyLocale}
        >
          <App initialPrompt={initialPrompt} projectRoot={projectRoot} onRestart={onRestart} />
        </I18nProvider>
      </RawModeProvider>
    </AppContext.Provider>
  );
};

export default AppContainer;
