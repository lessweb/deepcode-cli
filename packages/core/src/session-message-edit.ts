import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SessionMessage } from "./session";
import { generateToolCallId, getCurrentToolCallBatch } from "./common/tool-call-batch";
import { parseToolCallForPermissions, type PermissionPlan, type PermissionToolCall } from "./common/permissions";

export interface SessionMessageTarget {
  messageId: string;
  toolCallIndex?: number;
}
export type SessionMessageTab = "Content" | "Thinking" | "Parameters" | "Result" | "Raw";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ObjectValue) : {};
}
function calls(message: SessionMessage): ObjectValue[] {
  const value = object(message.messageParams).tool_calls;
  return Array.isArray(value) ? value.map(object) : [];
}
function rawMessage(message: SessionMessage): ObjectValue {
  return JSON.parse(JSON.stringify({ ...message, html: undefined, checkpointHash: undefined }));
}
function findTarget(messages: SessionMessage[], target: SessionMessageTarget) {
  const index = messages.findIndex((message) => message.id === target.messageId);
  if (index < 0) throw new Error("Message was not found.");
  const message = messages[index];
  if (target.toolCallIndex === undefined) return { index, message, call: undefined, result: undefined };
  const call = calls(message)[target.toolCallIndex];
  if (message.role !== "assistant" || !Number.isInteger(target.toolCallIndex) || !call)
    throw new Error("Tool call was not found.");
  const result =
    typeof call.id === "string" && call.id
      ? messages
          .slice(index + 1)
          .find((item) => item.role === "tool" && object(item.messageParams).tool_call_id === call.id)
      : undefined;
  return { index, message, call, result: result || undefined };
}

// Raw edits may change only these leaves. Everything else must match the displayed structure.
function validateRaw(before: unknown, after: unknown, paths: string[][]): void {
  const oldShape = structuredClone(before);
  const newShape = structuredClone(after);
  // These values are regenerated on save, so an older tab draft can retain them.
  for (const shape of [oldShape, newShape]) {
    const root = object(shape);
    const message = "result" in root ? object(root.result) : root;
    if (typeof message.role === "string") {
      delete message.updateTime;
      const meta = object(message.meta);
      delete meta.paramsMd;
      delete meta.resultMd;
      delete meta.reasoningSummary;
      // Paired result metadata is a display copy of the canonical call.function.
      if ("result" in root) delete meta.function;
      if (!Object.keys(meta).length) delete message.meta;
    }
  }
  for (const path of paths) {
    let oldParent = object(oldShape);
    let newParent = object(newShape);
    for (const key of path.slice(0, -1)) {
      oldParent = (oldParent[key] && typeof oldParent[key] === "object" ? oldParent[key] : {}) as ObjectValue;
      newParent = (newParent[key] && typeof newParent[key] === "object" ? newParent[key] : {}) as ObjectValue;
    }
    const key = path[path.length - 1];
    const value = newParent[key];
    if (key !== "arguments" && value !== undefined && value !== null && typeof value !== "string")
      throw new Error(`${path.join(".")} must be text or null.`);
    if ((key === "name" || key === "arguments") && typeof oldParent[key] === "string" && typeof value !== "string")
      throw new Error(`${path.join(".")} must be text.`);
    delete oldParent[key];
    delete newParent[key];
  }
  if (!isDeepStrictEqual(oldShape, newShape))
    throw new Error("Only content, thinking, and tool content can be edited. Keep all other fields unchanged.");
}
function messagePaths(message: SessionMessage): string[][] {
  const paths = [["content"]];
  if (message.messageParams && typeof message.messageParams === "object") {
    paths.push(["messageParams", "reasoning_content"]);
    calls(message).forEach((_, index) => {
      paths.push(["messageParams", "tool_calls", String(index), "function", "name"]);
      paths.push(["messageParams", "tool_calls", String(index), "function", "arguments"]);
    });
  }
  if (message.role === "tool" && message.meta?.function) {
    paths.push(["meta", "function", "name"], ["meta", "function", "arguments"]);
  }
  return paths;
}

/** Refresh authorization only when an unfinished call's function changes. Mutates the edited history. */
export function refreshEditedToolPermissions(
  original: SessionMessage[],
  edited: SessionMessage[],
  computePermissions: (toolCalls: unknown[]) => PermissionPlan
): PermissionPlan | undefined {
  const { message, pending } = getCurrentToolCallBatch(edited);
  if (!message) return;

  const previousCalls = new Map<string, PermissionToolCall>();
  for (const call of getCurrentToolCallBatch(original).pending) {
    const parsed = parseToolCallForPermissions(call);
    if (parsed) previousCalls.set(parsed.id, parsed);
  }
  const obsoleteIds = new Set<string>();
  for (const call of pending) {
    const parsed = parseToolCallForPermissions(call);
    const previous = parsed && previousCalls.get(parsed.id);
    if (!parsed || !previous || isDeepStrictEqual(previous.function, parsed.function)) continue;
    obsoleteIds.add(parsed.id);
    // A one-shot reply for the original arguments cannot authorize the edited call.
    object(call).id = generateToolCallId();
  }
  if (!obsoleteIds.size) return;

  const plan = computePermissions(pending);
  const replacedIds = new Set([...obsoleteIds, ...plan.permissions.map((permission) => permission.toolCallId)]);
  message.meta = {
    ...message.meta,
    permissions: [
      ...(message.meta?.permissions ?? []).filter((permission) => !replacedIds.has(permission.toolCallId)),
      ...plan.permissions,
    ],
  };
  return plan;
}

/** Edit a copy of the history; the caller persists it only after all validation succeeds. */
export function editSessionMessageHistory(
  history: SessionMessage[],
  target: SessionMessageTarget,
  tab: SessionMessageTab,
  text: string
): SessionMessage[] {
  const messages = structuredClone(history);
  const { index, message, call, result } = findTarget(messages, target);
  if (message.role === "user") throw new Error("User messages cannot be edited.");
  const now = new Date().toISOString();
  const touched = new Set<SessionMessage>([message]);
  if (call) {
    const fn = object(call.function);
    if (tab === "Parameters") call.function = { ...fn, arguments: text };
    else if (tab === "Result") {
      if (result) {
        result.content = text;
        touched.add(result);
      } else {
        if (typeof call.id !== "string" || !call.id) throw new Error("This tool call has no ID for a result.");
        const created: SessionMessage = {
          id: randomUUID(),
          sessionId: message.sessionId,
          role: "tool",
          content: text,
          contentParams: null,
          messageParams: { tool_call_id: call.id },
          compacted: message.compacted,
          visible: true,
          createTime: now,
          updateTime: now,
          meta: { function: structuredClone(fn) },
        };
        // Keep all results for this assistant together, before the next conversation message.
        let insertion = index + 1;
        while (messages[insertion]?.role === "tool") insertion++;
        messages.splice(insertion, 0, created);
      }
    } else if (tab === "Raw") {
      const parsed: unknown = JSON.parse(text);
      const before = result ? { call, result: rawMessage(result) } : call;
      const paths = [
        ["function", "name"],
        ["function", "arguments"],
      ];
      validateRaw(
        before,
        parsed,
        result
          ? [
              ...paths.map((path) => ["call", ...path]),
              ...messagePaths(result)
                .filter((path) => path[0] !== "meta")
                .map((path) => ["result", ...path]),
            ]
          : paths
      );
      const next = object(result ? object(parsed).call : parsed);
      call.function = next.function;
      if (result) {
        const nextResult = object(object(parsed).result);
        Object.assign(result, nextResult);
        result.content = typeof nextResult.content === "string" ? nextResult.content : null;
        touched.add(result);
      }
    } else throw new Error("This tab is not available for a tool call.");
    if (result) {
      result.meta = { ...result.meta, function: structuredClone(call.function) };
      touched.add(result);
    }
  } else if (tab === "Raw") {
    const parsed: unknown = JSON.parse(text);
    validateRaw(rawMessage(message), parsed, messagePaths(message));
    const next = object(parsed);
    message.content = typeof next.content === "string" ? next.content : null;
    message.messageParams = next.messageParams;
    if (next.meta) message.meta = next.meta as SessionMessage["meta"];
  } else if (tab === "Content" || (tab === "Result" && message.role === "tool")) message.content = text;
  else if (tab === "Thinking") message.messageParams = { ...object(message.messageParams), reasoning_content: text };
  else if (tab === "Parameters" && message.role === "tool") {
    message.meta = { ...message.meta, function: { ...object(message.meta?.function), arguments: text } };
  } else throw new Error("This tab is not available for this message.");

  // Tool result metadata also drives the ordinary chat view.
  if (message.role === "assistant")
    for (const toolCall of calls(message)) {
      const toolResult = messages
        .slice(index + 1)
        .find(
          (item) =>
            item.role === "tool" &&
            typeof toolCall.id === "string" &&
            object(item.messageParams).tool_call_id === toolCall.id
        );
      if (toolResult) {
        toolResult.meta = { ...toolResult.meta, function: structuredClone(toolCall.function) };
        touched.add(toolResult);
      }
    }
  for (const item of touched) {
    item.updateTime = now;
    delete item.html;
    if (item.meta) {
      delete item.meta.paramsMd;
      delete item.meta.resultMd;
      delete item.meta.reasoningSummary;
    }
  }
  return messages;
}

export function deleteSessionMessageHistory(history: SessionMessage[], target: SessionMessageTarget): SessionMessage[] {
  const messages = structuredClone(history);
  const { message, call, result } = findTarget(messages, target);
  if (call) {
    const remaining = calls(message).filter((_, index) => index !== target.toolCallIndex);
    const params = object(message.messageParams);
    if (remaining.length) params.tool_calls = remaining;
    else delete params.tool_calls;
    message.updateTime = new Date().toISOString();
    return messages.filter((item) => item !== result);
  }
  const ids = new Set(
    calls(message)
      .map((item) => item.id)
      .filter((id) => typeof id === "string" && id)
  );
  return messages.filter(
    (item) =>
      item !== message &&
      !(message.role === "assistant" && item.role === "tool" && ids.has(object(item.messageParams).tool_call_id))
  );
}
