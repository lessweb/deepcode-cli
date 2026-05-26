import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { PromptBufferState } from "../core/prompt-buffer";
import { cleanPasteContent, findPasteMarkerContaining, hasActivePasteMarkers, insertText } from "../core/prompt-buffer";

export type PasteRegion = {
  start: number;
  end: number;
  content: string;
  marker: string;
};

export type PasteHandlingState = {
  /** Ref holding all paste content keyed by paste ID. */
  pastesRef: React.RefObject<Map<number, string>>;
  /** Ref holding expanded paste regions for Ctrl+O toggle. */
  expandedRegionsRef: React.RefObject<Map<number, PasteRegion>>;
  /** Counter for generating unique paste IDs. */
  pasteCounterRef: React.RefObject<number>;
  /** Whether any paste marker is currently collapsed. */
  hasCollapsedMarkers: boolean;
  /** Whether any paste region has been expanded. */
  hasExpandedRegions: boolean;
};

export type PasteHandlingActions = {
  /**
   * Process pasted text. Short pastes (<1000 chars, ≤9 newlines) are inserted
   * inline. Larger pastes receive a collapsible marker.
   */
  handlePaste: (pastedText: string) => void;
  /** Expand a collapsed paste marker at the cursor, or collapse an expanded region. */
  expandPasteMarkerAtCursor: () => void;
  /** Reset all paste-related state. */
  resetPastes: () => void;
};

export function usePasteHandling(
  buffer: PromptBufferState,
  updateBuffer: (updater: (state: PromptBufferState) => PromptBufferState) => void,
  setStatusMessage: (msg: string | null) => void
): PasteHandlingState & PasteHandlingActions {
  const pastesRef = useRef<Map<number, string>>(new Map());
  const pasteCounterRef = useRef<number>(0);
  const expandedRegionsRef = useRef<Map<number, PasteRegion>>(new Map());
  const [hasCollapsedMarkers, setHasCollapsedMarkers] = useState(false);
  const [hasExpandedRegions, setHasExpandedRegions] = useState(false);

  function refreshDerivedFlags(): void {
    setHasCollapsedMarkers(hasActivePasteMarkers(buffer.text, pastesRef.current));
    setHasExpandedRegions(expandedRegionsRef.current.size > 0);
  }

  // Recompute derived flags whenever the buffer text changes, so they stay
  // in sync after any state update (e.g. large paste, expand/collapse, undo).
  useEffect(() => {
    refreshDerivedFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer.text]);

  function handlePaste(pastedText: string): void {
    const totalChars = pastedText.length;

    if (totalChars <= 1000) {
      const newlineCount = (pastedText.match(/\n/g) ?? []).length;
      if (newlineCount <= 9) {
        const clean = pastedText
          .replace(/\r\n|\r/g, "\n")
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
          .replace(/\t/g, "    ");
        updateBuffer((s) => insertText(s, clean));
        return;
      }
    }

    // Large paste: store raw text, insert marker.
    const lineCount = (pastedText.match(/\n/g) ?? []).length + 1;
    pasteCounterRef.current += 1;
    const pasteId = pasteCounterRef.current;
    pastesRef.current.set(pasteId, pastedText);

    const marker =
      lineCount > 10 ? `[paste #${pasteId} +${lineCount} lines]` : `[paste #${pasteId} ${totalChars} chars]`;

    updateBuffer((s) => insertText(s, marker));
    refreshDerivedFlags();
  }

  function expandPasteMarkerAtCursor(): void {
    // Collapse an already-expanded region at the cursor.
    for (const [id, region] of expandedRegionsRef.current) {
      if (buffer.cursor >= region.start && buffer.cursor <= region.end) {
        expandedRegionsRef.current.delete(id);
        pastesRef.current.set(id, region.content);
        setTimeout(() => {
          updateBuffer((s) => {
            const text = s.text.slice(0, region.start) + region.marker + s.text.slice(region.end);
            return { text, cursor: region.start + region.marker.length };
          });
          refreshDerivedFlags();
        }, 0);
        refreshDerivedFlags();
        return;
      }
    }

    // Expand a paste marker.
    const marker = findPasteMarkerContaining(buffer);
    if (!marker) {
      setStatusMessage("No paste marker at cursor");
      return;
    }
    const content = pastesRef.current.get(marker.id);
    if (!content) {
      setStatusMessage("Paste content not found");
      return;
    }

    const pasteId = marker.id;
    const originalMarker = buffer.text.slice(marker.start, marker.end);
    pastesRef.current.delete(pasteId);

    setTimeout(() => {
      updateBuffer((s) => {
        const text = s.text.slice(0, marker.start) + cleanPasteContent(content) + s.text.slice(marker.end);
        const newEnd = marker.start + content.length;
        expandedRegionsRef.current.set(pasteId, {
          start: marker.start,
          end: newEnd,
          content,
          marker: originalMarker,
        });
        return { text, cursor: marker.start };
      });
      refreshDerivedFlags();
    }, 0);
    refreshDerivedFlags();
  }

  function resetPastes(): void {
    pastesRef.current.clear();
    expandedRegionsRef.current.clear();
    pasteCounterRef.current = 0;
    refreshDerivedFlags();
  }

  return {
    pastesRef,
    expandedRegionsRef,
    pasteCounterRef,
    hasCollapsedMarkers,
    hasExpandedRegions,
    handlePaste,
    expandPasteMarkerAtCursor,
    resetPastes,
  };
}
