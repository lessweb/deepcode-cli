import { createContext, useContext } from "react";

export interface AppState {
  version: string;
}

export const AppContext = createContext<AppState | null>(null);

export const useAppContext = (): AppState => {
  const context = useContext(AppContext);
  if (!context) {
    // Safe fallback when App is rendered without AppContainer (e.g., in tests).
    return { version: "unknown" };
  }
  return context;
};
