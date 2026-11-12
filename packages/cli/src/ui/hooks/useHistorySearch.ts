import { useCallback, useEffect, useRef, useState } from "react";
import { HistorySearch } from "../core/history-search";
import type { InputKey } from "./useTerminalInput";

export type HistorySearchView = {
  query: string;
  preview: string | null;
  status: "idle" | "searching" | "match" | "no-match" | "unavailable";
};

export function isHistorySearchShortcut(input: string, key: Pick<InputKey, "ctrl">): boolean {
  return key.ctrl && input.toLowerCase() === "r";
}

export function useHistorySearch() {
  const [view, setView] = useState<HistorySearchView | null>(null);
  const viewRef = useRef<HistorySearchView | null>(null);
  const engine = useRef(new HistorySearch());
  const generation = useRef(0);
  const ready = useRef<Promise<void>>(Promise.resolve());

  const publish = useCallback((next: HistorySearchView | null) => {
    viewRef.current = next;
    setView(next);
  }, []);
  const close = useCallback(() => {
    generation.current++;
    publish(null);
  }, [publish]);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );

  function begin(history: string[]): void {
    generation.current++;
    publish({ query: "", preview: null, status: "idle" });
    ready.current = engine.current.start(history);
  }

  async function search(query: string, direction: "older" | "newer", changed: boolean): Promise<void> {
    const version = ++generation.current;
    const current = () => version === generation.current && viewRef.current !== null;
    if (!query) {
      publish({ query, preview: null, status: "idle" });
      return;
    }
    publish({ query, preview: changed ? null : (viewRef.current?.preview ?? null), status: "searching" });
    await ready.current;
    if (!current()) return;
    if (changed) engine.current.restartQuery(query);
    try {
      const result = await engine.current.find(query, direction, current);
      if (current())
        publish({
          query,
          preview: result.text,
          status: result.text !== null ? "match" : result.unavailable ? "unavailable" : "no-match",
        });
    } catch {
      if (current()) publish({ query, preview: null, status: "unavailable" });
    }
  }

  /** True means the search owns this key, including otherwise unsupported editor shortcuts. */
  function handleKey(input: string, key: InputKey, accept: (text: string) => void): boolean {
    const active = viewRef.current;
    if (!active) return false;
    if (key.escape || (key.ctrl && input.toLowerCase() === "c")) {
      close();
    } else if (key.return && !key.shift && !key.meta && !key.ctrl) {
      if (active.status === "match" && active.preview !== null) {
        accept(active.preview);
        close();
      }
    } else if (
      isHistorySearchShortcut(input, key) ||
      key.upArrow ||
      (key.ctrl && input.toLowerCase() === "s") ||
      key.downArrow
    ) {
      // Repeated keys while a fetch is pending are coalesced rather than starting duplicate reads.
      if (active.status !== "searching")
        void search(
          active.query,
          key.downArrow || (key.ctrl && input.toLowerCase() === "s") ? "newer" : "older",
          false
        );
    } else if (key.backspace || (key.ctrl && input.toLowerCase() === "h")) {
      void search(Array.from(active.query).slice(0, -1).join(""), "older", true);
    } else if (key.ctrl && input.toLowerCase() === "u") {
      void search("", "older", true);
    } else if (key.paste || (input && !key.ctrl && !key.meta && !key.tab && !key.return)) {
      const text = input.replace(/\r\n|\r/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
      if (text) void search(active.query + text, "older", true);
    }
    return true;
  }

  return { view, begin, close, handleKey };
}
