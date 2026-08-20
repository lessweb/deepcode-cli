/**
 * Transport abstraction for the MCP JSON-RPC layer.
 *
 * `McpClient` owns the protocol (request/response correlation, handshake,
 * notifications) and is transport-agnostic. A transport is responsible only
 * for moving already-encoded JSON-RPC messages to and from a server and for
 * delivering inbound messages back to the client as parsed objects.
 */

export type McpTransportHandlers = {
  /** Called once per inbound JSON-RPC message (response or server notification). */
  onMessage: (message: object) => void;
  /** Called when the channel closes unexpectedly (process exit, network error). */
  onClose: (reason: string) => void;
};

export interface McpTransport {
  /** Establish the channel and start delivering inbound messages. */
  start(handlers: McpTransportHandlers): Promise<void>;
  /** Send a single JSON-RPC request or notification object. */
  send(message: object): void;
  /** Tear the channel down. Must not trigger `onClose`. */
  close(): void;
  /** Whether the channel is currently usable. */
  isConnected(): boolean;
  /** Wrap an error message with transport-specific context (e.g. captured stderr). */
  decorateError(message: string): Error;
}
