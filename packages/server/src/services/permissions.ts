/**
 * Permission request normalization helpers.
 *
 * Summary:
 * Converts frontend permission reply payloads into core UserToolPermission and
 * PermissionScope values.
 *
 * Exports:
 * - normalizeUserPermissions(value: unknown): UserToolPermission[]
 * - normalizePermissionScopes(value: unknown): PermissionScope[] | undefined
 */
import type { PermissionScope, UserToolPermission } from "@vegamo/deepcode-core";

const VALID_PERMISSION_SCOPES = new Set<PermissionScope>([
  "read-in-cwd",
  "read-out-cwd",
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "mcp",
]);

export function normalizeUserPermissions(value: unknown): UserToolPermission[] {
  const entries = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([toolCallId, permission]) => ({ toolCallId, permission }))
      : [];
  return entries
    .map((item) => {
      if (!isRecord(item) || typeof item.toolCallId !== "string") {
        return null;
      }
      if (item.permission !== "allow" && item.permission !== "deny") {
        return null;
      }
      return { toolCallId: item.toolCallId, permission: item.permission } satisfies UserToolPermission;
    })
    .filter((item): item is UserToolPermission => item !== null);
}

export function normalizePermissionScopes(value: unknown): PermissionScope[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const scopes = value.filter(
    (item): item is PermissionScope => typeof item === "string" && VALID_PERMISSION_SCOPES.has(item as PermissionScope)
  );
  return scopes.length > 0 ? Array.from(new Set(scopes)) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
