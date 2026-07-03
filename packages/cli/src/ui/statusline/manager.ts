import type { ResolvedStatusLineSettings, StatusLineProviderConfig } from "@vegamo/deepcode-core";
import { sanitizeStatusText } from "./sanitize";
import { createCommandStatusProvider } from "./command-provider";
import { loadModuleProvider, validateModulePath } from "./module-provider";
import type { SessionInfo, StatusProvider, StatusSegment } from "./types";

type SegmentsListener = (segments: StatusSegment[]) => void;

function segmentsEqual(a: StatusSegment[], b: StatusSegment[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (
      a[i]?.id !== b[i]?.id ||
      a[i]?.text !== b[i]?.text ||
      a[i]?.color !== b[i]?.color ||
      a[i]?.newLine !== b[i]?.newLine
    ) {
      return false;
    }
  }
  return true;
}

export class StatusLineManager {
  private providers: StatusProvider[] = [];
  private ac: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private subscribers = new Set<SegmentsListener>();
  private segments: StatusSegment[] = [];
  private running = false;
  private projectRoot = "";
  private getSessionInfo: (() => SessionInfo | null) | undefined;

  get currentSegments(): StatusSegment[] {
    return this.segments;
  }

  subscribe(fn: SegmentsListener): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private emit(segments: StatusSegment[]): void {
    if (segmentsEqual(this.segments, segments)) {
      return;
    }
    this.segments = segments;
    for (const fn of this.subscribers) {
      try {
        fn(segments);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  async start(
    config: ResolvedStatusLineSettings,
    projectRoot: string,
    getSessionInfo?: () => SessionInfo | null
  ): Promise<void> {
    if (this.running) {
      this.stop();
    }
    if (!config.enabled || config.providers.length === 0) {
      return;
    }

    this.projectRoot = projectRoot;
    this.getSessionInfo = getSessionInfo;
    const { providers, refreshMs } = config;
    this.ac = new AbortController();
    const { signal } = this.ac;

    // Build providers
    const built: StatusProvider[] = [];
    let nextId = 0;
    for (const entry of providers) {
      const providerId = entry.id || `${entry.type}-${nextId}`;
      const provider = await this.buildProvider(entry, projectRoot, providerId);
      if (provider) {
        built.push(provider);
      }
      nextId += 1;
    }

    if (built.length === 0) {
      return;
    }

    this.providers = built;
    this.running = true;

    // Fetch immediately, then on interval.
    void this.fetchAll();
    this.timer = setInterval(() => {
      if (signal.aborted) {
        return;
      }
      void this.fetchAll();
    }, refreshMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ac) {
      this.ac.abort();
      this.ac = null;
    }
    for (const provider of this.providers) {
      provider.dispose?.();
    }
    this.providers = [];
    this.getSessionInfo = undefined;
  }

  private async buildProvider(
    config: StatusLineProviderConfig,
    projectRoot: string,
    providerId: string
  ): Promise<StatusProvider | null> {
    if (config.type === "command") {
      return createCommandStatusProvider(config, projectRoot, providerId);
    }
    if (config.type === "module") {
      const resolvedPath = validateModulePath(config.path, projectRoot);
      if (!resolvedPath) {
        return null;
      }
      const provider = await loadModuleProvider(
        resolvedPath,
        config.color,
        providerId,
        config.timeoutMs,
        config.maxLength
      );
      if (provider && config.newLine) {
        provider.newLine = true;
      }
      return provider;
    }
    return null;
  }

  private async fetchAll(): Promise<void> {
    if (!this.ac || this.ac.signal.aborted) {
      return;
    }

    const results = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          const text = await provider.fetch({
            projectRoot: this.projectRoot,
            signal: this.ac!.signal,
            getSessionInfo: this.getSessionInfo,
          });
          const sanitized = sanitizeStatusText(text, provider.maxLength);
          if (!sanitized) {
            return null;
          }
          const segment: StatusSegment = { id: provider.id, text: sanitized };
          if (provider.color) {
            segment.color = provider.color;
          }
          if (provider.newLine) {
            segment.newLine = true;
          }
          return segment;
        } catch {
          return null;
        }
      })
    );

    const segments = results.filter((s): s is StatusSegment => s !== null);
    this.emit(segments);
  }
}
