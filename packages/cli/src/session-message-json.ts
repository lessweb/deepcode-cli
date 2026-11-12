import type { SessionMessage } from "@vegamo/deepcode-core";

export function formatSessionMessageJson(message: SessionMessage): string {
  return JSON.stringify(omitEmptyValues(message));
}

function omitEmptyValues(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map(omitEmptyValues).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, omitEmptyValues(item)] as const)
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}
