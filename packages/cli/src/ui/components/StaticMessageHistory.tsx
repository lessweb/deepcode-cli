import React, { useEffect, useRef, useState } from "react";
import { Static, useStdout } from "ink";
import type { SessionMessage } from "@vegamo/deepcode-core";
import type { ImagePreview } from "../core/image-preview";
import { terminalImagesFor } from "../core/terminal-images";
import { usePreparedMessages } from "../hooks/usePreparedMessages";
import { ImageHistoryContext } from "./AttachmentPreviews";

/** Remount on history replacement so Ink's replay buffer and image resources expire together. */
export function StaticMessageHistory({
  messages,
  width,
  isExiting = false,
  children,
}: {
  messages: SessionMessage[];
  width: number;
  isExiting?: boolean;
  children: (message: SessionMessage, images: ImagePreview[] | undefined) => React.ReactNode;
}) {
  const [history] = useState(() => Symbol("image history"));
  const { stdout } = useStdout();
  const terminal = terminalImagesFor(stdout);
  const prepared = usePreparedMessages(messages, width);
  // Normal exit leaves the transcript in terminal scrollback, but releases JS buffers.
  const exiting = useRef(isExiting);
  exiting.current = isExiting;
  useEffect(() => () => terminal?.releaseHistory(history, exiting.current), [terminal, history]);
  return (
    <ImageHistoryContext.Provider value={history}>
      <Static items={prepared.items}>{(message) => children(message, prepared.previews.get(message))}</Static>
    </ImageHistoryContext.Provider>
  );
}
