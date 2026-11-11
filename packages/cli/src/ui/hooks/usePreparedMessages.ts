import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionMessage } from "@vegamo/deepcode-core";
import { prepareImagePreviews, type ImagePreview } from "../core/image-preview";
import { useImagePreviewEnvironment } from "../components/AttachmentPreviews";
import { extractMessageImageUrls } from "../utils";

/** Static consumes each item once. Hold only the display queue until its images are ready. */
export function usePreparedMessages(messages: SessionMessage[], width: number) {
  const { cell, graphics } = useImagePreviewEnvironment(Math.max(1, width - 3));
  const ready = useRef(new WeakMap<SessionMessage, ImagePreview[]>());
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    // App empties Static before replaying history (resize, session switch, undo).
    // Rebuild previews using the new width/cell size on that replay.
    if (messages.length === 0) {
      ready.current = new WeakMap();
      return;
    }
    const controller = new AbortController();
    void (async () => {
      for (const message of messages) {
        if (ready.current.has(message) || message.role !== "user" || !message.visible) continue;
        const urls = extractMessageImageUrls(message);
        if (!urls.length) continue;
        const images = await prepareImagePreviews(urls, cell, graphics, controller.signal);
        if (controller.signal.aborted) return;
        ready.current.set(message, images);
        setRevision((value) => value + 1);
      }
    })();
    return () => controller.abort();
  }, [messages, cell, graphics]);
  const items = useMemo(() => {
    const firstPending = messages.findIndex(
      (message) =>
        message.role === "user" &&
        message.visible &&
        extractMessageImageUrls(message).length > 0 &&
        !ready.current.has(message)
    );
    return firstPending === -1 ? messages : messages.slice(0, firstPending);
    // revision signals completed preparation in the WeakMap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, revision]);
  return { items, previews: ready.current };
}
