/**
 * 增强版 SKILL.md 解析器
 * 借鉴 OpenAI Codex CLI 的 Skill frontmatter 格式
 * 
 * 支持完整的 Codex 兼容 frontmatter：
 * - name, description 基础字段
 * - agent.dependencies 依赖声明
 * - agent.interface 接口配置
 * - agent.policy 策略声明
 * - disable-model-invocation 禁用标志
 */

import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

// ─── 类型定义 ────────────────────────────────────────────

/** Skill 依赖声明 */
export interface SkillDependency {
  /** 依赖的 Skill 名称 */
  name: string;
  /** 版本要求（可选） */
  version?: string;
  /** 来源路径（可选） */
  source?: string;
}

/** Skill 接口配置 */
export interface SkillInterface {
  /** 默认提示词（Agent 进入 Skill 时的初始 prompt） */
  defaultPrompt?: string;
  /** 品牌色（#RRGGBB 格式） */
  brandColor?: string;
  /** 截图路径列表 */
  screenshots?: string[];
}

/** Skill 策略声明 */
export interface SkillPolicy {
  /** 需要的权限 scope 列表 */
  requiredPermissions?: string[];
  /** 是否允许网络访问 */
  allowNetwork?: boolean;
  /** 是否允许 Git 写入 */
  allowGitWrite?: boolean;
  /** 允许的路径模式 */
  allowedPaths?: string[];
  /** 拒绝的路径模式 */
  deniedPaths?: string[];
}

/** 解析后的 Skill 元数据 */
export interface SkillMeta {
  /** Skill 名称 */
  name: string;
  /** 描述（给 Agent 看的触发关键词） */
  description: string;
  /** Agent 配置 */
  agent?: {
    /** 依赖的 Skills */
    dependencies?: SkillDependency[];
    /** UI 接口配置 */
    interface?: SkillInterface;
    /** 权限策略 */
    policy?: SkillPolicy;
  };
  /** 禁用模型调用（纯工具 Skill） */
  disableModelInvocation?: boolean;
  /** 其他原始 frontmatter 字段 */
  raw: Record<string, unknown>;
}

// ─── 解析器 ───────────────────────────────────────────────

const MAX_SKILL_NAME_LENGTH = 64;
const ALLOWED_FRONTMATTER_KEYS = new Set([
  "name", "description", "agent", "disable-model-invocation",
  "metadata",
]);

// 这些常量保留供后续验证扩展用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ALLOWED_AGENT_KEYS = new Set([
  "dependencies", "interface", "policy",
]);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ALLOWED_INTERFACE_KEYS = new Set([
  "default-prompt", "default_prompt", "brand-color", "brand_color",
  "screenshots",
]);

/**
 * 解析 SKILL.md 文件内容
 */
export function parseSkillFile(filePath: string): SkillMeta {
  const content = fs.readFileSync(filePath, "utf8");
  return parseSkillContent(content, path.basename(path.dirname(filePath)));
}

/**
 * 解析 SKILL.md 文本内容
 */
export function parseSkillContent(
  raw: string,
  fallbackName: string
): SkillMeta {
  const parsed = matter(raw);
  const frontmatter = parsed.data ?? {};

  // 校验无效字段
  const unexpectedKeys = Object.keys(frontmatter).filter(
    (k) => !ALLOWED_FRONTMATTER_KEYS.has(k) && k !== "metadata"
  );
  if (unexpectedKeys.length > 0 && !("metadata" in frontmatter)) {
    // 静默忽略，保持向前兼容
  }

  // name（必需）
  const name = typeof frontmatter.name === "string" && frontmatter.name.trim()
    ? frontmatter.name.trim()
    : fallbackName;

  // description（推荐）
  const description = typeof frontmatter.description === "string"
    ? frontmatter.description.trim()
    : "";

  // agent 配置
  const agentRaw = frontmatter.agent;
  const agent = parseAgentConfig(agentRaw);

  // disable-model-invocation
  const disableModelInvocation = frontmatter["disable-model-invocation"] === true;

  return {
    name,
    description,
    agent: Object.keys(agent ?? {}).length > 0 ? agent : undefined,
    disableModelInvocation,
    raw: frontmatter as Record<string, unknown>,
  };
}

function parseAgentConfig(agentRaw: unknown): SkillMeta["agent"] {
  if (!agentRaw || typeof agentRaw !== "object" || Array.isArray(agentRaw)) {
    return undefined;
  }

  const agent = agentRaw as Record<string, unknown>;
  const result: SkillMeta["agent"] = {};

  // dependencies
  if (agent.dependencies) {
    result.dependencies = parseDependencies(agent.dependencies);
  }

  // interface
  if (agent.interface) {
    result.interface = parseInterface(agent.interface);
  }

  // policy
  if (agent.policy) {
    result.policy = parsePolicy(agent.policy);
  }

  return result;
}

function parseDependencies(deps: unknown): SkillDependency[] {
  if (Array.isArray(deps)) {
    return deps
      .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
      .map((d) => {
        const dep = d as Record<string, unknown>;
        return {
          name: String(dep.name ?? ""),
          version: typeof dep.version === "string" ? dep.version : undefined,
          source: typeof dep.source === "string" ? dep.source : undefined,
        };
      })
      .filter((d) => d.name.length > 0);
  }

  if (typeof deps === "object" && deps !== null) {
    // 对象格式: { "skill-name": "path" }
    return Object.entries(deps).map(([name, source]) => ({
      name,
      source: typeof source === "string" ? source : undefined,
    }));
  }

  return [];
}

function parseInterface(iface: unknown): SkillInterface | undefined {
  if (!iface || typeof iface !== "object" || Array.isArray(iface)) {
    return undefined;
  }

  const raw = iface as Record<string, unknown>;
  const result: SkillInterface = {};

  // default_prompt (支持两种命名)
  result.defaultPrompt = String(
    raw["default_prompt"] ?? raw["default-prompt"] ?? ""
  ) || undefined;

  // brand_color
  const brandColor = String(raw["brand_color"] ?? raw["brand-color"] ?? "");
  if (/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
    result.brandColor = brandColor;
  }

  // screenshots
  if (Array.isArray(raw.screenshots)) {
    result.screenshots = raw.screenshots.map(String).filter((s) => s.length > 0);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parsePolicy(policy: unknown): SkillPolicy | undefined {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return undefined;
  }

  const raw = policy as Record<string, unknown>;
  const result: SkillPolicy = {};

  if (Array.isArray(raw.requiredPermissions)) {
    result.requiredPermissions = raw.requiredPermissions.map(String);
  }
  if (typeof raw.allowNetwork === "boolean") {
    result.allowNetwork = raw.allowNetwork;
  }
  if (typeof raw.allowGitWrite === "boolean") {
    result.allowGitWrite = raw.allowGitWrite;
  }
  if (Array.isArray(raw.allowedPaths)) {
    result.allowedPaths = raw.allowedPaths.map(String);
  }
  if (Array.isArray(raw.deniedPaths)) {
    result.deniedPaths = raw.deniedPaths.map(String);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * 从 Skill policy 生成 PermissionProfile
 */
import {
  type PermissionProfile,
  type FileSystemSandboxEntry,
  DEFAULT_DEV_PROFILE,
} from "./permission-profile";

export function skillPolicyToProfile(
  policy: SkillPolicy | undefined,
  _projectRoot: string
): PermissionProfile {
  if (!policy) return DEFAULT_DEV_PROFILE;

  const entries: FileSystemSandboxEntry[] = [
    { path: { type: "special", kind: "project_root" }, access: "write" },
    { path: { type: "special", kind: "tmpdir" }, access: "write" },
  ];

  // allowedPaths → write
  for (const p of policy.allowedPaths ?? []) {
    entries.push({
      path: p.includes("*") ? { type: "glob", pattern: p } : { type: "exact", path: p },
      access: "write",
    });
  }

  // deniedPaths → deny
  for (const p of policy.deniedPaths ?? []) {
    entries.push({
      path: p.includes("*") ? { type: "glob", pattern: p } : { type: "exact", path: p },
      access: "deny",
    });
  }

  return {
    mode: "managed",
    config: {
      fileSystem: entries,
      network: { external: policy.allowNetwork ?? true },
      git: { read: true, write: policy.allowGitWrite ?? true },
      globScanMaxDepth: 50,
    },
  };
}

/**
 * 验证 Skill 名称合法性
 */
export function validateSkillName(name: string): string | null {
  if (!name || !name.trim()) {
    return "Skill name must not be empty";
  }
  if (name.length > MAX_SKILL_NAME_LENGTH) {
    return `Skill name is too long (${name.length} characters). Maximum is ${MAX_SKILL_NAME_LENGTH} characters.`;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    return "Skill name must start with a letter or number, and contain only letters, numbers, underscores, and hyphens";
  }
  return null;
}
