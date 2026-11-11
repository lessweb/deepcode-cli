import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Box, Text, useStdout } from "ink";
import { DEFAULT_CELL_SIZE, imagePlaceholder, prepareImagePreviews, type ImagePreview } from "../core/image-preview";
import { terminalImagesFor } from "../core/terminal-images";
import type { TerminalImages } from "../core/terminal-images";

const noopSubscribe = () => () => {};
const zero = () => 0;
const EMPTY_URLS: string[] = [];
export const ImageHistoryContext = createContext<symbol | undefined>(undefined);

export function useImagePreviewEnvironment(width: number) {
  const { stdout } = useStdout();
  const terminal = terminalImagesFor(stdout);
  const revision = useSyncExternalStore(terminal?.subscribe ?? noopSubscribe, terminal?.snapshot ?? zero, zero);
  const cell = terminal?.cell ?? DEFAULT_CELL_SIZE;
  const graphics = Boolean(terminal?.protocol) && width >= 42;
  return { terminal, cell, graphics, revision };
}

export function AttachmentPreviews({
  urls,
  width,
  prepared,
  permanent = false,
  onLayoutChange,
}: {
  urls: string[];
  width: number;
  prepared?: ImagePreview[];
  permanent?: boolean;
  onLayoutChange?: () => void;
}): React.ReactElement {
  const { terminal, cell, graphics } = useImagePreviewEnvironment(width);
  const [loaded, setLoaded] = useState<{ urls: string[]; images: ImagePreview[] }>();
  // Compare source values, not array identity: MessageView may rerender during streaming.
  const sourceKey = JSON.stringify(prepared ? EMPTY_URLS : urls);
  const sources = useMemo<string[]>(() => JSON.parse(sourceKey), [sourceKey]);
  useEffect(() => {
    if (prepared) return;
    const controller = new AbortController();
    void prepareImagePreviews(sources, cell, graphics, controller.signal).then((images) => {
      if (!controller.signal.aborted) setLoaded({ urls: sources, images });
    });
    return () => controller.abort();
  }, [sources, cell, graphics, prepared]);
  const images = prepared ?? (loaded?.urls === sources ? loaded.images : undefined);
  useEffect(() => {
    onLayoutChange?.();
  }, [images, graphics, onLayoutChange]);
  return (
    <Box flexDirection="column" width={Math.max(1, width)}>
      {urls.map((_, index) => {
        const image = images?.[index];
        return (
          <Box key={index} flexDirection="column">
            <Text color="#229ac3" wrap="truncate-end">
              {imagePlaceholder(index, image)}
            </Text>
            {graphics && terminal && image?.png ? (
              <InlineImage image={image} terminal={terminal} permanent={permanent} />
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

function InlineImage({
  image,
  terminal,
  permanent,
}: {
  image: ImagePreview;
  terminal: TerminalImages;
  permanent: boolean;
}) {
  const history = useContext(ImageHistoryContext);
  const marker = useMemo(() => terminal.register(image, permanent, history), [image, terminal, permanent, history]);
  useEffect(() => () => terminal.unregister(marker), [terminal, marker]);
  return (
    <Box width={40} height={image.rows} flexShrink={0} flexDirection="column">
      {Array.from({ length: image.rows }, (_, row) => (
        <Text key={row}>{terminal.imageRow(marker, row)}</Text>
      ))}
    </Box>
  );
}
