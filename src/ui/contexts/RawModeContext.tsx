import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import type { DropdownMenuItem } from "../components/DropdownMenu";

export enum RawMode {
  None = "Normal mode",
  Lite = "Lite mode",
  Raw = "Raw scrollback mode",
}
export const RAW_COMMAND_MODELS: DropdownMenuItem[] = [
  {
    label: "Lite mode",
    key: RawMode.Lite,
    description: "Collapse chain-of-thought reasoning.",
  },
  {
    label: "Normal mode",
    key: RawMode.None,
    description: "Show full chain-of-thought reasoning.",
  },
  {
    label: "Raw scrollback mode",
    key: RawMode.Raw,
    description: "Show scrollback mode for copy-friendly terminal selection.",
  },
] as const;

type RawModeContextValue = {
  mode: RawMode;
  setMode: React.Dispatch<React.SetStateAction<RawMode>>;
  // The mode that was active right before the most recent mode transition.
  previousMode: RawMode;
};

const RawModeContext = createContext<RawModeContextValue>({
  mode: RawMode.Lite,
  setMode: () => {},
  previousMode: RawMode.Lite,
});

export function useRawModeContext() {
  const context = useContext(RawModeContext);
  if (!context) {
    throw new Error("useRawModeContext must be used within a RawModeProvider");
  }
  return context;
}

export const RawModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, _setMode] = useState<RawMode>(RawMode.Lite);
  const previousModeRef = useRef<RawMode>(RawMode.Lite);

  const setMode = useCallback<React.Dispatch<React.SetStateAction<RawMode>>>((next) => {
    _setMode((current) => {
      const resolved = typeof next === "function" ? (next as (prev: RawMode) => RawMode)(current) : next;
      if (resolved !== current) {
        previousModeRef.current = current;
      }
      return resolved;
    });
  }, []);

  return (
    <RawModeContext.Provider value={{ mode, setMode, previousMode: previousModeRef.current }}>
      {children}
    </RawModeContext.Provider>
  );
};
