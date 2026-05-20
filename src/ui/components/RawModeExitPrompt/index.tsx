import { useRef, type ReactElement } from "react";
import { useInput } from "ink";
import { useRawModeContext, type RawMode } from "../../contexts";

export function RawModeExitPrompt({ onExit }: { onExit: (previousMode: RawMode) => void }): ReactElement | null {
  const { previousMode } = useRawModeContext();
  // Snapshot the prior mode at mount so later context updates do not change the ESC target.
  const snapshotRef = useRef<RawMode>(previousMode);

  useInput(
    (_input, key) => {
      if (key.escape) {
        onExit(snapshotRef.current);
      }
    },
    { isActive: true }
  );

  return null;
}
