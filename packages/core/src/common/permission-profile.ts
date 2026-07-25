/**
 * Permission Profile 系统
 * 借鉴 OpenAI Codex CLI 的 PermissionProfile 结构化权限模型
 * 
 * 核心设计：
 * - Managed 模式：路径级别的细粒度 filesystem 权限 + network 控制
 * - Unrestricted 模式：完全放行（谨慎使用）
 * - 支持 glob 路径模式匹配
 * - ACL-like 的 allow/deny/readonly 三元控制
 */

import * as path from "path";
import * as os from "os";

// ─── 类型定义 ────────────────────────────────────────────

/** 文件系统访问级别 */
export type FileSystemAccessLevel = "read" | "write" | "deny";

/** 文件系统路径类型 */
export type FileSystemPathKind =
  | { type: "exact"; path: string }
  | { type: "glob"; pattern: string }
  | { type: "special"; kind: "project_root" | "tmpdir" | "home" | "data_dir" };

/** 文件系统沙箱条目 */
export interface FileSystemSandboxEntry {
  path: FileSystemPathKind;
  access: FileSystemAccessLevel;
}

/** 网络权限 */
export interface NetworkPermissions {
  /** 是否允许外部网络访问 */
  external: boolean;
  /** 允许的域名白名单（空 = 全部允许或全部禁止，取决于 external） */
  allowedHosts?: string[];
}

/** Git 操作权限 */
export interface GitPermissions {
  read: boolean;    // query-git-log
  write: boolean;   // mutate-git-log
}

/** Managed 模式下的详细权限配置 */
export interface ManagedPermissionConfig {
  fileSystem: FileSystemSandboxEntry[];
  network: NetworkPermissions;
  git: GitPermissions;
  /** glob 扫描最大深度 */
  globScanMaxDepth: number;
}

/** 权限 Profile 类型 */
export type PermissionProfile =
  | { mode: "unrestricted" }
  | { mode: "legacy"; readWriteRoots: string[] }
  | { mode: "managed"; config: ManagedPermissionConfig };

// ─── 预置 Profile ─────────────────────────────────────────

/** 严格隔离模式：只能读写项目目录，禁止外网 */
export const STRICT_SANDBOX_PROFILE: PermissionProfile = {
  mode: "managed",
  config: {
    fileSystem: [
      { path: { type: "special", kind: "project_root" }, access: "write" },
      { path: { type: "special", kind: "tmpdir" }, access: "write" },
      { path: { type: "glob", pattern: "**/node_modules/**" }, access: "read" },
      { path: { type: "glob", pattern: "**/.git/**" }, access: "read" },
      { path: { type: "special", kind: "home" }, access: "deny" },
    ],
    network: { external: false },
    git: { read: true, write: false },
    globScanMaxDepth: 50,
  },
};

/** 默认开发模式：可写项目目录，可访问外网 */
export const DEFAULT_DEV_PROFILE: PermissionProfile = {
  mode: "managed",
  config: {
    fileSystem: [
      { path: { type: "special", kind: "project_root" }, access: "write" },
      { path: { type: "special", kind: "tmpdir" }, access: "write" },
      { path: { type: "special", kind: "data_dir" }, access: "write" },
      { path: { type: "glob", pattern: "**/node_modules/**" }, access: "read" },
      { path: { type: "glob", pattern: "**/.git/**" }, access: "write" },
    ],
    network: { external: true },
    git: { read: true, write: true },
    globScanMaxDepth: 100,
  },
};

/** 完全放行模式（= Codex 的 Unrestricted） */
export const UNRESTRICTED_PROFILE: PermissionProfile = { mode: "unrestricted" };

/** 从旧的 PermissionScope[] 迁移的兼容 profile */
export function legacyProfileFromScopes(allowScopes: string[]): PermissionProfile {
  const hasNetwork = allowScopes.includes("network");
  const hasGitWrite = allowScopes.includes("mutate-git-log");

  return {
    mode: "managed",
    config: {
      fileSystem: [
        {
          path: { type: "special", kind: "project_root" },
          access: allowScopes.includes("write-out-cwd") ? "write" : "read",
        },
        { path: { type: "special", kind: "tmpdir" }, access: "write" },
        {
          path: { type: "special", kind: "home" },
          access: allowScopes.includes("write-out-cwd") ? "write" : "deny",
        },
      ],
      network: { external: hasNetwork },
      git: { read: true, write: hasGitWrite },
      globScanMaxDepth: 50,
    },
  };
}

// --- Simple Glob Matching Engine -----------------------------------

/**
 * Simple glob matching supporting recursive (double-star-slash) patterns
 * and single-level (single-star) matches.
 * No external dependencies needed - covers all Codex-common use cases.
 */
function matchGlob(target: string, pattern: string): boolean {
  let regexStr = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*" && pattern[i + 2] === "/") {
      regexStr += "(?:.*[/\\\\])?";
      i += 3;
    } else if (ch === "*" && pattern[i + 1] === "*") {
      regexStr += ".*";
      i += 2;
    } else if (ch === "*") {
      regexStr += "[^/\\\\]*";
      i += 1;
    } else if (ch === "?") {
      regexStr += "[^/\\\\]";
      i += 1;
    } else if (ch === ".") {
      regexStr += "\\.";
      i += 1;
    } else if (ch === "/" || ch === "\\") {
      // Path separator: match both / and \ (cross-platform)
      regexStr += "[/\\\\]";
      i += 1;
    } else {
      regexStr += ch;
      i += 1;
    }
  }

  try {
    const re = new RegExp(`^${regexStr}$`, "i");
    return re.test(target);
  } catch {
    return target.toLowerCase().includes(pattern.toLowerCase().replace(/\*\*/g, ""));
  }
}

// ─── 路径匹配引擎 ─────────────────────────────────────────

/**
 * 将 FileSystemPathKind 解析为实际的文件系统路径列表
 */
function resolvePathKind(
  kind: FileSystemPathKind,
  context: { projectRoot: string; dataDir: string }
): string[] {
  switch (kind.type) {
    case "exact":
      return [kind.path];
    case "glob":
      return [kind.pattern];
    case "special":
      switch (kind.kind) {
        case "project_root":
          return [context.projectRoot];
        case "tmpdir":
          return [os.tmpdir()];
        case "home":
          return [os.homedir()];
        case "data_dir":
          return [context.dataDir];
      }
  }
}

/**
 * 检查目标路径是否被允许访问
 * 
 * 匹配规则（类似 ACL）：
 * 1. 如果有 deny 匹配 → 拒绝
 * 2. 如果有 write 匹配 → 允许写入
 * 3. 如果有 read 匹配 → 允许读取
 * 4. 无匹配 → 拒绝（默认安全）
 */
export function checkFileSystemAccess(
  targetPath: string,
  profile: PermissionProfile,
  context: { projectRoot: string; dataDir: string }
): { allowed: boolean; writeAccess: boolean; matchedBy?: string } {
  if (profile.mode === "unrestricted") {
    return { allowed: true, writeAccess: true };
  }

  const entries: FileSystemSandboxEntry[] =
    profile.mode === "legacy"
      ? profile.readWriteRoots.map((p) => ({
          path: { type: "exact" as const, path: p },
          access: "write" as FileSystemAccessLevel,
        }))
      : profile.config.fileSystem;

  const normalizedTarget = path.resolve(targetPath).toLowerCase();

  let matchedAccess: FileSystemAccessLevel | null = null;
  let matchedBy: string | undefined;

  for (const entry of entries) {
    const resolvedPaths = resolvePathKind(entry.path, context);
    for (const rp of resolvedPaths) {
      // Don't call path.resolve() on glob patterns - it prepends CWD on Windows!
      const normalizedEntry = entry.path.type === "glob"
        ? rp.toLowerCase()
        : path.resolve(rp).toLowerCase();

      let matches = false;
      if (entry.path.type === "glob") {
        matches = matchGlob(normalizedTarget, normalizedEntry);
      } else if (entry.path.type === "exact") {
        matches =
          normalizedTarget === normalizedEntry ||
          normalizedTarget.startsWith(normalizedEntry + path.sep);
      } else {
        matches = normalizedTarget.startsWith(normalizedEntry);
      }

      if (matches) {
        matchedBy = formatPathKind(entry.path);
        if (entry.access === "deny") {
          return { allowed: false, writeAccess: false, matchedBy };
        }
        if (entry.access === "write") {
          matchedAccess = "write";
        } else if (entry.access === "read" && matchedAccess !== "write") {
          matchedAccess = "read";
        }
      }
    }
  }

  return {
    allowed: matchedAccess !== null,
    writeAccess: matchedAccess === "write",
    matchedBy,
  };
}

/**
 * 检查网络访问是否被允许
 */
export function checkNetworkAccess(
  host: string | undefined,
  profile: PermissionProfile
): boolean {
  if (profile.mode === "unrestricted") return true;
  if (profile.mode === "legacy") return true;

  const net = profile.config.network;
  if (!net.external) return false;
  if (!host || !net.allowedHosts || net.allowedHosts.length === 0) return true;
  return net.allowedHosts.some((allowed: string) => host.includes(allowed));
}

/**
 * 检查 Git 操作是否被允许
 */
export function checkGitAccess(
  operation: "read" | "write",
  profile: PermissionProfile
): boolean {
  if (profile.mode === "unrestricted") return true;
  if (profile.mode === "legacy") return true;
  return operation === "read" ? profile.config.git.read : profile.config.git.write;
}

// ─── 工具函数 ─────────────────────────────────────────────

function formatPathKind(kind: FileSystemPathKind): string {
  switch (kind.type) {
    case "exact": return `path:${kind.path}`;
    case "glob": return `glob:${kind.pattern}`;
    case "special": return `special:${kind.kind}`;
  }
}

/**
 * 将 JSON 配置解析为 PermissionProfile
 */
export function parsePermissionProfile(config: unknown): PermissionProfile {
  if (!config || typeof config !== "object") {
    return DEFAULT_DEV_PROFILE;
  }
  const cfg = config as Record<string, unknown>;

  if (cfg.mode === "unrestricted") {
    return UNRESTRICTED_PROFILE;
  }

  if (cfg.mode === "legacy" && Array.isArray(cfg.readWriteRoots)) {
    return {
      mode: "legacy",
      readWriteRoots: cfg.readWriteRoots.map(String),
    };
  }

  // 从 settings 中的 PermissionSettings 自动推断
  const allowList = (cfg.allow as string[]) ?? [];
  if (allowList.length > 0 || cfg.mode === "managed") {
    return legacyProfileFromScopes(allowList);
  }

  return DEFAULT_DEV_PROFILE;
}
