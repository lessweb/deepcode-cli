import {
  getHistoryRevision,
  readHistoryBatch,
  HistoryChangedError,
  type HistoryBatch,
  type HistoryCursor,
} from "@vegamo/deepcode-core";

export type HistorySearchSource = {
  revision: () => Promise<string>;
  read: (cursor?: HistoryCursor, maxRows?: number) => Promise<HistoryBatch>;
};
export type HistorySearchResult = { text: string | null; unavailable: boolean };
type QueryState = { matches: string[]; seen: Set<string>; scanned: number; selected: number; exhausted: boolean };

/** Disk records survive query changes and repeated search sessions on an unchanged file. */
export class HistorySearch {
  private local: string[] = [];
  private records: string[] = [];
  private revision: string | null = null;
  private cursor: HistoryCursor | null | undefined;
  private queries = new Map<string, QueryState>();
  private pending: Promise<void> | null = null;
  private unavailable = false;
  private epoch = 0;

  constructor(private source: HistorySearchSource = { revision: getHistoryRevision, read: readHistoryBatch }) {}

  async start(local: string[]): Promise<void> {
    this.local = [...local].reverse();
    this.queries.clear();
    this.unavailable = false;
    try {
      await this.refresh();
    } catch {
      this.unavailable = true;
    }
  }

  private async refresh(): Promise<void> {
    const revision = await this.source.revision();
    if (revision !== this.revision) {
      this.epoch++;
      this.revision = revision;
      this.records = [];
      this.cursor = undefined;
      this.queries.clear();
      this.pending = null;
    }
  }

  private async load(): Promise<void> {
    if (this.pending) return this.pending;
    const epoch = this.epoch;
    const request = this.source.read(this.cursor ?? undefined, this.cursor === undefined ? 1 : undefined);
    const pending = request.then((batch) => {
      if (epoch !== this.epoch) return;
      if (batch.revision !== this.revision) throw new HistoryChangedError();
      this.records.push(...batch.entries.map((entry) => entry.text));
      this.cursor = batch.cursor;
    });
    this.pending = pending;
    try {
      await pending;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  async find(
    query: string,
    direction: "older" | "newer",
    isCurrent: () => boolean = () => true,
    retries = 0
  ): Promise<HistorySearchResult> {
    if (!query) return { text: null, unavailable: false };
    if (!this.unavailable) {
      try {
        await this.refresh();
      } catch {
        this.unavailable = true;
      }
    }
    if (!isCurrent()) return { text: null, unavailable: false };
    let state = this.queries.get(query);
    if (!state) {
      state = { matches: [], seen: new Set(), scanned: 0, selected: -1, exhausted: false };
      this.queries.set(query, state);
    }
    const target = Math.max(0, state.selected + (direction === "older" ? 1 : -1));
    const queryLower = query.toLowerCase();
    while (isCurrent() && target >= state.matches.length && !state.exhausted) {
      const count = this.local.length + this.records.length;
      while (state.scanned < count) {
        const index = state.scanned++;
        const text = index < this.local.length ? this.local[index] : this.records[index - this.local.length];
        if (text.toLowerCase().includes(queryLower) && !state.seen.has(text)) {
          state.seen.add(text);
          state.matches.push(text);
          if (state.matches.length > target) break;
        }
      }
      if (state.matches.length > target) break;
      if (this.cursor === null || this.unavailable) {
        state.exhausted = true;
        break;
      }
      try {
        await this.load();
      } catch (error) {
        if (error instanceof HistoryChangedError && retries < 2 && isCurrent()) {
          // Also invalidate when a file was replaced and restored between metadata checks.
          this.revision = null;
          await this.refresh();
          return this.find(query, direction, isCurrent, retries + 1);
        }
        this.unavailable = true;
      }
    }
    if (!isCurrent()) return { text: null, unavailable: this.unavailable };
    state.selected = Math.min(target, state.matches.length - 1);
    return { text: state.matches[state.selected] ?? null, unavailable: this.unavailable };
  }

  /** Editing a query restarts selection at its newest match without discarding its cache. */
  restartQuery(query: string): void {
    const state = this.queries.get(query);
    if (state) state.selected = -1;
  }
}
