import { useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedStatusLineSettings } from "@vegamo/deepcode-core";
import { StatusLineManager } from "../statusline";
import type { SessionInfo, StatusSegment } from "../statusline";

/**
 * Manages a StatusLineManager lifecycle and returns the current segments.
 * Starts polling when the config is enabled, stops on unmount or config change.
 */
export function useStatusLine(
  config: ResolvedStatusLineSettings,
  projectRoot: string,
  getSessionInfo?: () => SessionInfo | null
): StatusSegment[] {
  const [segments, setSegments] = useState<StatusSegment[]>([]);
  const managerRef = useRef<StatusLineManager | null>(null);
  const getSessionInfoRef = useRef<typeof getSessionInfo>(getSessionInfo);
  getSessionInfoRef.current = getSessionInfo;

  const configKey = useMemo(
    () =>
      JSON.stringify({
        enabled: config.enabled,
        refreshMs: config.refreshMs,
        separator: config.separator,
        providers: config.providers,
      }),
    [config]
  );

  useEffect(() => {
    const manager = new StatusLineManager();
    managerRef.current = manager;

    const unsub = manager.subscribe(setSegments);
    void manager.start(config, projectRoot, () => (getSessionInfoRef.current ? getSessionInfoRef.current() : null));

    return () => {
      unsub();
      manager.stop();
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- config tracked via configKey
  }, [configKey, projectRoot]);

  return segments;
}
