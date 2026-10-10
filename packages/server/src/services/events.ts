/**
 * Server event envelope types.
 *
 * Summary:
 * Defines the structured event envelope used by the HTTP/SSE server. Event
 * production remains in the runtime service until the runtime class is split.
 *
 * Exports:
 * - type HeadlessEvent
 */
export type HeadlessEvent = {
  type: string;
  requestId?: string;
  sequence?: number;
  timestamp?: string;
  [key: string]: unknown;
};
