import type { PermissionScope, UserToolPermission } from "@vegamo/deepcode-core";

export const PLUS_PACKAGES_URL = "https://deepcode.vegamo.cn/plus/packages";

export function isAllowedExternalUrl(value: unknown): value is string {
  return value === PLUS_PACKAGES_URL;
}

export const VALID_PERMISSION_SCOPES = new Set<PermissionScope>([
  "read-in-cwd",
  "read-in-tmp",
  "read-out-cwd",
  "write-in-cwd",
  "write-in-tmp",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "mcp",
]);

export function parseUserToolPermissions(value: unknown): UserToolPermission[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: UserToolPermission[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as { toolCallId?: unknown; permission?: unknown };
    if (typeof record.toolCallId !== "string" || !record.toolCallId.trim()) {
      continue;
    }
    if (record.permission !== "allow" && record.permission !== "deny") {
      continue;
    }
    result.push({ toolCallId: record.toolCallId, permission: record.permission });
  }
  return result;
}

export function parsePermissionScopes(value: unknown): PermissionScope[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: PermissionScope[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !VALID_PERMISSION_SCOPES.has(item as PermissionScope)) {
      continue;
    }
    const scope = item as PermissionScope;
    if (!result.includes(scope)) {
      result.push(scope);
    }
  }
  return result;
}

export function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/** Collect attachment URLs without interpreting URLs inside message text. */
export function collectPromptImageUrls(value: unknown): string[] {
  const urls = new Set<string>();
  function visit(item: unknown): void {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (key === "imageUrls" && Array.isArray(child)) {
        for (const url of child) if (typeof url === "string") urls.add(url);
      } else if (key === "image_url" && child && typeof child === "object" && "url" in child) {
        if (typeof child.url === "string") urls.add(child.url);
      } else visit(child);
    }
  }
  visit(value);
  return [...urls];
}
